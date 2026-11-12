import { afterEach, expect, it, vi } from "vitest";
import { rpcChain } from "./chain.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const views: Record<string, unknown> = {
  get_config: { owner_id: "owner.near", intents_id: "intents.near", quote_asset: "nep141:usdc.near", quote_decimals: 6, timing: { period_sec: 86_400, offset_sec: 28_800, write_cutoff_sec: 1_800 }, paused: false },
  get_underlyings: [
    ["BTC", { index: "btc_usd", decimals: 8, min_write: "1000" }],
    ["ETH", { index: "eth_usd", decimals: 18, min_write: "1000000000000" }],
  ],
};

it("reads the cutoff, USDC decimals and each underlying's option decimals from the contract", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { params } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ result: { result: [...new TextEncoder().encode(JSON.stringify(views[params.method_name]))] } }));
    }),
  );
  expect(await rpcChain(["https://rpc.test"], "intents.near", "opt.near").contract()).toEqual({
    timing: { write_cutoff_sec: 1_800 },
    quoteDecimals: 6,
    decimals: { BTC: 8, ETH: 18 },
  });
});

const answer = (body: unknown) => new Response(JSON.stringify(body));
const salt = { result: { result: [...new TextEncoder().encode(JSON.stringify("0a0b0c0d"))] } };

it("moves to the next endpoint when one rate-limits, errors, hangs up or sends garbage", async () => {
  const asked: string[] = [];
  const replies: Record<string, () => Response> = {
    "https://a.rpc": () => new Response('{"error":"Rate limits exceeded"}', { status: 429 }),
    "https://b.rpc": () => answer({ jsonrpc: "2.0", error: { code: -32000, message: "Server error" } }),
    "https://c.rpc": () => {
      throw new TypeError("Failed to fetch");
    },
    "https://d.rpc": () => new Response("<html>bad gateway</html>", { status: 502 }),
    "https://e.rpc": () => answer(salt),
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (asked.push(url), replies[url]!())));
  expect(await rpcChain(Object.keys(replies), "intents.near", "opt.near").salt()).toEqual(Uint8Array.from([10, 11, 12, 13]));
  expect(asked).toEqual(Object.keys(replies));
});

it("returns a contract's own error from the first endpoint instead of asking the next", async () => {
  const fetch = vi.fn(async () => answer({ result: { error: "wasm execution failed: no such method" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(rpcChain(["https://a.rpc", "https://b.rpc"], "intents.near", "opt.near").salt()).rejects.toThrow("wasm execution failed: no such method");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("shows a plain message, never a provider's upsell, when no endpoint answers", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"Rate limits exceeded. For higher rate limits get a subscription"}', { status: 429 })));
  await expect(rpcChain(["https://a.rpc", "https://b.rpc"], "intents.near", "opt.near").contract()).rejects.toThrow("NEAR isn't answering right now. Try again in a minute.");
});

it("gives up on an endpoint after 5 s and starts from the one that answered next time", async () => {
  const timers: AbortController[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    expect(ms).toBe(5_000);
    const controller = new AbortController();
    timers.push(controller);
    return controller.signal;
  });
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      asked.push(url);
      if (url === "https://b.rpc") return Promise.resolve(answer(salt));
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    }),
  );
  const chain = rpcChain(["https://a.rpc", "https://b.rpc"], "intents.near", "opt.near");
  const first = chain.salt();
  await vi.waitFor(() => expect(timers).toHaveLength(1));
  timers[0]?.abort(new Error("timed out"));
  expect(await first).toEqual(Uint8Array.from([10, 11, 12, 13]));
  await chain.salt();
  expect(asked).toEqual(["https://a.rpc", "https://b.rpc", "https://b.rpc"]);
});
