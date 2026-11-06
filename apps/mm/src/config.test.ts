import { describe, expect, it } from "vitest";
import testnet from "../../../deploy/testnet.json" with { type: "json" };
import { loadConfig, loadMonitorConfig, loadProposerConfig, loadRelayConfig, loadSettlerConfig } from "./config.ts";

const KEY = `ed25519:${"1".repeat(64)}`;
const ENV = {
  NETWORK_ID: "testnet",
  MM_ACCOUNT_ID: "mm.near-options-dev.testnet",
  MM_PRIVATE_KEY: KEY,
};
const STALE = { NEAR_RPC_URL: "https://rpc.stale.example", INTENTS_ID: "intents.stale.testnet", OPTIONS_ID: "opt.stale.testnet" };

describe("config", () => {
  it("turns vol points and bps into fractions", () => {
    expect(loadConfig(ENV).settings).toMatchObject({ spreadVol: 0.02, hedgeFee: 0.00045 });
  });

  it.each([
    ["a missing network", { NETWORK_ID: undefined }],
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

  it("runs the monitor without an account or key", () => {
    const monitor = { NETWORK_ID: "testnet" };
    expect(loadMonitorConfig(monitor)).toEqual({
      rpcUrl: testnet.rpc_url,
      optionsId: testnet.options_id,
      intentsId: testnet.intents_id,
      relayerId: undefined,
      networkId: "testnet",
      webhookUrl: undefined,
      healthUrl: undefined,
    });
    expect(loadMonitorConfig({ ...monitor, RELAYER_ACCOUNT_ID: "x.testnet" })).toMatchObject({ relayerId: "x.testnet" });
    expect(() => loadMonitorConfig({ ...monitor, RELAYER_ACCOUNT_ID: "NOT AN ACCOUNT" })).toThrow();
    expect(() => loadMonitorConfig({ ...monitor, NETWORK_ID: "betanet" })).toThrow();
    expect(() => loadMonitorConfig({ ...monitor, ALERT_WEBHOOK_URL: "hooks.slack.com/x" })).toThrow();
    expect(() => loadMonitorConfig({ ...monitor, HEALTH_URL: "" })).toThrow();
  });

  it("takes the contract ids from deploy/<NETWORK_ID>.json, never from env", () => {
    const ids = { rpcUrl: testnet.rpc_url, intentsId: testnet.intents_id, optionsId: testnet.options_id };
    expect(loadConfig({ ...ENV, ...STALE })).toMatchObject(ids);
    expect(loadMonitorConfig({ NETWORK_ID: "testnet", ...STALE })).toMatchObject(ids);
    expect(loadProposerConfig({ NETWORK_ID: "testnet", ORACLE_ACCOUNT_ID: "oracle.testnet", ORACLE_PRIVATE_KEY: KEY, ...STALE })).toMatchObject({ rpcUrl: ids.rpcUrl, optionsId: ids.optionsId });
  });

  it("refuses a network without a deploy file: mainnet, and so settle, until deploy/mainnet.json exists", () => {
    expect(() => loadConfig({ ...ENV, NETWORK_ID: "mainnet" })).toThrow("no deploy/mainnet.json");
    expect(() => loadMonitorConfig({ NETWORK_ID: "mainnet" })).toThrow("no deploy/mainnet.json");
    expect(() => loadProposerConfig({ NETWORK_ID: "mainnet", ORACLE_ACCOUNT_ID: "oracle.near", ORACLE_PRIVATE_KEY: KEY })).toThrow("no deploy/mainnet.json");
    expect(() => loadSettlerConfig({ RELAYER_ACCOUNT_ID: "relayer.near", RELAYER_PRIVATE_KEY: KEY })).toThrow("no deploy/mainnet.json");
  });
});
