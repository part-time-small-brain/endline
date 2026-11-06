import { randomBytes } from "node:crypto";
import {
  amounts,
  type Diff,
  type Payload,
  payload,
  type QuoteEvent,
  readPayload,
  type Series,
  sessionPayload,
  type Settlement,
  type SignedPayload,
  tokenDiff,
  toSign,
  type Unsigned,
  unmatched,
} from "@endline/sdk";
import oneClickQuote from "../../../testdata/oneclick-quote.json" with { type: "json" };
import { legs } from "./bid.ts";
import { HttpError } from "./relay.ts";
import { type Chain, Rejected, Unsettled } from "./rpc.ts";

export const INTENTS = "intents.test";
export const OPTIONS = "opt.test";
export const USDC = "nep141:usdc.test";
const FEE = 1n;
export const SALT = Uint8Array.from([1, 2, 3, 4]);
export const WRITE_CUTOFF_SEC = 1_800;
export const MIN_WRITE = 1_000n;

export const SERIES: Series = {
  id: "BTC-27NOV26-110000_112000-C",
  underlying: "BTC",
  kind: "call",
  strike: "110000000000",
  width: "2000000000",
  expiry: 1_795_766_400,
  underlying_decimals: 8,
};
export const OPTION = `nep245:${OPTIONS}:${SERIES.id}`;

// Captured from 1Click for this request. It signs quote.deadline, not the request's, so DEPOSIT.deadline can move.
export const DEPOSIT = { ...oneClickQuote.request, deadline: new Date(Date.now() + 3_600_000).toISOString() };
export const SIGNED_QUOTE = oneClickQuote.response;

const diffOf = (signed: SignedPayload): Diff => {
  const [intent] = readPayload(signed).intents;
  const deltas = intent?.intent === "token_diff" ? intent.diff : {};
  return Object.fromEntries(Object.entries(deltas).map(([asset, amount]) => [asset, BigInt(amount)]));
};

export function fakeChain(series: Series[] = [SERIES]) {
  const used = new Set<string>();
  const executed: SignedPayload[][] = [];
  const settlements = new Map<string, Settlement>();
  const balances = new Map<string, bigint>();
  const txs = new Map<string, "succeeded" | "failed">();
  const simulate = async (batch: SignedPayload[]) => {
    for (const signed of batch) {
      const { signer_id, nonce, deadline } = readPayload(signed);
      if (signed.signature === "ed25519:bad") throw new Rejected("invalid signature");
      if (used.has(`${signer_id}:${nonce}`)) throw new Rejected("nonce already used");
      if (Date.parse(deadline) < Date.now()) throw new Rejected("deadline expired");
    }
    const left = unmatched(batch.map(diffOf), FEE);
    return Object.keys(left).length === 0 ? {} : { invariant_violated: { error: "unmatched_deltas", unmatched_deltas: amounts(left) } };
  };
  const chain = {
    fee: async () => FEE,
    currentSalt: async () => SALT,
    listSeries: async () => series,
    contractConfig: async () => ({ intents_id: INTENTS, quote_asset: USDC, quote_decimals: 6, timing: { write_cutoff_sec: WRITE_CUTOFF_SEC } }),
    settlement: async (underlying: string, expiry: number) => settlements.get(`${underlying}:${expiry}`) ?? null,
    minWrite: async () => MIN_WRITE,
    balanceOf: async (accountId: string, asset: string) => balances.get(`${accountId}:${asset}`) ?? 10n ** 18n,
    simulate,
    execute: async (batch: SignedPayload[]) => {
      const txHash = `tx${txs.size + 1}`;
      txs.set(txHash, "failed");
      try {
        const { invariant_violated } = await simulate(batch);
        if (invariant_violated) throw new Error("unbalanced");
      } catch (error) {
        throw new Unsettled([txHash], error);
      }
      for (const signed of batch) {
        const { signer_id, nonce } = readPayload(signed);
        used.add(`${signer_id}:${nonce}`);
      }
      executed.push(batch);
      txs.set(txHash, "succeeded");
      return txHash;
    },
    txStatus: async (txHash: string) => txs.get(txHash) ?? "unknown",
    finalTimeMs: async () => Date.now(),
  } satisfies Chain;
  return { chain, executed, settlements, balances };
}

export function nep413(p: Payload): Extract<SignedPayload, { standard: "nep413" }> {
  return { ...(toSign("nep413", p) as Extract<Unsigned, { standard: "nep413" }>), public_key: "ed25519:key", signature: "ed25519:sig" };
}

export function session(signerId: string, { deadlineMs = Date.now() + 86_400_000, verifyingContract = INTENTS, standard = "nep413" } = {}): SignedPayload {
  const p = sessionPayload(verifyingContract, signerId, deadlineMs, SALT, randomBytes(15));
  return standard === "nep413" ? nep413(p) : { ...(toSign("erc191", p) as Extract<Unsigned, { standard: "erc191" }>), signature: "secp256k1:sig" };
}

export function mmSigned(event: QuoteEvent, premium: bigint, options: { deadlineMs?: number; diff?: Diff; verifyingContract?: string } = {}) {
  const diff = options.diff ?? legs(event, premium).marketMaker;
  return nep413(payload(options.verifyingContract ?? INTENTS, "mm.test", options.deadlineMs ?? Date.now() + 30_000, SALT, randomBytes(15), [tokenDiff(diff)]));
}

export async function httpStatus(promise: Promise<unknown>): Promise<number> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  if (!(error instanceof HttpError)) throw new Error(`expected an HttpError, got ${String(error)}`);
  return error.status;
}

export function event(side: "buy" | "sell"): QuoteEvent {
  return {
    quote_id: `q-${side}`,
    series_id: SERIES.id,
    side,
    size: "1000000",
    option_asset: OPTION,
    quote_asset: USDC,
    fee_pips: Number(FEE),
    deadline_ms: Date.now() + 1_500,
    terms: {
      underlying: "BTC",
      expiry: SERIES.expiry,
      strike: SERIES.strike,
      width: SERIES.width,
      kind: "call",
      underlying_decimals: 8,
    },
  };
}
