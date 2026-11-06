import { afterEach, expect, it, vi } from "vitest";
import { finalStatus, httpRelay, RelayError, refusedOr } from "./relay.ts";

afterEach(() => vi.unstubAllGlobals());

it("keeps the relay's HTTP status and message on an error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "session refused: invalid signature" }), { status: 401 })));
  const error = await httpRelay("http://relay.test").listing().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RelayError);
  expect(error).toMatchObject({ status: 401, message: "session refused: invalid signature" });
});

it("refusedOr keeps a relay refusal and never passes on a 5xx or network error as if nothing moved", async () => {
  const refused = new RelayError("an earlier payload from this account is still being sent", 409);
  await expect(refusedOr(Promise.reject(refused), "unconfirmed")).rejects.toBe(refused);
  await expect(refusedOr(Promise.reject(new RelayError("relay returned 524", 524)), "unconfirmed")).rejects.toThrow(/^unconfirmed$/);
  await expect(refusedOr(Promise.reject(new TypeError("Failed to fetch")), "unconfirmed")).rejects.toThrow(/^unconfirmed$/);
  await expect(refusedOr(Promise.resolve(""), "unconfirmed")).resolves.toBe("");
});

it("asks the faucet for the account and surfaces its limit", async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ error: "this account already got test USDC in the last 24 hours" }), { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  const error = await httpRelay("http://relay.test").faucet("0xabc").catch((e: unknown) => e);
  expect(fetch).toHaveBeenCalledWith("http://relay.test/faucet", expect.objectContaining({ method: "POST", body: JSON.stringify({ account_id: "0xabc" }) }));
  expect(error).toMatchObject({ status: 429, message: "this account already got test USDC in the last 24 hours" });
});

it("finalStatus keeps polling a settling trade, returns only a final status for that quote, and gives up at its deadline", async () => {
  vi.useFakeTimers();
  try {
    const answers = [{ quote_id: "other", status: "settled" as const }, { quote_id: "q", status: "settling" as const }, { quote_id: "q", status: "settled" as const, tx_hash: "tx" }];
    const relay = { status: vi.fn(async () => answers.shift() ?? { quote_id: "q", status: "settling" as const }) };
    const settled = finalStatus(relay, "q", { quote_id: "q", status: "settling" }, Date.now() + 60_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(settled).resolves.toEqual({ quote_id: "q", status: "settled", tx_hash: "tx" });

    const stuck = finalStatus(relay, "q", undefined, Date.now() + 5_000);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(stuck).resolves.toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it("asks for an account's free calls and its standing at their own paths, and refuses a reply that isn't one", async () => {
  const board = { round: "2026-11-05", today: [{ account_id: "a.near", rank: 1, points: 400, wins: 1, streak: 2 }], week: [], you: { today: null, week: null } };
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/leaderboard") ? board : [{ bad: true }])));
  vi.stubGlobal("fetch", fetch);
  const relay = httpRelay("http://relay.test");
  await expect(relay.leaderboard("0xabc")).resolves.toEqual(board);
  await expect(relay.calls("0xabc")).rejects.toBeInstanceOf(RelayError);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["http://relay.test/leaderboard/0xabc", "http://relay.test/calls/0xabc"]);
});
