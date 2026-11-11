import { isDeepStrictEqual } from "node:util";
import { exerciseOptions, type Fill, longPayout, MIN_RELAYED_PAYOUT_USD, maxPayout, parseTokenId, readPayload, type Series, type Settlement, type SignedPayload, termsOf } from "@endline/sdk";
import type { Claims } from "./claims.ts";
import type { Config } from "./config.ts";
import type { Fills } from "./fills.ts";
import { HttpError } from "./relay.ts";
import { type Chain, ranTx, Rejected } from "./rpc.ts";

// block time can trail our clock, and an exercise before final_at burns the signer's nonce
export const FINAL_MARGIN_SEC = 60;
const MAX_CLAIMS = 1_000;
const MAX_CLAIMS_PER_ACCOUNT = 100;
const MAX_DEADLINE_MS = 10 * 60_000;
// intents rechecks the deadline on-chain, and near-api-js retries a send for up to ~85 s: a payload that expires first burns our gas
const MIN_DEADLINE_MS = 2 * 60_000;

interface Exercise {
  signerId: string;
  nonce: string;
  deadlineMs: number;
  tokens: Record<string, bigint>;
}

type Settings = Pick<Config, "intents_id" | "options_id">;

interface Leg {
  asset: string;
  series: Series;
  amount: bigint;
}

function readExercise(signed: SignedPayload, config: Settings): Exercise | undefined {
  try {
    const { signer_id, nonce, deadline, verifying_contract, intents } = readPayload(signed);
    const [intent, ...extra] = intents;
    const deadlineMs = Date.parse(deadline);
    if (verifying_contract !== config.intents_id || intent?.intent !== "transfer" || extra.length > 0) return undefined;
    if (!Number.isFinite(deadlineMs) || new Date(deadlineMs).toISOString() !== deadline) return undefined;
    const tokens = Object.fromEntries(Object.entries(intent.tokens).map(([asset, amount]) => [asset, BigInt(amount)]));
    return isDeepStrictEqual(intent, exerciseOptions(config.options_id, tokens)) ? { signerId: signer_id, nonce, deadlineMs, tokens } : undefined;
  } catch {
    return undefined;
  }
}

function relayBuys(fills: Fill[]): Map<string, { net: bigint; buys: number }> {
  const bought = new Map<string, { net: bigint; buys: number }>();
  for (const { series_id, side, size } of fills) {
    const { net, buys } = bought.get(series_id) ?? { net: 0n, buys: 0 };
    bought.set(series_id, side === "buy" ? { net: net + BigInt(size), buys: buys + 1 } : { net: net - BigInt(size), buys });
  }
  return bought;
}

export class Collector {
  private claiming: Exercise[] = [];
  private submitted = new Map<string, number>();
  private sending = new Set<string>();
  private final = new Map<string, Settlement>();

  constructor(
    private chain: Chain,
    private config: Settings,
    private claims: Claims,
    private fills: Pick<Fills, "byAccount">,
  ) {}

  async execute(signed: SignedPayload): Promise<string> {
    const exercise = this.read(signed);
    if (exercise.deadlineMs > Date.now() + MAX_DEADLINE_MS) throw new HttpError(400, "an exercise sent now must expire within 10 minutes");
    const total = await this.payout(await this.legs(exercise));
    if (total === undefined) throw new HttpError(409, "the final price is not settled yet");
    if (total === 0n) throw new HttpError(400, "these options pay nothing");
    if (total < (await this.minPayout())) throw new HttpError(400, "the relay pays gas only for payouts of at least $1: collect from a NEAR wallet");
    return this.submit(signed, exercise, true);
  }

  async claim(signed: SignedPayload): Promise<void> {
    const exercise = this.read(signed);
    const stored = this.claims.all().filter((claim) => !isDeepStrictEqual(claim, signed));
    const open = [...this.claiming, ...stored.flatMap((claim) => readExercise(claim, this.config) ?? [])];
    if (open.length >= MAX_CLAIMS) throw new HttpError(503, "the claim queue is full");
    if (open.filter((other) => other.signerId === exercise.signerId).length >= MAX_CLAIMS_PER_ACCOUNT) throw new HttpError(409, `an account can have at most ${MAX_CLAIMS_PER_ACCOUNT} open claims`);
    this.claiming.push(exercise);
    let saved: Promise<void>;
    try {
      await this.simulate(signed);
      const legs = await this.legs(exercise);
      const maxTotal = legs.reduce((sum, { series, amount }) => sum + maxPayout(termsOf(series), amount), 0n);
      if (maxTotal < (await this.minPayout())) throw new HttpError(400, "auto-collect needs a max payout of at least $1");
      const bought = relayBuys(this.fills.byAccount(exercise.signerId));
      for (const { asset, series, amount } of legs) {
        const mine = open.filter((other) => other.signerId === exercise.signerId && other.tokens[asset] !== undefined);
        const claimed = mine.reduce((sum, other) => sum + (other.tokens[asset] ?? 0n), amount);
        const { net, buys } = bought.get(series.id) ?? { net: 0n, buys: 0 };
        if (claimed > net) throw new HttpError(409, "auto-collect covers only options bought in this app");
        if (mine.length >= buys) throw new HttpError(409, "one auto-collect per buy");
        if (claimed > (await this.chain.balanceOf(exercise.signerId, asset))) throw new HttpError(409, "open claims exceed the options held");
      }
      saved = this.claims.add(signed);
    } finally {
      this.claiming.splice(this.claiming.indexOf(exercise), 1);
    }
    await saved;
  }

