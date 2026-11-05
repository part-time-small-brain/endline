import type { ListedSeries, OptionKind } from "@near-options/sdk";
import { describe, expect, it } from "vitest";
import { buildGrid, rowOf } from "./grid.ts";

const USD = 10n ** 6n;
const DAY = 1_800_000_000;
const NEXT = DAY + 86_400;
const SPOT = 81_500n * USD;

const listed = (strike: number, kind: OptionKind, expiry = DAY): ListedSeries => ({
  id: `BTC-${expiry}-${strike}-${kind}`,
  underlying: "BTC",
  kind,
  strike: (BigInt(strike) * USD).toString(),
  width: (2_000n * USD).toString(),
  expiry,
  underlying_decimals: 8,
  option_asset: `nep245:opt.near:BTC-${expiry}-${strike}-${kind}`,
  quotable: true,
});
const marked = (series: ListedSeries[], ask = 400n * USD) => Object.fromEntries(series.map((s) => [s.id, { series_id: s.id, ask: ask.toString(), vol: 0.5 }]));
const none = new Set<string>();

describe("tap grid", () => {
  it("is Up above spot and Down at or below it, rows high to low and columns nearest first", () => {
    const series = [listed(81_000, "put", NEXT), listed(81_500, "call"), listed(81_500, "put"), listed(82_000, "call"), listed(81_500, "call", NEXT)];
    const at = (spot: bigint) => buildGrid(series, spot, 25n * USD, marked(series), none);
    const grid = at(SPOT);
    expect(grid.strikes).toEqual([82_000n * USD, 81_500n * USD, 81_000n * USD]);
    expect(grid.expiries).toEqual([DAY, NEXT]);
    expect(grid.cells[1]?.[0]?.series.kind).toBe("put");
    expect(at(SPOT - 1n).cells[1]?.[0]?.series.kind).toBe("call");
    expect(grid.cells[2]?.[1]?.series.kind).toBe("put");
  });

  it("leaves a cell empty when only the other side is listed there, never swapping it in", () => {
    const series = [listed(82_000, "put"), listed(81_000, "call"), listed(82_000, "call", NEXT)];
    const grid = buildGrid(series, SPOT, 25n * USD, marked(series), none);
    expect(grid.cells[0]?.[0]).toBeUndefined();
    expect(grid.cells[1]?.[0]).toBeUndefined();
    expect(grid.cells[1]?.[1]).toBeUndefined();
    expect(grid.cells[0]?.[1]?.series.kind).toBe("call");
  });

  it("keeps a held bet in its cell after spot crosses its price to beat", () => {
    const series = [listed(81_000, "call"), listed(81_000, "put")];
    const held = new Set([series[0]!.id]);
    const cell = buildGrid(series, SPOT, 25n * USD, marked(series), held).cells[0]?.[0];
    expect(cell).toMatchObject({ series: series[0], held: true });
    expect(buildGrid(series, SPOT, 25n * USD, marked(series), none).cells[0]?.[0]?.series.kind).toBe("put");
  });

  it("shows the gross multiple rounded down, and none for a stake below one contract or a series without a mark", () => {
    const series = [listed(82_000, "call")];
    const cellAt = (stake: bigint, ask: bigint) => buildGrid(series, SPOT, stake, marked(series, ask), none).cells[0]?.[0];
    expect(cellAt(25n * USD, 803_212_852n)?.multiple).toBe(24n);
    expect(cellAt(25n * USD, 1_000n * USD)?.multiple).toBe(20n);
    expect(cellAt(1n, 400n * USD)?.multiple).toBeUndefined();
    expect(buildGrid(series, SPOT, 25n * USD, {}, none).cells[0]?.[0]?.multiple).toBeUndefined();
  });

  it("places spot between the rows that bracket it and clamps it half a row past the edges", () => {
    const strikes = [83_000n, 82_000n, 80_000n].map((k) => k * USD);
    expect(rowOf(strikes, 83_000n * USD)).toBe(0);
    expect(rowOf(strikes, 82_500n * USD)).toBe(0.5);
    expect(rowOf(strikes, 81_000n * USD)).toBe(1.5);
    expect(rowOf(strikes, 80_000n * USD)).toBe(2);
    expect(rowOf(strikes, 90_000n * USD)).toBe(-0.5);
    expect(rowOf(strikes, 1n)).toBe(2.5);
    expect(rowOf([80_000n * USD], 1n)).toBe(0);
  });
});
