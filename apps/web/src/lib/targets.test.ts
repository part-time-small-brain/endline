import { describe, expect, it } from "vitest";
import { presets } from "./targets.ts";

const K = (...dollars: number[]) => dollars.map((d) => BigInt(d) * 1_000_000n);
const STRIKES = K(78_000, 79_000, 80_000, 81_000, 82_000, 83_000, 84_000);
const SPOT = 80_512n * 1_000_000n;
const pick = (list: ReturnType<typeof presets>) => Object.fromEntries(list.map((p) => [p.name, p.index]));

describe("presets", () => {
  it("puts Balanced on the first strike past spot and Safer on the side that already pays", () => {
    expect(pick(presets(STRIKES, "call", SPOT))).toEqual({ Safer: 2, Balanced: 3, Bolder: 5 });
    expect(pick(presets(STRIKES, "put", SPOT))).toEqual({ Safer: 3, Balanced: 2, Bolder: 0 });
  });

  it("never calls a strike equal to spot Balanced, since it pays nothing at that price", () => {
    const spot = 80_000n * 1_000_000n;
    expect(pick(presets(STRIKES, "call", spot)).Balanced).toBe(3);
    expect(pick(presets(STRIKES, "put", spot)).Balanced).toBe(1);
  });

  it("drops presets that would fall off the list or repeat Balanced", () => {
    expect(pick(presets(STRIKES, "call", 100n))).toEqual({ Balanced: 0, Bolder: 2 });
    expect(pick(presets(STRIKES, "call", 10n ** 12n))).toEqual({ Safer: 5, Balanced: 6 });
    expect(pick(presets(STRIKES, "put", 10n ** 12n))).toEqual({ Balanced: 6, Bolder: 4 });
    expect(pick(presets(STRIKES, "put", 100n))).toEqual({ Balanced: 0, Safer: 1 });
    expect(pick(presets(K(80_000, 81_000), "call", SPOT))).toEqual({ Safer: 0, Balanced: 1 });
    expect(presets(K(81_000), "put", SPOT)).toEqual([{ name: "Balanced", index: 0 }]);
    expect(presets([], "call", SPOT)).toEqual([]);
  });

  it("keeps every index valid and distinct for random strike lists", () => {
    for (let n = 1; n < 12; n++) {
      const strikes = K(...Array.from({ length: n }, (_, i) => 1_000 + i * 50));
      for (let spot = 900; spot < 1_700; spot += 7) {
        for (const kind of ["call", "put"] as const) {
          const list = presets(strikes, kind, BigInt(spot) * 1_000_000n);
          const indices = list.map((p) => p.index);
          expect(new Set(indices).size).toBe(indices.length);
          for (const i of indices) expect(strikes[i]).toBeDefined();
          expect(list.some((p) => p.name === "Balanced")).toBe(true);
        }
      }
    }
  });
});
