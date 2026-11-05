import type { ListedSeries } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { bestWin } from "./shareCard.ts";

const USD = 1_000_000n;
const UNIT = 10n ** 8n;
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
const put = { ...series, id: "BTC-5NOV26-81000_79000-P", kind: "put" as const };
const stake = (amount: bigint, paid: bigint, received = 0n, s = series) => ({ series: s, amount, paid, received });

describe("bestWin", () => {
  it("says what won, what it paid back for what it cost, and the final price in UTC, with no account in it", () => {
    expect(bestWin([stake(UNIT / 50n, 25n * USD)], 83_000n * USD, 6)).toEqual({
      title: "BTC Up $81,000",
      result: "Won $40.00",
      detail: "Paid $25.00 · 1.6×",
      footer: "Final price $83,000 · 5 Nov 08:00 UTC",
      text: "BTC Up $81,000: Won $40.00 on Endline",
    });
  });

  it("adds up the main and Tap balances of one series, and shows what was sold back", () => {
    expect(bestWin([stake(UNIT / 100n, 3n * USD), stake(UNIT / 100n, 3n * USD)], 81_400n * USD, 6)).toMatchObject({ result: "Won $8.00", detail: "Paid $6.00 · 1.3×" });
    expect(bestWin([stake(UNIT / 100n, 10n * USD, 9n * USD)], 81_400n * USD, 6)).toMatchObject({ result: "Won $4.00", detail: "Paid $10.00 · sold $9.00 back · 1.3×" });
  });

  it("shares only a series that made money, still paid at the end and has a known cost, the one that made the most", () => {
    expect(bestWin([stake(UNIT / 100n, 10n * USD)], 81_400n * USD, 6)).toBeUndefined();
    expect(bestWin([stake(UNIT, 10n * USD, 20n * USD)], 80_000n * USD, 6)).toBeUndefined();
    expect(bestWin([stake(UNIT, 0n)], 83_000n * USD, 6)).toBeUndefined();
    const both = [stake(UNIT / 100n, 1n * USD), stake(UNIT / 50n, 1n * USD, 0n, put)];
    expect(bestWin(both, 81_400n * USD, 6)?.title).toBe("BTC Up $81,000");
    expect(bestWin(both, 80_000n * USD, 6)?.title).toBe("BTC Down $81,000");
  });
});
