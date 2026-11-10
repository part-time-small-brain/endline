import { capped, YEAR_MS } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { SETTINGS, testDesk } from "./fixtures/desk.ts";
import { contractPrice, premiumUsd, toQuoteUnits } from "./pricing.ts";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

const BOOK = testDesk().desk.book;

function priceOf(p: { kind: "call" | "put"; forward: number; strike: number; width: number; vol: number; capVol: number; years: number }, settings = SETTINGS) {
  const micros = (usd: number) => BigInt(Math.round(usd * 1e6)).toString();
  const series = { id: "x", underlying: "BTC", kind: p.kind, strike: micros(p.strike), width: micros(p.width), expiry: (p.years * YEAR_MS) / 1000, underlying_decimals: 8 };
  return contractPrice(BOOK, series, { forward: p.forward, vol: p.vol, capVol: p.capVol, at: 0 }, settings, 0);
}

describe("premium", () => {
  it("asks at least mid and bids at most mid for any bet", () => {
    const next = rng(5);
    for (let i = 0; i < 5_000; i++) {
      const kind = next() < 0.5 ? "call" : "put";
      const forward = 20_000 + next() * 180_000;
      const strike = Math.round(forward * (0.5 + next()));
      const vol = 0.1 + next();
      const p = { kind, forward, strike, width: Math.round(strike * (0.005 + next() * 0.1)), vol, capVol: vol + (next() - 0.5) * 0.1, years: 1e-4 + next() } as const;
      const mid = capped(kind, forward, strike, p.width, p.vol, p.capVol, p.years).price;
      const price = priceOf(p);
      expect(price.ask).toBeGreaterThanOrEqual(mid);
      expect(price.bid).toBeLessThanOrEqual(mid);
    }
  });

  it("charges for a skew move on a bet whose legs' vegas cancel", () => {
    const p = { kind: "call", forward: 80_000, strike: 79_000, width: 2_000, vol: 0.45, capVol: 0.45, years: 7 / 365 } as const;
    const mid = capped(p.kind, p.forward, p.strike, p.width, p.vol, p.capVol, p.years);
    expect(Math.abs(mid.vega)).toBeLessThan(0.05 * Math.abs(capped(p.kind, p.forward, p.strike, 1e9, p.vol, p.vol, p.years).vega));
    const price = priceOf(p, { ...SETTINGS, carryQuote: 0 });
    expect(price.ask - mid.price).toBeGreaterThan(0.02 * mid.price);
    expect(mid.price - price.bid).toBeGreaterThan(0.02 * mid.price);
    const legsApartFullSpread = capped(p.kind, p.forward, p.strike, p.width, p.vol + SETTINGS.spreadVol, p.capVol - SETTINGS.spreadVol, p.years).price;
    expect(price.ask - mid.price).toBeLessThan(0.75 * (legsApartFullSpread - mid.price));
  });

  it("charges only the vol spread and carry, nothing for a hedge, on a near-the-money bet with a big delta", () => {
    const p = { kind: "call", forward: 80_000, strike: 80_000, width: 2_000, vol: 0.4, capVol: 0.4, years: 1 / 365 } as const;
    const mid = capped(p.kind, p.forward, p.strike, p.width, p.vol, p.capVol, p.years);
    const price = priceOf(p, { ...SETTINGS, spreadVol: 1e-9, carryQuote: 0 });
    expect(price.ask - mid.price).toBeCloseTo(0, 4);
    expect(mid.price - price.bid).toBeCloseTo(0, 4);
  });

  it("charges carry on the USDC locked, which is the width, not the strike", () => {
    const p = { kind: "put", forward: 80_000, strike: 80_000, width: 2_000, vol: 0.5, capVol: 0.5, years: 1 } as const;
    const noCarry = priceOf(p, { ...SETTINGS, carryQuote: 0 }).ask;
    expect(priceOf(p).ask - noCarry).toBeCloseTo(2_000 * SETTINGS.carryQuote, 6);
  });

  it("refuses to bid below the minimum premium instead of flooring it", () => {
    const price = priceOf({ kind: "put", forward: 80_000, strike: 60_000, width: 2_000, vol: 0.4, capVol: 0.4, years: 0.01 });
    expect(premiumUsd(price, 0.0001, false, SETTINGS)).toBeUndefined();
    expect(premiumUsd(price, 0.0001, true, SETTINGS)).toBe(SETTINGS.minPremiumUsd);
  });
});

describe("quote units", () => {
  it("rounds asks up and bids down by less than one unit", () => {
    const next = rng(9);
    for (let i = 0; i < 5_000; i++) {
      const usd = next() * 50_000;
      if (usd === 0) continue;
      const up = toQuoteUnits(usd, 6, true);
      const down = toQuoteUnits(usd, 6, false);
      expect(Number(up)).toBeGreaterThanOrEqual(usd * 1e6);
      expect(Number(down)).toBeLessThanOrEqual(usd * 1e6);
      expect(up - down).toBeLessThanOrEqual(1n);
    }
    expect(toQuoteUnits(1.0000001, 6, true)).toBe(1_000_001n);
    expect(toQuoteUnits(1.0000009, 6, false)).toBe(1_000_000n);
  });

  it.each([Number.NaN, -1, 0, Number.POSITIVE_INFINITY, 1e12])("refuses %s", (usd) => {
    expect(() => toQuoteUnits(usd, 6, true)).toThrow();
  });
});
