import { useSyncExternalStore } from "react";
import { readTheme, type Theme, THEME_KEY, themeAfterStorage } from "../lib/theme.ts";

const listeners = new Set<() => void>();

function stored(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

let theme = readTheme(stored());

function apply() {
  if (theme === "light") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--page").trim());
  for (const listener of listeners) listener();
}

addEventListener("storage", (event) => {
  const next = themeAfterStorage(event.key, event.newValue, theme);
  if (next === theme) return;
  theme = next;
  apply();
});

export function setTheme(next: Theme) {
  theme = next;
  try {
    if (next === "light") localStorage.setItem(THEME_KEY, next);
    else localStorage.removeItem(THEME_KEY);
  } catch {}
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => theme);
}
