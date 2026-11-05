import { X } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { formatToken, parseBudget } from "../../lib/money.ts";
import { Chips } from "../Chips.tsx";
import { Field } from "./Field.tsx";

interface Props {
  value: bigint;
  quoteDecimals: number;
  onChange: (amount: bigint) => void;
}

const PRESETS = [10, 25, 50, 100];
const RESET_TO = 1;
const OTHER = "other";

export function AmountPicker({ value, quoteDecimals, onChange }: Props) {
  const unit = 10n ** BigInt(quoteDecimals);
  const presets = PRESETS.map((dollars) => BigInt(dollars) * unit);
  const [editing, setEditing] = useState(() => !presets.includes(value));
  const [custom, setCustom] = useState(() => (editing ? formatToken(value, quoteDecimals, 2) : ""));
  const errorId = useId();
  const invalid = editing && parseBudget(custom, quoteDecimals) === null;
  const close = () => {
    setEditing(false);
    setCustom("");
    onChange(presets[RESET_TO] ?? value);
  };

  return (
    <Field title="You pay">
      {editing ? (
        <label className="flex h-12 items-center gap-2 rounded-xl bg-paper px-3 shadow-[inset_0_0_0_2px_var(--ink)]">
          <span className="font-display text-xl font-semibold text-ink-2">$</span>
          <input
            autoFocus
            inputMode="decimal"
            placeholder="Amount"
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              onChange(parseBudget(event.target.value, quoteDecimals) ?? 0n);
            }}
            onKeyDown={(event) => event.key === "Escape" && close()}
            aria-label="Amount in dollars"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className="w-full min-w-0 bg-transparent font-display text-xl font-semibold outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          <button type="button" aria-label="Back to preset amounts" onClick={close} className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-well">
            <X size={16} weight="bold" />
          </button>
        </label>
      ) : (
        <Chips
          label="You pay"
          columns="grid grid-cols-3 min-[375px]:grid-cols-5 *:px-1 *:text-center"
          value={value.toString()}
          onChange={(v) => {
            if (v !== OTHER) return onChange(BigInt(v));
            setEditing(true);
            onChange(0n);
          }}
          options={[
            ...PRESETS.map((dollars, i) => ({ value: String(presets[i]), label: <span className="font-display text-lg">${dollars}</span> })),
            { value: OTHER, label: <span className="text-sm">Other</span> },
          ]}
        />
      )}
      {invalid && <p id={errorId} role="alert" className="mt-2 text-sm text-danger">Enter $1 or more, using whole cents.</p>}
    </Field>
  );
}
