import { CLAIM_WINDOW_SEC, closeOptions, exerciseOptions, intentsAssetId, type Series } from "@endline/sdk";
import { expect, it, vi } from "vitest";
import type { Config } from "./config.ts";
import { listCommand } from "./list.ts";

const EXPIRY = 1_800_000_000;
const SHORT = intentsAssetId("opt.testnet", "BTC-P-SHORT");
const chain = vi.hoisted(() => ({ series: [] as (Series & { created_by?: string })[], submitted: [] as unknown[], deletable: [] as string[], deleted: [] as string[][], held: {} as Record<string, bigint>, price: "1", viewDown: false }));

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
vi.mock("./chain.ts", () => ({
  Chain: class {
    listingTerms = async () => ({ paused: true, quoteAsset: "nep141:usdc", quoteDecimals: 6, writeCutoffSec: 1_800 });
    underlyings = async () => [];
    seriesFrom = async (fromExpiry: number) => chain.series.filter((s) => s.expiry >= fromExpiry);
    balances = async (assets: string[]) => new Map(assets.map((a) => [a, chain.held[a] ?? 0n]));
    settlement = async () => ({ price: chain.price, final_at: EXPIRY + 3_600 });
    deletableSeries = async (ids: string[]) => {
      if (chain.viewDown) throw new Error("MethodNotFound");
      return ids.filter((id) => chain.deletable.includes(id));
    };
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

  await listCommand({ optionsId: "opt.testnet", accountId: "mm.testnet", settings: { maxSeriesUsd: 1 } } as Config, true);

  expect(chain.submitted).toEqual([closeOptions("opt.testnet", "redeem", { [SHORT]: 5n })]);
});

it("exercises its own unpaired long once the price is final and pays it, not before", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series = [{ id: "BTC-P", underlying: "BTC", kind: "put", strike: "2000", expiry: EXPIRY, underlying_decimals: 8, width: "1000" }];
  const long = intentsAssetId("opt.testnet", "BTC-P");
  chain.held = { [long]: 100_000_000n };
  const config = { optionsId: "opt.testnet", accountId: "mm.testnet", settings: { maxSeriesUsd: 1 } } as Config;

  chain.submitted = [];
  vi.spyOn(Date, "now").mockReturnValue((EXPIRY + 3_599) * 1000);
  await listCommand(config, true);
  expect(chain.submitted).toEqual([]);

  vi.spyOn(Date, "now").mockReturnValue((EXPIRY + 3_600) * 1000);
  await listCommand(config, true);
  expect(chain.submitted).toEqual([exerciseOptions("opt.testnet", { [long]: 100_000_000n })]);
});

it("deletes, 20 at a time, the series a week past their end that the contract says owe nothing", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue((EXPIRY + CLAIM_WINDOW_SEC) * 1000);
  const old = Array.from({ length: 25 }, (_, i) => ({ id: `BTC-${i}`, underlying: "BTC", kind: "put" as const, strike: "1", expiry: EXPIRY, underlying_decimals: 8, width: "1", created_by: "mm.testnet" }));
  const others = [
    { ...old[0]!, id: "BTC-NEW", expiry: EXPIRY + 1 },
    { ...old[0]!, id: "BTC-THEIRS", created_by: "bob.testnet" },
    { ...old[0]!, id: "BTC-ANCIENT", expiry: EXPIRY - 30 * 86_400 - 1 },
  ];
  chain.series = [...old, ...others];
  chain.deletable = [...old.slice(1), ...others].map((s) => s.id);
  chain.held = {};
  chain.deleted = [];

  await listCommand({ optionsId: "opt.testnet", accountId: "mm.testnet", settings: { maxSeriesUsd: 1 } } as Config, true);

  expect(chain.deleted).toEqual([old.slice(1, 21).map((s) => s.id), old.slice(21).map((s) => s.id)]);
});

it("finishes the pass and logs it when the contract can't say what's deletable", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue((EXPIRY + CLAIM_WINDOW_SEC) * 1000);
  chain.series = [{ id: "BTC-0", underlying: "BTC", kind: "put", strike: "1", expiry: EXPIRY, underlying_decimals: 8, width: "1", created_by: "mm.testnet" }];
  chain.viewDown = true;
  chain.deleted = [];

  await listCommand({ optionsId: "opt.testnet", accountId: "mm.testnet", settings: { maxSeriesUsd: 1 } } as Config, true);

  chain.viewDown = false;
  expect(chain.deleted).toEqual([]);
  expect(log).toHaveBeenCalledWith(expect.stringMatching(/^list: \d+ targets/));
});
