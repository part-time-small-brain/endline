import { describe, expect, it } from "vitest";
import { barScale, chartDomain, cone, linear, nearestIndex, priceDomain, ticks } from "./chart.ts";

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("linear", () => {
  it("round-trips through invert for flipped ranges like a y axis", () => {
    const next = random(3);
    for (let i = 0; i < 200; i++) {
      const low = next() * 100_000;
      const scale = linear([low, low + 1 + next() * 50_000], [600, 20]);
      const price = low + next() * 60_000;
      expect(scale.invert(scale(price))).toBeCloseTo(price, 6);
    }
    expect(linear([10, 20], [600, 20])(20)).toBe(20);
  });

  it("never returns NaN for a zero-width domain", () => {
    const scale = linear([5, 5], [0, 100]);
    expect(scale(5)).toBe(0);
    expect(scale(9)).toBe(0);
    expect(scale.invert(70)).toBe(5);
  });
});

describe("priceDomain", () => {
  it("always contains spot, every given price and at least ±3%", () => {
    const next = random(11);
    for (let i = 0; i < 200; i++) {
      const spot = 100 + next() * 100_000;
      const prices = Array.from({ length: 20 }, () => spot * (0.7 + next() * 0.6));
      const [low, high] = priceDomain(spot, next() * 0.2, prices);
      expect(low).toBeGreaterThanOrEqual(0);
      expect(low).toBeLessThanOrEqual(spot * 0.97 + 1e-9);
      expect(high).toBeGreaterThanOrEqual(spot * 1.03 - 1e-9);
      for (const p of prices) {
        expect(p).toBeGreaterThanOrEqual(low);
        expect(p).toBeLessThanOrEqual(high);
      }
    }
  });

  it("clamps at zero instead of showing negative prices", () => {
    expect(priceDomain(100, 2, [])[0]).toBe(0);
    expect(priceDomain(100, 0, [1_000])[0]).toBe(0);
  });
});

describe("ticks", () => {
  it("returns round numbers inside the domain, never more than asked plus one", () => {
    const next = random(5);
    for (let i = 0; i < 300; i++) {
      const low = next() * 90_000;
      const high = low + 0.01 + next() * 20_000;
      const max = 1 + Math.floor(next() * 8);
      const out = ticks([low, high], max);
      if (max >= 2) expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThanOrEqual(max + 1);
      for (const t of out) {
        expect(t).toBeGreaterThanOrEqual(low);
        expect(t).toBeLessThanOrEqual(high);
        expect(String(t)).not.toMatch(/\.\d{5,}|e/);
      }
    }
  });

  it("does not leak float noise on small prices", () => {
    expect(ticks([0.1, 0.7], 6)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(ticks([76_900, 84_400], 7)).toEqual([78_000, 80_000, 82_000, 84_000]);
  });

  it("gives nothing for empty or inverted domains", () => {
    expect(ticks([5, 5], 5)).toEqual([]);
    expect(ticks([9, 5], 5)).toEqual([]);
    expect(ticks([0, 10], 0)).toEqual([]);
    expect(ticks([0, Number.NaN], 4)).toEqual([]);
  });
});

describe("cone", () => {
  it("starts at spot and only widens towards the end", () => {
    const points = cone(80_000, 0.42, 1 / 365, 24);
    expect(points[0]).toEqual({ at: 0, low: 80_000, high: 80_000 });
    expect(points.at(-1)?.at).toBe(1);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]?.low).toBeLessThan(points[i - 1]?.low ?? 0);
      expect(points[i]?.high).toBeGreaterThan(points[i - 1]?.high ?? 0);
    }
  });

  it("collapses to spot once the end has passed instead of going NaN", () => {
    for (const p of cone(3_000, 0.5, -0.01, 4)) expect(p).toMatchObject({ low: 3_000, high: 3_000 });
  });
});

describe("nearestIndex", () => {
  const strikes = [78_000, 79_000, 80_000, 81_000];
  it("snaps to the closest listed strike, including past either end", () => {
    expect(nearestIndex(80_499, strikes)).toBe(2);
    expect(nearestIndex(80_501, strikes)).toBe(3);
    expect(nearestIndex(10, strikes)).toBe(0);
    expect(nearestIndex(1e9, strikes)).toBe(3);
  });

  it("keeps the lower strike on an exact tie and returns -1 when nothing is listed", () => {
    expect(nearestIndex(79_500, strikes)).toBe(1);
    expect(nearestIndex(80_000, [])).toBe(-1);
  });
});

describe("chartDomain", () => {
  it("keeps a strike picked past every preset strictly inside the plot, so its line never pins to the edge", () => {
    const history: [number, number][] = [
      [0, 80_100],
      [1, 80_900],
    ];
    for (const strike of [60_000, 79_000, 84_000, 120_000]) {
      const [low, high] = chartDomain(80_650, 0.01, history, [80_000, 81_000, 82_000], strike);
      const y = linear([low, high], [600, 20]);
      expect(y(strike)).toBeGreaterThan(20);
      expect(y(strike)).toBeLessThan(600);
      for (const [, price] of history) expect(price).toBeGreaterThanOrEqual(low);
    }
  });

  it("still works with no history at all", () => {
    const [low, high] = chartDomain(3_120, 0.02, [], [], 3_400);
    expect(low).toBeLessThan(3_120);
    expect(high).toBeGreaterThan(3_400);
  });
});

describe("barScale", () => {
  const reach = (payout: bigint, reference: bigint) => Number(payout) / Number(barScale(reference, payout));
  it("never lets bars run past the ribbon when you pay more than the reference amount", () => {
    for (const payout of [1n, 49_999_999n, 50_000_000n, 400_000_000n, 10n ** 15n]) expect(reach(payout, 50_000_000n)).toBeLessThanOrEqual(1);
    expect(reach(400_000_000n, 50_000_000n)).toBe(1);
  });

  it("keeps a smaller amount's bars shorter than the reference so changing the amount still shows", () => {
    expect(reach(20_000_000n, 50_000_000n)).toBeCloseTo(0.4);
    expect(barScale(0n, 0n)).toBe(0n);
  });
});
