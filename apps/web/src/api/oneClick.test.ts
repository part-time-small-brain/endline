import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../../../testdata/oneclick-quote.json" with { type: "json" };
import { oneClick } from "./oneClick.ts";

afterEach(() => vi.unstubAllGlobals());

const asset = { assetId: fixture.request.originAsset, symbol: "SOL", blockchain: "sol", decimals: 9, price: 100.54 };
const ask = () => oneClick("https://app.test/").quote(asset, BigInt(fixture.request.amount), fixture.request.recipient, fixture.request.destinationAsset);
const relayAnswers = (body: unknown) => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

it("asks the relay for the quote so the partner key stays server side, and shows it once 1Click's signature checks out", async () => {
  const fetch = relayAnswers(fixture.response);
  const { depositAddress, amountIn, amountOut, timeEstimate, deadline: addressDeadline } = fixture.response.quote;
  expect(await ask()).toEqual({ depositAddress, amountIn, amountOut, timeEstimate, deadline: addressDeadline });
  const [url, init] = fetch.mock.calls[0] ?? [];
  expect(url).toBe("https://app.test/deposit-quote");
  expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
  const { deadline, ...body } = JSON.parse(String(init?.body));
  expect(body).toEqual(fixture.request);
  const ahead = Date.parse(deadline) - Date.now();
  expect(ahead).toBeGreaterThan(0);
  expect(ahead).toBeLessThanOrEqual(24 * 60 * 60_000);
});

it.each([
  ["loses more than 3% on the way, as an unsigned fee added by the relay would", { amountOutUsd: "97.5" }, "more than 3%"],
  ["has no USD price to measure the loss by", { amountInUsd: "" }, "more than 3%"],
  ["needs a deposit memo the sheet doesn't show", { depositMemo: "123" }, "memo"],
])("refuses a quote that %s", async (_, change, message) => {
  relayAnswers({ ...fixture.response, quote: { ...fixture.response.quote, ...change } });
  await expect(ask()).rejects.toThrow(message);
});

it("refuses a malformed quote with the same plain message, not a parser dump", async () => {
  relayAnswers({ quote: {} });
  await expect(ask()).rejects.toThrow("The deposit quote failed its signature check, so it isn't shown.");
});

it("refuses a quote with no address deadline, since the sheet couldn't say when the address stops working", async () => {
  const { deadline: _, ...quote } = fixture.response.quote;
  relayAnswers({ ...fixture.response, quote });
  await expect(ask()).rejects.toThrow("signature check");
});

it("refuses a quote whose deposit address the relay swapped", async () => {
  relayAnswers({ ...fixture.response, quote: { ...fixture.response.quote, depositAddress: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } });
  await expect(ask()).rejects.toThrow("signature check");
});

it("shows the relay's reason when a quote is refused", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Amount is too low for bridge" }), { status: 400 })));
  await expect(oneClick("https://app.test").quote(asset, 1n, "alice.near", "nep141:usdc.near")).rejects.toThrow("Amount is too low for bridge");
});

it("still reads tokens and deposit status straight from 1Click", async () => {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/status") ? { status: "SUCCESS" } : [asset]), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const client = oneClick("https://app.test");
  await client.assets();
  expect(await client.status("0xdep")).toBe("SUCCESS");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://1click.chaindefuser.com/v0/tokens", "https://1click.chaindefuser.com/v0/status?depositAddress=0xdep"]);
});
