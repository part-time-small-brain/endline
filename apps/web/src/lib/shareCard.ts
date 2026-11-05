import { type ListedSeries, longPayout, termsOf } from "@endline/sdk";
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

interface Stake {
  series: ListedSeries;
  amount: bigint;
  paid: bigint;
  received: bigint;
}

const utcDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function winCard(series: ListedSeries, payout: bigint, paid: bigint, received: bigint, price: bigint, quoteDecimals: number): Card {
  const title = seriesTitle(series, quoteDecimals);
  const result = `Won ${formatUsd(payout, quoteDecimals)}`;
  const detail = paid > 0n ? `Paid ${formatUsd(paid, quoteDecimals, "up")} · ${formatMultiple(((payout + received) * 10n) / paid)}` : "";
  const footer = `Final price ${formatPrice(price, quoteDecimals)} · ${utcDay.format(new Date(series.expiry * 1000))} ${formatUtc(series.expiry)}`;
  return { title, result, detail, footer, text: `${title}: ${result} on Endline` };
}

export function bestWin(stakes: Stake[], price: bigint, quoteDecimals: number): Card | undefined {
  const bySeries = new Map<string, Stake & { payout: bigint }>();
  for (const s of stakes) {
    const sum = bySeries.get(s.series.id) ?? { series: s.series, amount: 0n, paid: 0n, received: 0n, payout: 0n };
    bySeries.set(s.series.id, { ...sum, paid: sum.paid + s.paid, received: sum.received + s.received, payout: sum.payout + longPayout(termsOf(s.series), s.amount, price) });
  }
  const profit = (s: { payout: bigint; received: bigint; paid: bigint }) => s.payout + s.received - s.paid;
  const best = [...bySeries.values()].filter((s) => s.payout > 0n && profit(s) > 0n).sort((a, b) => (profit(b) > profit(a) ? 1 : -1))[0];
  return best && winCard(best.series, best.payout, best.paid, best.received, price, quoteDecimals);
}
