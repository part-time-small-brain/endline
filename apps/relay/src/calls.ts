import { AccountId, Call, type CallRequest, callableAt, callPoints, FREE_CALLS_PER_ROUND, type Leaderboard, type Mark, nextRound, roundOf, SECONDS_PER_DAY, type Series, type Standing, termsOf } from "@endline/sdk";
import { z } from "zod";
import { FINAL_MARGIN_SEC } from "./collect.ts";
import { JsonFile } from "./jsonFile.ts";
import { HttpError, listed, open } from "./relay.ts";
import type { Chain } from "./rpc.ts";
import type { Sessions } from "./session.ts";

const MAX_CALLS = 10_000;
const MAX_CALLS_PER_CLIENT = 10 * FREE_CALLS_PER_ROUND;
const BOARD_SIZE = 20;
const ROUNDS_KEPT = 7;
const WIN_DAYS_KEPT = 60;
const UNPRICED_KEEP_SEC = 7 * SECONDS_PER_DAY;

const Score = z.object({ points: z.number().int(), wins: z.number().int() });
type Score = z.infer<typeof Score>;
const State = z.object({
  calls: z.array(Call.extend({ client: z.string().optional() })),
  rounds: z.array(z.object({ date: z.string(), players: z.record(z.string(), Score) })),
  wins: z.record(z.string(), z.array(z.string())),
});
type State = z.infer<typeof State>;

const dayBefore = (date: string) => new Date(Date.parse(date) - SECONDS_PER_DAY * 1000).toISOString().slice(0, 10);
const newestFirst = <T extends { date: string }>(rounds: T[]) => [...rounds].sort((a, b) => (a.date < b.date ? 1 : -1));

export class Calls {
  private file: JsonFile<State>;
  private state: State = { calls: [], rounds: [], wins: {} };
  private ranked: Omit<Leaderboard, "you"> | undefined;

  constructor(
    private chain: Chain,
    private sessions: Sessions,
    private marks: () => Mark[],
    dir: string,
    private maxCalls = MAX_CALLS,
  ) {
    this.file = new JsonFile(dir, "calls.json", State);
  }

  async load(): Promise<void> {
    this.state = await this.file.read(this.state);
    this.ranked = undefined;
  }

  async add({ series_id, signer, session }: CallRequest, client: string): Promise<Call> {
    if (!AccountId.safeParse(signer.signer_id).success) throw new HttpError(400, "signer_id is not a valid intents account");
    await this.sessions.check(session, signer);
    const [all, contract] = await Promise.all([this.chain.listSeries(), this.chain.contractConfig()]);
    const series = all.find((s) => s.id === series_id);
    if (!series) throw new HttpError(404, "unknown series");
    const callable = (s: Series) => listed(s, contract) && open(s, contract) && callableAt(s.expiry, Date.now() / 1000);
    if (!listed(series, contract) || !open(series, contract)) throw new HttpError(409, "this market is closed");
    if (!callable(series)) throw new HttpError(409, "the final round has started: calls close when the averaging window opens");
    const round = roundOf(series.expiry);
    if (round !== nextRound(all.filter(callable).map((s) => s.expiry))) throw new HttpError(409, "free calls are open only for the next round");
    const checkRoom = () => {
      if (this.state.calls.some((c) => c.account_id === signer.signer_id && c.series_id === series_id)) throw new HttpError(409, "you already called this cell");
      const inRound = this.state.calls.filter((c) => roundOf(c.terms.expiry) === round);
      if (inRound.filter((c) => c.account_id === signer.signer_id).length >= FREE_CALLS_PER_ROUND) throw new HttpError(429, `you've used your ${FREE_CALLS_PER_ROUND} free calls for this round`);
      if (inRound.filter((c) => c.client === client).length >= MAX_CALLS_PER_CLIENT) throw new HttpError(429, "your network has used its free calls for this round");
      if (inRound.filter((c) => !c.result).length >= this.maxCalls) throw new HttpError(503, "free calls are full for this round");
    };
    checkRoom();
    const mark = this.marks().find((m) => m.series_id === series_id);
    if (!mark) throw new HttpError(503, "no price for this cell right now");
    if (BigInt(mark.ask) >= BigInt(series.width)) throw new HttpError(409, "this cell can't pay more than it costs");
    const dollar = 10n ** BigInt(contract.quote_decimals);
    if ((await this.chain.balanceOf(signer.signer_id, contract.quote_asset)) < dollar) throw new HttpError(402, "a free call needs at least $1 of USDC in this wallet's NEAR Intents balance: deposit first");
    // again: other calls may have landed while balanceOf was awaited
    checkRoom();
    const { id, ...terms } = series;
    const call: Call = { series_id: id, account_id: signer.signer_id, terms, ask: mark.ask, at_ms: Date.now() };
    const stored = { ...call, client };
    this.state.calls.push(stored);
    try {
      await this.file.write(this.state);
    } catch (error) {
      this.state.calls = this.state.calls.filter((c) => c !== stored);
      throw error;
    }
    return call;
  }

