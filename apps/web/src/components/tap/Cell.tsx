import { m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { TapState } from "../../hooks/useTaps.ts";
import type { GridCell } from "../../lib/grid.ts";
import { formatMultiple, formatPct } from "../../lib/money.ts";
import { SideGlyph } from "../Glyphs.tsx";

const LOOK = {
  call: "text-up-ink hover:border-up hover:bg-up-field hover:shadow-[0_0_18px_var(--up-glow-soft)]",
  put: "text-down-ink hover:border-down hover:bg-down-field hover:shadow-[0_0_18px_var(--down-glow-soft)]",
} as const;

const FILL = {
  call: {
    rest: "border-up/25 bg-up-soft",
    held: "border-up/25 bg-up-soft shadow-[inset_0_0_0_1.5px_currentColor]",
    winning: "border-up bg-up-field shadow-[inset_0_0_0_1.5px_currentColor,0_0_20px_var(--up-glow)]",
  },
  put: {
    rest: "border-down/25 bg-down-soft",
    held: "border-down/25 bg-down-soft shadow-[inset_0_0_0_1.5px_currentColor]",
    winning: "border-down bg-down-field shadow-[inset_0_0_0_1.5px_currentColor,0_0_20px_var(--down-glow)]",
  },
} as const;

const RING = { busy: "animate-pulse", done: "shadow-[0_0_28px_currentColor]", failed: "ring-2 ring-danger" } as const;

interface Props {
  cell: GridCell | undefined;
  label: string;
  value: string | undefined;
  change: number | undefined;
  state: TapState | undefined;
  onTap: (cell: GridCell) => void;
}

export function Cell({ cell, label, value, change, state, onTap }: Props) {
  const winning = cell?.winning ?? false;
  const last = useRef(winning);
  const [flips, setFlips] = useState(0);
  useEffect(() => {
    if (last.current === winning) return;
    last.current = winning;
    setFlips((n) => n + 1);
  }, [winning]);

  if (!cell) return <span className="block size-full rounded-md border border-rule/60" aria-hidden="true" />;
  const { series, multiple, held } = cell;
  const text = change === undefined ? (multiple === undefined ? "—" : formatMultiple(multiple)) : formatPct(change);
  return (
    <m.button
      type="button"
      aria-label={label}
      aria-busy={state?.status === "busy" || undefined}
      title={label}
      disabled={multiple === undefined}
      whileTap={{ scale: 0.9 }}
      animate={{ scale: state?.status === "done" ? [1, 1.08, 1] : 1 }}
      onClick={() => onTap(cell)}
      className={`relative flex size-full flex-col items-center justify-center gap-1 rounded-md border font-mono transition-[background-color,border-color,box-shadow] disabled:opacity-40 ${LOOK[series.kind]} ${FILL[series.kind][winning ? "winning" : held ? "held" : "rest"]} ${state ? RING[state.status] : ""}`}
    >
      {flips > 0 && <span key={flips} aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md opacity-0 [animation:cross-flash_1.2s_var(--ease-out)_1]" />}
      {value === undefined ? <SideGlyph kind={series.kind} size={14} /> : <span className="text-[0.6875rem] leading-none font-semibold">{value}</span>}
      <span className={`leading-none font-medium ${text.length > 5 ? "text-xs sm:text-base" : "text-[15px] sm:text-lg"} ${change === undefined ? "" : change > 0 ? "text-up-ink" : change < 0 ? "text-down-ink" : "text-ink-2"}`}>{text}</span>
    </m.button>
  );
}
