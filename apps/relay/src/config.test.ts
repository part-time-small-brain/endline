import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("secret files", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-secrets-"));
  const file = (name: string, content: string) => {
    writeFileSync(join(dir, name), content);
    return join(dir, name);
  };
  const { RELAYER_PRIVATE_KEY, MM_API_KEYS, ...rest } = ENV;

  it("reads the key, the shared MM_API_KEY file and an empty optional file", () => {
    const config = loadConfig({ ...rest, RELAYER_PRIVATE_KEY_FILE: file("key", `${RELAYER_PRIVATE_KEY}\n`), MM_API_KEYS_FILE: file("mm", `${MM_API_KEYS}\n`), ONECLICK_JWT_FILE: file("jwt", "") });
    expect(config).toMatchObject({ RELAYER_PRIVATE_KEY, MM_API_KEYS: [MM_API_KEYS] });
    expect(config.ONECLICK_JWT).toBeUndefined();
  });

  it("names a bad key without printing it", () => {
    const leaked = "ed25519:0OIl-not-base58";
    const error = (() => {
      try {
        loadConfig({ ...rest, MM_API_KEYS, RELAYER_PRIVATE_KEY_FILE: file("bad", leaked) });
      } catch (e) {
        return String(e);
      }
    })();
    expect(error).toContain("RELAYER_PRIVATE_KEY");
    expect(error).not.toContain(leaked);
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
