import { AccountId } from "@endline/sdk";
import { z } from "zod";

const positive = (fallback: number) => z.coerce.number().positive().default(fallback);

const Env = z.object({
  MM_ACCOUNT_ID: AccountId,
  MM_PRIVATE_KEY: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/, "ed25519:<base58>"),
  NEAR_RPC_URL: z.url(),
  INTENTS_ID: AccountId.default("intents.near"),
  OPTIONS_ID: AccountId,
  HL_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  HL_ACCOUNT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  SPREAD_VOL_POINTS: positive(2),
  MIN_PREMIUM_USD: positive(1),
  MAX_TRADE_USD: positive(2_000),
  MAX_SERIES_USD: positive(5_000),
  MAX_DELTA_USD: positive(50_000),
  MAX_VEGA_USD: positive(200),
});

const MonitorEnv = Env.pick({ NEAR_RPC_URL: true, INTENTS_ID: true, OPTIONS_ID: true }).extend({
  RELAYER_ACCOUNT_ID: AccountId.optional(),
  NETWORK_ID: z.enum(["mainnet", "testnet"]).default("mainnet"),
  ALERT_WEBHOOK_URL: z.url().optional(),
  HEALTH_URL: z.url().optional(),
});

const ProposerEnv = Env.pick({ NEAR_RPC_URL: true, OPTIONS_ID: true }).extend({
  ORACLE_ACCOUNT_ID: AccountId,
  ORACLE_PRIVATE_KEY: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/, "ed25519:<base58>"),
  WASMTIME: z.string().min(1).default("wasmtime"),
});

const SettlerEnv = Env.pick({ NEAR_RPC_URL: true, OPTIONS_ID: true }).extend({
  RELAYER_ACCOUNT_ID: AccountId,
  RELAYER_PRIVATE_KEY: Env.shape.MM_PRIVATE_KEY,
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
  return {
    accountId: e.MM_ACCOUNT_ID,
    privateKey: e.MM_PRIVATE_KEY as `ed25519:${string}`,
    rpcUrl: e.NEAR_RPC_URL,
    intentsId: e.INTENTS_ID,
    optionsId: e.OPTIONS_ID,
    hlPrivateKey: e.HL_PRIVATE_KEY as `0x${string}` | undefined,
    hlAccount: e.HL_ACCOUNT_ADDRESS as `0x${string}` | undefined,
    settings: {
      spreadVol: e.SPREAD_VOL_POINTS / 100,
      minPremiumUsd: e.MIN_PREMIUM_USD,
      hedgeFee: 0.00045,
      carryQuote: 0.07,
      maxTradeUsd: e.MAX_TRADE_USD,
      maxSeriesUsd: e.MAX_SERIES_USD,
      maxDeltaUsd: e.MAX_DELTA_USD,
      maxVegaUsd: e.MAX_VEGA_USD,
      hedgeBandUsd: 50,
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
  return {
    rpcUrl: e.NEAR_RPC_URL,
    optionsId: e.OPTIONS_ID,
    intentsId: e.INTENTS_ID,
    relayerId: e.RELAYER_ACCOUNT_ID,
    networkId: e.NETWORK_ID,
    webhookUrl: e.ALERT_WEBHOOK_URL,
    healthUrl: e.HEALTH_URL,
  };
}

export type ProposerConfig = ReturnType<typeof loadProposerConfig>;

export function loadProposerConfig(env: Record<string, string | undefined>) {
  const e = ProposerEnv.parse(env);
  return { rpcUrl: e.NEAR_RPC_URL, optionsId: e.OPTIONS_ID, oracleAccountId: e.ORACLE_ACCOUNT_ID, oraclePrivateKey: e.ORACLE_PRIVATE_KEY, wasmtime: e.WASMTIME };
}

export type SettlerConfig = ReturnType<typeof loadSettlerConfig>;

export function loadSettlerConfig(env: Record<string, string | undefined>) {
  const e = SettlerEnv.parse(env);
  return { rpcUrl: e.NEAR_RPC_URL, optionsId: e.OPTIONS_ID, relayerId: e.RELAYER_ACCOUNT_ID, relayerPrivateKey: e.RELAYER_PRIVATE_KEY };
}
