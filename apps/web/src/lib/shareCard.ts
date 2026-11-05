import { type ListedSeries, longPayout, type Series, termsOf } from "@endline/sdk";
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

interface Stake {
  series: ListedSeries;
  amount: bigint;
  paid: bigint;
  received: bigint;
}

interface Total {
  series: ListedSeries;
  paid: bigint;
  received: bigint;
  payout: bigint;
}

const finalAt = (series: Pick<Series, "expiry">, price: bigint, quoteDecimals: number) => `Final price ${formatPrice(price, quoteDecimals)} · ${formatUtcDay(series.expiry)} ${formatUtc(series.expiry)}`;

export function bestWin(stakes: Stake[], price: bigint, quoteDecimals: number): Card | undefined {
  const bySeries = new Map<string, Total>();
  for (const s of stakes) {
    const sum = bySeries.get(s.series.id) ?? { series: s.series, paid: 0n, received: 0n, payout: 0n };
    bySeries.set(s.series.id, { series: s.series, paid: sum.paid + s.paid, received: sum.received + s.received, payout: sum.payout + longPayout(termsOf(s.series), s.amount, price) });
  }
  const profit = (s: Total) => s.payout + s.received - s.paid;
  const best = [...bySeries.values()].filter((s) => s.paid > 0n && s.payout > 0n && profit(s) > 0n).reduce<Total | undefined>((top, s) => (!top || profit(s) > profit(top) ? s : top), undefined);
  if (!best) return undefined;
  const usd = (value: bigint, rounding?: "up") => formatUsd(value, quoteDecimals, rounding);
  const title = seriesTitle(best.series, quoteDecimals);
  const result = `Won ${usd(best.payout)}`;
  const sold = best.received > 0n ? ` · sold ${usd(best.received)} back` : "";
  const detail = `Paid ${usd(best.paid, "up")}${sold} · ${formatMultiple(((best.payout + best.received) * 10n) / best.paid)}`;
  return { title, result, detail, footer: finalAt(best.series, price, quoteDecimals), text: `${title}: ${result} on Endline` };
}

export function callCard(series: Omit<Series, "id">, multiple: bigint, points: number, price: bigint, quoteDecimals: number): Card {
  const title = seriesTitle(series, quoteDecimals);
  const result = `+${points} points`;
  return { title, result, detail: `Free call at ${formatMultiple(multiple)}`, footer: finalAt(series, price, quoteDecimals), text: `${title}: ${result} on Endline` };
}
