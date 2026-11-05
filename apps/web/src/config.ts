import { AccountId } from "@endline/sdk";
import { z } from "zod";

const Network = z.enum(["mainnet", "testnet"]);

const Live = z.object({
  VITE_RELAY_URL: z.url().optional(),
  VITE_NETWORK: Network,
  VITE_RPC_URL: z.url(),
  VITE_INTENTS_ID: AccountId,
  VITE_OPTIONS_ID: AccountId,
  VITE_QUOTE_ASSET: z.string().startsWith("nep141:"),
});

export interface Config {
  mock: boolean;
  relayUrl: string;
  network: z.infer<typeof Network>;
  rpcUrl: string;
  intentsId: string;
  optionsId: string;
  quoteAsset: string;
}

const MOCK: Config = {
  mock: true,
  relayUrl: "",
  network: "mainnet",
  rpcUrl: "",
  intentsId: "intents.near",
  optionsId: "opt.demo.near",
  quoteAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
};

const MOCK_TESTNET: Config = { ...MOCK, network: "testnet", intentsId: "intents.demo.testnet", optionsId: "opt.demo.testnet" };

export function loadConfig(env: Record<string, unknown>): Config {
  if (env.VITE_MOCK === "1") return env.VITE_NETWORK === "testnet" ? MOCK_TESTNET : MOCK;
  const e = Live.parse(env);
  return {
    mock: false,
    relayUrl: e.VITE_RELAY_URL ?? window.location.origin,
    network: e.VITE_NETWORK,
    rpcUrl: e.VITE_RPC_URL,
    intentsId: e.VITE_INTENTS_ID,
    optionsId: e.VITE_OPTIONS_ID,
    quoteAsset: e.VITE_QUOTE_ASSET,
  };
}
