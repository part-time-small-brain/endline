import type { ListedSeries } from "@endline/sdk";
import { seriesTitle } from "./labels.ts";
import { formatMultiple, formatPrice, formatUsd } from "./money.ts";
import { formatUtc } from "./time.ts";

export interface Card {
  title: string;
  result: string;
  detail: string;
  footer: string;
  text: string;
}

const utcDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function winCard(series: ListedSeries, payout: bigint, paid: bigint, price: bigint, quoteDecimals: number): Card {
  const title = seriesTitle(series, quoteDecimals);
  const result = `Won ${formatUsd(payout, quoteDecimals)}`;
  const detail = paid > 0n ? `Paid ${formatUsd(paid, quoteDecimals, "up")} · ${formatMultiple((payout * 10n) / paid)}` : "";
  const footer = `Final price ${formatPrice(price, quoteDecimals)} · ${utcDay.format(new Date(series.expiry * 1000))} ${formatUtc(series.expiry)}`;
  return { title, result, detail, footer, text: `${title}: ${result} on Endline` };
}
