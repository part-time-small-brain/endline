import { afterEach, expect, it, vi } from "vitest";
import { rpcChain } from "./chain.ts";

afterEach(() => vi.unstubAllGlobals());

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
  expect(await rpcChain("https://rpc.test", "intents.near", "opt.near").contract()).toEqual({
    timing: { write_cutoff_sec: 1_800 },
    quoteDecimals: 6,
    decimals: { BTC: 8, ETH: 18 },
  });
});
