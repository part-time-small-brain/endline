import { CLAIM_WINDOW_SEC } from "@endline/sdk";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.ts";
import { nearChain, Refunded } from "./rpc.ts";

const config = loadConfig({
  NEAR_RPC_URL: "https://rpc.example",
  NETWORK_ID: "testnet",
  OPTIONS_ID: "opt.test",
  QUOTE_ASSET: "nep141:usdc.test",
  RELAYER_ACCOUNT_ID: "relayer.test",
  RELAYER_PRIVATE_KEY: KeyPair.fromRandom("ed25519").toString(),
  MM_API_KEYS: "0123456789abcdef",
  DATA_DIR: "data",
});

const returning = (status: object) =>
  vi.spyOn(Account.prototype, "callFunctionRaw").mockResolvedValue({ status, transaction_outcome: { id: "tx" } } as Awaited<ReturnType<Account["callFunctionRaw"]>>);
const used = (amount: string) => ({ SuccessValue: Buffer.from(JSON.stringify(amount)).toString("base64") });

afterEach(() => vi.restoreAllMocks());

describe("depositFt", () => {
  it("returns the tx when the token reports the full amount used", async () => {
    const call = returning(used("100"));
    expect(await nearChain(config).depositFt("usdc.test", "alice.testnet", 100n)).toBe("tx");
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ contractId: "usdc.test", methodName: "ft_transfer_call", deposit: 1n, args: { receiver_id: "intents.near", amount: "100", msg: "alice.testnet" } }));
  });

  it("reports a refund when the token says nothing was used", async () => {
    returning(used("0"));
    await expect(nearChain(config).depositFt("usdc.test", "alice.testnet", 100n)).rejects.toBeInstanceOf(Refunded);
  });

  it("does not call a partial or unreadable result a refund", async () => {
    for (const status of [used("40"), { Failure: {} }]) {
      returning(status);
      const error = await nearChain(config).depositFt("usdc.test", "alice.testnet", 100n).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(Refunded);
    }
  });
});

describe("listSeries", () => {
  const NOW_SEC = 1_800_000_000;
  const oldest = NOW_SEC - CLAIM_WINDOW_SEC;
  const order = (a: { expiry: number; id: string }, b: { expiry: number; id: string }) => a.expiry - b.expiry || (a.id < b.id ? -1 : 1);
  const listed = Array.from({ length: 401 }, (_, i) => ({
    id: `BTC-${String(400 - i).padStart(3, "0")}`,
    underlying: "BTC",
    kind: "call" as const,
    strike: "1",
    expiry: oldest - 2 + (i % 5),
    underlying_decimals: 8,
    width: "1",
  }));
  const recent = listed.filter((s) => s.expiry >= oldest).sort(order);

  function contract() {
    vi.spyOn(Date, "now").mockReturnValue(NOW_SEC * 1000);
    const calls: string[] = [];
    vi.spyOn(JsonRpcProvider.prototype, "callFunction").mockImplementation((async ({ method, args }: { method: string; args: { from_expiry: number; after_id?: string; limit: number } }) => {
      calls.push(method);
      const { from_expiry: from, after_id: after, limit } = args;
      return [...listed].sort(order).filter((s) => s.expiry >= from && (after === undefined || s.expiry > from || s.id > after)).slice(0, limit);
    }) as unknown as JsonRpcProvider["callFunction"]);
    return calls;
  }

  it("pages series from the start of the claim window by expiry cursor", async () => {
    const calls = contract();
    expect(await nearChain(config).listSeries()).toEqual(recent);
    expect(calls).toEqual(Array(2).fill("list_series_by_expiry"));
  });

  it("keeps serving the last listing while the RPC rate-limits, backs off, then takes the next good refresh", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = contract();
    const chain = nearChain(config);
    expect(await chain.listSeries()).toEqual(recent);
    const limited = vi.spyOn(JsonRpcProvider.prototype, "callFunction").mockRejectedValue(new Error("429 Rate limits exceeded"));
    limited.mockClear();
    vi.spyOn(Date, "now").mockReturnValue(NOW_SEC * 1000 + 61_000);
    expect(await chain.listSeries()).toEqual(recent);
    expect(await chain.listSeries()).toEqual(recent);
    expect(limited).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, "now").mockReturnValue(NOW_SEC * 1000 + 122_000);
    expect(await chain.listSeries()).toEqual(recent);
    expect(limited).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
    const fresh = [{ ...recent[0]!, id: "BTC-NEW" }];
    limited.mockResolvedValue(fresh as never);
    vi.spyOn(Date, "now").mockReturnValue(NOW_SEC * 1000 + 183_000);
    expect(await chain.listSeries()).toEqual(fresh);
  });

  it("still fails when the first load fails, and retries on the next call", async () => {
    contract();
    const chain = nearChain(config);
    vi.spyOn(JsonRpcProvider.prototype, "callFunction").mockRejectedValueOnce(new Error("429 Rate limits exceeded"));
    await expect(chain.listSeries()).rejects.toThrow("429");
    expect(await chain.listSeries()).toEqual(recent);
  });
});
