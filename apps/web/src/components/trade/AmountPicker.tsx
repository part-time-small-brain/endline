import { X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import type { BudgetChoice } from "../../app/useTicket.ts";
import { formatToken, formatUsd, parseBudget } from "../../lib/money.ts";
import { amountChoices, maxBinds } from "../../lib/ticket.ts";
import { Chips } from "../Chips.tsx";
import { Field } from "./Field.tsx";

interface Props {
  value: bigint;
  atMax: boolean;
  max: bigint | undefined;
  quoteDecimals: number;
  onChange: (choice: BudgetChoice) => void;
}

const OTHER = "other";
const MAX = "max";

export function AmountPicker({ value, atMax, max, quoteDecimals, onChange }: Props) {
  const unit = 10n ** BigInt(quoteDecimals);
  const capped = maxBinds(max, unit);
  const maxPicked = capped && (atMax || value >= max);
  const [editing, setEditing] = useState(() => !atMax && !maxPicked && !amountChoices(max, unit).includes(value));
  const presets = amountChoices(max, unit, atMax || editing ? 0n : value);
  const [custom, setCustom] = useState(() => (editing ? formatToken(value, quoteDecimals, 2) : ""));
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus({ preventScroll: true });
  }, [editing]);
  const invalid = editing && parseBudget(custom, quoteDecimals) === null;
  const close = () => {
    setEditing(false);
    setCustom("");
    onChange(undefined);
  };

  return (
    <Field title="You pay">
      {editing ? (
        <label className="flex h-12 items-center gap-2 rounded-xl bg-paper px-3 shadow-[inset_0_0_0_2px_var(--ink)]">
          <span className="font-display text-xl font-semibold text-ink-2">$</span>
          <input
            ref={input}
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
          value={maxPicked ? MAX : value.toString()}
          onChange={(v) => {
            if (v === MAX) return onChange("max");
            if (v !== OTHER) return onChange(BigInt(v));
            setEditing(true);
            onChange(0n);
          }}
          options={[
            ...presets.map((amount) => ({ value: String(amount), label: <span className="font-display text-lg">{formatUsd(amount, quoteDecimals).replace(/\.00$/, "")}</span> })),
            ...(capped
              ? [{ value: MAX, label: <span className="text-sm">Max<span className="sr-only"> {formatUsd(max, quoteDecimals, "up").replace(/\.00$/, "")}</span></span> }]
              : []),
            { value: OTHER, label: <span className="text-sm">Other</span> },
          ]}
        />
      )}
      {invalid && <p id={errorId} role="alert" className="mt-2 text-sm text-danger">Enter $1 or more, using whole cents.</p>}
    </Field>
  );
}
