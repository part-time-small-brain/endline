import { Deployment } from "@endline/sdk";
import { z } from "zod";
import { PATHS, type Paths, pathsFor } from "./lib/route.ts";

const Network = z.enum(["mainnet", "testnet"]);

const Live = z.object({
  VITE_RELAY_URL: z.url().optional(),
  VITE_APP_URL: z
    .string()
    .refine((url) => URL.canParse(url) && new URL(url).origin === url, "an origin like https://app.example.com: no path, no trailing slash")
    .optional(),
  VITE_NETWORK: Network,
});

const DEPLOYMENTS = import.meta.glob("../../../deploy/*.json", { eager: true, import: "default" });

export interface Config {
  mock: boolean;
  relayUrl: string;
  paths: Paths;
  network: z.infer<typeof Network>;
  rpcUrl: string;
  intentsId: string;
  optionsId: string;
  quoteAsset: string;
}

const MOCK: Config = {
  mock: true,
  relayUrl: "",
  paths: PATHS,
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
  const file = DEPLOYMENTS[`../../../deploy/${e.VITE_NETWORK}.json`];
  if (file === undefined) throw new Error(`no deploy/${e.VITE_NETWORK}.json: ${e.VITE_NETWORK} has no deployment yet`);
  const d = Deployment.parse(file);
  return {
    mock: false,
    relayUrl: e.VITE_RELAY_URL ?? window.location.origin,
    paths: e.VITE_APP_URL === undefined ? PATHS : pathsFor(e.VITE_APP_URL, window.location.origin),
    network: e.VITE_NETWORK,
    rpcUrl: d.rpc_url,
    intentsId: d.intents_id,
    optionsId: d.options_id,
    quoteAsset: d.quote_asset,
  };
}
