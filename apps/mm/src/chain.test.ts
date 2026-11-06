import { JsonRpcProvider } from "near-api-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChainReader } from "./chain.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seriesFrom", () => {
  const order = (a: { expiry: number; id: string }, b: { expiry: number; id: string }) => a.expiry - b.expiry || (a.id < b.id ? -1 : 1);
  const listed = Array.from({ length: 401 }, (_, i) => ({
    id: `BTC-${String(400 - i).padStart(3, "0")}`,
    underlying: "BTC",
    kind: "call" as const,
    strike: "1",
    expiry: 1_000 + (i % 5),
    underlying_decimals: 8,
    width: "1",
  }));
  const from = (expiry: number) => listed.filter((s) => s.expiry >= expiry).sort(order);

  function contract() {
    const calls: string[] = [];
    vi.spyOn(JsonRpcProvider.prototype, "callFunction").mockImplementation((async ({ method, args }: { method: string; args: { from_expiry: number; after_id?: string; limit: number } }) => {
      calls.push(method);
      const { from_expiry: expiry, after_id: after, limit } = args;
      return from(expiry).filter((s) => after === undefined || s.expiry > expiry || s.id > after).slice(0, limit);
    }) as unknown as JsonRpcProvider["callFunction"]);
    return { chain: new ChainReader("http://rpc", "opt.testnet"), calls };
  }

  it("pages by expiry cursor without repeats or gaps", async () => {
    const { chain, calls } = contract();
    expect(await chain.seriesFrom(1_001)).toEqual(from(1_001));
    expect(calls).toEqual(Array(2).fill("list_series_by_expiry"));
    expect(await chain.seriesFrom(1_000)).toEqual(from(1_000));
  });

  it("reads every series by expiry cursor, an order a delete can't reshuffle", async () => {
    const { chain, calls } = contract();
    expect(await chain.series()).toEqual(from(0));
    expect(new Set(calls)).toEqual(new Set(["list_series_by_expiry"]));
  });
});
