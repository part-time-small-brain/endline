import { describe, expect, it } from "vitest";
import { assetName } from "./labels.ts";

describe("assetName", () => {
  it("uses the network names people search for, and falls back to the symbol", () => {
    expect(assetName("BTC")).toBe("Bitcoin");
    expect(assetName("ETH")).toBe("Ethereum");
    expect(assetName("SOL")).toBe("SOL");
  });
});
