import { listedWidth, MmMessage, netOf, type Series, seriesId } from "@endline/sdk";
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

const sellable = (series: Series, stock: bigint) => netOf(long(series), stock, 1n);

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
      return { series_id: series.id, ask: toQuoteUnits(price.ask, 6, true).toString(), bid: toQuoteUnits(price.bid, 6, false).toString(), max_size: sellable(series, PAIRS).toString(), vol: mark.vol };
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

  it("offer as max_size the most one buy gets, its free stock or the per-trade payout cap, which decide fills but not a unit more", () => {
    const maxSize = (desk: ReturnType<typeof testDesk>["desk"], settings = SETTINGS) => BigInt(marks(desk, settings, NOW).find((m) => m.series_id === PUT.id)?.max_size ?? 0);
    const reason = (desk: ReturnType<typeof testDesk>["desk"], size: bigint, settings = SETTINGS) => {
      const d = decide(quoteEvent(PUT, "buy", size), desk, settings, NOW);
      return d.ok ? "ok" : d.reason;
    };
    const { desk } = testDesk();
    const most = sellable(PUT, PAIRS);
    expect(most).toBeLessThan(PAIRS);
    expect(maxSize(desk)).toBe(most);
    expect(reason(desk, most)).toBe("ok");
    expect(reason(desk, most + 1n)).toBe("insufficient inventory");
    desk.inventory.reserve("pending", { [long(PUT)]: -2_000_000n }, NOW + 1_000);
    const rest = sellable(PUT, PAIRS - 2_000_000n);
    expect(maxSize(desk)).toBe(rest);
    expect(reason(desk, rest)).toBe("ok");
    expect(reason(desk, rest + 1n)).toBe("insufficient inventory");
    const small = { ...SETTINGS, maxTradeUsd: 50.5 };
    const capped = testDesk().desk;
    expect(maxSize(capped, small)).toBe(2_525_000n);
    expect(reason(capped, 2_525_000n, small)).toBe("ok");
    expect(reason(capped, 2_525_001n, small)).toBe("over trade cap");
  });

  it("lift the ask of a cheap series so a max_size buy at it pays the $1 minimum decide charges, not less", () => {
    const { desk } = testDesk(60);
    const far = put(60_000_000_000n);
    desk.book.series.set(far.id, far);
    hold(desk, [far]);
    const mark = marks(desk, SETTINGS, NOW).find((m) => m.series_id === far.id);
    const priced = seriesMark(desk.market, desk.book, far);
    if (!mark?.max_size || !priced) throw new Error("no mark");
    expect(contractPrice(desk.book, far, priced, SETTINGS, NOW).ask * Number(PAIRS) / 1e8).toBeLessThan(1);
    const d = decide(quoteEvent(far, "buy", BigInt(mark.max_size)), desk, SETTINGS, NOW);
    if (!d.ok) throw new Error(d.reason);
    const cost = (BigInt(mark.max_size) * BigInt(mark.ask) + 10n ** 8n - 1n) / 10n ** 8n;
    expect(d.premium).toBe(1_000_000n);
    expect(cost - d.premium).toBeGreaterThanOrEqual(0n);
    expect(cost - d.premium).toBeLessThanOrEqual(1n);
  });

  it("leave out max_size but keep the plain ask and the bid where the MM holds no long, or only a rest that pays under the $1 minimum", () => {
    const plain = (desk: ReturnType<typeof testDesk>["desk"]) => {
      const mark = seriesMark(desk.market, desk.book, PUT);
      if (!mark) throw new Error("no fixture market");
      return toQuoteUnits(contractPrice(desk.book, PUT, mark, SETTINGS, NOW).ask, 6, true).toString();
    };
    for (const rest of [0n, 1n, 50_000n]) {
      const { desk } = testDesk(1_800, [[long(PUT), rest]]);
      const mark = marks(desk, SETTINGS, NOW).find((m) => m.series_id === PUT.id);
      expect(mark).toMatchObject({ ask: plain(desk) });
      expect(mark).toHaveProperty("bid");
      expect(mark).not.toHaveProperty("max_size");
    }
    const { desk } = testDesk(1_800, [[long(PUT), 60_000n]]);
    expect(marks(desk, SETTINGS, NOW).find((m) => m.series_id === PUT.id)?.max_size).toBe(sellable(PUT, 60_000n).toString());
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
