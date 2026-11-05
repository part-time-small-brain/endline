import { useSyncExternalStore } from "react";
import { choiceAfterStorage, readChoice, resolveTheme, THEME_KEY, type ThemeChoice } from "../lib/theme.ts";

const media = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

let choice = readChoice(stored());

export function syncThemeColor() {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--page").trim());
}

function apply() {
  document.documentElement.dataset.theme = resolveTheme(choice, media.matches);
  syncThemeColor();
  for (const listener of listeners) listener();
}

media.addEventListener("change", apply);
addEventListener("storage", (event) => {
  choice = choiceAfterStorage(event.key, event.newValue, choice);
  apply();
});

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {}
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => choice);
}
