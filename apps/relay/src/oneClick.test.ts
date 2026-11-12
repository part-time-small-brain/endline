import { afterEach, expect, it, vi } from "vitest";
import { OneClick } from "./oneClick.ts";
import { HttpError } from "./relay.ts";
import { DEPOSIT, SIGNED_QUOTE } from "./test-fakes.ts";

const USDC = DEPOSIT.destinationAsset;
const HOUR_MS = 3_600_000;
const CLIENT = "1.2.3.4";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function upstream(status: number, body: string) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function failure(oneClick: OneClick, deposit: object = DEPOSIT, client = CLIENT): Promise<HttpError> {
  const error = await oneClick.quote(oneClick.schema.parse(deposit), client).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

it("forwards a deposit quote with the partner key and returns 1Click's signed quote", async () => {
  const oneClick = new OneClick(USDC, "partner-jwt");
  const fetch = upstream(201, JSON.stringify(SIGNED_QUOTE));
  expect(await oneClick.quote(oneClick.schema.parse(DEPOSIT), CLIENT)).toEqual(SIGNED_QUOTE);
  const [url, init] = fetch.mock.calls[0] ?? [];
  expect(url).toBe("https://1click.chaindefuser.com/v0/quote");
  expect(init?.headers).toEqual({ "content-type": "application/json", "x-api-key": "partner-jwt" });
  expect(JSON.parse(String(init?.body))).toEqual(DEPOSIT);
});

it("sends no key header without a partner key", async () => {
  const fetch = upstream(200, JSON.stringify(SIGNED_QUOTE));
  const oneClick = new OneClick(USDC, undefined);
  await oneClick.quote(oneClick.schema.parse(DEPOSIT), CLIENT);
  expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ "content-type": "application/json" });
});

it.each([
  [400, JSON.stringify({ message: "Amount is too low for bridge" }), 400, "Amount is too low for bridge"],
  [401, JSON.stringify({ message: "Invalid token", statusCode: 401 }), 502, "deposits are unavailable"],
  [429, JSON.stringify({ message: "Too many requests" }), 503, "1Click is busy"],
  [500, JSON.stringify({ message: "Internal error" }), 502, "deposits are unavailable"],
  [200, "<html>ok</html>", 502, "deposits are unavailable"],
])("answers 1Click's HTTP %i as the relay's own error", async (status, body, relayStatus, message) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  upstream(status, body);
  const error = await failure(new OneClick(USDC, "partner-jwt"));
  expect([error.status, error.message]).toEqual([relayStatus, expect.stringContaining(message)]);
});

it.each([
  ["a tampered deposit address", { ...SIGNED_QUOTE, quote: { ...SIGNED_QUOTE.quote, depositAddress: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } }, DEPOSIT],
  ["a tampered timestamp", { ...SIGNED_QUOTE, timestamp: "2026-10-27T13:43:33.321Z" }, DEPOSIT],
  ["no signature", { ...SIGNED_QUOTE, signature: undefined }, DEPOSIT],
  ["a truncated signature", { ...SIGNED_QUOTE, signature: SIGNED_QUOTE.signature.slice(0, -1) }, DEPOSIT],
  ["a quote 1Click signed for another recipient", SIGNED_QUOTE, { ...DEPOSIT, refundTo: "bob.near", recipient: "bob.near" }],
])("answers 502 for %s", async (_, response, deposit) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  upstream(201, JSON.stringify(response));
  const error = await failure(new OneClick(USDC, "partner-jwt"), deposit);
  expect([error.status, error.message]).toEqual([502, expect.stringContaining("deposits are unavailable")]);
});

it("answers 502 when 1Click is unreachable", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
  expect((await failure(new OneClick(USDC, "partner-jwt"))).status).toBe(502);
});

