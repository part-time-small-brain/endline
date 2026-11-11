import { describe, expect, it } from "vitest";
import { Amount } from "./protocol.ts";

describe("Amount", () => {
  it("takes a positive integer up to u128::MAX and nothing above it", () => {
    const max = 2n ** 128n - 1n;
    expect(Amount.safeParse(max.toString()).success).toBe(true);
    for (const bad of [(max + 1n).toString(), "9".repeat(39), "9".repeat(60_000), "0", "01", "-1", "1.5", ""]) expect(Amount.safeParse(bad).success, bad.slice(0, 40)).toBe(false);
  });
});
