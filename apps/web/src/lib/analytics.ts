import type { Config } from "../config.ts";

const BEACON = "https://static.cloudflareinsights.com/beacon.min.js";
const TOKEN = "a9282446496d49e0988b4b8e6d83cefe";

export function analyticsScript(config: Pick<Config, "mock" | "network">): { src: string; beacon: string } | undefined {
  return !config.mock && config.network === "mainnet" ? { src: BEACON, beacon: JSON.stringify({ token: TOKEN }) } : undefined;
}
