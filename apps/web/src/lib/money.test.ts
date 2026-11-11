import { describe, expect, it } from "vitest";
import { dollarDigits, formatChance, formatPct, formatPrice, formatToken, formatUnits, formatUsd, parseBudget, parseUnits, toRounded, toUnits } from "./money.ts";

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

  it("agrees with the animated figure for every amount near the switch", () => {
    for (let micros = 99_990_000n; micros <= 100_010_000n; micros += 1_237n)
      for (const rounding of ["down", "up"] as const) {
        const digits = dollarDigits(micros, 6, rounding);
        const shown = toRounded(micros, 6, digits, rounding).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
        expect(shown).toBe(formatUsd(micros, 6, rounding));
      }
  });
});

describe("formatToken", () => {
  it("trims trailing zeros and caps precision for 18-decimal tokens", () => {
    expect(formatToken(610_000n, 8)).toBe("0.0061");
    expect(formatToken(10n ** 18n, 18)).toBe("1");
    expect(formatToken(123_456_789_123_456_789n, 18)).toBe("0.12345678");
  });
});

describe("parseUnits", () => {
  it("parses dollars exactly", () => {
    expect(parseUnits("25", 6)).toBe(25_000_000n);
    expect(parseUnits(".25", 6)).toBe(250_000n);
  });

  it("rejects garbage and too much precision instead of rounding", () => {
    expect(parseUnits("", 6)).toBeNull();
    expect(parseUnits(".", 6)).toBeNull();
    expect(parseUnits("-5", 6)).toBeNull();
    expect(parseUnits("1e3", 6)).toBeNull();
    expect(parseUnits("0.0000001", 6)).toBeNull();
  });

  it("takes commas only as thousands separators, so a decimal comma is refused instead of read as thousands", () => {
    expect(parseUnits("1,500", 6)).toBe(1_500_000_000n);
    expect(parseUnits("1,000,000.5", 6)).toBe(1_000_000_500_000n);
    for (const text of ["12,50", "0,5", "1,5", "1,50", "0,500", ",500", "1,5000", "1500,000", "1,000,00"]) expect(parseUnits(text, 6), text).toBeNull();
    expect(parseBudget("9,99", 6)).toBeNull();
    for (const amount of [1_500_000_000n, 1_234_567_890_000n]) expect(parseBudget(formatToken(amount, 6, 2), 6)).toBe(amount);
  });
});

describe("parseBudget", () => {
  it("takes whole cents from $1 up", () => {
    expect(parseBudget("12", 6)).toBe(12_000_000n);
    expect(parseBudget("1", 6)).toBe(1_000_000n);
    expect(parseBudget("12.5", 6)).toBe(12_500_000n);
  });

  it.each(["", "0", "0.99", "0.001", "12.345", "-5", "1e3", "abc"])("refuses %j", (text) => {
    expect(parseBudget(text, 6)).toBeNull();
  });
});

describe("toUnits", () => {
  it("scales market prices into token units without float overflow", () => {
    expect(toUnits(80_656.08, 6)).toBe(80_656_080_000n);
    expect(toUnits(1.5, 18)).toBe(1_500_000_000_000_000_000n);
  });
});

describe("formatPct", () => {
  it("never prints a negative zero", () => {
    expect(formatPct(-0.00001)).toBe("0.0%");
    expect(formatPct(0.0842)).toBe("+8.4%");
    expect(formatPct(-0.126)).toBe("-13%");
  });
});

describe("formatChance", () => {
  it("never shows 0% or 100% for an outcome that can still go either way", () => {
    expect(formatChance(0.004)).toBe("<1%");
    expect(formatChance(0.996)).toBe(">99%");
    expect(formatChance(0)).toBe("0%");
    expect(formatChance(1)).toBe("100%");
    expect(formatChance(0.005)).toBe("1%");
    expect(formatChance(0.4149)).toBe("41%");
  });
});

describe("toRounded", () => {
  it("gives the same number formatUnits prints, so animated figures never disagree with text", () => {
    let state = 9;
    for (let i = 0; i < 500; i++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const value = BigInt(state) * BigInt(1 + (i % 97)) * (i % 3 === 0 ? -1n : 1n);
      for (const rounding of ["down", "up"] as const)
        for (const digits of [0, 2]) {
          const number = toRounded(value, 6, digits, rounding);
          expect(number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })).toBe(formatUnits(value, 6, digits, rounding).replace(/^-(0[.,]?0*)$/, "$1"));
        }
    }
  });

  it("survives cents that floats can't hold, where Intl floor rounding would lose a cent", () => {
    expect(toRounded(24_990_000n, 6, 2)).toBe(24.99);
    expect(toRounded(24_990_001n, 6, 2, "up")).toBe(25);
  });

  it("never returns negative zero, which Intl would print as -$0.00", () => {
    expect(Object.is(toRounded(-1n, 6, 2), 0)).toBe(true);
  });
});
