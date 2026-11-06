import { CLAIM_WINDOW_SEC, closeOptions, exerciseOptions, intentsAssetId, type Series } from "@endline/sdk";
import { expect, it, vi } from "vitest";
import type { Config } from "./config.ts";
import { listCommand } from "./list.ts";

const EXPIRY = 1_800_000_000;
const SHORT = intentsAssetId("opt.testnet", "BTC-P-SHORT");
const chain = vi.hoisted(() => ({ series: [] as Series[], submitted: [] as unknown[], deletable: [] as string[], deleted: [] as string[][], held: {} as Record<string, bigint>, price: "1" }));

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
vi.mock("./chain.ts", () => ({
  Chain: class {
    listingTerms = async () => ({ paused: true, quoteAsset: "nep141:usdc", quoteDecimals: 6, writeCutoffSec: 1_800 });
    underlyings = async () => [];
    seriesFrom = async (fromExpiry: number, untilExpiry = Infinity) => chain.series.filter((s) => s.expiry >= fromExpiry && s.expiry <= untilExpiry);
    balances = async (assets: string[]) => new Map(assets.map((a) => [a, chain.held[a] ?? 0n]));
    settlement = async () => ({ price: chain.price, final_at: EXPIRY + 3_600 });
    deletableSeries = async (ids: string[]) => ids.filter((id) => chain.deletable.includes(id));
    deleteSeries = async (ids: string[]) => {
      chain.deleted.push(ids);
      return "tx";
    };
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
  chain.held = { [SHORT]: 5n };

  await listCommand({ optionsId: "opt.testnet", settings: { maxSeriesUsd: 1 } } as Config, true);

  expect(chain.submitted).toEqual([closeOptions("opt.testnet", "redeem", { [SHORT]: 5n })]);
});

it("exercises its own unpaired long once the price is final and pays it", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue((EXPIRY + 7_200) * 1000);
  chain.series = [{ id: "BTC-P", underlying: "BTC", kind: "put", strike: "2000", expiry: EXPIRY, underlying_decimals: 8, width: "1000" }];
  const long = intentsAssetId("opt.testnet", "BTC-P");
  chain.held = { [long]: 100_000_000n };
  chain.submitted = [];

  await listCommand({ optionsId: "opt.testnet", settings: { maxSeriesUsd: 1 } } as Config, true);

  expect(chain.submitted).toEqual([exerciseOptions("opt.testnet", { [long]: 100_000_000n })]);
});

it("deletes, 20 at a time, the series a week past their end that the contract says owe nothing", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue((EXPIRY + CLAIM_WINDOW_SEC) * 1000);
  const old: Series[] = Array.from({ length: 25 }, (_, i) => ({ id: `BTC-${i}`, underlying: "BTC", kind: "put", strike: "1", expiry: EXPIRY, underlying_decimals: 8, width: "1" }));
  chain.series = [...old, { ...old[0]!, id: "BTC-NEW", expiry: EXPIRY + 1 }];
  chain.deletable = [...old.slice(1).map((s) => s.id), "BTC-NEW"];
  chain.held = {};
  chain.deleted = [];

  await listCommand({ optionsId: "opt.testnet", settings: { maxSeriesUsd: 1 } } as Config, true);

  expect(chain.deleted).toEqual([old.slice(1, 21).map((s) => s.id), old.slice(21).map((s) => s.id)]);
});