  byAccount(accountId: string): Call[] {
    return this.state.calls
      .filter((c) => c.account_id === accountId)
      .map(({ client: _, ...call }) => call)
      .sort((a, b) => b.at_ms - a.at_ms);
  }

  async score(): Promise<void> {
    const nowSec = Date.now() / 1000;
    const due = new Map<string, Call[]>();
    for (const call of this.state.calls) {
      if (call.result || call.terms.expiry > nowSec) continue;
      const key = `${call.terms.underlying}:${call.terms.expiry}`;
      due.set(key, [...(due.get(key) ?? []), call]);
    }
    let changed = false;
    for (const [first, ...rest] of due.values()) {
      if (!first) continue;
      const settlement = await this.chain.settlement(first.terms.underlying, first.terms.expiry).catch((error: unknown) => {
        console.error("free calls: can't read the settlement yet", first.terms.underlying, first.terms.expiry, error);
        return null;
      });
      if (!settlement || nowSec < settlement.final_at + FINAL_MARGIN_SEC) continue;
      for (const call of [first, ...rest]) this.settle(call, settlement.price);
      changed = true;
    }
    if (this.prune(nowSec) || changed) {
      this.ranked = undefined;
      await this.file.write(this.state);
    }
  }

  board(accountId?: string): Leaderboard {
    const board = (this.ranked ??= this.rank());
    if (accountId === undefined) return { ...board, today: board.today.slice(0, BOARD_SIZE), week: board.week.slice(0, BOARD_SIZE) };
    const find = (rows: Standing[]) => rows.find((s) => s.account_id === accountId) ?? null;
    return { round: board.round, today: board.today.slice(0, BOARD_SIZE), week: board.week.slice(0, BOARD_SIZE), you: { today: find(board.today), week: find(board.week) } };
  }

  private rank(): Omit<Leaderboard, "you"> {
    const rounds = newestFirst(this.state.rounds);
    const latest = rounds[0];
    const streakOf = (id: string) => {
      const won = new Set(Object.hasOwn(this.state.wins, id) ? this.state.wins[id] : []);
      let streak = 0;
      for (let day = latest?.date; day && won.has(day); day = dayBefore(day)) streak++;
      return streak;
    };
    const rank = (players: Record<string, Score>): Standing[] =>
      Object.entries(players)
        .sort(([a, x], [b, y]) => y.points - x.points || y.wins - x.wins || (a < b ? -1 : 1))
        .map(([id, s], i) => ({ account_id: id, rank: i + 1, points: s.points, wins: s.wins, streak: streakOf(id) }));
    const week = new Map<string, Score>();
    for (const round of rounds) {
      for (const [id, s] of Object.entries(round.players)) {
        const total = week.get(id) ?? { points: 0, wins: 0 };
        week.set(id, { points: total.points + s.points, wins: total.wins + s.wins });
      }
    }
    return { round: latest?.date ?? null, today: rank(latest?.players ?? {}), week: rank(Object.fromEntries(week)) };
  }

  private settle(call: Call, price: string): void {
    const points = callPoints(termsOf(call.terms), BigInt(call.ask), BigInt(price));
    call.result = { price, points };
    const date = roundOf(call.terms.expiry);
    let round = this.state.rounds.find((r) => r.date === date);
    if (!round) this.state.rounds.push((round = { date, players: {} }));
    const before = Object.hasOwn(round.players, call.account_id) ? round.players[call.account_id] : undefined;
    round.players[call.account_id] = { points: (before?.points ?? 0) + points, wins: (before?.wins ?? 0) + (points > 0 ? 1 : 0) };
    if (points <= 0) return;
    const won = (Object.hasOwn(this.state.wins, call.account_id) && this.state.wins[call.account_id]) || [];
    if (!won.includes(date)) this.state.wins[call.account_id] = [...won, date].sort();
  }

  private prune(nowSec: number): boolean {
    const calls = this.state.calls.filter((c) => c.terms.expiry > nowSec - (c.result ? SECONDS_PER_DAY : UNPRICED_KEEP_SEC));
    const rounds = newestFirst(this.state.rounds).slice(0, ROUNDS_KEPT);
    const latest = rounds[0]?.date;
    // a round can be scored up to UNPRICED_KEEP_SEC late, and the day before it can extend a streak
    const oldest = latest && roundOf(Date.parse(latest) / 1000 - UNPRICED_KEEP_SEC - SECONDS_PER_DAY);
    const live = Object.entries(this.state.wins).filter(([, days]) => !oldest || (days.at(-1) ?? "") >= oldest);
    const entries = live.map(([id, days]) => [id, days.slice(-WIN_DAYS_KEPT)] as const);
    const changed = calls.length !== this.state.calls.length || rounds.length !== this.state.rounds.length || entries.length !== Object.keys(this.state.wins).length || entries.some(([id, days]) => days.length !== this.state.wins[id]?.length);
    this.state = { calls, rounds, wins: Object.fromEntries(entries) };
    return changed;
  }
}
