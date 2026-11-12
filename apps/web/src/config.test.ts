import { afterEach, expect, it, vi } from "vitest";
import mainnet from "../../../deploy/mainnet.json" with { type: "json" };
import testnet from "../../../deploy/testnet.json" with { type: "json" };
import { loadConfig } from "./config.ts";

const ENV = { VITE_NETWORK: "testnet" };

afterEach(() => vi.unstubAllGlobals());

it("talks to the relay on the page's own origin unless VITE_RELAY_URL is set", () => {
  vi.stubGlobal("window", { location: { origin: "https://options.example" } });
  expect(loadConfig(ENV).relayUrl).toBe("https://options.example");
  expect(loadConfig({ ...ENV, VITE_RELAY_URL: "http://localhost:8080" }).relayUrl).toBe("http://localhost:8080");
  expect(() => loadConfig({ ...ENV, VITE_RELAY_URL: "relay" })).toThrow();
});

it("splits landing and app only when VITE_APP_URL is set, matching the app by origin", () => {
  vi.stubGlobal("window", { location: { origin: "https://app.example.com" } });
  expect(loadConfig(ENV).paths.trade).toBe("/app");
  expect(loadConfig({ ...ENV, VITE_APP_URL: "https://app.example.com" }).paths.trade).toBe("/");
  for (const bad of ["https://app.example.com/", "https://App.example.com", "https://app.example.com/app", "app.example.com"]) expect(() => loadConfig({ ...ENV, VITE_APP_URL: bad })).toThrow();
  vi.stubGlobal("window", { location: { origin: "https://example.com" } });
  expect(loadConfig({ ...ENV, VITE_APP_URL: "https://app.example.com" }).paths.trade).toBe("https://app.example.com/");
});

it("mock mode stays on mainnet ids unless VITE_NETWORK=testnet asks for a testnet-like mock", () => {
  expect(loadConfig({ VITE_MOCK: "1" })).toMatchObject({ mock: true, network: "mainnet", intentsId: "intents.near" });
  expect(loadConfig({ VITE_MOCK: "1", VITE_NETWORK: "testnet" })).toMatchObject({ mock: true, network: "testnet", intentsId: expect.stringMatching(/\.testnet$/) });
});

it("takes the contract ids from deploy/<VITE_NETWORK>.json, never from env", () => {
  vi.stubGlobal("window", { location: { origin: "https://app.example.com" } });
  const stale = { VITE_RPC_URL: "https://rpc.stale.example", VITE_INTENTS_ID: "intents.stale.testnet", VITE_OPTIONS_ID: "opt.stale.testnet", VITE_QUOTE_ASSET: "nep141:usdc.stale.testnet" };
  expect(loadConfig({ ...ENV, ...stale })).toMatchObject({ network: "testnet", rpcUrls: [testnet.rpc_url, ...testnet.rpc_fallbacks], intentsId: testnet.intents_id, optionsId: testnet.options_id, quoteAsset: testnet.quote_asset });
});

it("builds mainnet from deploy/mainnet.json, never testnet's", () => {
  vi.stubGlobal("window", { location: { origin: "https://app.endline.trade" } });
  expect(loadConfig({ VITE_NETWORK: "mainnet", VITE_RELAY_URL: "https://api.endline.trade" })).toMatchObject({ network: "mainnet", rpcUrls: [mainnet.rpc_url, ...mainnet.rpc_fallbacks], intentsId: "intents.near", optionsId: mainnet.options_id, quoteAsset: mainnet.quote_asset });
});
