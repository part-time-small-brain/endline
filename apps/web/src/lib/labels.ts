import { capPrice, type ListedSeries, termsOf } from "@endline/sdk";
import { formatPrice } from "./money.ts";

export function seriesTitle(series: ListedSeries, quoteDecimals: number): string {
  return `${series.underlying} ${series.kind === "call" ? "Up" : "Down"} ${formatPrice(BigInt(series.strike), quoteDecimals)}`;
}

export function capLabel(series: ListedSeries, quoteDecimals: number): string {
  return `Capped at ${formatPrice(capPrice(termsOf(series)), quoteDecimals)}`;
}

const NAMES: Record<string, string> = { BTC: "Bitcoin", ETH: "Ethereum" };

export const assetName = (symbol: string) => NAMES[symbol] ?? symbol;
