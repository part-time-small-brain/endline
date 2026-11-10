import type { ReactNode } from "react";
import { formatPrice } from "../lib/money.ts";
import { capNote, type GoodCase, type Ticket } from "../lib/ticket.ts";
import { LABEL } from "./label.ts";
import { Money } from "./Money.tsx";

interface Props {
  up: boolean;
  ticket: Ticket;
  budget: bigint;
  quoteDecimals: number;
  symbol: string;
  goodCase: GoodCase | null;
}

export function Summary({ up, ticket, budget, quoteDecimals, symbol, goodCase }: Props) {
  const note = capNote(ticket, budget, quoteDecimals);
  return (
    <div className="flex flex-col gap-3">
      <dl aria-label="Summary" className={`grid rounded-md shadow-[inset_0_0_0_1px_var(--rule)] ${goodCase ? "grid-cols-2" : "grid-cols-1"}`}>
        <Cell label="Max loss">
          <Money value={ticket.cost} decimals={quoteDecimals} rounding="up" />
        </Cell>
        {goodCase && (
          <Cell label={`If ${symbol} ends ${up ? "above" : "below"} ${formatPrice(goodCase.price, quoteDecimals)}`} tint>
            <Money value={goodCase.payout} decimals={quoteDecimals} />
            <span className="text-sm text-ink-2">· {(Math.floor((Number(goodCase.payout) / Number(ticket.cost)) * 10) / 10).toFixed(1)}×</span>
          </Cell>
        )}
      </dl>
      {note && <p className="px-1 text-sm text-ink-2">{note}</p>}
      <dl className="flex justify-between gap-3 px-1 font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
        <div className="flex gap-1.5">
          <dt>Breakeven</dt>
          <dd className="font-semibold text-ink">{ticket.breakeven === null ? "—" : formatPrice(ticket.breakeven, quoteDecimals, up ? "up" : "down")}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Sell back now</dt>
          <dd className="font-semibold text-ink">
            <Money value={ticket.cashOut} decimals={quoteDecimals} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Cell({ label, tint = false, children }: { label: string; tint?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 px-4 py-3 first:rounded-l-md last:rounded-r-md [&+&]:shadow-[-1px_0_0_var(--rule)] ${tint ? "bg-side-field" : ""}`}>
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-mono text-xl font-medium whitespace-nowrap">{children}</dd>
    </div>
  );
}
