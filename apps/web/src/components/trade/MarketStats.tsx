import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { Info } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { assetName } from "../../lib/labels.ts";
import { formatPct } from "../../lib/money.ts";
import { clockParts, formatClock, formatUtc } from "../../lib/time.ts";
import { Money } from "../Money.tsx";
import { Popover } from "../Popover.tsx";

interface Props {
  symbol: string;
  spot: bigint | undefined;
  change: number | undefined;
  expiry: number | undefined;
  nowSec: number;
  quoteDecimals: number;
}

export function MarketStats({ symbol, spot, change, expiry, nowSec, quoteDecimals }: Props) {
  return (
    <>
      <Stat
        label={
          <>
            <span className="size-2.5 rounded-full bg-ink shadow-[0_0_0_3px_var(--grid)]" aria-hidden="true" />
            {assetName(symbol)}
            {change !== undefined && (
              <b className={`font-semibold ${change >= 0 ? "text-up-ink" : "text-down-ink"}`} title="Last 24 hours">
                {formatPct(change)}
              </b>
            )}
          </>
        }
        value={spot === undefined ? "…" : <Money value={spot} decimals={quoteDecimals} />}
      />
      {expiry !== undefined && (
        <Stat
          className="text-right lg:ml-auto"
          label={
            <span className="group ml-auto inline-flex items-center gap-1.5 whitespace-nowrap">
              Ends {formatClock(expiry)}
              <span className="hidden text-ink-3 group-hover:inline">{formatUtc(expiry)}</span>
              <SettlementInfo />
            </span>
          }
          value={<Countdown seconds={expiry - nowSec} />}
        />
      )}
    </>
  );
}

function Stat({ label, value, className = "" }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={`-mx-2 min-w-0 rounded-md bg-page px-2 ${className}`}>
      <p className="flex items-center gap-2 text-xs text-ink-2 lg:text-sm">{label}</p>
      <p className="font-display text-2xl leading-8 font-semibold tracking-[-0.02em] lg:text-4xl lg:leading-10">{value}</p>
    </div>
  );
}

function SettlementInfo() {
  return (
    <Popover
      label="How the final price is set"
      hover
      button={<Info size={16} weight="bold" aria-hidden="true" />}
      buttonClassName="grid size-6 place-items-center rounded-full text-ink-2 transition-colors duration-150 hover:text-ink"
      panelClassName="w-64 rounded-xl bg-ink p-3 text-left text-xs leading-5 font-normal text-on-ink"
    >
      Final price is the median of 7 exchanges, averaged over the 30 minutes before the end.{" "}
      <a href="/docs/settlement" className="font-semibold underline underline-offset-2">
        More
      </a>
    </Popover>
  );
}

function Countdown({ seconds }: { seconds: number }) {
  return (
    <span className="inline-flex items-baseline gap-1" role="timer" aria-label={clockParts(seconds).map((p) => `${p.value}${p.unit}`).join(" ")}>
      <NumberFlowGroup>
        {clockParts(seconds).map((part) => (
          <span key={part.unit} className="inline-flex items-baseline" aria-hidden="true">
            <NumberFlow value={part.value} format={{ minimumIntegerDigits: 2 }} trend={-1} />
            <span className="mr-1 ml-0.5 text-sm font-medium text-ink-2 lg:text-xl">{part.unit}</span>
          </span>
        ))}
      </NumberFlowGroup>
    </span>
  );
}
