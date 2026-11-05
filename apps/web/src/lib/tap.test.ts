import type { Series } from "@near-options/sdk";
import { describe, expect, it } from "vitest";
import { decide, maxLossOf } from "./tap.ts";

const USD = 1_000_000n;
const SERIES: Series = { id: "BTC-X", underlying: "BTC", kind: "call", strike: String(81_000n * USD), width: String(2_000n * USD), expiry: 1_800_000_000, underlying_decimals: 8 };
const SIZE = 10n ** 6n;
const quote = (premium: bigint, signBy = 1_000) => ({ premium: premium.toString(), size: SIZE.toString(), sign_by_ms: signBy });

describe("one-tap price check", () => {
  it("buys only while the firm price still pays the N× on the cell, rounded down to tenths", () => {
    expect(decide(quote(8n * USD), SERIES, 25n, 8n * USD, 0)).toBe("sign");
    expect(decide(quote(8n * USD + 1n), SERIES, 25n, 8n * USD, 0)).toBe("moved");
    expect(decide(quote(7n * USD), SERIES, 25n, 8n * USD, 0)).toBe("sign");
    expect(decide(quote(0n), SERIES, 25n, 8n * USD, 0)).toBe("moved");
  });

  it("never spends more than 5% over the stake, the max loss shown, even when the multiple still holds", () => {
    expect(maxLossOf(10n * USD)).toBe(10_500_000n);
    expect(decide(quote(10_500_000n), SERIES, 10n, 10n * USD, 0)).toBe("sign");
    expect(decide(quote(10_500_001n), SERIES, 10n, 10n * USD, 0)).toBe("moved");
  });

  it("never signs a quote at or past its sign-by time, however good its price", () => {
    expect(decide(quote(1n, 1_000), SERIES, 25n, 8n * USD, 999)).toBe("sign");
    expect(decide(quote(1n, 1_000), SERIES, 25n, 8n * USD, 1_000)).toBe("expired");
  });
});
