import { describe, expect, it } from "vitest";
import { defaultExpiry, isListed, listedWidth } from "./series.ts";

const USD = 1_000_000n;

describe("defaultExpiry", () => {
  it("is the first end at least 6 h out, counting exactly 6 h, else the last resort is the nearest", () => {
    const now = 1_800_000_000;
    expect(defaultExpiry([now + 21_599, now + 21_600, now + 90_000], now)).toBe(now + 21_600);
    expect(defaultExpiry([now + 21_599, now + 90_000], now)).toBe(now + 90_000);
    expect(defaultExpiry([now + 60, now + 120], now)).toBe(now + 60);
    expect(defaultExpiry([], now)).toBeUndefined();
  });
});

describe("listedWidth", () => {
  it("is two steps of the strike's own grid, so it changes only where the step does", () => {
    expect(listedWidth(110_000n * USD, 6)).toBe(2_000n * USD);
    expect(listedWidth(66_666n * USD, 6)).toBe(1_000n * USD);
    expect(listedWidth(66_667n * USD, 6)).toBe(2_000n * USD);
    expect(listedWidth(2_400n * USD, 6)).toBe(40n * USD);
    expect(listedWidth(3_340n * USD, 6)).toBe(100n * USD);
  });

  it("lists only that width at a strike", () => {
    expect(isListed({ strike: (110_000n * USD).toString(), width: (2_000n * USD).toString() }, 6)).toBe(true);
    expect(isListed({ strike: (110_000n * USD).toString(), width: (2_000n * USD + 10_000n).toString() }, 6)).toBe(false);
  });
});
