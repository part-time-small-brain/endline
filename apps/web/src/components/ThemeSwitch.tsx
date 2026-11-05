import { CircleHalf, Moon, Sun } from "@phosphor-icons/react";
import { useId } from "react";
import { setTheme, useTheme } from "../hooks/useTheme.ts";
import type { ThemeChoice } from "../lib/theme.ts";

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Match system", Icon: CircleHalf },
];

export function ThemeSwitch() {
  const name = useId();
  const choice = useTheme();
  return (
    <fieldset className="flex gap-0.5 rounded-xl bg-track p-1">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ value, label, Icon }) => (
        <label
          key={value}
          title={label}
          className="grid size-8 cursor-pointer place-items-center rounded-lg text-ink-2 transition-colors duration-150 hover:text-ink has-checked:bg-paper has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-ink"
        >
          <input type="radio" name={name} value={value} checked={choice === value} onChange={() => setTheme(value)} className="sr-only" />
          <Icon size={16} weight="bold" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
