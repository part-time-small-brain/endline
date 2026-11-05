import { afterEach, describe, expect, it, vi } from "vitest";
import { deribitMarket } from "./market.ts";

afterEach(() => vi.unstubAllGlobals());

const serve = (body: (url: string) => unknown) => {
  const fetch = vi.fn(async (url: string) => {
    const value = body(url);
    return new Response(typeof value === "string" ? value : JSON.stringify(value));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("history", () => {
  it("keeps every minute, since the final-round average needs them, asking for the right index", async () => {
    const points = Array.from({ length: 12 }, (_, i) => [i * 60_000, 80_000 + i]);
    const fetch = serve(() => ({ result: points }));
    const history = await deribitMarket().history("BTC");
    expect(fetch.mock.calls[0]?.[0]).toContain("index_name=btc_usd&range=1d");
    expect(history).toEqual(points);
  });

  it("returns a single point once, and nothing for an empty chart", async () => {
    serve(() => ({ result: [[5, 3_120]] }));
    expect(await deribitMarket().history("ETH")).toEqual([[5, 3_120]]);
    serve(() => ({ result: [] }));
    expect(await deribitMarket().history("ETH")).toEqual([]);
  });

  it("rejects junk instead of drawing it", async () => {
    for (const junk of ["<html>rate limited</html>", { error: { code: 10028 } }, { result: [[1, 0]] }, { result: [[1, -5]] }, { result: [[1, "80000"]] }, { result: [[1]] }]) {
      serve(() => junk);
      await expect(deribitMarket().history("BTC")).rejects.toThrow();
    }
  });
});

describe("snapshot", () => {
  const index = (prices: Record<string, unknown>) => (url: string) => {
    const name = new URL(url).searchParams.get("index_name") ?? "";
    return name in prices ? { result: { index_price: prices[name] } } : { error: "unknown index" };
  };

  it("keeps the assets that loaded when one has no data, so the others stay tradable", async () => {
    const fetch = serve(index({ eth_usd: 3_120 }));
    expect(await deribitMarket().snapshot(["BTC", "ETH"])).toEqual({ spot: { ETH: 3_120 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails when no asset loads, so the app can show an error instead of loading forever", async () => {
    serve(() => "<html>down</html>");
    await expect(deribitMarket().snapshot(["BTC", "ETH"])).rejects.toThrow();
  });
});
