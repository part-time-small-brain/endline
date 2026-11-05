import type { Series } from "@endline/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requests, settleCommand } from "./settle.ts";

const EXPIRY = 1_800_000_000;
const WINDOW = 21_600;

const chain = vi.hoisted(() => ({ network: "mainnet", proposedAfter: Infinity, settlementReads: 0, calls: [] as unknown[], failFirst: true }));
const sleep = vi.hoisted(() => vi.fn());

vi.mock("node:timers/promises", () => ({ setTimeout: sleep }));
vi.mock("near-api-js", () => ({
  Account: class {
    callFunctionRaw = async (call: unknown) => {
      if (chain.calls.push(call) === 1 && chain.failFirst) throw new Error("rpc down");
    };
  },
  teraToGas: (t: number) => BigInt(t) * 10n ** 12n,
}));
vi.mock("./chain.ts", () => ({
  ChainReader: class {
    constructor(
      _rpcUrl: string,
      readonly optionsId: string,
    ) {}
    networkId = async () => chain.network;
    settlementTerms = async () => ({ oracleWindowSec: WINDOW });
    seriesFrom = async (fromExpiry: number) => [series("BTC", EXPIRY)].filter((s) => s.expiry >= fromExpiry);
    settlement = async () => (++chain.settlementReads > chain.proposedAfter ? { price: "1" } : null);
  },
}));

const series = (underlying: string, expiry: number, kind: "call" | "put" = "call") =>
  ({ id: `${underlying}-${expiry}-${kind}`, underlying, kind, strike: "1", expiry, underlying_decimals: 8, width: "1" }) as Series;
const btc = { underlying: "BTC", expiry: EXPIRY };
const config = { rpcUrl: "http://rpc", optionsId: "opt.near", relayerId: "relayer.near", relayerPrivateKey: "ed25519:x" };

afterEach(() => {
  vi.restoreAllMocks();
  sleep.mockReset();
  Object.assign(chain, { network: "mainnet", proposedAfter: Infinity, settlementReads: 0, calls: [], failFirst: true });
});

describe("requests", () => {
  const all = [series("BTC", EXPIRY), series("BTC", EXPIRY, "put")];

  it("opens at expiry + 5 min and closes at expiry + oracle window, as the contract does", () => {
    expect(requests(all, new Set(), new Map(), EXPIRY + 299, WINDOW)).toEqual([]);
    expect(requests(all, new Set(), new Map(), EXPIRY + 300, WINDOW)).toEqual([btc]);
    expect(requests(all, new Set(), new Map(), EXPIRY + WINDOW - 1, WINDOW)).toEqual([btc]);
    expect(requests(all, new Set(), new Map(), EXPIRY + WINDOW, WINDOW)).toEqual([]);
  });

  it("retries a key only 10 min after its last request, and never once proposed", () => {
    const requested = new Map([[`BTC ${EXPIRY}`, EXPIRY + 300]]);
    expect(requests(all, new Set(), requested, EXPIRY + 899, WINDOW)).toEqual([]);
    expect(requests(all, new Set(), requested, EXPIRY + 900, WINDOW)).toEqual([btc]);
    expect(requests(all, new Set([`BTC ${EXPIRY}`]), new Map(), EXPIRY + 900, WINDOW)).toEqual([]);
  });

  it("requests nothing without a listed series", () => {
    expect(requests([], new Set(), new Map(), EXPIRY + 300, WINDOW)).toEqual([]);
  });
});

describe("settleCommand", () => {
  it("refuses to run against a testnet RPC, where the proposer settles", async () => {
    chain.network = "testnet";
    await expect(settleCommand(config, false)).rejects.toThrow(/mainnet only/);
    expect(chain.calls).toEqual([]);
  });

  it("requests every 10 min with 0.01 NEAR and 300 TGas until a price is proposed, a failed request included", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let nowSec = EXPIRY + 300;
    vi.spyOn(Date, "now").mockImplementation(() => nowSec * 1000);
    chain.proposedAfter = 2;
    sleep.mockImplementation(async () => {
      nowSec += 60;
      if (nowSec > EXPIRY + 300 + 3_600) throw new Error("stop");
    });

    await expect(settleCommand(config, false)).rejects.toThrow("stop");

    const call = { contractId: "opt.near", methodName: "request_settlement", args: btc, gas: 300n * 10n ** 12n, deposit: 10n ** 22n, waitUntil: "INCLUDED_FINAL" };
    expect(chain.calls).toEqual([call, call]);
    expect(error.mock.calls).toEqual([[`settle: BTC ${EXPIRY}: Error: rpc down`]]);
    expect(chain.settlementReads).toBe(3);
  });

  it("says so when a request that went through brought no price by the next try", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let nowSec = EXPIRY + 300;
    vi.spyOn(Date, "now").mockImplementation(() => nowSec * 1000);
    Object.assign(chain, { failFirst: false, proposedAfter: 2 });
    sleep.mockImplementation(async () => {
      nowSec += 60;
      if (nowSec > EXPIRY + 300 + 3_600) throw new Error("stop");
    });

    await expect(settleCommand(config, false)).rejects.toThrow("stop");

    expect(error.mock.calls).toEqual([[`settle: BTC ${EXPIRY}: no price 10 min after the last request (OutLayer failed or the contract logged "settlement rejected"), requesting again`]]);
  });
});
