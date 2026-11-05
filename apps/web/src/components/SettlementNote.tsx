import { longPayout, termsOf } from "@near-options/sdk";
import type { ReactNode } from "react";
import type { PositionView } from "../app/usePositions.ts";
import { formatPrice, formatUsd } from "../lib/money.ts";
import { formatClock, isDailyExpiry } from "../lib/time.ts";

interface Props {
  view: PositionView;
  quoteDecimals: number;
  nowSec: number;
}

export function SettlementNote({ view, quoteDecimals, nowSec }: Props) {
  const { series, settlement } = view;
  const price = (value: bigint) => formatPrice(value, quoteDecimals);
  const ended = settlement && `Ended at ${price(settlement.price)}`;

  switch (view.status) {
    case "active":
    case "closed":
      return null;
    case "settling":
      if (!settlement) return <Note>Waiting for the final price{isDailyExpiry(series.expiry) ? ", usually about 1 h" : ""}</Note>;
      if (nowSec >= settlement.finalAt) return <Note>Final price {price(settlement.price)}. Preparing your payout.</Note>;
      return (
        <Note>
          Proposed final price {price(settlement.price)}, final at {formatClock(settlement.finalAt)}. Pays{" "}
          {formatUsd(longPayout(termsOf(series), view.amount, settlement.price), quoteDecimals)} if it stands.
        </Note>
      );
    case "collect":
    case "paid":
      return <Note>{ended}</Note>;
    case "expired":
      return (
        <Note>
          {ended}, {series.kind === "call" ? "below" : "above"} {price(BigInt(series.strike))}
        </Note>
      );
  }
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-well px-4 py-3 text-sm text-ink-2">{children}</p>;
}
