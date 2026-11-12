import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import type { Series } from "@endline/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { due, parseFixing, proposeCommand, verifiedWasm } from "./propose.ts";

const pinned = vi.hoisted(() => ({ next: (): unknown => null }));
const listed = vi.hoisted(() => ({ series: [] as Series[], settlementReads: [] as unknown[], settled: true, network: "testnet" }));
const sleep = vi.hoisted(() => vi.fn());
const sent = vi.hoisted(() => [] as unknown[]);
const wasmOutput = vi.hoisted(() => ({ stdout: "" }));
const spawned = vi.hoisted(() => [] as { args: string[]; env: unknown }[]);
const inputs = vi.hoisted(() => [] as string[]);

vi.mock("node:timers/promises", () => ({ setTimeout: sleep }));
vi.mock("near-api-js", () => ({
  Account: class {
    callFunctionRaw = async (call: unknown) => {
      sent.push(call);
      return { transaction_outcome: { id: "tx" } };
    };
  },
  teraToGas: () => 0n,
}));
vi.mock("node:child_process", () => ({
  spawn: (_: string, args: string[], options: { env: unknown }) => {
    spawned.push({ args, env: options.env });
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
    child.stdin.on("data", (d) => inputs.push(String(d)));
    setImmediate(() => {
      child.stdout.emit("data", wasmOutput.stdout);
      child.emit("close", 0);
    });
    return child;
  },
}));
vi.mock("./chain.ts", () => ({
  ChainReader: class {
    constructor(
      _rpc: unknown,
      readonly optionsId: string,
    ) {}
    networkId = async () => listed.network;
    view = async () => pinned.next();
    settlementTerms = async () => ({ oracleWindowSec: 600, quoteDecimals: 6 });
    underlyings = async () => [];
    seriesFrom = async (fromExpiry: number) => listed.series.filter((s) => s.expiry >= fromExpiry);
    settlement = async (underlying: string, expiry: number) => {
      listed.settlementReads.push([underlying, expiry]);
      return listed.settled ? { price: "1" } : null;
    };
  },
}));

const EXPIRY = 1_800_000_000;
const WINDOW = 600;
const series = (underlying: string, expiry: number, kind: "call" | "put" = "call") =>
  ({ id: `${underlying}-${expiry}-${kind}`, underlying, kind, strike: "1", width: "1", expiry, underlying_decimals: 8 }) as Series;

describe("due", () => {
  it("opens exactly at expiry + oracle window, as the contract does", () => {
    const all = [series("BTC", EXPIRY)];
    expect(due(all, new Set(), EXPIRY + WINDOW - 1, WINDOW, 86_400)).toEqual([]);
    expect(due(all, new Set(), EXPIRY + WINDOW, WINDOW, 86_400)).toEqual([{ underlying: "BTC", expiry: EXPIRY }]);
  });

  it("proposes once per underlying and expiry, however many series share it", () => {
    const all = [series("BTC", EXPIRY), series("BTC", EXPIRY, "put"), series("ETH", EXPIRY)];
    expect(due(all, new Set(), EXPIRY + WINDOW, WINDOW, 86_400)).toEqual([
      { underlying: "BTC", expiry: EXPIRY },
      { underlying: "ETH", expiry: EXPIRY },
    ]);
  });

  it("skips settled expiries and gives up on ones older than a day", () => {
    const all = [series("BTC", EXPIRY), series("ETH", EXPIRY)];
    expect(due(all, new Set([`BTC ${EXPIRY}`]), EXPIRY + 86_399, WINDOW, 86_400)).toEqual([{ underlying: "ETH", expiry: EXPIRY }]);
    expect(due(all, new Set(), EXPIRY + 86_400, WINDOW, 86_400)).toEqual([]);
  });
});

describe("verifiedWasm", () => {
  const bytes = new TextEncoder().encode("wasm");
  const sha = createHash("sha256").update(bytes).digest("hex");

  it("runs only the exact wasm the contract pins", () => {
    expect(verifiedWasm(bytes, sha)).toBe(bytes);
    expect(() => verifiedWasm(new TextEncoder().encode("wasn"), sha)).toThrow(/contract pins/);
  });
});

describe("parseFixing", () => {
  it("accepts a fixing and refuses a zero, negative, decimal or missing price shape", () => {
    expect(parseFixing('{"ok":true,"price":"80329098539","source":"deribit_index"}').price).toBe("80329098539");
    expect(parseFixing('{"ok":false,"price":null,"source":"none"}').ok).toBe(false);
    for (const price of ['"0"', '"-1"', '"1.5"', '"01"', "80329"]) {
      expect(() => parseFixing(`{"ok":true,"price":${price},"source":"x"}`)).toThrow();
    }
    expect(() => parseFixing("not json")).toThrow();
  });
});

