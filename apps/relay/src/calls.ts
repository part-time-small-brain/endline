import { AccountId, Call, type CallRequest, callPoints, CLAIM_WINDOW_SEC, FREE_CALLS_PER_ROUND, type Leaderboard, type Mark, roundOf, SECONDS_PER_DAY, type Series, type Standing, termsOf, TWAP_WINDOW_SEC } from "@endline/sdk";
import { z } from "zod";
import { FINAL_MARGIN_SEC } from "./collect.ts";
import { JsonFile } from "./jsonFile.ts";
import { HttpError, listed, open } from "./relay.ts";
import type { Chain } from "./rpc.ts";
import type { Sessions } from "./session.ts";

const MAX_CALLS = 10_000;
const BOARD_SIZE = 20;
const ROUNDS_KEPT = 7;

const Score = z.object({ points: z.number().int(), wins: z.number().int() });
type Score = z.infer<typeof Score>;
const State = z.object({
  calls: z.array(Call),
  rounds: z.array(z.object({ date: z.string(), players: z.record(z.string(), Score) })),
  streaks: z.record(z.string(), z.object({ streak: z.number().int(), last: z.string() })),
});
type State = z.infer<typeof State>;

const dayBefore = (date: string) => new Date(Date.parse(date) - SECONDS_PER_DAY * 1000).toISOString().slice(0, 10);
const newestFirst = <T extends { date: string }>(rounds: T[]) => [...rounds].sort((a, b) => (a.date < b.date ? 1 : -1));

export class Calls {
  private file: JsonFile<State>;
  private state: State = { calls: [], rounds: [], streaks: {} };

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
  }

  async add({ series_id, signer, session }: CallRequest): Promise<Call> {
    if (!AccountId.safeParse(signer.signer_id).success) throw new HttpError(400, "signer_id is not a valid intents account");
    await this.sessions.check(session, signer);
    const [all, contract] = await Promise.all([this.chain.listSeries(), this.chain.contractConfig()]);
    const series = all.find((s) => s.id === series_id);
    if (!series) throw new HttpError(404, "unknown series");
    const callable = (s: Series) => listed(s, contract) && open(s, contract) && Date.now() < (s.expiry - TWAP_WINDOW_SEC) * 1000;
    if (!listed(series, contract) || !open(series, contract)) throw new HttpError(409, "this market is closed");
    if (!callable(series)) throw new HttpError(409, "the final round has started: calls close when the averaging window opens");
    const round = roundOf(series.expiry);
    if (round !== all.filter(callable).map((s) => roundOf(s.expiry)).sort()[0]) throw new HttpError(409, "free calls are open only for the next round");
    const mine = this.state.calls.filter((c) => c.account_id === signer.signer_id);
    if (mine.some((c) => c.series_id === series_id)) throw new HttpError(409, "you already called this cell");
    const mark = this.marks().find((m) => m.series_id === series_id);
    if (!mark) throw new HttpError(503, "no price for this cell right now");
    if (BigInt(mark.ask) >= BigInt(series.width)) throw new HttpError(409, "this cell can't pay more than it costs");
    if (mine.filter((c) => roundOf(c.terms.expiry) === round).length >= FREE_CALLS_PER_ROUND) throw new HttpError(429, `you've used your ${FREE_CALLS_PER_ROUND} free calls for this round`);
    if (this.state.calls.length >= this.maxCalls) throw new HttpError(503, "free calls are full for this round");
    const { id, ...terms } = series;
    const call: Call = { series_id: id, account_id: signer.signer_id, terms, ask: mark.ask, at_ms: Date.now() };
    this.state.calls.push(call);
    await this.file.write(this.state);
    return call;
  }

  byAccount(accountId: string): Call[] {
    return this.state.calls.filter((c) => c.account_id === accountId).sort((a, b) => b.at_ms - a.at_ms);
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
      const settlement = await this.chain.settlement(first.terms.underlying, first.terms.expiry);
      if (!settlement || nowSec < settlement.final_at + FINAL_MARGIN_SEC) continue;
      for (const call of [first, ...rest]) this.settle(call, settlement.price);
      changed = true;
    }
    if (this.prune(nowSec) || changed) await this.file.write(this.state);
  }

  board(accountId?: string): Leaderboard {
    const rounds = newestFirst(this.state.rounds);
    const latest = rounds[0];
    const streakOf = (id: string) => {
      const s = this.state.streaks[id];
      return s && s.last === latest?.date ? s.streak : 0;
    };
    const rank = (players: Record<string, Score>): Standing[] =>
      Object.entries(players)
        .sort(([a, x], [b, y]) => y.points - x.points || y.wins - x.wins || (a < b ? -1 : 1))
        .map(([id, s], i) => ({ account_id: id, rank: i + 1, points: s.points, wins: s.wins, streak: streakOf(id) }));
    const week: Record<string, Score> = {};
    for (const round of rounds) {
      for (const [id, s] of Object.entries(round.players)) {
        const total = (week[id] ??= { points: 0, wins: 0 });
        total.points += s.points;
        total.wins += s.wins;
      }
    }
    const today = rank(latest?.players ?? {});
    const all = rank(week);
    const board = { round: latest?.date ?? null, today: today.slice(0, BOARD_SIZE), week: all.slice(0, BOARD_SIZE) };
    if (accountId === undefined) return board;
    return { ...board, you: { today: today.find((s) => s.account_id === accountId) ?? null, week: all.find((s) => s.account_id === accountId) ?? null } };
  }

  private settle(call: Call, price: string): void {
    const points = callPoints(termsOf(call.terms), BigInt(call.ask), BigInt(price));
    call.result = { price, points };
    const date = roundOf(call.terms.expiry);
    let round = this.state.rounds.find((r) => r.date === date);
    if (!round) this.state.rounds.push((round = { date, players: {} }));
    const player = (round.players[call.account_id] ??= { points: 0, wins: 0 });
    player.points += points;
    if (points <= 0) return;
    player.wins += 1;
    const streak = this.state.streaks[call.account_id];
    if (streak?.last === date) return;
    this.state.streaks[call.account_id] = { streak: streak?.last === dayBefore(date) ? streak.streak + 1 : 1, last: date };
  }

  private prune(nowSec: number): boolean {
    const calls = this.state.calls.filter((c) => c.terms.expiry > nowSec - (c.result ? SECONDS_PER_DAY : CLAIM_WINDOW_SEC));
    const rounds = newestFirst(this.state.rounds).slice(0, ROUNDS_KEPT);
    const latest = rounds[0]?.date;
    const streaks = Object.fromEntries(Object.entries(this.state.streaks).filter(([, s]) => latest === undefined || s.last >= dayBefore(latest)));
    const changed = calls.length !== this.state.calls.length || rounds.length !== this.state.rounds.length || Object.keys(streaks).length !== Object.keys(this.state.streaks).length;
    this.state = { calls, rounds, streaks };
    return changed;
  }
}
