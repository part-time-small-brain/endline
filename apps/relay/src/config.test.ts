import { describe, expect, it } from "vitest";
import testnet from "../../../deploy/testnet.json" with { type: "json" };
import { loadConfig } from "./config.ts";

const ENV = {
  NETWORK_ID: "testnet",
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

describe("contract ids", () => {
  it("come from deploy/<NETWORK_ID>.json, never from env", () => {
    const stale = { NEAR_RPC_URL: "https://rpc.stale.example", INTENTS_ID: "intents.stale.testnet", OPTIONS_ID: "opt.stale.testnet", QUOTE_ASSET: "nep141:usdc.stale.testnet" };
    expect(loadConfig({ ...ENV, ...stale })).toMatchObject({ rpc_url: testnet.rpc_url, intents_id: testnet.intents_id, options_id: testnet.options_id, quote_asset: testnet.quote_asset });
  });

  it("refuses a network without a deploy file: mainnet until deploy/mainnet.json exists", () => {
    expect(() => loadConfig({ ...ENV, NETWORK_ID: "mainnet" })).toThrow("no deploy/mainnet.json");
  });
});
