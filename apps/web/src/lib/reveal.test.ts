import type { ListedSeries } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import type { PricePoint } from "../api/market.ts";
import { averageEstimate, callVerdict, closingOf, phaseOf, revealSays, verdictOf } from "./reveal.ts";

const E = 1_800_028_800;
const USD = 1_000_000n;
const minute = (offset: number, price: number): PricePoint => [(E + offset * 60) * 1000, price];
const series = (kind: "call" | "put"): ListedSeries => ({
  id: `BTC-${kind}`,
  underlying: "BTC",
  kind,
  strike: (81_000n * USD).toString(),
  width: (2_000n * USD).toString(),
  expiry: E,
  underlying_decimals: 8,
  option_asset: "x",
  quotable: false,
});

describe("averageEstimate", () => {
  it("counts the closed minutes and the rest at spot, so it starts at spot and ignores the minute still forming", () => {
    expect(averageEstimate([], E, (E - 1_800) * 1000, 80_000)).toBe(80_000);
    const tenDone = Array.from({ length: 10 }, (_, i) => minute(i - 29, 81_000));
    const forming = minute(-19, 99_000);
    expect(averageEstimate([...tenDone, forming], E, (E - 19 * 60) * 1000 - 9_000, 78_000)).toBe((10 * 81_000 + 20 * 78_000) / 30);
  });

  it("is the plain mean of the 30 minutes once the round has ended, and fills a missing minute with spot", () => {
    const all = Array.from({ length: 30 }, (_, i) => minute(i - 29, 80_000 + i));
    expect(averageEstimate([minute(-30, 1), ...all, minute(1, 1)], E, (E + 600) * 1000, 1)).toBe(80_014.5);
    expect(averageEstimate(all.slice(0, 24), E, (E + 600) * 1000, 90_000)).toBeUndefined();
    expect(averageEstimate(all.slice(0, 25), E, (E + 600) * 1000, 90_000)).toBeDefined();
    const gap = all.filter((_, i) => i !== 3);
    expect(averageEstimate(gap, E, (E + 600) * 1000, 90_000)).toBe((all.reduce((sum, [, p]) => sum + p, 0) - 80_003 + 90_000) / 30);
  });
});

describe("phaseOf", () => {
  it("opens the final round with the averaging window, not the trading cutoff, and drops the column 3 h after the end", () => {
    const proposed = { price: 81_400n * USD, finalAt: E + 3_900 };
    expect(phaseOf(E, null, E - 1_801)).toBeUndefined();
    expect(phaseOf(E, null, E - 1_800)).toBe("close_only");
    expect(phaseOf(E, null, E - 1)).toBe("close_only");
    expect(phaseOf(E, null, E)).toBe("awaiting_price");
    expect(phaseOf(E, proposed, E + 300)).toBe("proposed");
    expect(phaseOf(E, proposed, E + 3_900)).toBe("final");
    expect(phaseOf(E, proposed, E + 10_799)).toBe("final");
    expect(phaseOf(E, proposed, E + 10_800)).toBeUndefined();
    expect(phaseOf(E, null, E + 10_800)).toBeUndefined();
  });
});

describe("verdictOf", () => {
  it("pays past the price to beat, not at or short of it, and an estimate within 0.1% is too close to call", () => {
    expect(verdictOf(series("call"), "close_only", 81_100n * USD)).toBe("win");
    expect(verdictOf(series("call"), "close_only", 80_900n * USD)).toBe("lose");
    expect(verdictOf(series("call"), "awaiting_price", 81_081n * USD - 1n)).toBe("close");
    expect(verdictOf(series("call"), "close_only", 81_081n * USD)).toBe("win");
    expect(verdictOf(series("put"), "close_only", 80_900n * USD)).toBe("win");
    expect(verdictOf(series("put"), "close_only", 83_500n * USD)).toBe("lose");
    expect(verdictOf(series("put"), "close_only", 80_919n * USD + 1n)).toBe("close");
  });

  it("is never too close once a price is proposed or final", () => {
    expect(verdictOf(series("call"), "proposed", 81_050n * USD)).toBe("win");
    expect(verdictOf(series("call"), "final", 81_000n * USD)).toBe("lose");
    expect(verdictOf(series("put"), "final", 80_950n * USD)).toBe("win");
  });

  it("says what a cell pays, never that a payout is a win", () => {
    expect(revealSays("close_only", "win", "$1.20")).toBe("on track to pay about $1.20");
    expect(revealSays("awaiting_price", "lose", "$0.00")).toBe("looks like it pays nothing");
    expect(revealSays("final", "win", "$1.20")).toBe("pays $1.20");
    expect(revealSays("final", "lose", "$0.00")).toBe("lost");
  });
});

describe("closingOf", () => {
  it("keeps a column in its final round for everyone, but after the end only while you have a stake in it", () => {
    const next = E + 86_400;
    const none = () => null;
    const final = { price: 81_400n * USD, finalAt: E + 300 };
    expect(closingOf([next, E], [], none, E - 600)).toEqual({ expiry: E, phase: "close_only", settlement: null });
    expect(closingOf([next, E], [], none, E + 60)).toBeUndefined();
    expect(closingOf([next, E, E], [E], none, E + 60)).toEqual({ expiry: E, phase: "awaiting_price", settlement: null });
    expect(closingOf([E, next], [E, next], () => final, E + 600)).toEqual({ expiry: E, phase: "final", settlement: final });
    expect(closingOf([E, next], [E, next], none, E - 1_801)).toBeUndefined();
  });
});

describe("free calls in the reveal", () => {
  it("are a win only above their stake, and too close near the price to beat until the price is known", () => {
    expect(callVerdict(series("call"), "close_only", 81_500n * USD, 25)).toBe("win");
    expect(callVerdict(series("call"), "close_only", 81_500n * USD, -50)).toBe("lose");
    expect(callVerdict(series("call"), "awaiting_price", 81_050n * USD, -88)).toBe("close");
    expect(callVerdict(series("call"), "final", 81_050n * USD, -88)).toBe("lose");
  });
});
