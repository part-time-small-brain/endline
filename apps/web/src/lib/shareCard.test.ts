import type { ListedSeries } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { callCard, winCard } from "./shareCard.ts";

const USD = 1_000_000n;
const series: ListedSeries = {
  id: "BTC-5NOV26-81000_83000-C",
  underlying: "BTC",
  kind: "call",
  strike: (81_000n * USD).toString(),
  width: (2_000n * USD).toString(),
  expiry: Date.UTC(2026, 10, 5, 8) / 1000,
  underlying_decimals: 8,
  option_asset: "x",
  quotable: false,
};

describe("winCard", () => {
  it("says what won, what it paid back for what it cost, and the final price in UTC, with no account in it", () => {
    expect(winCard(series, 40n * USD, 25n * USD, 81_400n * USD, 6)).toEqual({
      title: "BTC Up $81,000",
      result: "Won $40.00",
      detail: "Paid $25.00 · 1.6×",
      footer: "Final price $81,400 · 5 Nov 08:00 UTC",
      text: "BTC Up $81,000: Won $40.00 on Endline",
    });
    expect(winCard(series, 40n * USD, 0n, 81_400n * USD, 6).detail).toBe("");
  });
});

describe("callCard", () => {
  it("shows the points a free call won and the multiple it was called at", () => {
    expect(callCard(series, 50n, 400, 83_000n * USD, 6)).toEqual({
      title: "BTC Up $81,000",
      result: "+400 points",
      detail: "Free call at 5.0×",
      footer: "Final price $83,000 · 5 Nov 08:00 UTC",
      text: "BTC Up $81,000: +400 points on Endline",
    });
  });
});
