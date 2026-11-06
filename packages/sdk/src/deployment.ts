import { existsSync, readFileSync } from "node:fs";
import { Deployment } from "./protocol.ts";

export function readDeployment(network: "mainnet" | "testnet"): Deployment {
  const file = new URL(`../../../deploy/${network}.json`, import.meta.url);
  if (!existsSync(file)) throw new Error(`no deploy/${network}.json: ${network} has no deployment yet`);
  const deployment = Deployment.parse(JSON.parse(readFileSync(file, "utf8")));
  if (deployment.network !== network) throw new Error(`deploy/${network}.json is for ${deployment.network}`);
  return deployment;
}
