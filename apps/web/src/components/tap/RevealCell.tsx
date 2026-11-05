import { type ListedSeries, longPayout, termsOf } from "@endline/sdk";
import { Check, Equals, X } from "@phosphor-icons/react";
import { formatUsd } from "../../lib/money.ts";
import { isEstimate, type Phase, PHASE_TITLES, revealSays, verdictOf } from "../../lib/reveal.ts";

const LOOK = {
  call: { win: "border-up bg-up-field text-up-ink shadow-[0_0_20px_var(--up-glow)]", close: "border-up/40 bg-up-soft text-up-ink", lose: "border-up/20 bg-up-soft/50 text-up-ink/80" },
  put: { win: "border-down bg-down-field text-down-ink shadow-[0_0_20px_var(--down-glow)]", close: "border-down/40 bg-down-soft text-down-ink", lose: "border-down/20 bg-down-soft/50 text-down-ink/80" },
} as const;

const ICON = { win: Check, close: Equals, lose: X } as const;

interface Props {
  series: ListedSeries;
  phase: Phase;
  price: bigint | undefined;
  amount: bigint;
  where: string;
  quoteDecimals: number;
}

export function RevealCell({ series, phase, price, amount, where, quoteDecimals }: Props) {
  const verdict = price === undefined ? "close" : verdictOf(series, phase, price);
  const usd = price === undefined ? "…" : formatUsd(longPayout(termsOf(series), amount, price), quoteDecimals);
  const says = price === undefined ? "waiting for the final price" : revealSays(phase, verdict, usd);
  const label = `${where} · ${PHASE_TITLES[phase].toLowerCase()} · ${says} · you hold this`;
  const Icon = ICON[verdict];
  return (
    <div role="group" aria-label={label} title={label} className={`flex size-full flex-col items-center justify-center gap-1 rounded-md border font-mono inset-ring-[1.5px] ${LOOK[series.kind][verdict]}`}>
      <Icon size={14} weight="bold" aria-hidden="true" />
      <span className="text-[0.6875rem] leading-none font-semibold sm:text-sm">
        {isEstimate(phase) && price !== undefined ? "≈ " : ""}
        {usd}
      </span>
    </div>
  );
}
