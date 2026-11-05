import { isDeepStrictEqual } from "node:util";
import {
  amounts,
  buyDiffs,
  isVersionedNonce,
  maxPayout,
  type QuoteEvent,
  type QuoteResponse,
  readPayload,
  type SignedPayload,
  sellDiffs,
  termsOf,
  unmatched,
} from "@near-options/sdk";
import { z } from "zod";
import type { Chain } from "./rpc.ts";

const MM_DEADLINE_MIN_MS = 20_000;
const MM_DEADLINE_MAX_MS = 60_000;

export interface Bid {
  mmId: string;
  premium: bigint;
  deadlineMs: number;
  signed: SignedPayload;
}

export function legs(event: QuoteEvent, premium: bigint) {
  const trade = {
    option: event.option_asset,
    quote: event.quote_asset,
    size: BigInt(event.size),
    premium,
    pips: BigInt(event.fee_pips),
  };
  return event.side === "buy" ? buyDiffs(trade) : sellDiffs(trade);
}

export async function checkBid(
  chain: Chain,
  intentsId: string,
  event: QuoteEvent,
  mmId: string,
  response: QuoteResponse,
  receivedAt: number,
): Promise<Bid> {
  const { signed } = response;
  const payload = readPayload(signed);
  if (payload.verifying_contract !== intentsId) throw new Error("wrong verifying contract");

  const deadlineMs = Date.parse(payload.deadline);
  if (!(deadlineMs >= receivedAt + MM_DEADLINE_MIN_MS && deadlineMs <= receivedAt + MM_DEADLINE_MAX_MS)) {
    throw new Error("deadline outside window");
  }
  if (!isVersionedNonce(payload.nonce)) throw new Error("nonce is not versioned");

  const premium = BigInt(response.premium);
  if (event.side === "buy" && premium >= maxPayout(termsOf(event.terms), BigInt(event.size))) throw new Error("premium at or above max payout");
  const expected = legs(event, premium).marketMaker;
  const [intent, ...extra] = payload.intents;
  if (intent?.intent !== "token_diff" || extra.length > 0 || !isDeepStrictEqual(intent.diff, amounts(expected))) throw new Error("diff mismatch");

  const { invariant_violated } = await chain.simulate([signed]);
  const imbalance = z
    .object({ error: z.literal("unmatched_deltas"), unmatched_deltas: z.record(z.string(), z.string()) })
    .safeParse(invariant_violated);
  if (!imbalance.success || !isDeepStrictEqual(imbalance.data.unmatched_deltas, amounts(unmatched([expected], BigInt(event.fee_pips))))) {
    throw new Error("simulation does not leave exactly the user leg open");
  }
  return { mmId, premium, deadlineMs, signed };
}
