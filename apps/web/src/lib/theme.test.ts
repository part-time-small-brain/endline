import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readTheme, THEME_KEY, themeAfterStorage } from "./theme.ts";

describe("theme", () => {
  it("is dark unless light was stored exactly", () => {
    for (const junk of [null, "", "dark", "Light", " light", "system", "undefined"]) expect(readTheme(junk)).toBe("dark");
    expect(readTheme("light")).toBe("light");
  });

  it("follows another tab's choice, ignores other keys and goes dark when storage is cleared", () => {
    expect(themeAfterStorage(THEME_KEY, "light", "dark")).toBe("light");
    expect(themeAfterStorage(THEME_KEY, null, "light")).toBe("dark");
    expect(themeAfterStorage("trade-mode", "pro", "light")).toBe("light");
    expect(themeAfterStorage(null, null, "light")).toBe("dark");
  });

  it("paints the stored theme and its page colour before first paint, matching the CSS", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    const page = (block: string) => new RegExp(`${block}\\s*{[^}]*--page:\\s*(#[0-9a-f]{6})`).exec(css)?.[1];
    const dark = page(":root");
    const light = page('\\[data-theme="light"\\]');
    expect(dark).toMatch(/^#/);
    expect(light).toMatch(/^#/);
    expect(light).not.toBe(dark);
    const initial = /<meta name="theme-color" content="(#[0-9a-f]{6})"/.exec(html)?.[1];
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).toContain(`"${THEME_KEY}"`);
    const run = (stored: string | null | Error) => {
      const root = { dataset: {} as Record<string, string> };
      const meta = { content: initial };
      const storage = { getItem: () => { if (stored instanceof Error) throw stored; return stored; } };
      new Function("localStorage", "document", script)(storage, { documentElement: root, querySelector: () => meta });
      return { theme: root.dataset.theme ?? "dark", bar: meta.content };
    };
    for (const stored of [null, "dark", "system", "Light", new Error("blocked")]) expect(run(stored)).toEqual({ theme: "dark", bar: dark });
    expect(run("light")).toEqual({ theme: "light", bar: light });
  });
});
