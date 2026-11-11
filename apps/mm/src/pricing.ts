import { capped, type Series, YEAR_MS } from "@endline/sdk";
import type { Settings } from "./config.ts";
import { type Book, type SeriesMark, strikeUsd, widthUsd } from "./portfolio.ts";

export interface ContractPrice {
  ask: number;
  bid: number;
  vol: number;
}

export const QUOTE_TTL_MS = 25_000;
const MIN_VOL = 0.01;
// each leg's vol moves this share of the spread, in opposite directions: a skew move the net vega doesn't see
const SKEW_SHOCK = 0.5;

export function contractPrice(book: Book, series: Series, mark: SeriesMark, s: Settings, now: number): ContractPrice {
  const width = widthUsd(book, series);
  const years = (series.expiry * 1000 - now) / YEAR_MS;
  const theo = (vol: number, capVol: number) =>
    capped(series.kind, mark.forward, strikeUsd(book, series), width, Math.max(vol, MIN_VOL), Math.max(capVol, MIN_VOL), years);
  const shocks = [[1, 1], [-1, -1], [SKEW_SHOCK, -SKEW_SHOCK], [-SKEW_SHOCK, SKEW_SHOCK]] as const;
  const prices = shocks.map(([near, far]) => theo(mark.vol + near * s.spreadVol, mark.capVol + far * s.spreadVol).price);
  const carry = width * s.carryQuote * years;
  const moveSd = mark.forward * Math.max(mark.vol, MIN_VOL) * Math.sqrt((QUOTE_TTL_MS + Math.max(0, now - mark.at)) / YEAR_MS);
  const staleGain = (Math.abs(theo(mark.vol, mark.capVol).delta) * moveSd) / Math.sqrt(2 * Math.PI);
  return { ask: Math.max(...prices) + carry + staleGain, bid: Math.min(...prices) - staleGain, vol: mark.vol };
}

export function premiumUsd(price: ContractPrice, contracts: number, mmSells: boolean, s: Settings): number | undefined {
  if (mmSells) return Math.max(price.ask * contracts, s.minPremiumUsd);
  const bid = price.bid * contracts;
  return bid >= s.minPremiumUsd ? bid : undefined;
}

export function toQuoteUnits(usd: number, decimals: number, roundUp: boolean): bigint {
  const scaled = usd * 10 ** decimals;
  if (!Number.isFinite(scaled) || scaled <= 0 || scaled > Number.MAX_SAFE_INTEGER) throw new Error(`premium out of range: ${usd}`);
  return BigInt(roundUp ? Math.ceil(scaled) : Math.floor(scaled));
}
