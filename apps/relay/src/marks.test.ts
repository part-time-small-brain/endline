import { describe, expect, it } from "vitest";
import { MARK_TTL_MS, Marks } from "./marks.ts";

const mark = (series_id: string, ask: string, bid: string | undefined, vol: number) => ({ series_id, ask, ...(bid === undefined ? {} : { bid }), vol });

describe("marks", () => {
  it("serve each series' lowest ask with that market maker's vol and the highest bid from anyone", () => {
    const marks = new Marks();
    marks.set("a", [mark("S1", "900", "500", 0.4), mark("S2", "300", undefined, 0.5)], 0);
    marks.set("b", [mark("S1", "1000", "700", 0.6), mark("S2", "200", "100", 0.45)], 0);
    expect(marks.best(0)).toEqual([
      { series_id: "S1", ask: "900", bid: "700", vol: 0.4 },
      { series_id: "S2", ask: "200", bid: "100", vol: 0.45 },
    ]);
  });

  it("serve the size of the market maker whose ask wins, and take the lowest ask from those that can sell", () => {
    const marks = new Marks();
    marks.set("a", [mark("S1", "100", "90", 0.3), { ...mark("S2", "300", undefined, 0.5), max_size: "7" }], 0);
    marks.set("b", [{ ...mark("S1", "200", "50", 0.5), max_size: "9" }, { ...mark("S2", "250", undefined, 0.6), max_size: "4" }], 0);
    expect(marks.best(0)).toEqual([
      { series_id: "S1", ask: "200", bid: "90", max_size: "9", vol: 0.5 },
      { series_id: "S2", ask: "250", max_size: "4", vol: 0.6 },
    ]);
    marks.drop("b");
    expect(marks.best(0)).toEqual([
      { series_id: "S1", ask: "100", bid: "90", vol: 0.3 },
      { series_id: "S2", ask: "300", max_size: "7", vol: 0.5 },
    ]);
  });

  it("compare amounts as integers, not strings", () => {
    const marks = new Marks();
    marks.set("a", [mark("S1", "90", "9", 0.4)], 0);
    marks.set("b", [mark("S1", "100", "10", 0.6)], 0);
    expect(marks.best(0)).toEqual([{ series_id: "S1", ask: "90", bid: "10", vol: 0.4 }]);
  });

  it("drop a market maker's marks 10 s after the relay received them, and on disconnect", () => {
    const marks = new Marks();
    marks.set("old", [mark("S1", "100", "90", 0.3)], 0);
    marks.set("new", [mark("S1", "200", "50", 0.5)], 5_000);
    expect(marks.best(MARK_TTL_MS)).toEqual([{ series_id: "S1", ask: "100", bid: "90", vol: 0.3 }]);
    expect(marks.best(MARK_TTL_MS + 1)).toEqual([{ series_id: "S1", ask: "200", bid: "50", vol: 0.5 }]);
    marks.drop("new");
    expect(marks.best(MARK_TTL_MS + 1)).toEqual([]);
  });

  it("replace a market maker's marks with its latest message, so a series it stopped quoting goes", () => {
    const marks = new Marks();
    marks.set("a", [mark("S1", "100", "90", 0.3)], 0);
    marks.set("a", [], 1_000);
    expect(marks.best(1_000)).toEqual([]);
  });
});
