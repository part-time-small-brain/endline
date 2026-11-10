import { type Series, seriesId, strikeStepCents } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import type { ListingTerms } from "./chain.ts";
import { expiries, type Holding, type Market, planBurns, planExercises, planRedeems, planWrites, strikes, targets, watched } from "./listing.ts";

const DAY = 86_400;
const USDC = "nep141:usdc";
const MAINNET: ListingTerms = { quoteAsset: USDC, quoteDecimals: 6, periodSec: DAY, offsetSec: 28_800, writeCutoffSec: 1_800, maxHorizonSec: 180 * DAY, paused: false };
const TESTNET: ListingTerms = { ...MAINNET, periodSec: 60, offsetSec: 0, writeCutoffSec: 60, maxHorizonSec: 7 * DAY };
const at = (iso: string) => Date.parse(iso) / 1000;
const BTC: Market = { symbol: "BTC", index: "btc_usd", decimals: 8, minWrite: 1_000n, spot: 80_000 };
const ETH: Market = { symbol: "ETH", index: "eth_usd", decimals: 18, minWrite: 10n ** 15n, spot: 2_351.37 };
const iso = (list: { expiry: number; short: boolean }[]) => list.map((e) => `${new Date(e.expiry * 1000).toISOString().slice(0, 16)}${e.short ? " short" : ""}`);

describe("expiries", () => {
  it("lists the next 4 writable 08:00 UTC dailies, dropping today's once its cutoff is within the margin", () => {
    const lastChance = at("2026-10-26T07:20:00Z") - 1;
    expect(iso(expiries(MAINNET, lastChance))).toEqual(["2026-10-26T08:00", "2026-10-27T08:00", "2026-10-28T08:00", "2026-10-29T08:00"]);
    expect(iso(expiries(MAINNET, lastChance + 1))).toEqual(["2026-10-27T08:00", "2026-10-28T08:00", "2026-10-29T08:00", "2026-10-30T08:00"]);
  });

  it("stays at 08:00 UTC across European and US DST changes", () => {
    for (const now of [at("2026-03-28T12:00:00Z"), at("2026-10-24T12:00:00Z"), at("2026-10-31T12:00:00Z")]) {
      const days = expiries(MAINNET, now).map((e) => e.expiry);
      expect(days.every((e) => e % DAY === 28_800)).toBe(true);
      expect(days.slice(1).map((e, i) => e - days[i]!)).toEqual([DAY, DAY, DAY]);
    }
  });

  it("never goes past max_horizon, inclusive like the contract", () => {
    const now = at("2026-10-26T08:00:00Z");
    expect(expiries({ ...MAINNET, maxHorizonSec: 2 * DAY }, now).map((e) => e.expiry)).toEqual([now + DAY, now + 2 * DAY]);
    expect(expiries({ ...MAINNET, maxHorizonSec: 2 * DAY - 1 }, now).map((e) => e.expiry)).toEqual([now + DAY]);
  });

  it("lists only expiries on the contract's grid", () => {
    const now = at("2026-10-26T10:00:00Z");
    expect(expiries({ ...MAINNET, offsetSec: 0 }, now)).toEqual([]);
    expect(expiries({ ...TESTNET, periodSec: 3_600, offsetSec: 1_800 }, now)).toEqual([]);
    expect(iso(expiries({ ...TESTNET, periodSec: 7_200 }, now))).toContain("2026-10-26T12:00 short");
  });

  it("adds one 4-hourly short expiry at least 90 min out, only when the grid is finer than a day", () => {
    expect(iso(expiries(TESTNET, at("2026-10-26T10:30:00Z")))[0]).toBe("2026-10-26T12:00 short");
    expect(iso(expiries(TESTNET, at("2026-10-26T10:30:01Z")))[0]).toBe("2026-10-26T16:00 short");
    expect(iso(expiries(TESTNET, at("2026-10-26T10:30:00Z")))).toHaveLength(5);
    expect(expiries(MAINNET, at("2026-10-26T10:30:00Z")).some((e) => e.short)).toBe(false);
  });

  it("doesn't double-list a short expiry that is also the 08:00 daily", () => {
    expect(iso(expiries(TESTNET, at("2026-10-26T06:00:00Z")))).toEqual(["2026-10-26T08:00", "2026-10-27T08:00", "2026-10-28T08:00", "2026-10-29T08:00"]);
  });
});

