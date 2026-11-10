import { buyDiffs, type Diff, isListed, maxPayout, type QuoteEvent, type Series, sellDiffs, termsOf } from "@endline/sdk";
import type { IntentsState } from "./chain.ts";
import type { Settings } from "./config.ts";
import type { Inventory } from "./inventory.ts";
import type { Market } from "./market.ts";
import { type Book, contracts, exposure, longAsset, type SeriesMark, seriesMark, shortAsset, widthUsd } from "./portfolio.ts";
import { type ContractPrice, contractPrice, premiumUsd, toQuoteUnits } from "./pricing.ts";

export const QUOTE_TTL_MS = 25_000;

export interface Desk {
  book: Book;
  intents: IntentsState;
  market: Market;
  inventory: Inventory;
}

export type Decision = { ok: true; premium: bigint; diff: Diff; deadlineMs: number } | { ok: false; reason: string };

const reject = (reason: string) => ({ ok: false, reason }) as const;

function termsMatch(ev: QuoteEvent, s: Series): boolean {
  const t = ev.terms;
  return (
    t.underlying === s.underlying &&
    t.expiry === s.expiry &&
    t.strike === s.strike &&
    t.width === s.width &&
    t.kind === s.kind &&
    t.underlying_decimals === s.underlying_decimals
  );
}

export function maxTradeSize(book: Book, series: Series, settings: Settings): bigint {
  return (toQuoteUnits(settings.maxTradeUsd, book.quoteDecimals, false) * 10n ** BigInt(series.underlying_decimals)) / BigInt(series.width);
}

export function priceSeries(desk: Desk, series: Series, settings: Settings, now: number): { ok: true; mark: SeriesMark; price: ContractPrice } | { ok: false; reason: string } {
  const { book } = desk;
  if (!isListed(series, book.quoteDecimals)) return reject("width we don't list");
  if (now + QUOTE_TTL_MS >= (series.expiry - book.writeCutoffSec) * 1000) return reject("too close to expiry");
  const mark = seriesMark(desk.market, book, series);
  if (!mark) return reject("no market data");
  if (now - mark.at > settings.maxDataAgeMs) return reject("stale market data");
  return { ok: true, mark, price: contractPrice(book, series, mark, settings, now) };
}

export function decide(ev: QuoteEvent, desk: Desk, settings: Settings, now: number): Decision {
  const { book, market, inventory } = desk;
  if (now > ev.deadline_ms) return reject("auction closed");
  if (inventory.has(ev.quote_id)) return reject("duplicate quote id");
  const series = book.series.get(ev.series_id);
  if (!series) return reject("unknown series");
  if (ev.option_asset !== longAsset(book, series.id) || ev.quote_asset !== book.quoteAsset) return reject("unsupported assets");
  if (!termsMatch(ev, series)) return reject("terms differ from contract");
  if (BigInt(ev.fee_pips) !== desk.intents.fee) return reject("fee differs from intents");
  const priced = priceSeries(desk, series, settings, now);
  if (!priced.ok) return priced;
  const { mark, price } = priced;
  const deadlineMs = now + QUOTE_TTL_MS;

  const markOf = (s: Series) => seriesMark(market, book, s);
  const size = BigInt(ev.size);
  const n = contracts(series, size);
  const width = widthUsd(book, series);
  if (size > maxTradeSize(book, series, settings)) return reject("over trade cap");
  const mmSells = ev.side === "buy";
  const usd = premiumUsd(price, n, mmSells, settings);
  if (usd === undefined) return reject("below minimum premium");
  const premium = toQuoteUnits(usd, book.quoteDecimals, mmSells);
  if (premium >= maxPayout(termsOf(series), size)) return reject("premium at or above max payout");
  const trade = { option: ev.option_asset, quote: ev.quote_asset, size, premium, pips: desk.intents.fee };
  const diff = (mmSells ? buyDiffs(trade) : sellDiffs(trade)).marketMaker;

  for (const [asset, delta] of Object.entries(diff)) {
    if (delta < 0n && inventory.available(asset) < -delta) return reject("insufficient inventory");
  }

  const after = inventory.confirmed();
  for (const [asset, delta] of Object.entries(diff)) after.set(asset, (after.get(asset) ?? 0n) + delta);
  const pending = inventory.pending().map((d) => new Map(Object.entries(d)));
  // any pending leg may fill or not, so each cap must hold with every leg that pushes its way
  const over = (base: number, legs: number[], cap: number) =>
    [Math.max, Math.min].some((pick) => Math.abs(legs.reduce((sum, leg) => sum + pick(leg, 0), base)) > cap);
  const netShortUsd = (h: Map<string, bigint>) => contracts(series, (h.get(shortAsset(book, series.id)) ?? 0n) - (h.get(longAsset(book, series.id)) ?? 0n)) * width;
  if (over(netShortUsd(after), pending.map(netShortUsd), settings.maxSeriesUsd)) return reject("over series cap");

  let exposures, legExposures;
  try {
    exposures = exposure(book, after, markOf, now);
    legExposures = pending.map((h) => exposure(book, h, markOf, now));
  } catch {
    return reject("no market data for inventory");
  }
  const deltaUsd = (e: typeof exposures) => (e.get(series.underlying)?.delta ?? 0) * mark.forward;
  if (over(deltaUsd(exposures), legExposures.map(deltaUsd), settings.maxDeltaUsd)) return reject("over delta cap");
  const vega = (e: typeof exposures) => [...e.values()].reduce((sum, x) => sum + x.vega, 0);
  if (over(vega(exposures), legExposures.map(vega), settings.maxVegaUsd)) return reject("over vega cap");

  return { ok: true, premium, diff, deadlineMs };
}
