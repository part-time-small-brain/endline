import { z } from "zod";
import { SignedPayload, Unsigned } from "./signing.ts";

export const Amount = z.string().regex(/^[1-9][0-9]*$/, "positive integer string");
export const AccountId = z.string().min(2).max(64).regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/);
// the smallest total payout the relay pays gas to collect, in whole quote-asset units
export const MIN_RELAYED_PAYOUT_USD = 1n;
const TRANSFER_FEE_CENTS = 1n;
export const transferFee = (quoteDecimals: number) => TRANSFER_FEE_CENTS * 10n ** BigInt(quoteDecimals - 2);
const TradeSide = z.enum(["buy", "sell"]);
const OptionKind = z.enum(["call", "put"]);

export const Series = z.object({
  id: z.string(),
  underlying: z.string(),
  kind: OptionKind,
  strike: Amount,
  width: Amount,
  expiry: z.number().int(),
  underlying_decimals: z.number().int().min(0).max(24),
});
export type Series = z.infer<typeof Series>;

export const Timing = z.object({ write_cutoff_sec: z.number().int().min(0) });
export type Timing = z.infer<typeof Timing>;

export const Config = z.object({
  intents_id: z.string(),
  quote_asset: z.string(),
  quote_decimals: z.number().int().min(0).max(24),
  timing: Timing,
});
export type Config = z.infer<typeof Config>;

export const Deployment = z.object({
  rpc_url: z.url(),
  intents_id: AccountId,
  options_id: AccountId,
  quote_asset: z.string().startsWith("nep141:"),
});
export type Deployment = z.infer<typeof Deployment>;

export const Settlement = z.object({ price: Amount, final_at: z.number().int() });
export type Settlement = z.infer<typeof Settlement>;

export const ListedSeries = Series.extend({ option_asset: z.string(), quotable: z.boolean() });
export type ListedSeries = z.infer<typeof ListedSeries>;

export const SeriesListing = z.object({
  quote_asset: z.string(),
  quote_decimals: z.number().int().min(0).max(24),
  series: z.array(ListedSeries),
});
export type SeriesListing = z.infer<typeof SeriesListing>;

const Signer = z.object({
  standard: z.enum(["nep413", "erc191"]),
  signer_id: z.string().min(2).max(64),
});

export const QuoteRequest = z.object({
  series_id: z.string().min(1).max(64),
  side: TradeSide,
  size: Amount,
  signer: Signer,
  session: SignedPayload,
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

export const QuoteEvent = z.object({
  quote_id: z.string(),
  series_id: z.string(),
  side: TradeSide,
  size: Amount,
  option_asset: z.string(),
  quote_asset: z.string(),
  fee_pips: z.number().int().min(0),
  deadline_ms: z.number().int(),
  terms: Series.omit({ id: true }),
});
export type QuoteEvent = z.infer<typeof QuoteEvent>;

export const QuoteResponse = z.object({
  quote_id: z.string(),
  premium: Amount,
  signed: SignedPayload,
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

export const Quote = z.object({
  quote_id: z.string(),
  series_id: z.string(),
  side: TradeSide,
  size: Amount,
  premium: Amount,
  pay: z.object({ asset: z.string(), amount: Amount }),
  receive: z.object({ asset: z.string(), amount: Amount }),
  sign_by_ms: z.number().int(),
  payload: Unsigned,
});
export type Quote = z.infer<typeof Quote>;

export const PublishRequest = z.object({ quote_id: z.string(), signed: SignedPayload });
export type PublishRequest = z.infer<typeof PublishRequest>;

export const SignedRequest = z.object({ signed: SignedPayload });

const QuoteStatus = z.enum(["open", "settling", "settled", "failed", "expired"]);

export const StatusUpdate = z.object({
  quote_id: z.string(),
  status: QuoteStatus,
  tx_hash: z.string().optional(),
  reason: z.string().optional(),
});
export type StatusUpdate = z.infer<typeof StatusUpdate>;

export const Fill = z.object({
  quote_id: z.string(),
  series_id: z.string(),
  side: TradeSide,
  account_id: z.string(),
  size: Amount,
  premium: Amount,
  tx_hash: z.string(),
  at_ms: z.number().int(),
});
export type Fill = z.infer<typeof Fill>;

export const CallRequest = z.object({ series_id: z.string().min(1).max(64), signer: Signer, session: SignedPayload });
export type CallRequest = z.infer<typeof CallRequest>;

export const Call = z.object({
  series_id: z.string(),
  account_id: z.string(),
  terms: Series.omit({ id: true }),
  ask: Amount,
  at_ms: z.number().int(),
  result: z.object({ price: Amount, points: z.number().int() }).optional(),
});
export type Call = z.infer<typeof Call>;

export const Standing = z.object({
  account_id: z.string(),
  rank: z.number().int().min(1),
  points: z.number().int(),
  wins: z.number().int().min(0),
  streak: z.number().int().min(0),
});
export type Standing = z.infer<typeof Standing>;

export const Leaderboard = z.object({
  round: z.string().nullable(),
  today: z.array(Standing),
  week: z.array(Standing),
  you: z.object({ today: Standing.nullable(), week: Standing.nullable() }).optional(),
});
export type Leaderboard = z.infer<typeof Leaderboard>;

// ask and bid: quote units per one terms.unit of option, before the MM's minimum premium
export const Mark = z.object({
  series_id: z.string(),
  ask: Amount,
  bid: Amount.optional(),
  vol: z.number().positive().max(10),
});
export type Mark = z.infer<typeof Mark>;

export const MmMessage = z.discriminatedUnion("method", [
  z.object({ method: z.literal("quote_response"), params: QuoteResponse }),
  z.object({ method: z.literal("marks"), params: z.array(Mark) }),
]);
export const RelayMessage = z.discriminatedUnion("method", [
  z.object({ method: z.literal("quote"), params: QuoteEvent }),
  z.object({ method: z.literal("quote_status"), params: StatusUpdate }),
]);
