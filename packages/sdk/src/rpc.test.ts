import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutedRpcProvider, rpcUrls } from "./rpc.ts";

type Behaviour = { network?: string; status?: number; body?: unknown; hang?: boolean; delayMs?: number };

function stubRpc(behaviours: Record<string, Behaviour>) {
  const calls: { host: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      const host = new URL(url).host;
      const { method, id } = JSON.parse(init.body);
      calls.push({ host, method });
      const b = behaviours[host] ?? {};
      if (method === "status") return Response.json({ jsonrpc: "2.0", id, result: { chain_id: b.network ?? "mainnet" } });
      if (b.hang) return new Promise(() => {});
      if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
      if (b.status && b.status !== 200) return new Response('{"error":{"code":-429,"message":"Rate limits exceeded"}}', { status: b.status });
      return Response.json(b.body ?? { jsonrpc: "2.0", id, result: { host } });
    }),
  );
  return calls;
}

const rpc = (...hosts: string[]) => ({ urls: hosts.map((h) => `https://${h}/key-${h}`), network: "mainnet" });
const block = async (p: RoutedRpcProvider) => (await p.sendJsonRpc("block", { finality: "final" })) as { host: string };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("rpcUrls", () => {
  it("puts listed endpoints first, the deploy file's last, without duplicates", () => {
    expect(rpcUrls("https://deploy.rpc", " https://a.rpc/k1, ,https://deploy.rpc,https://b.rpc/k2 ")).toEqual(["https://a.rpc/k1", "https://deploy.rpc", "https://b.rpc/k2"]);
    expect(rpcUrls("https://deploy.rpc", undefined)).toEqual(["https://deploy.rpc"]);
  });

  it("refuses a non-https entry without echoing its key", () => {
    expect(() => rpcUrls("https://deploy.rpc", "http://plain.rpc/secret-key")).toThrow(/plain\.rpc/);
    expect(() => rpcUrls("https://deploy.rpc", "http://plain.rpc/secret-key")).not.toThrow(/secret-key/);
  });
});

describe("RoutedRpcProvider", () => {
  it("moves past a rate-limited endpoint and keeps it cooling on the next call", async () => {
    const calls = stubRpc({ "a.rpc": { status: 429 } });
    const log = vi.fn();
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), log);
    expect((await block(p)).host).toBe("b.rpc");
    expect((await block(p)).host).toBe("b.rpc");
    expect(calls.filter((c) => c.host === "a.rpc" && c.method === "block")).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^rpc a\.rpc failed \(429\), cooling 2 s$/));
  });

  it("returns a chain's own error from the first endpoint instead of asking another", async () => {
    const calls = stubRpc({ "a.rpc": { body: { jsonrpc: "2.0", id: 1, error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT", info: {} }, code: -32000, message: "Server error", data: "account nope.near does not exist" } } } });
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn());
    await expect(block(p)).rejects.toThrow();
    expect(calls.filter((c) => c.method === "block").map((c) => c.host)).toEqual(["a.rpc"]);
  });

  it("never sends a request to an endpoint on another network", async () => {
    const calls = stubRpc({ "a.rpc": { network: "testnet" } });
    const log = vi.fn();
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), log);
    expect((await block(p)).host).toBe("b.rpc");
    expect((await block(p)).host).toBe("b.rpc");
    expect(calls.filter((c) => c.host === "a.rpc").map((c) => c.method)).toEqual(["status"]);
    expect(log).toHaveBeenCalledWith("rpc a.rpc is on testnet, not mainnet: never used");
  });

  it("moves on from an endpoint that hangs", async () => {
    vi.useFakeTimers();
    stubRpc({ "a.rpc": { hang: true } });
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn());
    const result = block(p);
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await result).host).toBe("b.rpc");
  });

  it("still tries the endpoint that recovers soonest when every one is cooling", async () => {
    const calls = stubRpc({ "a.rpc": { status: 503 }, "b.rpc": { status: 429 } });
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn());
    await expect(block(p)).rejects.toThrow();
    await expect(block(p)).rejects.toThrow();
    expect(calls.filter((c) => c.method === "block")).toHaveLength(4);
  });

  it("logs hosts, never the key in the path", async () => {
    stubRpc({ "a.rpc": { status: 429 } });
    const log = vi.fn();
    await block(new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), log));
    expect(log.mock.calls.flat().join(" ")).not.toContain("key-");
  });

  it("tries each endpoint once, then sends traffic to the one that answered faster", async () => {
    stubRpc({ "a.rpc": { delayMs: 40 }, "b.rpc": {} });
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn());
    const hosts = [];
    for (let i = 0; i < 4; i++) hosts.push((await block(p)).host);
    expect(hosts).toEqual(["a.rpc", "b.rpc", "b.rpc", "b.rpc"]);
  });
});
