import { describe, expect, it } from "vitest";
import { loadConfig, loadMonitorConfig, loadRelayConfig } from "./config.ts";

const ENV = {
  MM_ACCOUNT_ID: "mm.near-options-dev.testnet",
  MM_PRIVATE_KEY: `ed25519:${"1".repeat(64)}`,
  NEAR_RPC_URL: "https://rpc.testnet.fastnear.com",
  OPTIONS_ID: "opt4.near-options-dev.testnet",
};

describe("config", () => {
  it("turns vol points and bps into fractions", () => {
    expect(loadConfig(ENV).settings).toMatchObject({ spreadVol: 0.02, hedgeFee: 0.00045 });
  });

  it.each([
    ["a missing options contract", { OPTIONS_ID: undefined }],
    ["a key without the curve prefix", { MM_PRIVATE_KEY: "1".repeat(64) }],
    ["a malformed Hyperliquid key", { HL_PRIVATE_KEY: "0x1234" }],
    ["a negative limit", { MAX_DELTA_USD: "-5" }],
    ["a non-numeric limit", { MAX_VEGA_USD: "lots" }],
  ])("refuses %s", (_, override) => {
    expect(() => loadConfig({ ...ENV, ...override })).toThrow();
  });

  it("only accepts a websocket relay and a real API key", () => {
    expect(() => loadRelayConfig({ RELAY_WS_URL: "https://relay.example/mm", MM_API_KEY: "k".repeat(16) })).toThrow();
    expect(() => loadRelayConfig({ RELAY_WS_URL: "wss://relay.example/mm", MM_API_KEY: "short" })).toThrow();
  });

  it("runs the monitor without an account or key, defaulting to mainnet commands", () => {
    const monitor = { NEAR_RPC_URL: ENV.NEAR_RPC_URL, OPTIONS_ID: ENV.OPTIONS_ID };
    expect(loadMonitorConfig(monitor)).toEqual({
      rpcUrl: ENV.NEAR_RPC_URL,
      optionsId: ENV.OPTIONS_ID,
      intentsId: "intents.near",
      relayerId: undefined,
      networkId: "mainnet",
      webhookUrl: undefined,
      healthUrl: undefined,
    });
    expect(loadMonitorConfig({ ...monitor, INTENTS_ID: "intents.x.testnet", RELAYER_ACCOUNT_ID: "x.testnet" })).toMatchObject({ intentsId: "intents.x.testnet", relayerId: "x.testnet" });
    expect(() => loadMonitorConfig({ ...monitor, RELAYER_ACCOUNT_ID: "NOT AN ACCOUNT" })).toThrow();
    expect(() => loadMonitorConfig({ ...monitor, NETWORK_ID: "betanet" })).toThrow();
    expect(() => loadMonitorConfig({ ...monitor, ALERT_WEBHOOK_URL: "hooks.slack.com/x" })).toThrow();
    expect(() => loadMonitorConfig({ ...monitor, HEALTH_URL: "" })).toThrow();
  });
});
