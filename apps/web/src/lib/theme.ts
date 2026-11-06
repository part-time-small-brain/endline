export type Theme = "light" | "dark";

export const THEME_KEY = "theme";

export function readTheme(stored: string | null): Theme {
  return stored === "light" ? "light" : "dark";
}

export function themeAfterStorage(key: string | null, value: string | null, current: Theme): Theme {
  return key === null || key === THEME_KEY ? readTheme(value) : current;
}
