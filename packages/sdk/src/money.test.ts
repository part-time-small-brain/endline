import { describe, expect, it } from "vitest";
import { formatPrice, formatToken, formatUnits, formatUsd } from "./money.ts";

describe("formatUnits", () => {
  it("rounds down by default and up when asked, carrying into the whole part", () => {
    expect(formatUnits(999_999n, 6, 2)).toBe("0.99");
    expect(formatUnits(999_999n, 6, 2, "up")).toBe("1.00");
    expect(formatUnits(1_999_999_999n, 6, 0, "up")).toBe("2,000");
  });

  it("groups thousands and keeps the sign", () => {
    expect(formatUnits(-1_234_567_890_000n, 6, 2)).toBe("-1,234,567.89");
    expect(formatUnits(-1n, 6, 2)).toBe("0.00");
  });

  it("pads when asking for more digits than the token has", () => {
    expect(formatUnits(5n, 0, 2)).toBe("5.00");
  });
});

describe("formatUsd", () => {
  it("never shows a non-zero amount as $0.00", () => {
    expect(formatUsd(1n, 6)).toBe("<$0.01");
    expect(formatUsd(-9_999n, 6)).toBe("-<$0.01");
    expect(formatUsd(0n, 6)).toBe("$0.00");
  });

  it("rounds what you pay up", () => {
    expect(formatUsd(25_000_001n, 6, "up")).toBe("$25.01");
  });

  it("drops cents from $100, deciding on the rounded amount so $99.999 never prints as $100.00", () => {
    expect(formatUsd(99_990_000n, 6)).toBe("$99.99");
    expect(formatUsd(99_999_999n, 6)).toBe("$99.99");
    expect(formatUsd(99_999_999n, 6, "up")).toBe("$100");
    expect(formatUsd(100_000_000n, 6)).toBe("$100");
    expect(formatUsd(100_990_000n, 6)).toBe("$100");
    expect(formatUsd(100_000_001n, 6, "up")).toBe("$101");
    expect(formatUsd(-150_500_000n, 6)).toBe("-$150");
    expect(formatPrice(81_506_400_000n, 6, "up")).toBe("$81,507");
    expect(formatPrice(81_506_400_000n, 6, "down")).toBe("$81,506");
    expect(formatPrice(49_500_000n, 6)).toBe("$49.50");
  });
});

describe("formatToken", () => {
  it("trims trailing zeros and caps precision for 18-decimal tokens", () => {
    expect(formatToken(610_000n, 8)).toBe("0.0061");
    expect(formatToken(10n ** 18n, 18)).toBe("1");
    expect(formatToken(123_456_789_123_456_789n, 18)).toBe("0.12345678");
  });
});
