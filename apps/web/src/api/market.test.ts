import { afterEach, describe, expect, it, vi } from "vitest";
import { chartPoints, deribitMarket } from "./market.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const serve = (body: (url: string) => unknown) => {
  const fetch = vi.fn(async (url: string) => {
    const value = body(url);
    return new Response(typeof value === "string" ? value : JSON.stringify(value));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("a hanging Deribit", () => {
  it("gives up after 5 s on both the spot and the chart, so the app stops showing old prices", async () => {
    const timers: [number, AbortController][] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      timers.push([ms, controller]);
      return controller.signal;
    });
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))));
    const pending = [deribitMarket().snapshot(["BTC"]), deribitMarket().history("BTC")];
    for (const request of pending) request.catch(() => {});
    expect(timers.map(([ms]) => ms)).toEqual([5_000, 5_000]);
    for (const [, controller] of timers) controller.abort(new Error("timed out"));
    for (const request of pending) await expect(request).rejects.toThrow("timed out");
  });
});

describe("chartPoints", () => {
  it("keeps a point every 5 minutes and always the latest, whatever the spacing it gets", () => {
    const minutes = Array.from({ length: 12 }, (_, i): [number, number] => [i * 60_000, 80_000 + i]);
    expect(chartPoints(minutes).map(([t]) => t / 60_000)).toEqual([0, 5, 10, 11]);
    const fives = Array.from({ length: 4 }, (_, i): [number, number] => [i * 300_000, 80_000 + i]);
    expect(chartPoints(fives)).toEqual(fives);
    expect(chartPoints([])).toEqual([]);
    const later = minutes.map(([t, p]): [number, number] => [t + 60_000, p]);
    expect(chartPoints(later).map(([t]) => t / 60_000)).toEqual([1, 5, 10, 12]);
  });
});

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
