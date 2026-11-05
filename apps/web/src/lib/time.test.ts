import { describe, expect, it } from "vitest";
import { clockParts, dayLabel, expiryChips, formatEnds, formatUtc } from "./time.ts";

const EXPIRY = Date.UTC(2026, 10, 27, 8) / 1000;

describe("local times", () => {
  it("shows ends in the user's zone with no UTC suffix, and UTC only through formatUtc", () => {
    expect(process.env.TZ).toBe("Asia/Kolkata");
    expect(formatEnds(EXPIRY)).toMatch(/^Fri.*(1:30|13:30)/);
    expect(formatEnds(EXPIRY)).not.toContain("UTC");
    expect(formatUtc(EXPIRY)).toBe("08:00 UTC");
  });

  it("counts Today and Tomorrow in local days, not UTC days", () => {
    const pastLocalMidnight = Date.UTC(2026, 10, 26, 19) / 1000;
    expect(dayLabel(EXPIRY, pastLocalMidnight)).toBe("Today");
    const beforeLocalMidnight = Date.UTC(2026, 10, 26, 18) / 1000;
    expect(dayLabel(EXPIRY, beforeLocalMidnight)).toBe("Tomorrow");
  });

  it("names days this week by weekday and date, later or earlier ones by date and month", () => {
    const now = Date.UTC(2026, 10, 23, 12) / 1000;
    expect(dayLabel(EXPIRY, now)).toMatch(/^Fri 27$/);
    expect(dayLabel(EXPIRY + 7 * 86_400, now)).toMatch(/^(4 Dec|Dec 4)$/);
    expect(dayLabel(now - 2 * 86_400, now)).toMatch(/^(21 Nov|Nov 21)$/);
  });
});

describe("clockParts", () => {
  const show = (s: number) => clockParts(s).map((p) => `${p.value}${p.unit}`).join(" ");
  it("shows the two largest units, switching exactly at one hour and one day", () => {
    expect(show(3_599)).toBe("59m 59s");
    expect(show(3_600)).toBe("1h 0m");
    expect(show(86_399)).toBe("23h 59m");
    expect(show(86_400)).toBe("1d 0h");
    expect(show(27 * 86_400 + 3_661.9)).toBe("27d 1h");
  });

  it("never counts below zero", () => {
    expect(show(-5)).toBe("0m 0s");
    expect(show(0.999)).toBe("0m 0s");
  });
});

describe("expiryChips", () => {
  const now = Date.UTC(2026, 10, 26, 12) / 1000;
  it("adds the local clock when testnet minute expiries share a day, so chips never read Today four times", () => {
    const minutes = [5, 6, 7, 30].map((m) => Date.UTC(2026, 10, 26, 12, m) / 1000);
    const chips = expiryChips(minutes, now);
    expect(chips.map((c) => c.label)).toEqual(["Today", "Today", "Today", "Today"]);
    expect(new Set(chips.map((c) => c.hint)).size).toBe(4);
    expect(chips[0]?.hint).toMatch(/^(5:35|17:35)/);
    expect(chips[0]?.hint).not.toContain("UTC");
  });

  it("shows the day alone for daily expiries, and the clock for every chip once one isn't daily", () => {
    expect(expiryChips([EXPIRY, EXPIRY + 86_400], now)).toEqual([
      { expiry: EXPIRY, label: "Tomorrow" },
      { expiry: EXPIRY + 86_400, label: "Sat 28" },
    ]);
    const mixed = expiryChips([EXPIRY, EXPIRY + 60], now);
    expect(mixed.every((c) => c.hint !== undefined)).toBe(true);
    expect(expiryChips([], now)).toEqual([]);
  });
});
