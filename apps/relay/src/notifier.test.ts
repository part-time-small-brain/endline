import type { Fill } from "@endline/sdk";
import { afterEach, beforeEach, expect, it, type MockInstance, vi } from "vitest";
import { Notifier } from "./notifier.ts";
import { fakeChain, SERIES } from "./test-fakes.ts";

const WEBHOOK = "https://api.telegram.org/bot123:secret-token/sendMessage?chat_id=-100";
const fill = (account: string): Fill => ({ quote_id: "q", series_id: SERIES.id, side: "buy", account_id: account, size: "500000", premium: "1880000", tx_hash: "tx", at_ms: 0 });
const trade = (account = "alice.near") => ({ kind: "trade" as const, fill: fill(account) });

let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.useFakeTimers();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function webhook(answer: (n: number) => Promise<Response> = async () => new Response("{}")) {
  const posted = vi.fn((_url: string, _init?: RequestInit) => answer(posted.mock.calls.length));
  vi.stubGlobal("fetch", posted);
  return posted;
}
const texts = (posted: ReturnType<typeof webhook>) => posted.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).text);
const logs = () => errors.mock.calls.flat().map(String).join("\n");

it("posts nothing and reads nothing without a webhook", async () => {
  const posted = webhook();
  const { chain } = fakeChain();
  const read = vi.spyOn(chain, "listSeries");
  const notifier = new Notifier(undefined, "mainnet", chain);
  notifier.post(trade());
  await vi.runAllTimersAsync();
  expect(notifier.on).toBe(false);
  expect(read).not.toHaveBeenCalled();
  expect(posted).not.toHaveBeenCalled();
});

it("sends a burst in order, 3 s apart to stay under Telegram's group limit", async () => {
  const posted = webhook();
  const notifier = new Notifier(WEBHOOK, "mainnet", fakeChain().chain);
  for (const account of ["a.near", "b.near", "c.near"]) notifier.post(trade(account));
  await vi.advanceTimersByTimeAsync(0);
  expect(posted).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2_999);
  expect(posted).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(posted).toHaveBeenCalledTimes(2);
  await vi.runAllTimersAsync();
  expect(texts(posted).map((text) => text.split(" · ")[2])).toEqual(["a.near", "b.near", "c.near"]);
  expect(posted.mock.calls[0]?.[0]).toBe(WEBHOOK);
});

it("keeps at most 50 waiting behind the one in flight and logs each dropped one", async () => {
  const posted = webhook();
  const notifier = new Notifier(WEBHOOK, "mainnet", fakeChain().chain);
  for (let i = 0; i < 60; i++) notifier.post(trade(`n${i}.near`));
  await vi.runAllTimersAsync();
  expect(posted).toHaveBeenCalledTimes(51);
  expect(texts(posted).at(-1)).toContain("n50.near");
  expect(errors.mock.calls.filter(([line]) => String(line).includes("dropped"))).toHaveLength(9);
});

it("logs a refused or unreachable webhook without its url or token and still sends the next message", async () => {
  const posted = webhook(async (n) => {
    if (n === 1) return new Response("", { status: 429 });
    if (n === 2) throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.telegram.org") });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }));
  });
  const notifier = new Notifier(WEBHOOK, "mainnet", fakeChain().chain);
  for (const account of ["a.near", "b.near", "c.near"]) notifier.post(trade(account));
  await vi.runAllTimersAsync();
  expect(posted).toHaveBeenCalledTimes(3);
  expect(posted.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  expect(logs()).toContain("HTTP 429");
  expect(logs()).toContain("fetch failed");
  expect(logs()).not.toContain("secret-token");
  expect(logs()).not.toContain("bot123");
});

it("logs an activity it can't describe and never throws to the caller", async () => {
  const posted = webhook();
  const { chain } = fakeChain();
  chain.listSeries = async () => {
    throw new Error("rpc down");
  };
  const notifier = new Notifier(WEBHOOK, "mainnet", chain);
  expect(() => notifier.post(trade())).not.toThrow();
  await vi.runAllTimersAsync();
  expect(posted).not.toHaveBeenCalled();
  expect(logs()).toContain("can't describe a trade");
});
