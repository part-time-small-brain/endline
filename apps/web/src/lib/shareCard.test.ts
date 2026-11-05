import type { ListedSeries } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { bestWin, callCard, winCard } from "./shareCard.ts";

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
    expect(winCard(series, 40n * USD, 25n * USD, 0n, 81_400n * USD, 6)).toEqual({
      title: "BTC Up $81,000",
      result: "Won $40.00",
      detail: "Paid $25.00 · 1.6×",
      footer: "Final price $81,400 · 5 Nov 08:00 UTC",
      text: "BTC Up $81,000: Won $40.00 on Endline",
    });
    expect(winCard(series, 40n * USD, 0n, 0n, 81_400n * USD, 6).detail).toBe("");
  });
});

describe("bestWin", () => {
  const unit = 10n ** 8n;
  const put = { ...series, id: "BTC-5NOV26-81000_79000-P", kind: "put" as const };

  it("adds up the main and Tap balances of one series, and counts what was sold back as made", () => {
    const stakes = [
      { series, amount: unit / 100n, paid: 3n * USD, received: 0n },
      { series, amount: unit / 100n, paid: 3n * USD, received: 0n },
    ];
    expect(bestWin(stakes, 81_400n * USD, 6)).toMatchObject({ result: "Won $8.00", detail: "Paid $6.00 · 1.3×" });
    expect(bestWin([{ series, amount: unit / 100n, paid: 10n * USD, received: 9n * USD }], 81_400n * USD, 6)).toMatchObject({ result: "Won $4.00", detail: "Paid $10.00 · 1.3×" });
  });

  it("shares only a series that made money and still paid at the end, the one that made the most", () => {
    expect(bestWin([{ series, amount: unit / 100n, paid: 10n * USD, received: 0n }], 81_400n * USD, 6)).toBeUndefined();
    expect(bestWin([{ series, amount: unit, paid: 10n * USD, received: 20n * USD }], 80_000n * USD, 6)).toBeUndefined();
    const both = [
      { series, amount: unit / 100n, paid: 1n * USD, received: 0n },
      { series: put, amount: unit / 50n, paid: 1n * USD, received: 0n },
    ];
    expect(bestWin(both, 81_400n * USD, 6)?.title).toBe("BTC Up $81,000");
    expect(bestWin(both, 80_000n * USD, 6)?.title).toBe("BTC Down $81,000");
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