describe("strikes", () => {
  it("steps by the largest 1/2/5×10^n at most 1.5% of spot", () => {
    expect(strikeStepCents(80_000)).toBe(100_000n);
    expect(strikeStepCents(110_000)).toBe(100_000n);
    expect(strikeStepCents(66_666.67)).toBe(100_000n);
    expect(strikeStepCents(66_666)).toBe(50_000n);
    expect(strikeStepCents(4_000)).toBe(5_000n);
    expect(strikeStepCents(2_351.37)).toBe(2_000n);
    expect(strikeStepCents(0.5)).toBe(1n);
  });

  it("gives 5 whole-cent strikes around spot for dailies and the two either side for the short expiry", () => {
    expect(strikes(2_351.37, 6, false)).toEqual([2_320, 2_340, 2_360, 2_380, 2_400].map((k) => BigInt(k) * 1_000_000n));
    expect(strikes(2_351.37, 6, true)).toEqual([2_340n * 1_000_000n, 2_360n * 1_000_000n]);
    expect(strikes(0.5, 2, false)).toEqual([48n, 49n, 50n, 51n, 52n]);
    expect(strikes(0.004, 6, false)).toEqual([1n, 2n].map((c) => c * 10_000n));
  });

  it("keeps a strike's id when spot re-centres across a step change, so no strike is listed twice", () => {
    const now = at("2026-10-26T10:00:00Z");
    const key = (t: { expiry: number; strike: bigint; kind: string }) => `${t.expiry} ${t.strike} ${t.kind}`;
    const ids = new Map<string, Set<string>>();
    for (const spot of [3_300, 3_330, 3_340, 3_400])
      for (const t of targets(MAINNET, [{ ...ETH, spot }], now, 5_000)) ids.set(key(t), (ids.get(key(t)) ?? new Set()).add(t.id));
    expect([...ids.values()].every((set) => set.size === 1)).toBe(true);
    expect(strikeStepCents(3_300)).not.toBe(strikeStepCents(3_340));
  });

  it("re-centres when spot jumps, so a new set of ids is listed", () => {
    const now = at("2026-10-26T10:00:00Z");
    const before = new Set(targets(MAINNET, [BTC], now, 5_000).map((t) => t.id));
    const after = targets(MAINNET, [{ ...BTC, spot: 86_000 }], now, 5_000).map((t) => t.id);
    expect(after.filter((id) => before.has(id))).toEqual([]);
  });
});

describe("targets", () => {
  it("lists calls and puts per strike with the contract's ids, default end date first, then nearest expiry and strike", () => {
    const now = at("2026-10-26T10:30:00Z");
    const list = targets(TESTNET, [BTC, ETH], now, 5_000);
    expect(list).toHaveLength(4 * 2 * 5 * 2 + 2 * 2 * 2);
    const [first] = list;
    expect(first).toEqual({
      id: "BTC-27OCT26-80000_82000-C",
      underlying: "BTC",
      kind: "call",
      strike: 80_000_000_000n,
      width: 2_000_000_000n,
      expiry: at("2026-10-27T08:00:00Z"),
      usd: 500,
    });
    for (const t of list) expect(t.id).toBe(seriesId({ ...t, quoteDecimals: 6 }));
    expect(list.every((t) => t.usd === 500)).toBe(true);
    expect(new Set(list.filter((t) => t.underlying === "ETH").map((t) => t.width))).toEqual(new Set([40_000_000n]));
    expect(targets(TESTNET, [BTC], now, 40).every((t) => t.usd === 40)).toBe(true);
  });

  it("stocks the app's default end date (the first at least 6 h out) before a nearer one", () => {
    const now = at("2026-10-26T03:00:00Z");
    const list = targets(MAINNET, [BTC], now, 5_000);
    expect([...new Set(list.map((t) => new Date(t.expiry * 1000).toISOString().slice(0, 10)))]).toEqual(["2026-10-27", "2026-10-26", "2026-10-28", "2026-10-29"]);
    expect(targets(MAINNET, [BTC], at("2026-10-26T01:59:59Z"), 5_000)[0]?.expiry).toBe(at("2026-10-26T08:00:00Z"));
  });

  it("skips puts whose width would reach the strike, as the contract refuses them", () => {
    const list = targets(TESTNET, [{ ...BTC, symbol: "DUST", spot: 0.004 }], at("2026-10-26T10:30:00Z"), 5_000);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((t) => t.kind === "call")).toBe(true);
  });
});

