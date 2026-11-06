import { buyDiffs, capped, type Diff, type QuoteResponse, readPayload, type Series, sellDiffs, unmatched, YEAR_MS } from "@endline/sdk";
import { KeyPair } from "near-api-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.ts";
import { CALL, DEMO_PUT, long, NOW, PAIRS, PUT, quoteEvent, SETTINGS, short, testDesk, USDC } from "./fixtures/desk.ts";
import { CHAIN_LAG_MS } from "./inventory.ts";
import { exposure, seriesMark } from "./portfolio.ts";
import { decide, type Desk, QUOTE_TTL_MS } from "./quote.ts";
import { Quoter } from "./quoter.ts";
import { nep413Signer } from "./signer.ts";

const MM = "mm.test.near";
const key = KeyPair.fromRandom("ed25519");

const DEFAULTS = loadConfig({ MM_ACCOUNT_ID: MM, MM_PRIVATE_KEY: key.toString(), NETWORK_ID: "testnet" }).settings;

describe("default limits on a near-money bet", () => {
  const ONE_BTC = 100_000_000n;
  const nearMoney = (hoursOut: number): Series => ({
    id: `BTC-NEAR-${hoursOut}H`,
    underlying: "BTC",
    kind: "call",
    strike: "80000000000",
    width: "2000000000",
    expiry: Math.floor(NOW / 3_600_000 + hoursOut) * 3_600,
    underlying_decimals: 8,
  });
  const quote = (hoursOut: number, size: bigint) => {
    const series = nearMoney(hoursOut);
    const { desk } = testDesk(1_800, [[long(series), 2n * ONE_BTC], [short(series), 2n * ONE_BTC]]);
    desk.book.series.set(series.id, series);
    return decide(quoteEvent(series, "buy", size), desk, DEFAULTS, NOW);
  };

  it.each([24, 4])("sells half a BTC of contracts %i h out", (hours) => {
    expect(quote(hours, ONE_BTC / 2n)).toMatchObject({ ok: true });
  });

  it("refuses a full-size trade 4 h out, whose delta is near one per contract", () => {
    expect(quote(4, ONE_BTC)).toEqual({ ok: false, reason: "over delta cap" });
  });
});

const LOOSE = { ...SETTINGS, maxTradeUsd: 1e9, maxSeriesUsd: 1e12, maxDeltaUsd: 1e9, maxVegaUsd: 1e9 };

function quoter(desk: Desk, send: (r: QuoteResponse) => void, settings = SETTINGS) {
  return new Quoter({ desk, settings, intentsId: "intents.test.near", accountId: MM, sign: nep413Signer(key.toString()), send, onFill: () => {}, log: () => {} });
}

beforeAll(() => vi.setSystemTime(NOW));
afterAll(() => vi.useRealTimers());

function signedDiff(r: QuoteResponse): { diff: Diff; deadline: string; nonce: string; signer: string; recipient: string } {
  const p = readPayload(r.signed);
  const [intent] = p.intents;
  const diff = Object.fromEntries(Object.entries(intent?.intent === "token_diff" ? intent.diff : {}).map(([a, v]) => [a, BigInt(v)]));
  return { diff, deadline: p.deadline, nonce: p.nonce, signer: p.signer_id, recipient: p.verifying_contract };
}

