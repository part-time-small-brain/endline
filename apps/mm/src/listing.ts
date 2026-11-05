import { CLAIM_WINDOW_SEC, defaultExpiry, EXPIRY_TIME_OF_DAY, listedWidth, type OptionKind, SECONDS_PER_DAY, type Series, seriesId, strikeStepCents } from "@endline/sdk";
import type { ListingTerms } from "./chain.ts";
import type { Underlying } from "./market.ts";

const WRITABLE_MARGIN_SEC = 600;
const DAILY_EXPIRIES = 4;
const SHORT_EVERY_SEC = 4 * 3_600;
const SHORT_LEAD_SEC = 5_400;
const STOCK_USD = 500;
const RESERVE_USD = 500;
const MAX_REDEEM_TOKENS = 10;
const KINDS: OptionKind[] = ["call", "put"];

export interface Market extends Underlying {
  spot: number;
}

export interface Target {
  id: string;
  underlying: string;
  kind: OptionKind;
  strike: bigint;
  width: bigint;
  expiry: number;
  usd: number;
}

export interface Write {
  id: string;
  collateral: bigint;
}

export interface Holding {
  series: Series;
  long: bigint;
  short: bigint;
}

export interface Close {
  id: string;
  amount: bigint;
}

export function expiries(t: ListingTerms, nowSec: number): { expiry: number; short: boolean }[] {
  const ok = (e: number) => e % t.periodSec === t.offsetSec && e - t.writeCutoffSec > nowSec + WRITABLE_MARGIN_SEC && e <= nowSec + t.maxHorizonSec;
  const found: { expiry: number; short: boolean }[] = [];
  let e = Math.floor((nowSec - EXPIRY_TIME_OF_DAY) / SECONDS_PER_DAY) * SECONDS_PER_DAY + EXPIRY_TIME_OF_DAY;
  for (; found.length < DAILY_EXPIRIES && e <= nowSec + t.maxHorizonSec; e += SECONDS_PER_DAY) if (ok(e)) found.push({ expiry: e, short: false });
  if (t.periodSec < SECONDS_PER_DAY) {
    const short = Math.ceil((nowSec + SHORT_LEAD_SEC) / SHORT_EVERY_SEC) * SHORT_EVERY_SEC;
    if (ok(short) && !found.some((d) => d.expiry === short)) found.push({ expiry: short, short: true });
  }
  return found.sort((a, b) => a.expiry - b.expiry);
}

export function strikes(spot: number, quoteDecimals: number, short: boolean): bigint[] {
  const step = strikeStepCents(spot);
  const cents = spot * 100;
  const offsets = short ? [0n, 1n] : [-2n, -1n, 0n, 1n, 2n];
  const base = BigInt(short ? Math.floor(cents / Number(step)) : Math.round(cents / Number(step))) * step;
  return offsets.map((k) => base + k * step).filter((c) => c > 0n).map((c) => c * 10n ** BigInt(quoteDecimals - 2));
}

export function targets(terms: ListingTerms, markets: Market[], nowSec: number, maxSeriesUsd: number): Target[] {
  const scale = 10 ** terms.quoteDecimals;
  const dated = expiries(terms, nowSec);
  const first = defaultExpiry(dated.map((d) => d.expiry), nowSec);
  const list = dated.flatMap(({ expiry, short }) =>
    markets.flatMap((m) =>
      strikes(m.spot, terms.quoteDecimals, short).flatMap((strike) => {
        const width = listedWidth(strike, terms.quoteDecimals);
        return KINDS.filter((kind) => kind === "call" || width < strike).map((kind) => ({
          id: seriesId({ underlying: m.symbol, expiry, strike, width, quoteDecimals: terms.quoteDecimals, kind }),
          underlying: m.symbol,
          kind,
          strike,
          width,
          expiry,
          usd: Math.min(maxSeriesUsd, STOCK_USD),
          distance: Math.abs(Number(strike) / scale - m.spot) / m.spot,
        }));
      }),
    ),
  );
  const rank = (t: { expiry: number }) => (t.expiry === first ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || a.expiry - b.expiry || a.distance - b.distance).map(({ distance, ...t }) => t);
}

export function planWrites(targets: Target[], markets: Market[], terms: ListingTerms, longs: Map<string, bigint>, balances: Map<string, bigint>): Write[] {
  const usdUnits = (usd: number) => BigInt(Math.floor(usd * 10 ** terms.quoteDecimals));
  let free = (balances.get(terms.quoteAsset) ?? 0n) - usdUnits(RESERVE_USD);
  const writes: Write[] = [];
  for (const t of targets) {
    const m = markets.find((x) => x.symbol === t.underlying);
    if (!m) continue;
    const unit = 10n ** BigInt(m.decimals);
    const deficit = (usdUnits(t.usd) * unit) / t.width - (longs.get(t.id) ?? 0n);
    const affordable = (free * unit) / t.width;
    const amount = deficit < affordable ? deficit : affordable;
    if (amount <= 0n || amount < m.minWrite) continue;
    const collateral = (amount * t.width + unit - 1n) / unit;
    free -= collateral;
    writes.push({ id: t.id, collateral });
  }
  return writes;
}

export const watched = (series: Series[], nowSec: number) => series.filter((s) => s.expiry > nowSec - CLAIM_WINDOW_SEC);

export const settlementKey = (s: Series) => `${s.underlying} ${s.expiry}`;

export function planBurns(holdings: Holding[], writeCutoffSec: number, nowSec: number): Close[] {
  return holdings
    .filter((h) => nowSec >= h.series.expiry - writeCutoffSec)
    .map((h) => ({ id: h.series.id, amount: h.long < h.short ? h.long : h.short }))
    .filter((c) => c.amount > 0n);
}

export function unpairedShorts(holdings: Holding[]): Holding[] {
  return holdings.filter((h) => h.short > h.long);
}

export function planRedeems(holdings: Holding[], final: Set<string>): Close[][] {
  const due = unpairedShorts(holdings)
    .filter((h) => final.has(settlementKey(h.series)))
    .map((h) => ({ id: h.series.id, amount: h.short - h.long }));
  return Array.from({ length: Math.ceil(due.length / MAX_REDEEM_TOKENS) }, (_, i) => due.slice(i * MAX_REDEEM_TOKENS, (i + 1) * MAX_REDEEM_TOKENS));
}
