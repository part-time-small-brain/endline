import { Amount, writeOptions } from "@endline/sdk";
import { Chain } from "./chain.ts";
import type { Config } from "./config.ts";

export const WRITE_TTL_MS = 60_000;

export async function writeCommand(config: Config, seriesId: string | undefined, collateralText: string | undefined): Promise<void> {
  if (!seriesId || !collateralText) throw new Error("usage: write <series_id> <collateral_amount>");
  const collateral = BigInt(Amount.parse(collateralText));
  const chain = new Chain(config);
  const [series, contract] = await Promise.all([chain.getSeries(seriesId), chain.contractConfig()]);
  const deadlineMs = Date.now() + WRITE_TTL_MS;
  if (deadlineMs >= (series.expiry - contract.writeCutoffSec) * 1000) throw new Error(`writes for ${seriesId} are closed or close before the deadline`);
  const tx = await chain.submit(writeOptions(config.optionsId, contract.quoteAsset, collateral, series.id), deadlineMs);
  console.log(`wrote ${seriesId} with ${collateral} ${contract.quoteAsset}: tx ${tx}`);
}
