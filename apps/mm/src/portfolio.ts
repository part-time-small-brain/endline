import { capPrice, capped, intentsAssetId, type Series, shortTokenId, termsOf, YEAR_MS } from "@endline/sdk";
import type { ContractConfig } from "./chain.ts";
import type { Market } from "./market.ts";

export interface Book extends ContractConfig {
  optionsId: string;
  series: Map<string, Series>;
}

interface Exposure {
  delta: number;
  vega: number;
}

export interface SeriesMark {
  forward: number;
  vol: number;
  capVol: number;
  at: number;
}

export const longAsset = (book: Book, id: string) => intentsAssetId(book.optionsId, id);
export const shortAsset = (book: Book, id: string) => intentsAssetId(book.optionsId, shortTokenId(id));

export function liveAssets(book: Book, nowMs: number): string[] {
  const live = [...book.series.values()].filter((s) => s.expiry * 1000 > nowMs);
  return [book.quoteAsset, ...live.flatMap((s) => [longAsset(book, s.id), shortAsset(book, s.id)])];
}

export function contracts(s: Series, units: bigint): number {
  return Number(units) / 10 ** s.underlying_decimals;
}

export function strikeUsd(book: Book, s: Series): number {
  return Number(s.strike) / 10 ** book.quoteDecimals;
}

export function widthUsd(book: Book, s: Series): number {
  return Number(s.width) / 10 ** book.quoteDecimals;
}

export function seriesMark(market: Pick<Market, "mark">, book: Book, s: Series): SeriesMark | undefined {
  const at = (strike: number) => market.mark({ underlying: s.underlying, expiry: s.expiry, strike });
  const near = at(strikeUsd(book, s));
  const far = at(Number(capPrice(termsOf(s))) / 10 ** book.quoteDecimals);
  return near && far && { forward: near.forward, vol: near.vol, capVol: far.vol, at: Math.min(near.at, far.at) };
}

export function greeks(book: Book, s: Series, m: SeriesMark, now: number) {
  return capped(s.kind, m.forward, strikeUsd(book, s), widthUsd(book, s), m.vol, m.capVol, (s.expiry * 1000 - now) / YEAR_MS);
}

export function exposure(book: Book, holdings: Map<string, bigint>, mark: (s: Series) => SeriesMark | undefined, now: number): Map<string, Exposure> {
  const result = new Map<string, Exposure>();
  for (const s of book.series.values()) {
    const long = holdings.get(longAsset(book, s.id)) ?? 0n;
    const short = holdings.get(shortAsset(book, s.id)) ?? 0n;
    if ((long === 0n && short === 0n) || s.expiry * 1000 <= now) continue;
    const m = mark(s);
    if (!m) throw new Error(`no market data for ${s.id}`);
    const g = greeks(book, s, m, now);
    const net = contracts(s, long - short);
    const e = result.get(s.underlying) ?? { delta: 0, vega: 0 };
    result.set(s.underlying, { delta: e.delta + net * g.delta, vega: e.vega + net * g.vega });
  }
  return result;
}
