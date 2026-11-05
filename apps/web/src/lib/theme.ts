export type ThemeChoice = "light" | "dark" | "system";
type Theme = "light" | "dark";

export const THEME_KEY = "theme";

export function readChoice(stored: string | null): ThemeChoice {
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  if (choice !== "system") return choice;
  return prefersDark ? "dark" : "light";
}

export function choiceAfterStorage(key: string | null, newValue: string | null, current: ThemeChoice): ThemeChoice {
  if (key === null) return "system";
  return key === THEME_KEY ? readChoice(newValue) : current;
}