it("caps quotes across all clients so many IPs can't burn the key", async () => {
  const fetch = upstream(200, JSON.stringify(SIGNED_QUOTE));
  const oneClick = new OneClick(USDC, "partner-jwt");
  for (let i = 0; i < 60; i++) await oneClick.quote(oneClick.schema.parse(DEPOSIT), `10.0.0.${i}`);
  expect((await failure(oneClick, DEPOSIT, "10.0.1.0")).status).toBe(503);
  expect(fetch).toHaveBeenCalledTimes(60);
});

it("caps each client at 10 quotes a minute before the shared cap, so one client can't block the rest", async () => {
  const fetch = upstream(200, JSON.stringify(SIGNED_QUOTE));
  const oneClick = new OneClick(USDC, "partner-jwt");
  for (let i = 0; i < 10; i++) await oneClick.quote(oneClick.schema.parse(DEPOSIT), CLIENT);
  for (let i = 0; i < 60; i++) expect((await failure(oneClick)).status).toBe(429);
  expect(await oneClick.quote(oneClick.schema.parse(DEPOSIT), "5.6.7.8")).toEqual(SIGNED_QUOTE);
  expect(fetch).toHaveBeenCalledTimes(11);
});

it("gives a client its slot back when the shared cap refuses it, so it isn't blamed for others", async () => {
  upstream(200, JSON.stringify(SIGNED_QUOTE));
  const oneClick = new OneClick(USDC, "partner-jwt");
  for (let i = 0; i < 60; i++) await oneClick.quote(oneClick.schema.parse(DEPOSIT), `10.0.0.${i}`);
  for (let i = 0; i < 20; i++) expect((await failure(oneClick)).status).toBe(503);
});

it.each([
  ["a NEP-141", "nep141:sol.omft.near"],
  ["a HOT omni NEP-245", "nep245:v2_1.omni.hot.tg:10_11111111111111111111"],
  ["a 1cs_v1", "1cs_v1:aptos:aptos-fa:0x0b0b819dcf8d9517ed14195a95adfae6a49bfdb49de33a532ca0aa7ee588e8e0"],
])("accepts %s origin asset", (_, originAsset) => {
  expect(new OneClick(USDC, "partner-jwt").schema.safeParse({ ...DEPOSIT, originAsset }).success).toBe(true);
});

it.each([
  ["an app fee paid to someone else under our key", { appFees: [{ recipient: "mallory.near", fee: 100 }] }],
  ["a rebate to someone else", { rebates: [{ recipient: "mallory.near", fee: 10 }] }],
  ["a referral tag", { referral: "mallory" }],
  ["a swap into anything but the quote asset", { destinationAsset: "nep141:wrap.near" }],
  ["a recipient other than the refund account", { recipient: "mallory.near" }],
  ["a payout outside intents", { recipientType: "DESTINATION_CHAIN", recipient: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" }],
  ["a refund to the origin chain", { refundType: "ORIGIN_CHAIN" }],
  ["a deposit from intents", { depositType: "INTENTS" }],
  ["an origin asset of an unknown kind", { originAsset: "nep171:v2_1.omni.hot.tg:56_11111111111111111111" }],
  ["an origin asset with a lookalike prefix", { originAsset: "xnep141:sol.omft.near" }],
  ["a dry quote", { dry: true }],
  ["an exact-output swap", { swapType: "EXACT_OUTPUT" }],
  ["slippage over 1%", { slippageTolerance: 101 }],
  ["a zero amount", { amount: "0" }],
  ["a padded amount", { amount: "01" }],
  ["a non-integer amount", { amount: "1.5" }],
  ["a bad deadline", { deadline: "tomorrow" }],
  ["a past deadline", { deadline: new Date(Date.now() - 1_000).toISOString() }],
  ["a deadline over 24 h out", { deadline: new Date(Date.now() + 25 * HOUR_MS).toISOString() }],
])("refuses %s", (_, change) => {
  expect(new OneClick(USDC, "partner-jwt").schema.safeParse({ ...DEPOSIT, ...change }).success).toBe(false);
});
