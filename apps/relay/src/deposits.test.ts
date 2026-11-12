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
  const deposits = new Deposits("partner-jwt", notifier);
  const outcomes = () => notifier.post.mock.calls.map(([activity]) => `${activity.deposit.address} ${activity.outcome}`);
  return { notifier, deposits, outcomes };
}

describe("deposit tracker", () => {
  it.each(["SUCCESS", "REFUNDED", "FAILED"])("posts the issued address, waits through pending statuses and posts %s exactly once", async (final) => {
    const statuses: Record<string, string> = { A: "PENDING_DEPOSIT" };
    const fetch = oneClick(statuses);
    const { notifier, deposits, outcomes } = setup();
    deposits.track(REQUEST, quoteAt("A"));
    await vi.advanceTimersByTimeAsync(0);
    expect(notifier.post).toHaveBeenCalledWith({ kind: "deposit", outcome: "issued", deposit: expect.objectContaining({ address: "A", accountId: "alice.near", sent: "1.0 SOL on sol", amountOut: 100_305_978n }) });
    for (const status of ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", final, final]) {
      statuses.A = status;
      await deposits.poll();
    }
    expect(outcomes()).toEqual(["A issued", `A ${final}`]);
    const polled = fetch.mock.calls.filter(([url]) => url.includes("/status"));
    expect(polled).toHaveLength(5);
    expect(polled[0]).toEqual([`https://1click.chaindefuser.com/v0/status?depositAddress=A`, expect.objectContaining({ headers: { "x-api-key": "partner-jwt" } })]);
  });

  it("gives up an hour after the deadline with one notice, also while 1Click is down, and polls it no more", async () => {
    const fetch = oneClick({ A: 503, B: "PENDING_DEPOSIT" });
    const { deposits, outcomes } = setup();
    deposits.track(REQUEST, quoteAt("A"));
    deposits.track(REQUEST, quoteAt("B"));
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.parse(REQUEST.deadline) + 3_600_000);
    await deposits.poll();
    expect(outcomes()).toEqual(["A issued", "B issued"]);
    vi.setSystemTime(Date.parse(REQUEST.deadline) + 3_600_001);
    await deposits.poll();
    await deposits.poll();
    expect(outcomes()).toEqual(["A issued", "B issued", "A expired", "B expired"]);
    expect(fetch.mock.calls.filter(([url]) => url.includes("/status"))).toHaveLength(4);
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toMatch(/HTTP 503/);
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).not.toContain("partner-jwt");
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
    const fetch = oneClick({}, 502);
    const { notifier, deposits } = setup();
    deposits.track(REQUEST, quoteAt("A"));
    deposits.track(REQUEST, quoteAt("B"));
    await vi.advanceTimersByTimeAsync(0);
    deposits.track(REQUEST, quoteAt("C"));
    await vi.advanceTimersByTimeAsync(0);
    expect(notifier.post.mock.calls.map(([activity]) => activity.deposit.sent)).toEqual(Array(3).fill(`1.0 ${DEPOSIT.originAsset}`));
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/tokens"))).toHaveLength(2);
  });
});
