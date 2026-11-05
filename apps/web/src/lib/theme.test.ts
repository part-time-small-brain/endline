import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routeOf } from "./route.ts";
import { choiceAfterStorage, readChoice, resolveTheme, THEME_KEY } from "./theme.ts";
import { TRADE_MODE_KEY } from "./tradeMode.ts";

describe("theme", () => {
  it("falls back to system for anything that isn't an exact stored choice", () => {
    for (const junk of [null, "", "system", "Dark", " dark", "light ", "auto", "undefined", "{}"]) expect(readChoice(junk)).toBe("system");
    expect(readChoice("dark")).toBe("dark");
    expect(readChoice("light")).toBe("light");
  });

  it("lets an explicit choice win over the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("matches the inline script in index.html that runs before first paint", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(script).toContain(`"${THEME_KEY}"`);
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    const page = (block: string) => new RegExp(`${block}\\s*{[^}]*--page:\\s*(#[0-9a-f]{6})`).exec(css)?.[1];
    const pageColor = { light: page(":root"), dark: page('\\[data-theme="dark"\\]'), near: page('\\[data-look="near"\\]') };
    expect(pageColor.light).toMatch(/^#/);
    expect(pageColor.dark).toMatch(/^#/);
    expect(pageColor.near).toMatch(/^#/);
    const run = (stored: string | null, prefersDark: boolean, pathname = "/", mode: string | null = null, origin = "https://example.com", appUrl = "%VITE_APP_URL%") => {
      const root = { dataset: {} as Record<string, string> };
      const meta = { content: "" };
      new Function("localStorage", "matchMedia", "document", "location", (script ?? "").replace("%VITE_APP_URL%", appUrl))(
        { getItem: (key: string) => (key === TRADE_MODE_KEY ? mode : stored) },
        () => ({ matches: prefersDark }),
        { documentElement: root, querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null) },
        { pathname, origin },
      );
      return { theme: root.dataset.theme, look: root.dataset.look, bar: meta.content };
    };
    for (const stored of [null, "light", "dark", "system", "Dark"])
      for (const prefersDark of [true, false]) {
        const theme = resolveTheme(readChoice(stored), prefersDark);
        expect(run(stored, prefersDark)).toEqual({ theme, bar: pageColor[theme] });
      }
    expect(run("dark", false).bar).toBe(pageColor.dark);
    for (const pathname of ["/", "/app", "/app/", "/app//", "/app/positions", "/apps", "/nope"])
      for (const mode of [null, "lite", "pro", "Pro", "tap"]) {
        const near = routeOf(pathname) !== "landing";
        expect(run("light", false, pathname, mode), `${pathname} ${mode}`).toEqual(near ? { theme: "light", look: "near", bar: pageColor.near } : { theme: "light", bar: pageColor.light });
      }
    const app = "https://app.example.com";
    expect(run("light", false, "/", null, app, app).look).toBe("near");
    expect(run("light", false, "/", null, "https://example.com", app).look).toBeUndefined();
  });

  it("follows another tab's choice and resets to system when storage is cleared", () => {
    expect(choiceAfterStorage(THEME_KEY, "dark", "light")).toBe("dark");
    expect(choiceAfterStorage(THEME_KEY, null, "dark")).toBe("system");
    expect(choiceAfterStorage(THEME_KEY, "sepia", "dark")).toBe("system");
    expect(choiceAfterStorage(null, null, "dark")).toBe("system");
    expect(choiceAfterStorage("dragged", "1", "dark")).toBe("dark");
  });
});
