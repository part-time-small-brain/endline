import { existsSync, readFileSync } from "node:fs";
import { Deployment } from "./protocol.ts";

export function readDeployment(network: "mainnet" | "testnet"): Deployment {
  const file = new URL(`../../../deploy/${network}.json`, import.meta.url);
  if (!existsSync(file)) throw new Error(`no deploy/${network}.json: ${network} has no deployment yet`);
  return Deployment.parse(JSON.parse(readFileSync(file, "utf8")));
}
