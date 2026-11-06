import { Moon, Sun } from "@phosphor-icons/react";
import { setTheme, useTheme } from "../hooks/useTheme.ts";

export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const light = useTheme() === "light";
  const Icon = light ? Moon : Sun;
  return (
    <button
      type="button"
      aria-pressed={light}
      aria-label={withLabel ? undefined : "Light theme"}
      onClick={() => setTheme(light ? "dark" : "light")}
      className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl text-ink-2 ring-1 ring-ink/20 transition-colors duration-150 ring-inset hover:text-ink ${withLabel ? "w-full font-mono text-[11px] font-semibold tracking-[0.06em] uppercase" : "w-11"}`}
    >
      <Icon size={18} weight="bold" aria-hidden="true" />
      {withLabel && "Light theme"}
    </button>
  );
}