describe("proposeCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.assign(listed, { series: [], settlementReads: [], settled: true, network: "testnet" });
    sent.length = 0;
    spawned.length = 0;
    inputs.length = 0;
  });

  it("waits for a pinned wasm, then loads each new pin once", async () => {
    const wasms = ["a", "b"].map((body) => ({ body, sha256: createHash("sha256").update(body).digest("hex") }));
    const pins = [null, wasms[0], wasms[0], wasms[1], wasms[1]];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async (url: string) => new Response(url.slice(-1)));
    vi.stubGlobal("fetch", fetch);
    sleep.mockImplementation(async () => {
      if (sleep.mock.calls.length === pins.length) throw new Error("stop");
    });
    pinned.next = () => {
      const pin = pins[sleep.mock.calls.length];
      return pin && { url: `https://ipfs.example/${pin.body}`, sha256: pin.sha256 };
    };

    const config = { rpc: { urls: ["https://rpc"], network: "testnet" }, optionsId: "opt.testnet", oracleAccountId: "oracle.testnet", oraclePrivateKey: "ed25519:x", wasmtime: "wasmtime" };
    await expect(proposeCommand(config, false)).rejects.toThrow("stop");

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://ipfs.example/a", "https://ipfs.example/b"]);
    vi.unstubAllGlobals();
  });

  it("proposes the wasm's fixing with the one yocto the contract requires", async () => {
    const sha256 = createHash("sha256").update("a").digest("hex");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("a"));
    vi.spyOn(Date, "now").mockReturnValue((EXPIRY + WINDOW) * 1000);
    pinned.next = () => ({ url: "https://ipfs.example/a", sha256 });
    Object.assign(listed, { series: [series("BTC", EXPIRY)], settled: false });
    wasmOutput.stdout = '{"ok":true,"price":"80000000000","source":"cex_twap_median"}';

    await proposeCommand({ rpc: { urls: ["https://rpc"], network: "testnet" }, optionsId: "opt.testnet", oracleAccountId: "oracle.testnet", oraclePrivateKey: "ed25519:x", wasmtime: "wasmtime" }, true);

    expect(sent).toEqual([{ contractId: "opt.testnet", methodName: "propose_settlement", args: { underlying: "BTC", expiry: EXPIRY, price: "80000000000" }, gas: 0n, deposit: 1n }]);
    expect(spawned).toEqual([{ args: ["run", "-S", "http", "--env", `NEAR_BLOCK_TIMESTAMP=${BigInt((EXPIRY + WINDOW) * 1000) * 1_000_000n}`, expect.stringMatching(new RegExp(`^${tmpdir()}/oracle-\\w+/${sha256}\\.wasm$`))], env: { PATH: process.env.PATH } }]);
    expect(inputs.map((i) => JSON.parse(i))).toEqual([{ expiry: EXPIRY, quote_decimals: 6, max_dev_bps: 20 }]);
  });

  it("refuses a mainnet RPC, where OutLayer settles", async () => {
    listed.network = "mainnet";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(proposeCommand({ rpc: { urls: ["https://rpc"], network: "testnet" }, optionsId: "opt.near", oracleAccountId: "oracle.near", oraclePrivateKey: "ed25519:x", wasmtime: "wasmtime" }, true)).rejects.toThrow(/testnet only/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads the pinned wasm again when the cached file stops matching its sha256", async () => {
    const sha256 = createHash("sha256").update("a").digest("hex");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async () => new Response("a"));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(Date, "now").mockReturnValue((EXPIRY + WINDOW) * 1000);
    pinned.next = () => ({ url: "https://ipfs.example/a", sha256 });
    Object.assign(listed, { series: [series("BTC", EXPIRY)], settled: false });
    wasmOutput.stdout = '{"ok":false,"price":null,"source":"none"}';
    sleep.mockImplementation(async () => {
      if (sleep.mock.calls.length === 1) return writeFileSync(spawned[0]?.args.at(-1) ?? "", "tampered");
      if (sleep.mock.calls.length === 3) throw new Error("stop");
    });

    await expect(proposeCommand({ rpc: { urls: ["https://rpc"], network: "testnet" }, optionsId: "opt.testnet", oracleAccountId: "oracle.testnet", oraclePrivateKey: "ed25519:x", wasmtime: "wasmtime" }, false)).rejects.toThrow("stop");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("still checks an expiry a second short of a day old", async () => {
    const sha256 = createHash("sha256").update("a").digest("hex");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("a"));
    vi.spyOn(Date, "now").mockReturnValue((EXPIRY + 86_399) * 1000);
    pinned.next = () => ({ url: "https://ipfs.example/a", sha256 });
    listed.series = [series("BTC", EXPIRY)];

    await proposeCommand({ rpc: { urls: ["https://rpc"], network: "testnet" }, optionsId: "opt.testnet", oracleAccountId: "oracle.testnet", oraclePrivateKey: "ed25519:x", wasmtime: "wasmtime" }, true);

    expect(listed.settlementReads).toEqual([["BTC", EXPIRY]]);
  });
});
