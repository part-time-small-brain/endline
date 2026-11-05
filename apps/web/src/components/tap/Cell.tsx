import { m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { TapState } from "../../hooks/useTaps.ts";
import type { GridCell } from "../../lib/grid.ts";
import { formatMultiple } from "../../lib/money.ts";
import { SideGlyph } from "../Glyphs.tsx";

const LOOK = {
  call: {
    open: "border-up/25 bg-up-soft text-up-ink hover:border-up hover:bg-up-field hover:shadow-[0_0_18px_var(--up-glow-soft)]",
    held: "border-up/25 bg-up-soft text-up-ink inset-ring-[1.5px] hover:border-up",
    winning: "border-up bg-up-field text-up-ink inset-ring-[1.5px] shadow-[0_0_20px_var(--up-glow)]",
  },
  put: {
    open: "border-down/25 bg-down-soft text-down-ink hover:border-down hover:bg-down-field hover:shadow-[0_0_18px_var(--down-glow-soft)]",
    held: "border-down/25 bg-down-soft text-down-ink inset-ring-[1.5px] hover:border-down",
    winning: "border-down bg-down-field text-down-ink inset-ring-[1.5px] shadow-[0_0_20px_var(--down-glow)]",
  },
} as const;

const RING = { busy: "animate-pulse", done: "shadow-[0_0_28px_currentColor]!", failed: "ring-2 ring-danger" } as const;

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
  const pays = multiple === undefined ? "—" : formatMultiple(multiple);
  const pct = change === undefined ? undefined : Math.round(change * 100);
  const text = pct === undefined ? pays : `${pct > 0 ? "+" : ""}${pct}%`;
  const look = LOOK[series.kind][winning ? "winning" : held ? "held" : "open"];
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
      className={`relative flex size-full flex-col items-center justify-center gap-1 rounded-md border font-mono transition-[background-color,border-color,box-shadow] ${held ? "" : "disabled:opacity-40"} ${look} ${state ? RING[state.status] : ""}`}
    >
      {flips > 0 && (
        <span
          key={flips}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-md opacity-0 shadow-[0_0_0_2px_currentColor,0_0_28px_currentColor] [animation:fade_1.2s_ease-in_1_reverse]"
        />
      )}
      {value === undefined ? <SideGlyph kind={series.kind} size={14} /> : <span className="text-[0.6875rem] leading-none font-semibold">{value}</span>}
      <span className={`leading-none font-medium ${text.length > (pct === undefined ? 5 : 4) ? "text-xs sm:text-base" : "text-[15px] sm:text-lg"} ${pct === undefined ? "" : pct > 0 ? "text-up-ink" : pct < 0 ? "text-down-ink" : "text-ink-2"}`}>{text}</span>
      {pct !== undefined && <span className="text-[0.625rem] leading-none opacity-70">{pays}</span>}
    </m.button>
  );
}