describe("planWrites", () => {
  const now = at("2026-10-26T10:30:00Z");
  const daily = (m: Market, kind: "call" | "put") => targets(MAINNET, [m], now, 5_000).find((t) => t.kind === kind)!;
  const reserve = 500_000_000n;
  const rich = new Map([[USDC, 10n ** 12n]]);

  it("writes $500 of max payout in USDC for calls and puts", () => {
    const call = daily(BTC, "call");
    const put = daily(ETH, "put");
    expect(planWrites([call, put], [BTC, ETH], MAINNET, new Map(), rich, 100)).toEqual([
      { id: call.id, collateral: 500_000_000n },
      { id: put.id, collateral: 500_000_000n },
    ]);
  });

  it("plans collateral that the contract turns into at least the missing options, and not one more", () => {
    for (const [m, kind] of [
      [BTC, "call"],
      [ETH, "put"],
    ] as const) {
      const t = daily(m, kind);
      const unit = 10n ** BigInt(m.decimals);
      const target = (500_000_000n * unit) / t.width;
      for (const held of [0n, 1n, 7n, target / 3n, target - m.minWrite]) {
        const [w] = planWrites([t], [m], MAINNET, new Map([[t.id, held]]), rich, 100);
        if (!w) throw new Error(`no write at ${held}`);
        const minted = (w.collateral * unit) / t.width;
        expect(minted).toBeGreaterThanOrEqual(target - held);
        expect(((minted + 1n) * t.width + unit - 1n) / unit).toBeGreaterThan(w.collateral);
      }
    }
  });

  it("tops up only what was sold and skips series at or above target or short by less than min_write", () => {
    const call = daily(BTC, "call");
    expect(planWrites([call], [BTC], MAINNET, new Map([[call.id, 20_000_000n]]), rich, 100)).toEqual([{ id: call.id, collateral: 100_000_000n }]);
    expect(planWrites([call], [BTC], MAINNET, new Map([[call.id, 25_000_000n]]), rich, 100)).toEqual([]);
    expect(planWrites([call], [BTC], MAINNET, new Map([[call.id, 30_000_000n]]), rich, 100)).toEqual([]);
    expect(planWrites([call], [BTC], MAINNET, new Map([[call.id, 24_999_001n]]), rich, 100)).toEqual([]);
  });

  it("keeps $500 back, shares what's left nearest-first and never overspends", () => {
    const [a, b, c] = targets(MAINNET, [BTC], now, 5_000);
    expect(planWrites([a!, b!, c!], [BTC], MAINNET, new Map(), new Map([[USDC, reserve + 510_000_000n]]), 100)).toEqual([
      { id: a!.id, collateral: 500_000_000n },
      { id: b!.id, collateral: 10_000_000n },
    ]);
    expect(planWrites([a!], [BTC], MAINNET, new Map(), new Map([[USDC, reserve + 99n]]), 100)).toEqual([]);
    expect(planWrites([a!], [BTC], MAINNET, new Map(), new Map([[USDC, reserve - 1n]]), 100)).toEqual([]);
    const all = targets(MAINNET, [BTC, ETH], now, 5_000);
    const budget = 1_234_567_891n;
    const writes = planWrites(all, [BTC, ETH], MAINNET, new Map(), new Map([[USDC, reserve + budget]]), 100);
    expect(writes.reduce((sum, w) => sum + w.collateral, 0n)).toBeLessThanOrEqual(budget);
    expect(writes.map((w) => w.collateral).slice(0, 2)).toEqual([500_000_000n, 500_000_000n]);
    expect(writes).toHaveLength(3);
  });

  it("keeps a full max-size trade back when that is above $500, so a pending buy leg still settles", () => {
    const [a] = targets(MAINNET, [BTC], now, 5_000);
    const tradeReserve = 2_000_000_000n;
    expect(planWrites([a!], [BTC], MAINNET, new Map(), new Map([[USDC, tradeReserve + 500_000_000n]]), 2_000)).toEqual([{ id: a!.id, collateral: 500_000_000n }]);
    expect(planWrites([a!], [BTC], MAINNET, new Map(), new Map([[USDC, tradeReserve + 99n]]), 2_000)).toEqual([]);
    expect(planWrites([a!], [BTC], MAINNET, new Map(), new Map([[USDC, tradeReserve - 1n]]), 2_000)).toEqual([]);
  });
});

