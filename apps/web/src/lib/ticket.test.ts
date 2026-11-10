import { longPayout } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { capNote, goodCase, payoutMultiple, type Ticket, ticket } from "./ticket.ts";

const BTC = 10n ** 8n;
const USD = 10n ** 6n;

function random(seed: number) {
  let state = seed;
  return (max: bigint) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return (BigInt(state) * max) / 2147483648n + 1n;
  };
}

const ticketOf = (kind: "call" | "put", strike: bigint, width: bigint, size: bigint, cost: bigint): Ticket => ({
  terms: { kind, strike, width, unit: BTC },
  size,
  cost,
  capped: false,
  breakeven: null,
  cashOut: 0n,
});

describe("goodCase", () => {
  it("shows the most the bet can pay, at the cap, only when that beats what you paid", () => {
    const next = random(11);
    let shown = 0;
    for (let i = 0; i < 400; i++) {
      const kind = next(2n) === 1n ? ("call" as const) : ("put" as const);
      const t = ticketOf(kind, (10_000n + next(140_000n)) * USD, next(5_000n) * USD, next(5n * BTC), next(2_000n * USD));
      const win = goodCase(t);
      const max = (t.size * t.terms.width) / BTC;
      if (win === null) {
        expect(max).toBeLessThanOrEqual(t.cost);
        continue;
      }
      shown++;
      expect(win.price).toBe(kind === "call" ? t.terms.strike + t.terms.width : t.terms.strike - t.terms.width);
      expect(win.payout).toBe(max);
      expect(longPayout(t.terms, t.size, win.price + (kind === "call" ? 1_000n * USD : -1n))).toBe(max);
      expect(win.payout).toBeGreaterThan(t.cost);
    }
    expect(shown).toBeGreaterThan(0);
  });

  it("puts the ceiling above the strike for Up and below it for Down", () => {
    expect(goodCase(ticketOf("call", 81_000n * USD, 2_000n * USD, BTC / 100n, 5n * USD))).toEqual({ price: 83_000n * USD, payout: 20n * USD });
    expect(goodCase(ticketOf("put", 80_000n * USD, 2_000n * USD, BTC / 100n, 5n * USD))).toEqual({ price: 78_000n * USD, payout: 20n * USD });
  });

  it("shows nothing for an empty ticket or one whose max payout doesn't beat the cost", () => {
    expect(goodCase(ticketOf("call", 81_000n * USD, 2_000n * USD, 0n, 0n))).toBeNull();
    expect(goodCase(ticketOf("call", 81_000n * USD, 2_000n * USD, BTC / 100n, 20n * USD))).toBeNull();
  });
});

describe("ticket", () => {
  const series = { id: "BTC-X", underlying: "BTC", kind: "call" as const, strike: (81_000n * USD).toString(), width: (2_000n * USD).toString(), expiry: 1_800_000_000, underlying_decimals: 8 };
  const mark = (ask: bigint, bid?: bigint, maxSize = 10n ** 30n) => ({ series_id: series.id, ask: ask.toString(), ...(bid === undefined ? {} : { bid: bid.toString() }), max_size: maxSize.toString(), vol: 0.4 });

  it("sizes the budget at the market maker's ask, up to what it sells, and costs size × ask, rounded up, never over the budget", () => {
    const next = random(7);
    for (let i = 0; i < 400; i++) {
      const ask = next(2_000n * USD - 1n);
      const bid = next(ask);
      const budget = next(500n * USD);
      const most = next(BTC);
      const t = ticket(series, budget, mark(ask, bid, most));
      expect(t.size).toBeLessThanOrEqual(most);
      expect(t.capped || (t.size + 1n) * ask > budget * BTC).toBe(true);
      expect(!t.capped || t.size === most).toBe(true);
      expect(t.cost).toBe((t.size * ask + BTC - 1n) / BTC);
      expect(t.cost).toBeLessThanOrEqual(budget);
      expect(t.cashOut).toBe((t.size * bid) / BTC);
    }
  });

  it("offers nothing without a mark or when the ask is at least what the bet can pay, and sells back for nothing without a bid", () => {
    expect(ticket(series, 25n * USD, undefined)).toMatchObject({ size: 0n, cost: 0n });
    expect(ticket(series, 25n * USD, mark(2_000n * USD)).size).toBe(0n);
    expect(ticket(series, 25n * USD, mark(2_000n * USD - 1n)).size).toBeGreaterThan(0n);
    expect(ticket(series, 25n * USD, mark(650n * USD)).cashOut).toBe(0n);
  });

  it("buys only what one trade may pay out, so a long shot costs less than the budget", () => {
    const capped = ticket(series, 100n * USD, mark(40n * USD, undefined, BTC));
    expect(capped).toMatchObject({ size: BTC, cost: 40n * USD, capped: true });
    expect(payoutMultiple(capped)).toBe(500n);
    expect(ticket(series, 40n * USD, mark(40n * USD, undefined, BTC))).toMatchObject({ size: BTC, capped: false });
  });
});

describe("payoutMultiple", () => {
  it("is the capped gross payout over the cost in tenths, rounded down, and nothing for an empty ticket", () => {
    const next = random(5);
    for (let i = 0; i < 400; i++) {
      const t = ticketOf("call", 81_000n * USD, next(5_000n) * USD, next(5n * BTC), next(2_000n * USD));
      const tenths = payoutMultiple(t) ?? 0n;
      const max = (t.size * t.terms.width) / BTC;
      expect(tenths * t.cost).toBeLessThanOrEqual(max * 10n);
      expect((tenths + 1n) * t.cost).toBeGreaterThan(max * 10n);
    }
    expect(payoutMultiple(ticketOf("call", 81_000n * USD, 2_000n * USD, 0n, 0n))).toBeUndefined();
    expect(payoutMultiple(ticketOf("call", 81_000n * USD, 2_000n * USD, BTC, 0n))).toBeUndefined();
  });
});

describe("capNote", () => {
  const series = { id: "BTC-X", underlying: "BTC", kind: "call" as const, strike: (81_000n * USD).toString(), width: (2_000n * USD).toString(), expiry: 1_800_000_000, underlying_decimals: 8 };
  const capped = (budget: bigint, ask: bigint) => capNote(ticket(series, budget, { series_id: series.id, ask: ask.toString(), max_size: BTC.toString(), vol: 0.4 }), budget, 6);

  it("says why a capped ticket costs less than the stake, and stays quiet when it doesn't or the cost reads as the stake", () => {
    expect(capped(100n * USD, 40n * USD)).toBe("One trade pays out at most $2,000, so this costs $40.");
    expect(capped(25n * USD, 40n * USD)).toBeUndefined();
    expect(capped(100n * USD, 100n * USD - 1n)).toBeUndefined();
  });
});
