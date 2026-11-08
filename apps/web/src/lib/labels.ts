import { capPrice, type ListedSeries, type Series, termsOf } from "@endline/sdk";
import { formatPrice } from "./money.ts";

export function seriesTitle(series: Pick<Series, "underlying" | "kind" | "strike">, quoteDecimals: number): string {
  return `${series.underlying} ${series.kind === "call" ? "Up" : "Down"} ${formatPrice(BigInt(series.strike), quoteDecimals)}`;
}

export function capLabel(series: ListedSeries, quoteDecimals: number): string {
  return `Capped at ${formatPrice(capPrice(termsOf(series)), quoteDecimals)}`;
}

export const shortAccount = (account: string) => (account.length > 16 ? `${account.slice(0, 6)}…${account.slice(-4)}` : account);

const NAMES: Record<string, string> = { BTC: "Bitcoin" };

export const assetName = (symbol: string) => NAMES[symbol] ?? symbol;