const series = (id: string, expiry: number, kind: "call" | "put" = "put", underlying = "BTC"): Series => ({
  id,
  underlying,
  kind,
  strike: "80000000000",
  expiry,
  width: "2000000000",
  underlying_decimals: 8,
});
const EXPIRY = at("2026-10-26T08:00:00Z");
const hold = (s: Series, long: bigint, short: bigint): Holding => ({ series: s, long, short });

describe("recycling", () => {
  it("burns unsold pairs only from the write cutoff on, and only the paired amount", () => {
    const s = series("A", EXPIRY);
    const holdings = [hold(s, 3n, 10n), hold(series("B", EXPIRY), 0n, 10n), hold(series("C", EXPIRY), 5n, 0n), hold(series("D", EXPIRY), 7n, 7n)];
    expect(planBurns(holdings, 1_800, EXPIRY - 1_801)).toEqual([]);
    expect(planBurns(holdings, 1_800, EXPIRY - 1_800)).toEqual([
      { id: "A", amount: 3n },
      { id: "D", amount: 7n },
    ]);
    expect(planBurns([], 1_800, EXPIRY)).toEqual([]);
  });

  it("redeems only shorts beyond the pairs, only for final prices", () => {
    const a = series("A", EXPIRY);
    const holdings = [hold(a, 3n, 10n), hold(series("B", EXPIRY, "put", "ETH"), 1n, 4n), hold(series("C", EXPIRY), 10n, 10n), hold(series("D", EXPIRY), 0n, 0n)];
    expect(planRedeems(holdings, new Set())).toEqual([]);
    expect(planRedeems(holdings, new Set([`BTC ${EXPIRY}`]))).toEqual([[{ id: "A", amount: 7n }]]);
  });

  it("batches redeems of calls and puts together, at most 10 tokens each", () => {
    const puts = Array.from({ length: 12 }, (_, i) => hold(series(`P${i}`, EXPIRY), 0n, 1n));
    const batches = planRedeems([...puts, hold(series("C", EXPIRY, "call"), 0n, 1n)], new Set([`BTC ${EXPIRY}`]));
    expect(batches.map((b) => b.map((c) => c.id))).toEqual([puts.slice(0, 10).map((h) => h.series.id), ["P10", "P11", "C"]]);
  });

  it("exercises only longs beyond the pairs, only at a final price that pays them", () => {
    const holdings = [hold(series("A", EXPIRY), 10n, 3n), hold(series("B", EXPIRY), 5n, 5n), hold(series("C", EXPIRY), 4n, 0n), hold(series("D", EXPIRY + DAY), 6n, 0n), hold(series("E", EXPIRY), 0n, 2n)];
    expect(planExercises(holdings, new Map())).toEqual([]);
    expect(planExercises(holdings, new Map([[`BTC ${EXPIRY}`, 80_000_000_000n]]))).toEqual([]);
    expect(planExercises([hold(series("F", EXPIRY), 1n, 0n)], new Map([[`BTC ${EXPIRY}`, 79_999_999_999n]]))).toEqual([]);
    expect(planExercises(holdings, new Map([[`BTC ${EXPIRY}`, 79_000_000_000n]]))).toEqual([
      [
        { id: "A", amount: 7n },
        { id: "C", amount: 4n },
      ],
    ]);
  });

  it("watches series until 7 days after expiry", () => {
    const s = series("A", EXPIRY);
    expect(watched([s], EXPIRY + 7 * DAY - 1)).toEqual([s]);
    expect(watched([s], EXPIRY + 7 * DAY)).toEqual([]);
  });
});
