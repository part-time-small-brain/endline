import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutedRpcProvider, rpcUrls } from "./rpc.ts";

type Behaviour = { network?: string; status?: number | number[]; body?: unknown; hang?: boolean; drop?: boolean; delayMs?: number; statusProbe?: number };

function stubRpc(behaviours: Record<string, Behaviour>) {
  const calls: { url: string; host: string; method: string; headers: Record<string, string> }[] = [];
  const served: Record<string, number> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
      const host = new URL(url).host;
      const { method, id } = JSON.parse(init.body);
      calls.push({ url, host, method, headers: init.headers });
      const b = behaviours[host] ?? {};
      if (method === "status") {
        if (b.statusProbe) return new Response('{"message":"forbidden"}', { status: b.statusProbe });
        return Response.json({ jsonrpc: "2.0", id, result: { chain_id: b.network ?? "mainnet" } });
      }
      if (b.hang) return new Promise(() => {});
      if (b.drop) throw new TypeError("terminated");
      if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
      const n = served[host] ?? 0;
      served[host] = n + 1;
      const status = Array.isArray(b.status) ? b.status[n] : b.status;
      if (status && status !== 200) return new Response(`https://${host}/key-${host} unavailable`, { status });
      return Response.json(b.body ?? { jsonrpc: "2.0", id, result: { host } });
    }),
  );
  return calls;
}

