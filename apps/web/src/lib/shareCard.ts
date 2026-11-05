import type { ListedSeries, Series } from "@endline/sdk";
import { seriesTitle } from "./labels.ts";
import { formatMultiple, formatPrice, formatUsd } from "./money.ts";
import { formatUtc, formatUtcDay } from "./time.ts";

export interface Card {
  title: string;
  result: string;
  detail: string;
  footer: string;
  text: string;
}

export function winCard(series: ListedSeries, payout: bigint, paid: bigint, price: bigint, quoteDecimals: number): Card {
  const title = seriesTitle(series, quoteDecimals);
  const result = `Won ${formatUsd(payout, quoteDecimals)}`;
  const detail = paid > 0n ? `Paid ${formatUsd(paid, quoteDecimals, "up")} · ${formatMultiple((payout * 10n) / paid)}` : "";
  const footer = `Final price ${formatPrice(price, quoteDecimals)} · ${formatUtcDay(series.expiry)} ${formatUtc(series.expiry)}`;
  return { title, result, detail, footer, text: `${title}: ${result} on Endline` };
}

export function callCard(series: Omit<Series, "id">, multiple: bigint, points: number, price: bigint, quoteDecimals: number): Card {
  const title = seriesTitle(series, quoteDecimals);
  const result = `+${points} points`;
  const footer = `Final price ${formatPrice(price, quoteDecimals)} · ${formatUtcDay(series.expiry)} ${formatUtc(series.expiry)}`;
  return { title, result, detail: `Free call at ${formatMultiple(multiple)}`, footer, text: `${title}: ${result} on Endline` };
}
