import { CLAIM_WINDOW_SEC, closeOptions, intentsAssetId, type Series } from "@near-options/sdk";
import { expect, it, vi } from "vitest";
import type { Config } from "./config.ts";
import { listCommand } from "./list.ts";

const EXPIRY = 1_800_000_000;
const SHORT = intentsAssetId("opt.testnet", "BTC-P-SHORT");
const chain = vi.hoisted(() => ({ series: [] as Series[], submitted: [] as unknown[] }));

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
vi.mock("./chain.ts", () => ({
  Chain: class {
    listingTerms = async () => ({ paused: true, quoteAsset: "nep141:usdc", quoteDecimals: 6, writeCutoffSec: 1_800 });
    underlyings = async () => [];
    seriesFrom = async (fromExpiry: number) => chain.series.filter((s) => s.expiry >= fromExpiry);
    balances = async (assets: string[]) => new Map(assets.map((a) => [a, a === SHORT ? 5n : 0n]));
    settlement = async () => ({ final_at: EXPIRY + 3_600 });
    submit = async (intent: unknown) => {
      chain.submitted.push(intent);
      return "tx";
    };
  },
}));

it("redeems shorts of a series that expired a second short of the claim window ago", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue((EXPIRY + CLAIM_WINDOW_SEC - 1) * 1000);
  chain.series = [{ id: "BTC-P", underlying: "BTC", kind: "put", strike: "1", expiry: EXPIRY, underlying_decimals: 8, width: "1" }];

  await listCommand({ optionsId: "opt.testnet", settings: { maxSeriesUsd: 1 } } as Config, true);

  expect(chain.submitted).toEqual([closeOptions("opt.testnet", "redeem", { [SHORT]: 5n })]);
});
