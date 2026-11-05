import { describe, expect, it } from "vitest";
import { black76, capped, YEAR_MS } from "./black76.ts";
import put from "./fixtures/deribit-ticker-btc-27nov26-80000-p.json" with { type: "json" };
import call from "./fixtures/deribit-ticker-btc-27nov26-90000-c.json" with { type: "json" };

const EXPIRY_MS = Date.UTC(2026, 10, 27, 8);

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

describe("black76", () => {
  it("never prices below intrinsic value for random inputs", () => {
    const next = rng(11);
    for (let i = 0; i < 5_000; i++) {
      const forward = 100 + next() * 200_000;
      const strike = forward * (0.2 + next() * 3);
      const vol = 0.05 + next() * 2;
      const years = 1 / 525_600 + next() * 2;
      const c = black76("call", forward, strike, vol, years);
      const p = black76("put", forward, strike, vol, years);
      expect(c.price).toBeGreaterThanOrEqual(Math.max(forward - strike, 0) - 1e-9 * forward);
      expect(p.price).toBeGreaterThanOrEqual(Math.max(strike - forward, 0) - 1e-9 * forward);
    }
  });

  it.each([
    ["put", put.result],
    ["call", call.result],
  ] as const)("reproduces Deribit's recorded %s mark, delta and vega", (kind, t) => {
    const strike = Number(t.instrument_name.split("-")[2]);
    const g = black76(kind, t.underlying_price, strike, t.mark_iv / 100, (EXPIRY_MS - t.timestamp) / YEAR_MS);
    expect(Math.abs(g.price / t.underlying_price - t.mark_price)).toBeLessThan(5e-5);
    expect(g.delta).toBeCloseTo(t.greeks.delta, 4);
    expect(g.vega).toBeCloseTo(t.greeks.vega, 2);
  });

  it.each([
    ["zero vol", 0, 0.1],
    ["expired", 0.5, 0],
    ["NaN vol", Number.NaN, 0.1],
  ])("refuses %s", (_, vol, years) => {
    expect(() => black76("call", 80_000, 80_000, vol, years)).toThrow();
  });
});

describe("capped", () => {
  it("costs between 0 and the width, and an Up and a Down over the same range add up to the width", () => {
    const next = rng(13);
    for (let i = 0; i < 5_000; i++) {
      const forward = 100 + next() * 200_000;
      const strike = forward * (0.5 + next());
      const width = strike * (0.001 + next() * 0.2);
      const vol = 0.05 + next() * 2;
      const years = 1 / 525_600 + next() * 2;
      const up = capped("call", forward, strike, width, vol, vol, years);
      const down = capped("put", forward, strike + width, width, vol, vol, years);
      expect(up.price).toBeGreaterThanOrEqual(-1e-6 * forward);
      expect(up.price).toBeLessThanOrEqual(width + 1e-6 * forward);
      expect(Math.abs(up.price + down.price - width)).toBeLessThan(1e-6 * forward);
      expect(Math.abs(up.delta + down.delta)).toBeLessThan(1e-9);
    }
  });

  it("refuses a Down whose cap would reach zero", () => {
    expect(() => capped("put", 80_000, 80_000, 80_000, 0.5, 0.5, 0.01)).toThrow();
  });
});
