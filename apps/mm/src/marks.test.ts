import { listedWidth, MmMessage, type Series, seriesId } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { CALL, DEMO_PUT, long, NOW, PAIRS, PUT, quoteEvent, SETTINGS, short, testDesk } from "./fixtures/desk.ts";
import { marks } from "./marks.ts";
import { seriesMark } from "./portfolio.ts";
import { contractPrice, toQuoteUnits } from "./pricing.ts";
import { decide } from "./quote.ts";

const put = (strike: bigint): Series => {
  const width = listedWidth(strike, 6);
  return { ...PUT, id: seriesId({ underlying: "BTC", expiry: PUT.expiry, strike, width, quoteDecimals: 6, kind: "put" }), strike: strike.toString(), width: width.toString() };
};

function hold(desk: ReturnType<typeof testDesk>["desk"], series: Series[]) {
  desk.inventory.setBalances(new Map([...desk.inventory.confirmed(), ...series.flatMap((s) => [[long(s), PAIRS] as const, [short(s), PAIRS] as const])]), NOW);
}

describe("marks", () => {
  it("publish the per-contract price decide quotes from, for one whole option, without a bid the MM wouldn't pay", () => {
    const { desk } = testDesk(60);
    const published = marks(desk, SETTINGS, NOW);
    const expected = (series: Series) => {
      const mark = seriesMark(desk.market, desk.book, series);
      if (!mark) throw new Error("no fixture market");
      const price = contractPrice(desk.book, series, mark, SETTINGS, NOW);
      return { series_id: series.id, ask: toQuoteUnits(price.ask, 6, true).toString(), bid: toQuoteUnits(price.bid, 6, false).toString(), vol: mark.vol };
    };
    expect(published).toHaveLength(3);
    expect(published).toContainEqual(expected(PUT));
    expect(published).toContainEqual(expected(CALL));
    const demo = published.find((m) => m.series_id === DEMO_PUT.id);
    expect(BigInt(demo?.ask ?? 0)).toBeGreaterThan(0n);
    expect(demo).not.toHaveProperty("bid");
  });

  it("price a buy at size × the published ask, lifted to the $1 minimum", () => {
    const { desk } = testDesk();
    const ask = BigInt(marks(desk, SETTINGS, NOW).find((m) => m.series_id === PUT.id)?.ask ?? 0);
    const premium = (size: bigint) => {
      const d = decide(quoteEvent(PUT, "buy", size), desk, SETTINGS, NOW);
      if (!d.ok) throw new Error(d.reason);
      return d.premium;
    };
    for (const size of [1_000_000n, 2_500_000n, 4_000_000n]) expect(Number(premium(size))).toBeCloseTo(Number((size * ask) / 10n ** 8n), -1);
    expect(premium(60_000n)).toBe(1_000_000n);
    expect((60_000n * ask) / 10n ** 8n).toBeLessThan(1_000_000n);
  });

  it("leave out series past the quoting window, at a width nobody lists, without market data, or that the MM holds neither side of", () => {
    const { desk } = testDesk(1_800);
    const other = { ...PUT, id: "BTC-27NOV26-80000_79999d99-P", width: "10000" };
    const unpriced = { ...PUT, id: "ETH-27NOV26-3000_2960-P", underlying: "ETH", strike: "3000000000", width: "40000000" };
    const unheld = { ...PUT, id: "BTC-27NOV26-81000_79000-P", strike: "81000000000" };
    for (const s of [other, unpriced, unheld]) desk.book.series.set(s.id, s);
    hold(desk, [other, unpriced]);
    expect(marks(desk, SETTINGS, NOW).map((m) => m.series_id).sort()).toEqual([CALL.id, PUT.id].sort());
  });

  it("skip a series whose price is absurd or at least its width and still publish the rest", () => {
    const { desk } = testDesk(60);
    const absurd = put(10n ** 18n);
    const deepInTheMoney = put(150_000_000_000n);
    for (const s of [absurd, deepInTheMoney]) desk.book.series.set(s.id, s);
    hold(desk, [absurd, deepInTheMoney]);
    expect(marks(desk, SETTINGS, NOW).map((m) => m.series_id).sort()).toEqual([CALL.id, DEMO_PUT.id, PUT.id].sort());
  });

  it("leave out a mark the relay would refuse, so one series can't void the whole message", () => {
    const { desk } = testDesk(60);
    const real = desk.market.mark.bind(desk.market);
    desk.market.mark = (target) => {
      const mark = real(target);
      return mark && target.strike >= 90_000 ? { ...mark, vol: 11 } : mark;
    };
    const published = marks(desk, SETTINGS, NOW);
    expect(published.map((m) => m.series_id).sort()).toEqual([DEMO_PUT.id, PUT.id].sort());
    expect(() => MmMessage.parse({ method: "marks", params: [{ series_id: CALL.id, ask: "1", vol: 11 }] })).toThrow();
  });

  it("rank by what the MM's tokens are worth and stop under the relay's 64 KB frame, so dust gifts in many long-id series can't crowd its own out", () => {
    const { desk } = testDesk(60);
    const digits = "9".repeat(36);
    const junk = Array.from({ length: 1_000 }, (_, i): Series => ({ ...PUT, id: `BTC-24OCT26T0712-${digits}${i}_${digits}${i}-P`, strike: `${70_000 + i * 10}000000` }));
    desk.book.series = new Map([...junk, ...desk.book.series.values()].map((s) => [s.id, s]));
    desk.inventory.setBalances(new Map([...desk.inventory.confirmed(), ...junk.map((s) => [long(s), 1n] as const)]), NOW);
    const published = marks(desk, SETTINGS, NOW);
    expect(published.length).toBeLessThan(1_003);
    expect(published.slice(0, 3).map((m) => m.series_id).sort()).toEqual([CALL.id, DEMO_PUT.id, PUT.id].sort());
    expect(JSON.stringify({ method: "marks", params: published }).length).toBeLessThan(64 * 1024);
  });

  it("publish nothing while halted or once the market data is stale", () => {
    const { desk, kill } = testDesk();
    expect(marks(desk, SETTINGS, NOW + SETTINGS.maxDataAgeMs)).toHaveLength(2);
    expect(marks(desk, SETTINGS, NOW + SETTINGS.maxDataAgeMs + 1)).toEqual([]);
    kill.trip("hedge", "2 failures");
    expect(marks(desk, SETTINGS, NOW)).toEqual([]);
  });
});
