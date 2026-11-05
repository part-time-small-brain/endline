import { type ListedSeries, type SeriesListing, seriesId } from "@near-options/sdk";
import type { ContractTerms } from "../api/chain.ts";

// ids show expiries to the minute, so a series off the minute can't be checked
const genuine = (s: ListedSeries, { quoteDecimals, decimals }: Pick<ContractTerms, "quoteDecimals" | "decimals">) =>
  s.expiry % 60 === 0 &&
  decimals[s.underlying] === s.underlying_decimals &&
  s.id === seriesId({ underlying: s.underlying, expiry: s.expiry, strike: BigInt(s.strike), width: BigInt(s.width), quoteDecimals, kind: s.kind });

export function verifiedListing(listing: SeriesListing, contract: Pick<ContractTerms, "quoteDecimals" | "decimals">): SeriesListing {
  return { ...listing, series: listing.series.filter((s) => genuine(s, contract)) };
}
