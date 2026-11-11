import { createHash } from "node:crypto";
import { CLAIM_WINDOW_SEC } from "@endline/sdk";
import { Account, baseEncode, JsonRpcProvider, KeyPair } from "near-api-js";
import { InvalidNonceError, TransactionTimeoutError, UnknownTransactionError } from "near-api-js/rpc-errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.ts";
import { type Chain, nearChain, ranTx, Refunded, Unsettled } from "./rpc.ts";
import { session } from "./test-fakes.ts";

const config = loadConfig({
  NETWORK_ID: "testnet",
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
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ contractId: "usdc.test", methodName: "ft_transfer_call", deposit: 1n, args: { receiver_id: config.intents_id, amount: "100", msg: "alice.testnet" } }));
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

describe("execute", () => {
  it("hands back every transaction it signed when a send errors, also one re-signed after a stale key nonce", async () => {
    vi.spyOn(JsonRpcProvider.prototype, "viewAccessKey").mockResolvedValue({ nonce: 7n } as never);
    vi.spyOn(JsonRpcProvider.prototype, "viewBlock").mockResolvedValue({ header: { hash: baseEncode(new Uint8Array(32)) } } as never);
    const sent: string[] = [];
    vi.spyOn(JsonRpcProvider.prototype, "sendTransactionUntil").mockImplementation(async (tx) => {
      sent.push(baseEncode(createHash("sha256").update(tx.transaction.encode()).digest()));
      if (sent.length === 1) throw new InvalidNonceError(7, 7, "", "");
      throw new Error("Request timeout");
    });
    const error = await nearChain(config).execute([]).catch((e: unknown) => e);
    expect(sent).toHaveLength(2);
    expect(error).toBeInstanceOf(Unsettled);
    expect(error).toMatchObject({ message: "Request timeout", txHashes: sent });
  });
});

describe("txStatus", () => {
  it("reads the relayer's transaction at final, one seen but not final is pending, and only one the node never saw is unknown", async () => {
    const view = vi.spyOn(JsonRpcProvider.prototype, "viewTransactionStatus");
    const chain = nearChain(config);
    view.mockResolvedValueOnce({ final_execution_status: "FINAL", status: { SuccessValue: "" } } as never);
    expect(await chain.txStatus("h")).toBe("succeeded");
    expect(view).toHaveBeenCalledWith({ txHash: "h", accountId: "relayer.test", waitUntil: "NONE" });
    view.mockResolvedValueOnce({ final_execution_status: "FINAL", status: { Failure: {} } } as never);
    expect(await chain.txStatus("h")).toBe("failed");
    view.mockResolvedValueOnce({ final_execution_status: "EXECUTED_OPTIMISTIC", status: { SuccessValue: "" } } as never);
    expect(await chain.txStatus("h")).toBe("pending");
    view.mockRejectedValueOnce(new UnknownTransactionError("h"));
    expect(await chain.txStatus("h")).toBe("unknown");
    view.mockRejectedValueOnce(new TransactionTimeoutError());
    await expect(chain.txStatus("h")).rejects.toBeInstanceOf(TransactionTimeoutError);
  });
});

describe("ranTx", () => {
  const expired = session("alice.test", { deadlineMs: Date.now() - 60_000 });
  const chainWith = (txStatus: Chain["txStatus"]) => ({ txStatus, finalTimeMs: async () => Date.now() }) as unknown as Chain;

  it("returns a transaction that ran even while another one can't be read", async () => {
    const chain = chainWith(async (txHash) => {
      if (txHash === "a") throw new Error("rpc down");
      return "succeeded";
    });
    expect(await ranTx(chain, expired, new Unsettled(["a", "b"], new Error("timeout")), "t")).toBe("b");
  });

  it("waits for a seen transaction to become final, even past the deadline", async () => {
    vi.useFakeTimers();
    const reads: Awaited<ReturnType<Chain["txStatus"]>>[] = ["pending", "pending", "succeeded"];
    const chain = chainWith(async () => reads.shift() ?? "unknown");
    const outcome = ranTx(chain, expired, new Unsettled(["a"], new Error("timeout")), "t");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe("a");
    vi.useRealTimers();
  });

  it("never decides failed on a read error, even past the deadline", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const chain = chainWith(async () => {
      reads += 1;
      if (reads === 1) throw new Error("rpc down");
      return "unknown";
    });
    const outcome = ranTx(chain, expired, new Unsettled(["a"], new Error("timeout")), "t");
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await outcome).toBeUndefined();
    expect(reads).toBe(2);
    vi.useRealTimers();
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
