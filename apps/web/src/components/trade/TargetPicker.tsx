import { Minus, Plus } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { formatPct, formatPrice, toNumber } from "../../lib/money.ts";
import type { Preset } from "../../lib/targets.ts";
import { Chips } from "../Chips.tsx";
import { Money } from "../Money.tsx";
import { Field } from "./Field.tsx";

interface Props {
  strikes: bigint[];
  index: number;
  presets: Preset[];
  spot: bigint;
  quoteDecimals: number;
  onChange: (index: number) => void;
}

const LEVEL: Record<Preset["name"], number> = { Safer: 0, Balanced: 1, Bolder: 2 };

export function TargetPicker({ strikes, index, presets, spot, quoteDecimals, onChange }: Props) {
  const strike = strikes[index];
  const move = (price: bigint) => formatPct(toNumber(price - spot, quoteDecimals) / toNumber(spot, quoteDecimals));
  return (
    <Field title="Price to beat">
      <div className="mb-2 flex items-center gap-2">
        <Step label="Lower price to beat" disabled={index <= 0} onClick={() => onChange(index - 1)}>
          <Minus size={18} weight="bold" />
        </Step>
        <output className="flex h-10 flex-1 items-center justify-between rounded-xl px-3 shadow-[inset_0_0_0_1.5px_var(--rule)]" aria-live="polite">
          <strong className="font-display text-xl font-semibold">{strike !== undefined && <Money value={strike} decimals={quoteDecimals} />}</strong>
          <span className="text-sm text-ink-3">{strike !== undefined && move(strike)}</span>
        </output>
        <Step label="Higher price to beat" disabled={index >= strikes.length - 1} onClick={() => onChange(index + 1)}>
          <Plus size={18} weight="bold" />
        </Step>
      </div>
      <Chips
        label="Suggested prices to beat"
        columns="grid grid-cols-3 *:px-2 min-[375px]:*:px-3"
        value={String(index)}
        onChange={(v) => onChange(Number(v))}
        options={presets.map((preset) => ({
          value: String(preset.index),
          label: (
            <>
              <span className="flex items-center justify-between text-xs font-normal text-ink-2">
                {preset.name}
                <Meter level={LEVEL[preset.name]} />
              </span>
              <span className="block text-sm min-[375px]:text-base">{formatPrice(strikes[preset.index] ?? 0n, quoteDecimals)}</span>
            </>
          ),
        }))}
      />
    </Field>
  );
}

function Step({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-10 place-items-center rounded-xl bg-well transition-[transform,background-color] duration-150 ease-out hover:bg-well-hover active:scale-[0.94] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Meter({ level }: { level: number }) {
  return (
    <span className="hidden gap-0.5 min-[375px]:inline-flex" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`h-2.5 w-1 rounded-[1px] ${i <= level ? "bg-ink" : "bg-rule"}`} />
      ))}
    </span>
  );
}
