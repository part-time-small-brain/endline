import { describe, expect, it } from "vitest";
import { readTradeMode, TRADE_MODE_KEY, tradeModeAfterStorage } from "./tradeMode.ts";

describe("trade mode", () => {
  it("defaults to Lite for absent, old, or invalid stored choices", () => {
    for (const value of [null, "", "advanced", "PRO", "TAP", "Tap", "undefined", "lite"]) expect(readTradeMode(value)).toBe("lite");
    expect(readTradeMode("pro")).toBe("pro");
    expect(readTradeMode("tap")).toBe("tap");
  });

  it("resets to Lite on removal or clear but ignores unrelated storage", () => {
    expect(tradeModeAfterStorage(TRADE_MODE_KEY, "pro", "lite")).toBe("pro");
    expect(tradeModeAfterStorage(TRADE_MODE_KEY, "tap", "pro")).toBe("tap");
    expect(tradeModeAfterStorage(TRADE_MODE_KEY, null, "tap")).toBe("lite");
    expect(tradeModeAfterStorage(TRADE_MODE_KEY, null, "pro")).toBe("lite");
    expect(tradeModeAfterStorage(null, null, "pro")).toBe("lite");
    expect(tradeModeAfterStorage("theme", "dark", "pro")).toBe("pro");
  });
});
