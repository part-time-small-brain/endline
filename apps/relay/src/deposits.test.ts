import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Deposits } from "./deposits.ts";
import { DEPOSIT, SIGNED_QUOTE } from "./test-fakes.ts";

const NOW = Date.parse("2026-11-12T10:00:00Z");
const REQUEST = { ...DEPOSIT, deadline: new Date(NOW + 3 * 3_600_000).toISOString() };
const TOKENS = [{ assetId: DEPOSIT.originAsset, symbol: "SOL", blockchain: "sol", decimals: 9, price: 100 }];
const quoteAt = (address: string) => ({ ...SIGNED_QUOTE, quote: { ...SIGNED_QUOTE.quote, depositAddress: address } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function oneClick(statuses: Record<string, string | number>, tokens: unknown = TOKENS) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/tokens")) return typeof tokens === "number" ? new Response("", { status: tokens }) : Response.json(tokens);
    const status = statuses[new URL(url).searchParams.get("depositAddress") ?? ""] ?? "PENDING_DEPOSIT";
    return typeof status === "number" ? new Response("", { status }) : Response.json({ status, updatedAt: "" });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function setup(on = true) {
  const notifier = { on, post: vi.fn() };
  const deposits = new Deposits(notifier);
  const outcomes = () => notifier.post.mock.calls.map(([activity]) => `${activity.deposit.address} ${activity.outcome}`);
  return { notifier, deposits, outcomes };
}

const statusCalls = (fetch: ReturnType<typeof oneClick>) => fetch.mock.calls.filter(([url]) => url.includes("/status"));

describe("deposit tracker", () => {
  it.each(["SUCCESS", "REFUNDED", "FAILED"])("says nothing while a deposit is on its way and posts %s exactly once", async (final) => {
    const statuses: Record<string, string> = { A: "PENDING_DEPOSIT" };
    const fetch = oneClick(statuses);
    const { notifier, deposits, outcomes } = setup();
    deposits.track(REQUEST, quoteAt("A"));
    await vi.advanceTimersByTimeAsync(0);
    await deposits.poll();
    expect(notifier.post).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * 60_000);
    for (const status of ["KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", final, final]) {
      statuses.A = status;
      await deposits.poll();
    }
    expect(outcomes()).toEqual([`A ${final}`]);
    expect(notifier.post).toHaveBeenCalledWith({ kind: "deposit", outcome: final, deposit: expect.objectContaining({ address: "A", accountId: "alice.near", sent: "1.0 SOL on sol", amountOut: 100_305_978n }) });
    expect(statusCalls(fetch)).toHaveLength(5);
  });

  it("asks 1Click without our partner key, so status polls never eat into the deposit quote limit", async () => {
    const fetch = oneClick({});
    const { deposits } = setup();
    deposits.track(REQUEST, quoteAt("A"));
    await vi.advanceTimersByTimeAsync(0);
    await deposits.poll();
    expect(statusCalls(fetch)[0]).toEqual(["https://1click.chaindefuser.com/v0/status?depositAddress=A", expect.not.objectContaining({ headers: expect.anything() })]);
  });

  it("checks a deposit nothing has reached yet only every 2 minutes, one on its way every poll", async () => {
    const fetch = oneClick({ A: "PENDING_DEPOSIT", B: "PROCESSING" });
    const { deposits } = setup();
    deposits.track(REQUEST, quoteAt("A"));
    deposits.track(REQUEST, quoteAt("B"));
    await vi.advanceTimersByTimeAsync(0);
    await deposits.poll();
    vi.advanceTimersByTime(2 * 60_000 - 1);
    await deposits.poll();
    expect(statusCalls(fetch).map(([url]) => new URL(url).searchParams.get("depositAddress"))).toEqual(["A", "B", "B"]);
    vi.advanceTimersByTime(1);
    await deposits.poll();
    expect(statusCalls(fetch).map(([url]) => new URL(url).searchParams.get("depositAddress")).filter((a) => a === "A")).toHaveLength(2);
  });

  it("drops a deposit nothing reached an hour after its deadline without a word, also while 1Click is down, but keeps one on its way", async () => {
    const statuses: Record<string, string | number> = { A: 503, B: "PENDING_DEPOSIT", C: "PROCESSING" };
    const fetch = oneClick(statuses);
    const { deposits, outcomes } = setup();
    for (const address of ["A", "B", "C"]) deposits.track(REQUEST, quoteAt(address));
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.parse(REQUEST.deadline) + 3_600_001);
    await deposits.poll();
    const before = statusCalls(fetch).length;
    vi.advanceTimersByTime(10 * 60_000);
    statuses.C = "SUCCESS";
    await deposits.poll();
    expect(statusCalls(fetch).slice(before).map(([url]) => new URL(url).searchParams.get("depositAddress"))).toEqual(["C"]);
    expect(outcomes()).toEqual(["C SUCCESS"]);
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toMatch(/HTTP 503/);
  });

  it("makes room by dropping the oldest when it already follows 200 deposits", async () => {
    const fetch = oneClick({});
    const { deposits } = setup();
    for (let i = 0; i <= 200; i++) deposits.track(REQUEST, quoteAt(`D${i}`));
    await vi.advanceTimersByTimeAsync(0);
    await deposits.poll();
    const polled = statusCalls(fetch).map(([url]) => new URL(url).searchParams.get("depositAddress"));
    expect(polled).toHaveLength(200);
    expect(polled).not.toContain("D0");
    expect(polled).toContain("D200");
  });

  it("follows nothing and calls 1Click for nothing without a webhook", async () => {
    const fetch = oneClick({});
    const { notifier, deposits } = setup(false);
    deposits.track(REQUEST, quoteAt("A"));
    await vi.advanceTimersByTimeAsync(0);
    await deposits.poll();
    expect(fetch).not.toHaveBeenCalled();
    expect(notifier.post).not.toHaveBeenCalled();
  });

  it("asks 1Click about at most 3 deposits at a time", async () => {
    let inFlight = 0;
    let most = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/tokens")) return Response.json(TOKENS);
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight--;
      return Response.json({ status: "PROCESSING" });
    });
    const { deposits } = setup();
    for (const address of ["A", "B", "C", "D", "E", "F", "G"]) deposits.track(REQUEST, quoteAt(address));
    await vi.advanceTimersByTimeAsync(0);
    const poll = deposits.poll();
    await vi.advanceTimersByTimeAsync(300);
    await poll;
    expect(most).toBe(3);
  });

  it("names the token by its asset id while 1Click's token list is down, and asks for the list again next time", async () => {
    const fetch = oneClick({ A: "SUCCESS", B: "SUCCESS", C: "SUCCESS" }, 502);
    const { notifier, deposits } = setup();
    deposits.track(REQUEST, quoteAt("A"));
    deposits.track(REQUEST, quoteAt("B"));
    await vi.advanceTimersByTimeAsync(0);
    deposits.track(REQUEST, quoteAt("C"));
    await vi.advanceTimersByTimeAsync(0);
    await deposits.poll();
    expect(notifier.post.mock.calls.map(([activity]) => activity.deposit.sent)).toEqual(Array(3).fill(`1.0 ${DEPOSIT.originAsset}`));
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/tokens"))).toHaveLength(2);
  });
});