const rpc = (...hosts: string[]) => ({ urls: hosts.map((h) => `https://${h}/key-${h}`), network: "mainnet" });
const block = async (p: RoutedRpcProvider) => (await p.sendJsonRpc("block", { finality: "final" })) as { host: string };
const sent = (calls: { host: string; method: string }[], method: string) => calls.filter((c) => c.method === method).map((c) => c.host);

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
    expect(sent(calls, "block").filter((h) => h === "a.rpc")).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("rpc a.rpc failed (429), cooling 2 s");
  });

  it("returns a chain's own error from the first endpoint instead of asking another", async () => {
    const calls = stubRpc({ "a.rpc": { body: { jsonrpc: "2.0", id: 1, error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT", info: {} }, code: -32000, message: "Server error", data: "account nope.near does not exist" } } } });
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn());
    await expect(p.viewAccount({ accountId: "nope.near" })).rejects.toMatchObject({ name: "AccountDoesNotExistError" });
    expect(sent(calls, "query")).toEqual(["a.rpc"]);
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

  it("skips an endpoint whose network check is refused, such as a revoked key, instead of failing every call", async () => {
    stubRpc({ "a.rpc": { statusProbe: 403 } });
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn());
    expect((await block(p)).host).toBe("b.rpc");
  });

  it("fails over on an answer that isn't the chain's: an unknown error body, a syncing node or a dropped connection", async () => {
    const odd = { jsonrpc: "2.0", id: 1, error: { code: 30, message: "Request timeout on the free tier" } };
    const syncing = { jsonrpc: "2.0", id: 1, error: { name: "HANDLER_ERROR", cause: { name: "NO_SYNCED_BLOCKS" }, code: -32000, message: "Server error" } };
    for (const a of [{ body: odd }, { body: syncing }, { drop: true }]) {
      stubRpc({ "a.rpc": a, "b.rpc": {} });
      expect((await block(new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn()))).host).toBe("b.rpc");
    }
  });

  it("keeps a contract's error a chain error even when its text reads like an endpoint failure", async () => {
    const panic = "wasm execution failed: rate limit, Unknown RPC error, NoSyncedBlocks";
    const calls = stubRpc({ "a.rpc": { body: { jsonrpc: "2.0", id: 1, result: { error: panic, logs: [] } } } });
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn());
    await expect(p.sendJsonRpc("query", { request_type: "call_function", finality: "final", account_id: "opt.near", method_name: "x", args_base64: "" })).rejects.toThrow(panic);
    expect(sent(calls, "query")).toEqual(["a.rpc"]);
  });

  it("moves on from an endpoint that hangs", async () => {
    vi.useFakeTimers();
    stubRpc({ "a.rpc": { hang: true } });
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn());
    const result = block(p);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await result).host).toBe("b.rpc");
  });

  it("retries a lone endpoint after its cooldown instead of failing on one 503", async () => {
    vi.useFakeTimers();
    const calls = stubRpc({ "a.rpc": { status: [503, 200] } });
    const result = block(new RoutedRpcProvider(rpc("a.rpc"), vi.fn()));
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await result).host).toBe("a.rpc");
    expect(sent(calls, "block")).toEqual(["a.rpc", "a.rpc"]);
  });

  it("throws the endpoint's host, never its key, once every endpoint failed", async () => {
    vi.useFakeTimers();
    stubRpc({ "a.rpc": { status: 503 }, "b.rpc": { status: 502 } });
    const log = vi.fn();
    const result = block(new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), log)).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await result;
    expect(error).toMatchObject({ name: "RpcEndpointError" });
    expect(String((error as Error).message)).toMatch(/^rpc [ab]\.rpc failed \(50[23]\)$/);
    expect(`${(error as Error).message} ${log.mock.calls.flat().join(" ")}`).not.toContain("key-");
  });

  it("never resends a transaction after an unclear failure, but does after a refusal", async () => {
    const tx = (p: RoutedRpcProvider) => p.sendJsonRpc("send_tx", { signed_tx_base64: "AA==", wait_until: "FINAL" });
    let calls = stubRpc({ "a.rpc": { status: 503 }, "b.rpc": {} });
    await expect(tx(new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn()))).rejects.toMatchObject({ name: "RpcEndpointError" });
    expect(sent(calls, "send_tx")).toEqual(["a.rpc"]);
    calls = stubRpc({ "a.rpc": { status: 429 }, "b.rpc": {} });
    expect(await tx(new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn()))).toEqual({ host: "b.rpc" });
    expect(sent(calls, "send_tx")).toEqual(["a.rpc", "b.rpc"]);
  });

  it("counts a burst of failures from one spike as one, so a busy endpoint isn't benched for minutes", async () => {
    stubRpc({ "a.rpc": { status: 429 } });
    const log = vi.fn();
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), log);
    await Promise.all(Array.from({ length: 10 }, () => block(p)));
    expect(log.mock.calls.flat().filter((m) => String(m).startsWith("rpc a.rpc"))).toEqual(["rpc a.rpc failed (429), cooling 2 s"]);
  });

  it("sends a key given in the URL fragment as a header, exactly as written, and never the fragment itself", async () => {
    const calls = stubRpc({});
    await block(new RoutedRpcProvider({ urls: ["https://h.rpc/full#x-api-key=a+b%2Fc==&x-other=1"], network: "mainnet" }, vi.fn()));
    expect(calls.at(-1)).toMatchObject({ url: "https://h.rpc/full", headers: expect.objectContaining({ "x-api-key": "a+b/c==", "x-other": "1" }) });
    for (const fragment of ["bad header=secret", "x-api-key=a%0Ab", "x-api-key=%E0%A4%A"]) {
      expect(() => rpcUrls("https://deploy.rpc", `https://h.rpc/full#${fragment}`)).toThrow(/h\.rpc has a (bad header|malformed #fragment)/);
      expect(() => rpcUrls("https://deploy.rpc", `https://h.rpc/full#${fragment}`)).not.toThrow(/secret|%0A|%E0/);
    }
  });

  it("tries each endpoint once, then sends traffic to the one that answered faster", async () => {
    stubRpc({ "a.rpc": { delayMs: 40 }, "b.rpc": {} });
    const p = new RoutedRpcProvider(rpc("a.rpc", "b.rpc"), vi.fn());
    const hosts = [];
    for (let i = 0; i < 4; i++) hosts.push((await block(p)).host);
    expect(hosts).toEqual(["a.rpc", "b.rpc", "b.rpc", "b.rpc"]);
  });
});
