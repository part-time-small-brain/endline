import { capped, type Mark, type Series, YEAR_MS } from "@endline/sdk";
import { toUnits } from "../lib/money.ts";

const SPREAD_VOL = 0.015;
const MIN_VOL = 0.01;
const MAX_TRADE_USD = 2_000n;
const MIN_PREMIUM_USD = 1n;

export function exampleMark(series: Series, spot: number, vol: number, nowSec: number, quoteDecimals: number): Mark | undefined {
  const strike = Number(series.strike) / 10 ** quoteDecimals;
  const width = Number(series.width) / 10 ** quoteDecimals;
  const years = ((series.expiry - nowSec) * 1000) / YEAR_MS;
  const price = (shift: number) =>
    toUnits(capped(series.kind, spot, strike, width, Math.max(vol + shift, MIN_VOL), Math.max(vol - shift, MIN_VOL), years).price, quoteDecimals);
  const ask = price(SPREAD_VOL);
  const bid = price(-SPREAD_VOL);
  const units = 10n ** BigInt(quoteDecimals + series.underlying_decimals);
  const maxSize = (MAX_TRADE_USD * units) / BigInt(series.width);
  const lifted = (MIN_PREMIUM_USD * units + maxSize - 1n) / maxSize;
  return ask > 0n ? { series_id: series.id, ask: (ask > lifted ? ask : lifted).toString(), ...(bid > 0n && { bid: bid.toString() }), max_size: maxSize.toString(), vol } : undefined;
}
