import { AccountId } from "@endline/sdk";
import { readDeployment } from "@endline/sdk/deployment";
import { z } from "zod";

const positive = (fallback: number) => z.coerce.number().positive().default(fallback);

const Env = z.object({
  NETWORK_ID: z.enum(["mainnet", "testnet"]),
  MM_ACCOUNT_ID: AccountId,
  MM_PRIVATE_KEY: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/, "ed25519:<base58>"),
  SPREAD_VOL_POINTS: positive(2),
  MIN_PREMIUM_USD: positive(1),
  MAX_TRADE_USD: z.coerce.number().positive().max(1e9).default(2_000),
  MAX_SERIES_USD: positive(5_000),
  MAX_DELTA_USD: positive(50_000),
  MAX_VEGA_USD: positive(200),
});

const MonitorEnv = Env.pick({ NETWORK_ID: true }).extend({
  RELAYER_ACCOUNT_ID: AccountId.optional(),
  ALERT_WEBHOOK_URL: z.url().optional(),
  HEALTH_URL: z.url().optional(),
});

const ProposerEnv = Env.pick({ NETWORK_ID: true }).extend({
  ORACLE_ACCOUNT_ID: AccountId,
  ORACLE_PRIVATE_KEY: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/, "ed25519:<base58>"),
  WASMTIME: z.string().min(1).default("wasmtime"),
});

const SettlerEnv = z.object({
  SETTLER_ACCOUNT_ID: AccountId,
  SETTLER_PRIVATE_KEY: Env.shape.MM_PRIVATE_KEY,
});

const RelayEnv = z.object({
  RELAY_WS_URL: z.url({ protocol: /^wss?$/ }),
  MM_API_KEY: z.string().min(16),
});

export type Config = ReturnType<typeof loadConfig>;
export type Settings = Config["settings"];
export type MonitorConfig = ReturnType<typeof loadMonitorConfig>;

export function loadConfig(env: Record<string, string | undefined>) {
  const e = Env.parse(env);
  const d = readDeployment(e.NETWORK_ID);
  return {
    accountId: e.MM_ACCOUNT_ID,
    privateKey: e.MM_PRIVATE_KEY as `ed25519:${string}`,
    rpcUrl: d.rpc_url,
    intentsId: d.intents_id,
    optionsId: d.options_id,
    settings: {
      spreadVol: e.SPREAD_VOL_POINTS / 100,
      minPremiumUsd: e.MIN_PREMIUM_USD,
      carryQuote: 0.07,
      maxTradeUsd: e.MAX_TRADE_USD,
      maxSeriesUsd: e.MAX_SERIES_USD,
      maxDeltaUsd: e.MAX_DELTA_USD,
      maxVegaUsd: e.MAX_VEGA_USD,
      maxDataAgeMs: 10_000,
    },
  };
}

export function loadRelayConfig(env: Record<string, string | undefined>) {
  const e = RelayEnv.parse(env);
  return { url: e.RELAY_WS_URL, apiKey: e.MM_API_KEY };
}

export function loadMonitorConfig(env: Record<string, string | undefined>) {
  const e = MonitorEnv.parse(env);
  const d = readDeployment(e.NETWORK_ID);
  return {
    rpcUrl: d.rpc_url,
    optionsId: d.options_id,
    intentsId: d.intents_id,
    relayerId: e.RELAYER_ACCOUNT_ID,
    networkId: e.NETWORK_ID,
    webhookUrl: e.ALERT_WEBHOOK_URL,
    healthUrl: e.HEALTH_URL,
  };
}

export type ProposerConfig = ReturnType<typeof loadProposerConfig>;

export function loadProposerConfig(env: Record<string, string | undefined>) {
  const e = ProposerEnv.parse(env);
  const d = readDeployment(e.NETWORK_ID);
  return { rpcUrl: d.rpc_url, optionsId: d.options_id, oracleAccountId: e.ORACLE_ACCOUNT_ID, oraclePrivateKey: e.ORACLE_PRIVATE_KEY, wasmtime: e.WASMTIME };
}

export type SettlerConfig = ReturnType<typeof loadSettlerConfig>;

export function loadSettlerConfig(env: Record<string, string | undefined>) {
  const e = SettlerEnv.parse(env);
  const d = readDeployment("mainnet");
  return { rpcUrl: d.rpc_url, optionsId: d.options_id, accountId: e.SETTLER_ACCOUNT_ID, privateKey: e.SETTLER_PRIVATE_KEY };
}
