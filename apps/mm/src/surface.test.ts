import { describe, expect, it } from "vitest";
import { parseBookSummary, parseInstrument } from "./deribit.ts";
import book from "./fixtures/deribit-book-summary-btc.json" with { type: "json" };
import { NOW, SPOT } from "./fixtures/desk.ts";
import { markFor, smileOf } from "./surface.ts";

const marks = parseBookSummary(book.result, NOW);
const smile = smileOf(marks);
const spot = { price: SPOT, at: NOW + 5 };
const NOV27 = Date.UTC(2026, 10, 27, 8) / 1000;
const DEMO = Date.UTC(2026, 9, 24, 7, 12) / 1000;
const volOf = (name: string) => marks.get(name)?.vol ?? Number.NaN;

describe("vol surface", () => {
  it("parses Deribit names into 08:00 UTC expiries and decimal strikes", () => {
    expect(parseInstrument("BTC-27NOV26-80000-P")).toEqual({ underlying: "BTC", expiry: NOV27, strike: 80_000 });
    expect(parseInstrument("ETH-5DEC26-2650d5-C")).toEqual({ underlying: "ETH", expiry: Date.UTC(2026, 11, 5, 8) / 1000, strike: 2650.5 });
    expect(parseInstrument("BTC-24OCT26T0712-80000-P")).toBeUndefined();
    expect(parseInstrument("BTC-27XXX26-80000-P")).toBeUndefined();
    expect(parseInstrument("BTC-PERPETUAL")).toBeUndefined();
  });

  it("prices a demo expiry off the nearest Deribit expiry's smile at the spot forward", () => {
    const m = markFor(smile, spot, { underlying: "BTC", expiry: DEMO, strike: 80_500 });
    expect(m?.forward).toBe(SPOT);
    const low = volOf("BTC-25OCT26-80000-P");
    const high = volOf("BTC-25OCT26-81000-P");
    expect(m?.vol).toBeGreaterThan(Math.min(low, high));
    expect(m?.vol).toBeLessThan(Math.max(low, high));
    expect(m?.at).toBe(NOW);
  });

  it("prices a listed strike at its own vol", () => {
    expect(markFor(smile, spot, { underlying: "BTC", expiry: NOV27, strike: 80_000 })?.vol).toBeCloseTo(volOf("BTC-27NOV26-80000-P"), 4);
  });

  it("clamps to the wing vol outside the listed strikes", () => {
    const wing = markFor(smile, spot, { underlying: "BTC", expiry: DEMO, strike: 200_000 });
    expect(wing?.vol).toBe(volOf("BTC-25OCT26-90000-C"));
  });

  it("interpolates a missing strike inside a listed expiry at that expiry's forward", () => {
    const m = markFor(smile, undefined, { underlying: "BTC", expiry: NOV27, strike: 79_000 });
    expect(m?.vol).toBeGreaterThan(volOf("BTC-27NOV26-80000-P"));
    expect(m?.vol).toBeLessThan(volOf("BTC-27NOV26-78000-P"));
  });

  it("gives nothing for another underlying, or a demo expiry without a spot price", () => {
    expect(markFor(smile, spot, { underlying: "ETH", expiry: NOV27, strike: 3_000 })).toBeUndefined();
    expect(markFor(smile, undefined, { underlying: "BTC", expiry: DEMO, strike: 80_000 })).toBeUndefined();
  });

  it("ages a row by Deribit's own timestamp, so a frozen feed goes stale, and drops a row without one", () => {
    const [row] = book.result;
    const name = row!.instrument_name;
    expect(parseBookSummary([{ ...row, creation_timestamp: NOW - 60_000 }], NOW).get(name)?.at).toBe(NOW - 60_000);
    expect(parseBookSummary([{ ...row, creation_timestamp: undefined }], NOW).has(name)).toBe(false);
  });

  it("gives nothing for a listed expiry whose forward is far from the index", () => {
    const target = { underlying: "BTC", expiry: NOV27, strike: 80_000 };
    expect(markFor(smile, spot, target)).toBeDefined();
    expect(markFor(smile, { ...spot, price: SPOT * 0.8 }, target)).toBeUndefined();
    expect(markFor(smile, { ...spot, price: SPOT * 1.25 }, target)).toBeUndefined();
  });

  it("inherits the oldest timestamp so staleness can't be laundered through the spot", () => {
    const old = { price: SPOT, at: NOW - 60_000 };
    expect(markFor(smile, old, { underlying: "BTC", expiry: DEMO, strike: 80_000 })?.at).toBe(NOW - 60_000);
  });
});
