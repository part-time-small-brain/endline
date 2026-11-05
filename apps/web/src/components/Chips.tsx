import type { KeyboardEvent, ReactNode } from "react";

interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

interface Props<T extends string> {
  label: string;
  options: ChipOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  columns?: string;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function pickWithArrows(event: KeyboardEvent<HTMLElement>) {
  const step = STEP[event.key];
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]:enabled")];
  const at = radios.indexOf(event.target as HTMLElement);
  if (!step || at < 0) return;
  event.preventDefault();
  const next = radios[(at + step + radios.length) % radios.length];
  next?.focus();
  next?.click();
}

export function Chips<T extends string>({ label, options, value, onChange, columns = "flex flex-wrap" }: Props<T>) {
  const enabled = options.filter((option) => !option.disabled);
  const stop = enabled.find((option) => option.value === value) ?? enabled[0];

  return (
    <div role="radiogroup" aria-label={label} className={`${columns} gap-2`} onKeyDown={pickWithArrows}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={option === stop ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-11 min-w-0 rounded-xl px-3 py-2 text-left transition-[transform,background-color,box-shadow] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 ${
              selected ? "bg-paper shadow-[inset_0_0_0_2px_var(--ink)]" : "bg-well hover:bg-well-hover near:ring-1 near:ring-ink/20 near:ring-inset"
            }`}
          >
            <span className="block truncate text-base font-semibold">{option.label}</span>
            {option.hint && <span className="block truncate text-xs text-ink-2">{option.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
