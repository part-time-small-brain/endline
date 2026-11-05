import { capped, YEAR_MS } from "@near-options/sdk";
import { describe, expect, it } from "vitest";
import { CALL, DEMO_PUT, long, NOW, PAIRS, PUT, short, USDC } from "./fixtures/desk.ts";
import { type Book, exposure, liveAssets, type SeriesMark } from "./portfolio.ts";

const book: Book = { quoteAsset: USDC, quoteDecimals: 6, writeCutoffSec: 60, optionsId: "opt.test.near", series: new Map([CALL, PUT, DEMO_PUT].map((s) => [s.id, s])) };

it("reads balances only for series that haven't expired yet", () => {
  expect(liveAssets(book, DEMO_PUT.expiry * 1000 - 1)).toEqual([USDC, long(CALL), short(CALL), long(PUT), short(PUT), long(DEMO_PUT), short(DEMO_PUT)]);
  expect(liveAssets(book, DEMO_PUT.expiry * 1000)).toEqual([USDC, long(CALL), short(CALL), long(PUT), short(PUT)]);
});

describe("exposure", () => {
  const at = (forward: number) => (): SeriesMark => ({ forward, vol: 0.5, capVol: 0.5, at: NOW });

  it("is zero for written pairs of Up or Down, since the collateral is USDC", () => {
    for (const s of [CALL, PUT]) {
      const e = exposure(book, new Map([[long(s), PAIRS], [short(s), PAIRS]]), at(80_000), NOW).get("BTC");
      expect(e?.delta).toBe(0);
      expect(e?.vega).toBe(0);
    }
  });

  it("is minus the spread's delta for each sold Up, and fades to zero far past the cap", () => {
    const sold = new Map([[short(CALL), 5_000_000n]]);
    const g = capped("call", 80_000, 90_000, 2_000, 0.5, 0.5, (CALL.expiry * 1000 - NOW) / YEAR_MS);
    expect(g.delta).toBeGreaterThan(0);
    expect(exposure(book, sold, at(80_000), NOW).get("BTC")?.delta).toBeCloseTo(-0.05 * g.delta, 12);
    expect(Math.abs(exposure(book, sold, at(400_000), NOW).get("BTC")?.delta ?? 1)).toBeLessThan(1e-6);
  });
});