  async submitClaims(): Promise<void> {
    for (const signed of this.claims.all()) {
      try {
        const exercise = this.read(signed);
        const total = await this.payout(await this.legs(exercise));
        if (total === undefined) {
          await this.simulate(signed);
          continue;
        }
        if (total >= (await this.minPayout())) await this.submit(signed, exercise, false);
        await this.claims.remove(signed);
      } catch (error) {
        if (error instanceof HttpError && error.status !== 409) await this.claims.remove(signed);
        else console.error("claim not submitted", error);
      }
    }
  }

  private read(signed: SignedPayload): Exercise {
    const exercise = readExercise(signed, this.config);
    if (!exercise) throw new HttpError(400, "only a single exercise transfer of our option tokens is relayed");
    return exercise;
  }

  private async legs({ tokens }: Exercise): Promise<Leg[]> {
    const listed = new Map((await this.chain.listSeries()).map((s) => [s.id, s]));
    const prefix = `nep245:${this.config.options_id}:`;
    const legs: Leg[] = [];
    for (const [asset, amount] of Object.entries(tokens)) {
      const { seriesId, side } = parseTokenId(asset.slice(prefix.length));
      const series = listed.get(seriesId);
      if (side !== "long" || !series) throw new HttpError(400, "only long tokens of series in the listing can be exercised");
      if (amount < (await this.chain.minWrite(series.underlying))) throw new HttpError(400, "amount is below the minimum write size");
      legs.push({ asset, series, amount });
    }
    return legs;
  }

  private async submit(signed: SignedPayload, { signerId, nonce, deadlineMs }: Exercise, awaitOutcome: boolean): Promise<string> {
    for (const [key, deadline] of this.submitted) if (deadline < Date.now()) this.submitted.delete(key);
    const key = `${signerId}:${nonce}`;
    if (this.submitted.has(key)) throw new HttpError(409, "this payload was already submitted");
    if (this.sending.has(signerId)) throw new HttpError(409, "an earlier payload from this account is still being sent");
    this.sending.add(signerId);
    try {
      await this.simulate(signed);
      if (deadlineMs < Date.now() + MIN_DEADLINE_MS) throw new HttpError(400, "a payload must stay valid for at least 2 minutes when it is sent");
      this.submitted.set(key, deadlineMs);
      return await this.chain.execute([signed]).catch(async (error: unknown) => {
        if (awaitOutcome) {
          console.error("execute_intents errored, settling by the relayer's transactions", key, error);
          const txHash = await ranTx(this.chain, signed, error, key);
          if (txHash !== undefined) return txHash;
        } else this.submitted.delete(key);
        throw error;
      });
    } finally {
      this.sending.delete(signerId);
    }
  }

  private async payout(legs: Leg[]): Promise<bigint | undefined> {
    const nowSec = Date.now() / 1000;
    let total = 0n;
    for (const { series, amount } of legs) {
      const key = `${series.underlying}:${series.expiry}`;
      const settlement = this.final.get(key) ?? (await this.chain.settlement(series.underlying, series.expiry));
      if (!settlement || nowSec < settlement.final_at + FINAL_MARGIN_SEC) return undefined;
      this.final.set(key, settlement);
      total += longPayout(termsOf(series), amount, BigInt(settlement.price));
    }
    return total;
  }

  private async minPayout(): Promise<bigint> {
    return MIN_RELAYED_PAYOUT_USD * 10n ** BigInt((await this.chain.contractConfig()).quote_decimals);
  }

  private async simulate(signed: SignedPayload): Promise<void> {
    await this.chain.simulate([signed]).catch((error: unknown) => {
      if (error instanceof Rejected) throw new HttpError(422, error.message);
      throw error;
    });
  }
}
