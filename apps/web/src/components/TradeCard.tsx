import type { ListedSeries } from "@endline/sdk";
import { capLabel, seriesTitle } from "../lib/labels.ts";
import { formatToken } from "../lib/money.ts";
import { formatEnds, formatUtc } from "../lib/time.ts";
import type { Leg } from "../lib/tradeCheck.ts";

interface Props {
  series: ListedSeries;
  legs: { pay: Leg; receive: Leg };
  quoteAsset: string;
  quoteDecimals: number;
}

export function TradeCard({ series, legs, quoteAsset, quoteDecimals }: Props) {
  const describe = (leg: Leg) =>
    leg.asset === quoteAsset ? (
      <span>{formatToken(leg.amount, quoteDecimals)} USDC</span>
    ) : (
      <span>
        {formatToken(leg.amount, series.underlying_decimals, series.underlying_decimals)} {seriesTitle(series, quoteDecimals)}
        <span className="block text-xs font-normal text-ink-2">{capLabel(series, quoteDecimals)}</span>
        <span className="block text-xs font-normal text-ink-2">Ends {formatEnds(series.expiry)} <span className="text-ink-3">· {formatUtc(series.expiry)}</span></span>
      </span>
    );
  return (
    <div className="rounded-2xl bg-well p-4 text-sm">
      <div className="flex justify-between gap-4 py-1">
        <span className="text-ink-2">You pay</span>
        <span className="text-right font-semibold">{describe(legs.pay)}</span>
      </div>
      <div className="flex justify-between gap-4 py-1">
        <span className="text-ink-2">You get</span>
        <span className="text-right font-semibold">{describe(legs.receive)}</span>
      </div>
      <p className="mt-2 border-t border-rule pt-2 text-xs text-ink-3">
        Your wallet shows this exact swap.
      </p>
    </div>
  );
}
