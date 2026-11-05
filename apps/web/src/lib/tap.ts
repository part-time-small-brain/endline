import { maxPayout, type Quote, type Series, termsOf } from "@near-options/sdk";

const OVER_STAKE_PER_MILLE = 50n;

export const maxLossOf = (stake: bigint) => stake + (stake * OVER_STAKE_PER_MILLE) / 1000n;

export function decide(quote: Pick<Quote, "premium" | "sign_by_ms" | "size">, series: Series, tapped: bigint, stake: bigint, now: number): "sign" | "moved" | "expired" {
  if (now >= quote.sign_by_ms) return "expired";
  const premium = BigInt(quote.premium);
  const pays = premium > 0n && (maxPayout(termsOf(series), BigInt(quote.size)) * 10n) / premium >= tapped;
  return pays && premium <= maxLossOf(stake) ? "sign" : "moved";
}
