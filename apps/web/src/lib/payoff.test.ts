import { capPrice, longPayout, type Terms } from "@near-options/sdk";
import { describe, expect, it } from "vitest";
import { breakeven, costOf, sizeForBudget } from "./payoff.ts";

const BTC = 10n ** 8n;
const USD = 10n ** 6n;

function random(seed: number) {
  let state = seed;
  return (max: bigint) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return (BigInt(state) * max) / 2147483648n + 1n;
  };
}

describe("breakeven", () => {
  const next = random(7);
  const cases = Array.from({ length: 300 }, () => ({
    kind: next(2n) === 1n ? ("call" as const) : ("put" as const),
    strike: (10_000n + next(140_000n)) * USD + next(USD) - 1n,
    width: next(5_000n) * USD,
    size: next(5n * BTC),
    premium: next(2_000n * USD),
  }));

  it("is the exact first price where the payout covers what you paid, and none when even the cap doesn't", () => {
    for (const c of cases) {
      const t: Terms = { kind: c.kind, strike: c.strike, width: c.width, unit: BTC };
      const be = breakeven(t, c.size, c.premium);
      if (be === null) {
        expect(longPayout(t, c.size, capPrice(t))).toBeLessThan(c.premium);
        continue;
      }
      expect(longPayout(t, c.size, be)).toBeGreaterThanOrEqual(c.premium);
      const beyond = c.kind === "call" ? be - 1n : be + 1n;
      expect(longPayout(t, c.size, beyond)).toBeLessThan(c.premium);
    }
    expect(cases.some((c) => breakeven({ kind: c.kind, strike: c.strike, width: c.width, unit: BTC }, c.size, c.premium) === null)).toBe(true);
  });

  it("stops at the cap instead of searching forever when the max payout is one unit short", () => {
    const t: Terms = { kind: "call", strike: 80_000n * USD, width: 2_000n * USD, unit: BTC };
    expect(breakeven(t, BTC, 2_000n * USD)).toBe(82_000n * USD);
    expect(breakeven(t, BTC, 2_000n * USD + 1n)).toBeNull();
    expect(breakeven({ ...t, kind: "put" }, BTC, 2_000n * USD)).toBe(78_000n * USD);
    expect(breakeven({ ...t, kind: "put" }, BTC, 2_000n * USD + 1n)).toBeNull();
  });

  it("accounts for the contract rounding down tiny payouts", () => {
    const t: Terms = { kind: "call", strike: 80_000n * USD, width: 2_000n * USD, unit: BTC };
    const naive = t.strike + BTC / 3n;
    const be = breakeven(t, 3n, 1n);
    expect(be).not.toBeNull();
    expect(be!).toBeGreaterThan(naive);
    expect(longPayout(t, 3n, be!)).toBeGreaterThanOrEqual(1n);
  });

  it("has none for an empty size", () => {
    expect(breakeven({ kind: "call", strike: USD, width: USD, unit: BTC }, 0n, USD)).toBeNull();
  });
});

describe("sizeForBudget", () => {
  it("never spends more than the budget and leaves no whole unit on the table", () => {
    const next = random(11);
    for (let i = 0; i < 500; i++) {
      const budget = next(10_000n * USD);
      const price = next(20_000n * USD);
      const unit = i % 2 === 0 ? BTC : 10n ** 18n;
      const size = sizeForBudget(budget, price, unit);
      expect(costOf(size, price, unit)).toBeLessThanOrEqual(budget);
      expect(costOf(size + 1n, price, unit)).toBeGreaterThan(budget);
    }
  });

  it("buys nothing without a price or budget", () => {
    expect(sizeForBudget(25n * USD, 0n, BTC)).toBe(0n);
    expect(sizeForBudget(0n, USD, BTC)).toBe(0n);
  });
});
