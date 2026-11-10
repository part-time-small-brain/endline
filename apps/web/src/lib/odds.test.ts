import { describe, expect, it } from "vitest";
import { chance, nearestVol } from "./odds.ts";

const NOW = 1_800_000_000;
const DAY = 86_400;
const series = (kind: "call" | "put", strikeUsd: number, expiry = NOW + DAY) => ({ kind, strike: (BigInt(strikeUsd) * 1_000_000n).toString(), expiry });

describe("chance", () => {
  it("is the lognormal odds of ending past the strike, a bit under 50% at the money", () => {
    const up = chance(series("call", 80_000), 80_000, 0.42, NOW, 6);
    expect(up).toBeGreaterThan(0.49);
    expect(up).toBeLessThan(0.5);
    expect(chance(series("call", 81_000), 80_512, 0.42, NOW, 6)).toBeCloseTo(0.4, 1);
  });

  it("makes Up and Down add to one while time remains", () => {
    for (const strike of [20_000, 70_000, 80_000, 80_512, 95_000, 400_000])
      for (const days of [0.01, 1, 30]) {
        const end = NOW + days * DAY;
        expect(chance(series("call", strike, end), 80_512, 0.42, NOW, 6) + chance(series("put", strike, end), 80_512, 0.42, NOW, 6)).toBeCloseTo(1, 9);
      }
  });

  it("stays inside [0, 1] and moves the right way with the strike", () => {
    let previous = 1;
    for (let strike = 10_000; strike <= 300_000; strike += 10_000) {
      const p = chance(series("call", strike), 80_000, 1.5, NOW, 6);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(previous);
      previous = p;
    }
  });

  it("at or after the end, pays only strictly past the strike, so neither side wins at exactly the strike", () => {
    const ended = NOW - 1;
    expect(chance(series("call", 80_000, ended), 80_000, 0.42, NOW, 6)).toBe(0);
    expect(chance(series("put", 80_000, ended), 80_000, 0.42, NOW, 6)).toBe(0);
    expect(chance(series("call", 80_000, NOW), 80_001, 0.42, NOW, 6)).toBe(1);
    expect(chance(series("put", 80_000, NOW), 79_999, 0.42, NOW, 6)).toBe(1);
  });

  it("falls back to intrinsic instead of throwing on missing market data", () => {
    expect(chance(series("call", 80_000), 0, 0.42, NOW, 6)).toBe(0);
    expect(chance(series("put", 80_000), 0, 0.42, NOW, 6)).toBe(1);
    expect(chance(series("call", 80_000), 81_000, 0, NOW, 6)).toBe(1);
  });
});

describe("nearestVol", () => {
  const listed = [20_000, 79_000, 81_000, 82_000].map((strike) => ({ id: `S${strike}`, strike: (BigInt(strike) * 1_000_000n).toString() }));
  const mark = (id: string, vol: number) => ({ series_id: id, ask: "1", max_size: "1", vol });

  it("takes the vol of the priced strike nearest spot, skipping strikes without a mark", () => {
    const marks = { S20000: mark("S20000", 0.9), S81000: mark("S81000", 0.5), S82000: mark("S82000", 0.6) };
    expect(nearestVol(listed, marks, 80_400_000_000n)).toBe(0.5);
    expect(nearestVol(listed, marks, 81_700_000_000n)).toBe(0.6);
    expect(nearestVol(listed, { S20000: mark("S20000", 0.9) }, 80_400_000_000n)).toBe(0.9);
    expect(nearestVol(listed, {}, 80_400_000_000n)).toBeUndefined();
  });
});