function rng(seed: bigint) {
  let s = seed;
  return (max: bigint) => {
    s = (s * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
    return (s % max) + 1n;
  };
}

describe("quote refusals", () => {
  const size = 1_000_000n;

  it.each([
    [1_800, PUT],
    [60, DEMO_PUT],
  ])("stops quoting once a deadline would reach expiry minus the contract's %i s write cutoff", (cutoff, series) => {
    const { desk } = testDesk(cutoff);
    const lastOk = series.expiry * 1000 - cutoff * 1000 - QUOTE_TTL_MS - 1;
    const at = (now: number) => decide(quoteEvent(series, "buy", size, { deadline_ms: now + 1_000 }), desk, { ...SETTINGS, maxDataAgeMs: Infinity }, now);
    expect(at(lastOk)).toMatchObject({ ok: true });
    expect(at(lastOk + 1)).toEqual({ ok: false, reason: "too close to expiry" });
  });

  it("refuses data older than the limit and accepts it at the limit", () => {
    const { desk } = testDesk();
    expect(decide(quoteEvent(PUT, "buy", size, { deadline_ms: NOW + 20_000 }), desk, SETTINGS, NOW + SETTINGS.maxDataAgeMs)).toMatchObject({ ok: true });
    expect(decide(quoteEvent(PUT, "buy", size, { deadline_ms: NOW + 20_000 }), desk, SETTINGS, NOW + SETTINGS.maxDataAgeMs + 1)).toEqual({
      ok: false,
      reason: "stale market data",
    });
  });

  it.each([
    ["unknown series", { series_id: "BTC-27NOV26-85000_83000-P" }, "unknown series"],
    ["short token instead of long", { option_asset: short(PUT) }, "unsupported assets"],
    ["another quote asset", { quote_asset: "nep141:usdt.test.near" }, "unsupported assets"],
    ["terms the contract disagrees with", { terms: { ...quoteEvent(PUT, "buy", size).terms, strike: "70000000000" } }, "terms differ from contract"],
    ["the same strike with another width", { terms: { ...quoteEvent(PUT, "buy", size).terms, width: "4000000000" } }, "terms differ from contract"],
    ["a relay fee that differs from intents", { fee_pips: 0 }, "fee differs from intents"],
    ["an auction that already closed", { deadline_ms: NOW - 1 }, "auction closed"],
  ])("refuses %s", (_, overrides, reason) => {
    expect(decide(quoteEvent(PUT, "buy", size, overrides), testDesk().desk, SETTINGS, NOW)).toEqual({ ok: false, reason });
  });

  it("caps each trade and each series by max payout (contracts × width), not by notional", () => {
    const { desk } = testDesk(1_800, [[long(PUT), 50_000_000n], [short(PUT), 50_000_000n]]);
    const capped100 = { ...LOOSE, maxTradeUsd: 100 };
    expect(decide(quoteEvent(PUT, "buy", 5_000_000n), desk, capped100, NOW)).toMatchObject({ ok: true });
    expect(decide(quoteEvent(PUT, "buy", 5_000_001n), desk, capped100, NOW)).toEqual({ ok: false, reason: "over trade cap" });
    expect(decide(quoteEvent(PUT, "buy", 2_000_000n), desk, { ...LOOSE, maxSeriesUsd: 40 }, NOW)).toEqual({ ok: false, reason: "over series cap" });
  });

  it("refuses a series at a width the lister doesn't use, so a third party's copy of a strike can't be quoted", () => {
    const { desk } = testDesk();
    const other = { ...PUT, id: "BTC-27NOV26-80000_79999d99-P", width: "10000" };
    desk.book.series.set(other.id, other);
    expect(decide(quoteEvent(other, "buy", 1_000_000n), desk, SETTINGS, NOW)).toEqual({ ok: false, reason: "width we don't list" });
  });

  it("never quotes a premium at or above what the option can pay, even when the $1 minimum lifts it there", () => {
    const { desk } = testDesk();
    expect(decide(quoteEvent(PUT, "buy", 50_000n), desk, SETTINGS, NOW)).toEqual({ ok: false, reason: "premium at or above max payout" });
    expect(decide(quoteEvent(PUT, "buy", 50_001n), desk, SETTINGS, NOW)).toMatchObject({ ok: true, premium: 1_000_000n });
  });

  it("refuses when the inventory can't cover the gross leg including the fee", () => {
    const { desk } = testDesk(1_800, [[long(PUT), 1_000_000n]]);
    expect(decide(quoteEvent(PUT, "buy", 1_000_000n), desk, SETTINGS, NOW)).toEqual({ ok: false, reason: "insufficient inventory" });
    expect(decide(quoteEvent(PUT, "buy", 999_999n), desk, SETTINGS, NOW)).toMatchObject({ ok: true });
    const poor = testDesk(1_800, [[USDC, 1_000_000n]]).desk;
    expect(decide(quoteEvent(PUT, "sell", 1_000_000n), poor, SETTINGS, NOW)).toEqual({ ok: false, reason: "insufficient inventory" });
  });

  it("refuses when the trade would push net delta or vega over the cap", () => {
    const { desk } = testDesk();
    expect(decide(quoteEvent(PUT, "buy", 1_000_000n), desk, SETTINGS, NOW)).toMatchObject({ ok: true });
    expect(decide(quoteEvent(PUT, "buy", 1_000_000n), desk, { ...SETTINGS, maxDeltaUsd: 1 }, NOW)).toEqual({ ok: false, reason: "over delta cap" });
    expect(decide(quoteEvent(PUT, "buy", 1_000_000n), desk, { ...SETTINGS, maxVegaUsd: 0.001 }, NOW)).toEqual({ ok: false, reason: "over vega cap" });
  });

  it("refuses everything while a kill switch is tripped", () => {
    const { desk, kill } = testDesk();
    kill.trip("hedge", "2 failures");
    expect(decide(quoteEvent(PUT, "buy", size), desk, SETTINGS, NOW)).toMatchObject({ ok: false });
    kill.clear("hedge");
    expect(decide(quoteEvent(PUT, "buy", size), desk, SETTINGS, NOW)).toMatchObject({ ok: true });
  });
});

describe("reservations", () => {
  it.each(["failed", "expired", "settled"] as const)("never signs two quotes that together exceed the inventory, and holds the first past a relay's %s until its deadline", async (status) => {
    const { desk, inventory } = testDesk(1_800, [[long(PUT), 3_000_000n]]);
    const sent: QuoteResponse[] = [];
    const q = quoter(desk, (r) => sent.push(r), LOOSE);
    const first = quoteEvent(PUT, "buy", 2_000_000n);
    const second = quoteEvent(PUT, "buy", 2_000_000n);
    await Promise.all([q.onQuote(first), q.onQuote(second)]);
    expect(sent.map((r) => r.quote_id)).toEqual([first.quote_id]);
    q.onStatus({ quote_id: first.quote_id, status, tx_hash: "tx" });
    await q.onQuote({ ...second, quote_id: "retry" });
    expect(sent.map((r) => r.quote_id)).toEqual([first.quote_id]);
    inventory.setBalances(inventory.confirmed(), NOW + QUOTE_TTL_MS + CHAIN_LAG_MS + 1);
    await q.onQuote({ ...second, quote_id: "after deadline" });
    expect(sent.map((r) => r.quote_id)).toEqual([first.quote_id, "after deadline"]);
  });

  it("keeps the series cap while a filled trade is counted both in balances and in its still-held reservation", () => {
    const settings = { ...SETTINGS, maxTradeUsd: 1e9, maxSeriesUsd: 60, maxDeltaUsd: 1e9, maxVegaUsd: 1e9 };
    const { desk, inventory } = testDesk();
    const buy = decide(quoteEvent(PUT, "buy", 2_000_000n), desk, settings, NOW);
    if (!buy.ok) throw new Error(buy.reason);
    inventory.reserve("filled", buy.diff, buy.deadlineMs);
    const filled = new Map(inventory.confirmed());
    for (const [asset, delta] of Object.entries(buy.diff)) filled.set(asset, (filled.get(asset) ?? 0n) + delta);
    inventory.setBalances(filled, NOW + 5_000);
    expect(decide(quoteEvent(PUT, "sell", 6_000_000n), desk, settings, NOW)).toEqual({ ok: false, reason: "over series cap" });
  });

  it("keeps the series cap however the pending quotes on either side end up, filled or not", () => {
    const settings = { ...SETTINGS, maxTradeUsd: 1e9, maxSeriesUsd: 60, maxDeltaUsd: 1e9, maxVegaUsd: 1e9 };
    const { desk, inventory } = testDesk(1_800, [[long(PUT), 100_000_000n], [short(PUT), 100_000_000n]]);
    const take = (side: "buy" | "sell", size: bigint, id: string) => {
      const d = decide({ ...quoteEvent(PUT, side, size), quote_id: id }, desk, settings, NOW);
      if (d.ok) inventory.reserve(id, d.diff, d.deadlineMs);
      return d;
    };
    expect(take("sell", 3_000_000n, "never signed").ok).toBe(true);
    expect(take("buy", 2_900_000n, "first").ok).toBe(true);
    expect(take("buy", 2_900_000n, "second")).toEqual({ ok: false, reason: "over series cap" });
  });

  it.each([
    ["delta", "maxDeltaUsd", "over delta cap"],
    ["vega", "maxVegaUsd", "over vega cap"],
  ] as const)("keeps the %s cap when a pending opposite quote that never fills would hide two same-way trades", (greek, cap, reason) => {
    const { desk, inventory } = testDesk(1_800, [[long(PUT), 100_000_000n], [short(PUT), 100_000_000n]]);
    const mark = seriesMark(desk.market, desk.book, PUT);
    const e = exposure(desk.book, new Map([[short(PUT), 2_000_000n]]), (s) => seriesMark(desk.market, desk.book, s), NOW).get("BTC");
    if (!mark || !e) throw new Error("no fixture market");
    const one = Math.abs(greek === "delta" ? e.delta * mark.forward : e.vega);
    const settings = { ...SETTINGS, maxTradeUsd: 1e9, maxSeriesUsd: 1e9, maxDeltaUsd: 1e9, maxVegaUsd: 1e9, [cap]: 1.5 * one };
    const take = (side: "buy" | "sell", id: string) => {
      const d = decide({ ...quoteEvent(PUT, side, 2_000_000n), quote_id: id }, desk, settings, NOW);
      if (d.ok) inventory.reserve(id, d.diff, d.deadlineMs);
      return d;
    };
    expect(take("sell", "never signed").ok).toBe(true);
    expect(take("buy", "first").ok).toBe(true);
    expect(take("buy", "second")).toEqual({ ok: false, reason });
  });

  it("releases the reservation when the quote can't be sent", async () => {
    const { desk, inventory } = testDesk();
    const before = inventory.available(long(PUT));
    const q = quoter(desk, () => {
      throw new Error("relay not connected");
    });
    await q.onQuote(quoteEvent(PUT, "buy", 1_000_000n));
    expect(inventory.available(long(PUT))).toBe(before);
  });

  it("refuses a replayed quote id instead of reserving twice", async () => {
    const { desk } = testDesk();
    const ev = quoteEvent(PUT, "buy", 1_000_000n);
    await quoter(desk, () => {}).onQuote(ev);
    expect(decide(ev, desk, SETTINGS, NOW)).toEqual({ ok: false, reason: "duplicate quote id" });
  });

  it("holds a reservation until a balance read that started after its deadline, even if the relay never reports", () => {
    const { inventory } = testDesk();
    inventory.reserve("q", { [long(PUT)]: -PAIRS }, NOW + QUOTE_TTL_MS);
    const balances = new Map([[long(PUT), PAIRS]]);
    inventory.setBalances(balances, NOW + QUOTE_TTL_MS + CHAIN_LAG_MS);
    expect(inventory.available(long(PUT))).toBe(0n);
    inventory.setBalances(balances, NOW + QUOTE_TTL_MS + CHAIN_LAG_MS + 1);
    expect(inventory.available(long(PUT))).toBe(PAIRS);
  });

  it("ignores a balance read that started before the last one", () => {
    const { inventory } = testDesk();
    inventory.setBalances(new Map([[long(PUT), 0n]]), NOW + 2_000);
    inventory.setBalances(new Map([[long(PUT), PAIRS]]), NOW + 1_000);
    expect(inventory.available(long(PUT))).toBe(0n);
  });
});

describe("signed quotes", () => {
  it("always settle against the user's leg after fees, for random sizes on both sides", async () => {
    const next = rng(3n);
    const big = [PUT, CALL, DEMO_PUT].flatMap((s): [string, bigint][] => [[long(s), 10n ** 12n], [short(s), 10n ** 12n]]);
    const { desk } = testDesk(60, [...big, [USDC, 10n ** 15n]]);
    const sent: QuoteResponse[] = [];
    const q = quoter(desk, (r) => sent.push(r), LOOSE);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const series = [PUT, CALL, DEMO_PUT][i % 3] ?? PUT;
      const side = i % 2 === 0 ? "buy" : "sell";
      const ev = quoteEvent(series, side, next(5_000_000n));
      const d = decide(ev, desk, LOOSE, NOW);
      if (!d.ok) {
        expect(["below minimum premium", "premium at or above max payout"]).toContain(d.reason);
        continue;
      }
      expect(d.premium).toBeLessThan((BigInt(ev.size) * BigInt(series.width)) / 10n ** 8n);
      await q.onQuote(ev);
      const r = sent.at(-1);
      if (!r) throw new Error("no quote sent");
      const trade = { option: ev.option_asset, quote: USDC, size: BigInt(ev.size), premium: BigInt(r.premium), pips: 1n };
      const user = (side === "buy" ? buyDiffs(trade) : sellDiffs(trade)).user;
      expect(unmatched([user, signedDiff(r).diff], 1n)).toEqual({});
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("signs for the verifier with a 25 s deadline and the current salt", async () => {
    const { desk } = testDesk();
    const sent: QuoteResponse[] = [];
    await quoter(desk, (r) => sent.push(r)).onQuote(quoteEvent(PUT, "buy", 1_000_000n));
    const [r] = sent;
    if (!r) throw new Error("no quote sent");
    const s = signedDiff(r);
    expect([...Buffer.from(s.nonce, "base64").subarray(5, 9)]).toEqual([...desk.intents.salt]);
    expect(Date.parse(s.deadline)).toBe(NOW + QUOTE_TTL_MS);
    expect(s.signer).toBe(MM);
    expect(s.recipient).toBe("intents.test.near");
  });

  it("charges a buyer more than the spread's theo and never pays a seller more than it", async () => {
    const { desk } = testDesk();
    const ask = decide(quoteEvent(PUT, "buy", 1_000_000n), desk, SETTINGS, NOW);
    const bid = decide(quoteEvent(PUT, "sell", 1_000_000n), desk, SETTINGS, NOW);
    if (!ask.ok || !bid.ok) throw new Error("expected quotes");
    const m = seriesMark(desk.market, desk.book, PUT);
    if (!m) throw new Error("no mark");
    expect(m.capVol).toBeGreaterThan(m.vol);
    const theoUsd = capped("put", m.forward, 80_000, 2_000, m.vol, m.capVol, (PUT.expiry * 1000 - NOW) / YEAR_MS).price * 0.01;
    expect(Number(ask.premium) / 1e6).toBeGreaterThan(theoUsd);
    expect(Number(bid.premium) / 1e6).toBeLessThan(theoUsd);
    expect(theoUsd).toBeLessThan(20);
  });
});
