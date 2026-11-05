import { describe, expect, it } from "vitest";
import vectors from "../../../testdata/vectors.json" with { type: "json" };
import { longPayout, maxPayout } from "./math.ts";
import { type OptionKind, parseTokenId, seriesId, shortTokenId } from "./series.ts";

describe("series ids", () => {
  it.each(vectors.series_ids)("$id", (c) => {
    const id = seriesId({
      underlying: c.underlying,
      expiry: c.expiry,
      strike: BigInt(c.strike),
      width: BigInt(c.width),
      quoteDecimals: c.quote_decimals,
      kind: c.kind as OptionKind,
    });
    expect(id).toBe(c.id);
    expect(parseTokenId(shortTokenId(id))).toEqual({ seriesId: id, side: "short" });
    expect(parseTokenId(id)).toEqual({ seriesId: id, side: "long" });
  });
});

describe("payout math", () => {
  it.each(vectors.math)("$kind $strike $amount @ $settlement", (c) => {
    const t = { kind: c.kind as OptionKind, strike: BigInt(c.strike), width: BigInt(c.width), unit: BigInt(c.unit) };
    expect(longPayout(t, BigInt(c.amount), BigInt(c.settlement))).toBe(BigInt(c.long_payout));
    expect(maxPayout(t, BigInt(c.amount))).toBe(BigInt(c.pair_refund));
  });
});
