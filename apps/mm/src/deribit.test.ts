import { afterEach, describe, expect, it, vi } from "vitest";
import { settlementReferences } from "./deribit.ts";

const OCT_23_0800 = 1_792_742_400;
const MINUTE_EXPIRY = OCT_23_0800 + 3_660;

function serve(result: unknown, status = 200) {
  const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify({ result }), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

const at = (sec: number, price: number) => [sec * 1000, price];
const minutes = (count: number, price: number) => Array.from({ length: count }, (_, i) => at(MINUTE_EXPIRY - 60 * i, price));

describe("settlementReferences", () => {
  const deliveries = { data: [{ date: "2026-10-24", delivery_price: 80_705.19 }, { date: "2026-10-23", delivery_price: 81_594.54 }] };

  it("takes the delivery price of the expiry's UTC date for 08:00 expiries", async () => {
    const fetch = serve(deliveries);
    expect(await settlementReferences()("btc_usd", OCT_23_0800)).toBe(81_594.54);
    expect(fetch.mock.calls[0]?.[0]).toContain("/get_delivery_prices?index_name=btc_usd&offset=0&count=30");
  });

  it("has no reference when Deribit has no delivery for that date", async () => {
    serve(deliveries);
    expect(await settlementReferences()("btc_usd", OCT_23_0800 + 2 * 86_400)).toBeUndefined();
  });

  it("averages at least 25 index points in (expiry − 30 min, expiry] for any other expiry", async () => {
    const edges = [at(MINUTE_EXPIRY - 1_800, 1_000_000), at(MINUTE_EXPIRY + 60, 1_000_000)];
    const fetch = serve([...edges, at(MINUTE_EXPIRY, 200), ...minutes(25, 100).slice(1)]);
    expect(await settlementReferences()("eth_usd", MINUTE_EXPIRY)).toBe(104);
    expect(fetch.mock.calls[0]?.[0]).toContain("/get_index_chart_data?index_name=eth_usd&range=1d");
    serve([...edges, ...minutes(25, 100).slice(1)]);
    expect(await settlementReferences()("eth_usd", MINUTE_EXPIRY)).toBeUndefined();
  });

  it("fetches each index's data once per instance, however many expiries use it", async () => {
    const fetch = serve(minutes(25, 100));
    const reference = settlementReferences();
    await Promise.all([reference("btc_usd", MINUTE_EXPIRY), reference("btc_usd", MINUTE_EXPIRY - 60), reference("eth_usd", MINUTE_EXPIRY)]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("has no reference when the chart doesn't reach back to the expiry", async () => {
    serve([[(MINUTE_EXPIRY + 86_400) * 1000, 80_000]]);
    expect(await settlementReferences()("btc_usd", MINUTE_EXPIRY)).toBeUndefined();
  });

  it("throws on a failed or malformed response instead of returning a price", async () => {
    serve(null, 502);
    await expect(settlementReferences()("btc_usd", OCT_23_0800)).rejects.toThrow("HTTP 502");
    serve([[MINUTE_EXPIRY * 1000 - 60_000, 0]]);
    await expect(settlementReferences()("btc_usd", MINUTE_EXPIRY)).rejects.toThrow();
  });
});
