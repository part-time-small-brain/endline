import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const ENV = {
  NEAR_RPC_URL: "https://rpc.testnet.example",
  NETWORK_ID: "testnet",
  OPTIONS_ID: "opt.test.testnet",
  QUOTE_ASSET: "nep141:usdc.test.testnet",
  RELAYER_ACCOUNT_ID: "relayer.testnet",
  RELAYER_PRIVATE_KEY: "ed25519:11111111111111111111111111111111",
  MM_API_KEYS: "0123456789abcdef",
  DATA_DIR: "data",
};

describe("APP_ORIGINS", () => {
  it("defaults to none and reads a comma list", () => {
    expect(loadConfig(ENV).APP_ORIGINS).toEqual([]);
    expect(loadConfig({ ...ENV, APP_ORIGINS: " https://app.example.com, http://localhost:5173 ," }).APP_ORIGINS).toEqual(["https://app.example.com", "http://localhost:5173"]);
  });

  it.each(["https://app.example.com/", "https://app.example.com/app", "app.example.com", "*"])("refuses %s, which a browser never sends as an Origin", (origin) => {
    expect(() => loadConfig({ ...ENV, APP_ORIGINS: origin })).toThrow(/APP_ORIGINS/);
  });
});
