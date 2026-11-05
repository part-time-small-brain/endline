import { m } from "motion/react";
import type { TapState } from "../../hooks/useTaps.ts";
import type { GridCell } from "../../lib/grid.ts";
import { formatMultiple } from "../../lib/money.ts";
import { SideGlyph } from "../Glyphs.tsx";

const LOOK = {
  call: "border-up/25 bg-up-soft text-up-ink hover:border-up hover:bg-up-field hover:shadow-[0_0_18px_var(--up-glow-soft)]",
  put: "border-down/25 bg-down-soft text-down-ink hover:border-down hover:bg-down-field hover:shadow-[0_0_18px_var(--down-glow-soft)]",
} as const;

const RING = { busy: "animate-pulse", done: "shadow-[0_0_28px_currentColor]", failed: "ring-2 ring-danger" } as const;

interface Props {
  cell: GridCell | undefined;
  label: string;
  value: string | undefined;
  state: TapState | undefined;
  onTap: (cell: GridCell) => void;
}

export function Cell({ cell, label, value, state, onTap }: Props) {
  if (!cell) return <span className="block size-full rounded-md border border-rule/60" aria-hidden="true" />;
  const { series, multiple, held } = cell;
  const text = multiple === undefined ? "—" : formatMultiple(multiple);
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
      className={`flex size-full flex-col items-center justify-center gap-1 rounded-md border font-mono transition-[background-color,border-color,box-shadow] disabled:opacity-40 ${LOOK[series.kind]} ${held ? "shadow-[inset_0_0_0_1.5px_currentColor]" : ""} ${state ? RING[state.status] : ""}`}
    >
      {value === undefined ? <SideGlyph kind={series.kind} size={14} /> : <span className="text-[0.6875rem] leading-none font-semibold">{value}</span>}
      <span className={`leading-none font-medium ${text.length > 5 ? "text-xs sm:text-base" : "text-[15px] sm:text-lg"}`}>{text}</span>
    </m.button>
  );
}
