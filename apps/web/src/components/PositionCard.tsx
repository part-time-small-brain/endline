import { Check } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { pnlOf, type PositionView, valueOf } from "../app/usePositions.ts";
import { useCollect } from "../hooks/useCollect.ts";
import { capLabel, seriesTitle } from "../lib/labels.ts";
import { formatPct, formatUsd, minTrade, toNumber } from "../lib/money.ts";
import type { PositionStatus } from "../lib/status.ts";
import { bestWin } from "../lib/shareCard.ts";
import { countdown, formatEnds, formatUtc } from "../lib/time.ts";
import { Button } from "./Button.tsx";
import { LABEL } from "./label.ts";
import { SettlementNote } from "./SettlementNote.tsx";
import { ShareButton } from "./ShareButton.tsx";
import { TxLink } from "./TxLink.tsx";

const PILLS: Record<PositionStatus, { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-up-field text-ink" },
  closed: { label: "Ending", tone: "bg-well text-ink" },
  settling: { label: "Settling", tone: "bg-well text-ink-2" },
  collect: { label: "Ready", tone: "bg-up text-on-up" },
  paid: { label: "Paid", tone: "bg-up-field text-ink" },
  expired: { label: "Ended $0", tone: "bg-well text-ink-2" },
};

interface Props {
  view: PositionView;
  quoteDecimals: number;
  nowSec: number;
  onSellBack: (view: PositionView) => void;
}

export function PositionCard({ view, quoteDecimals, nowSec, onSellBack }: Props) {
  const { series } = view;
  const collect = useCollect();
  const usd = (value: bigint) => formatUsd(value, quoteDecimals);
  const value = valueOf(view);
  const pnl = pnlOf(view);
  const ended = series.expiry <= nowSec;
  const pill = PILLS[view.status];
  const card = (view.status === "collect" || view.status === "paid") && view.settlement ? bestWin([view], view.settlement.price, quoteDecimals) : undefined;
  const tooSmall = view.valueNow !== undefined && view.valueNow < minTrade(quoteDecimals);
  const sellable = view.status === "active" && series.quotable && !tooSmall;
  const valueLabel = view.status === "active" ? "Value now" : view.status === "paid" ? "Collected" : "Payout";

  return (
    <article className="rounded-md border border-rule bg-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{seriesTitle(series, quoteDecimals)}</h3>
          <p className="text-xs text-ink-2">{capLabel(series, quoteDecimals)}</p>
          <p className="text-sm text-ink-2">
            {ended ? "Ended" : "Ends"} {formatEnds(series.expiry)} <span className="text-ink-3">· {formatUtc(series.expiry)}</span>
            {!ended && <span className="text-ink"> · {countdown(series.expiry - nowSec)}</span>}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${pill.tone}`}>{pill.label}</span>
      </header>

      <dl className="my-4 grid grid-cols-3 gap-2 text-sm">
        <Stat label="Paid">{view.paid > 0n ? formatUsd(view.paid, quoteDecimals, "up") : "—"}</Stat>
        <Stat label={valueLabel}>
          {value === undefined ? "—" : usd(value)}
        </Stat>
        <Stat label="P&L">
          {pnl === undefined ? (
            "—"
          ) : (
            <span className={pnl > 0n ? "text-up-ink" : pnl < 0n ? "text-down-ink" : "text-ink"}>
              {pnl >= 0n ? "+" : ""}
              {usd(pnl)}
              <span className="block text-xs">{formatPct(toNumber(pnl, quoteDecimals) / toNumber(view.paid, quoteDecimals))}</span>
            </span>
          )}
        </Stat>
      </dl>

      <SettlementNote view={view} quoteDecimals={quoteDecimals} nowSec={nowSec} />
      {card && <ShareButton card={card} className="mt-3" />}

      {(view.status === "active" || view.status === "closed") && (
        <Button tone="ghost" size="lg" disabled={!sellable} onClick={() => onSellBack(view)}>
          {sellable ? "Sell back" : view.status === "closed" ? "Sell back closed" : tooSmall ? "Worth under $1, too small to sell back" : "Sell back unavailable"}
        </Button>
      )}
      {view.status === "collect" && (
        <div className="mt-3 space-y-2">
          <Button tone="up" size="lg" disabled={collect.busy} onClick={() => void collect.collect([view])}>
            {collect.busy ? "Confirm in your wallet…" : "Collect"}
          </Button>
          {collect.error && <p className="text-sm text-danger">{collect.error}</p>}
        </div>
      )}
      {collect.done && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold" role="status">
          <span className="inline-flex items-center gap-1.5">
            <Check size={16} weight="bold" aria-hidden="true" />
            Added to your balance
          </span>
          {collect.txHash && <TxLink hash={collect.txHash} />}
        </p>
      )}
    </article>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-well px-3 py-2.5">
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-1 font-mono font-medium tabular-nums">{children}</dd>
    </div>
  );
}
