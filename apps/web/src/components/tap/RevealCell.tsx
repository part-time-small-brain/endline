import type { OptionKind } from "@endline/sdk";
import { Check, Equals, X } from "@phosphor-icons/react";
import type { Verdict } from "../../lib/reveal.ts";

const LOOK = {
  call: { win: "border-up bg-up-field text-up-ink shadow-[0_0_20px_var(--up-glow)]", close: "border-up/40 bg-up-soft text-up-ink", lose: "border-up/20 bg-up-soft/50 text-up-ink/60" },
  put: { win: "border-down bg-down-field text-down-ink shadow-[0_0_20px_var(--down-glow)]", close: "border-down/40 bg-down-soft text-down-ink", lose: "border-down/20 bg-down-soft/50 text-down-ink/60" },
} as const;

const ICON = { win: Check, close: Equals, lose: X } as const;

interface Props {
  kind: OptionKind;
  verdict: Verdict;
  amount: string;
  label: string;
}

export function RevealCell({ kind, verdict, amount, label }: Props) {
  const Icon = ICON[verdict];
  return (
    <div role="group" aria-label={label} title={label} className={`flex size-full flex-col items-center justify-center gap-1 rounded-md border font-mono inset-ring-[1.5px] ${LOOK[kind][verdict]}`}>
      <Icon size={14} weight="bold" aria-hidden="true" />
      <span className="text-[0.6875rem] leading-none font-semibold sm:text-sm">{amount}</span>
    </div>
  );
}
