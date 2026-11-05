import { type ListedSeries, type SeriesListing, seriesId } from "@near-options/sdk";
import { describe, expect, it } from "vitest";
import { verifiedListing } from "./listing.ts";

const EXPIRY = 1_795_766_400;
const genuine: ListedSeries = {
  id: seriesId({ underlying: "BTC", expiry: EXPIRY, strike: 81_000_000_000n, width: 2_000_000_000n, quoteDecimals: 6, kind: "call" }),
  underlying: "BTC",
  kind: "call",
  strike: "81000000000",
  width: "2000000000",
  expiry: EXPIRY,
  underlying_decimals: 8,
  option_asset: "nep245:opt.near:BTC",
  quotable: true,
};
const listing = (series: ListedSeries[]): SeriesListing => ({ quote_asset: "nep141:usdc.near", quote_decimals: 6, series });
const contract = { quoteDecimals: 6, decimals: { BTC: 8 } };

describe("verifiedListing", () => {
  it("drops any series whose terms don't produce its id or whose decimals aren't the contract's", () => {
    const tampered: ListedSeries[] = [
      { ...genuine, strike: "80000000000" },
      { ...genuine, width: "4000000000" },
      { ...genuine, kind: "put" },
      { ...genuine, expiry: EXPIRY + 86_400 },
      { ...genuine, underlying: "ETH" },
      { ...genuine, underlying_decimals: 6 },
    ];
    expect(verifiedListing(listing([genuine, ...tampered]), contract).series).toEqual([genuine]);
  });

  it("drops a minute-grid series whose expiry was moved within its minute, which its id can't show", () => {
    const expiry = EXPIRY + 360;
    const minute = { ...genuine, expiry, id: seriesId({ underlying: "BTC", expiry, strike: 81_000_000_000n, width: 2_000_000_000n, quoteDecimals: 6, kind: "call" }) };
    expect(verifiedListing(listing([minute, { ...minute, expiry: expiry + 30 }]), contract).series).toEqual([minute]);
  });

  it("rebuilds ids with the contract's USDC decimals, whatever the relay says", () => {
    expect(verifiedListing({ ...listing([genuine]), quote_decimals: 5 }, contract).series).toEqual([genuine]);
    expect(verifiedListing(listing([genuine]), { ...contract, quoteDecimals: 5 }).series).toEqual([]);
  });
});
