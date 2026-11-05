import type { OptionKind } from "@endline/sdk";
import { formatChance } from "../../lib/money.ts";
import { pickWithArrows } from "../Chips.tsx";
import { SideGlyph } from "../Glyphs.tsx";

export interface Side {
  kind: OptionKind;
  chance: number | undefined;
}

interface Props {
  sides: Side[];
  value: OptionKind;
  onChange: (kind: OptionKind) => void;
}

const LOOK = {
  call: { label: "Up", small: "Call", idle: "text-up-ink", picked: "bg-up text-on-up" },
  put: { label: "Down", small: "Put", idle: "text-down-ink", picked: "bg-down text-on-down" },
} as const;

export function DirectionPicker({ sides, value, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-2" onKeyDown={pickWithArrows}>
      {sides.map(({ kind, chance }) => {
        const look = LOOK[kind];
        const selected = kind === value;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(kind)}
            className={`flex h-16 rounded-2xl text-left transition-[transform,background-color,color] duration-200 ease-out active:scale-[0.98] flex-col items-start justify-center px-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-4 ${selected ? look.picked : "bg-well hover:bg-well-hover"}`}
          >
            <span className={`flex items-center gap-2 font-display text-xl leading-7 font-semibold lg:text-2xl lg:leading-8 ${selected ? "" : look.idle}`}>
              <SideGlyph kind={kind} />
              {look.label}
              <span className="sr-only">({look.small})</span>
            </span>
            {chance !== undefined && (
              <span className={`text-xs leading-4 sm:text-right ${selected ? "" : "text-ink-2"}`}>
                <b className="font-semibold sm:block sm:text-base">{formatChance(chance)}</b> chance
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
