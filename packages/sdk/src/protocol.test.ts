import { describe, expect, it } from "vitest";
import { Amount } from "./protocol.ts";

describe("Amount", () => {
  it("takes a positive integer up to u128's 39 digits and nothing longer", () => {
    expect(Amount.safeParse("9".repeat(39)).success).toBe(true);
    for (const bad of ["9".repeat(40), "0", "01", "-1", "1.5", ""]) expect(Amount.safeParse(bad).success, bad).toBe(false);
  });
});
