import type { Quote } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { type CheckedQuote, type Phase, reduce, shouldPrefetch } from "./quoteMachine.ts";

const OPTION = "nep245:opt:BTC-27NOV26-110000_112000-C";
const quote = (premium: string, signBy: number, side: Quote["side"] = "buy"): CheckedQuote => ({
  quote_id: `${premium}-${signBy}`,
  series_id: "BTC-27NOV26-110000_112000-C",
  side,
  size: "1000000",
  premium,
  pay: { asset: "nep141:usdc", amount: premium },
  receive: { asset: OPTION, amount: "1000000" },
  sign_by_ms: signBy,
  payload: { standard: "erc191", payload: "{}" },
  legs: { pay: { asset: "nep141:usdc", amount: BigInt(premium) }, receive: { asset: OPTION, amount: 1_000_000n } },
  receivedAt: 0,
});

const live = (q: CheckedQuote): Phase => reduce({ name: "loading" }, { type: "quoted", quote: q, now: 0 });
const renew = (phase: Phase, next: CheckedQuote, now = 16_000) => reduce(reduce(phase, { type: "refresh" }), { type: "quoted", quote: next, now });

describe("quote countdown", () => {
  it("expires when the ring runs out", () => {
    const phase = live(quote("35000000", 20_000));
    expect(reduce(phase, { type: "tick", now: 19_999 }).name).toBe("live");
    expect(reduce(phase, { type: "tick", now: 20_000 }).name).toBe("expired");
  });

  it("freezes while the wallet is open and refuses a signature that lands after sign_by", () => {
    const signing = reduce(live(quote("35000000", 20_000)), { type: "sign" });
    expect(reduce(signing, { type: "tick", now: 25_000 })).toBe(signing);
    expect(reduce(signing, { type: "signed", now: 20_000 }).name).toBe("late");
    expect(reduce(signing, { type: "signed", now: 19_999 }).name).toBe("submitting");
  });

  it("drops back to expired if the wallet is closed after sign_by", () => {
    const signing = reduce(live(quote("35000000", 20_000)), { type: "sign" });
    expect(reduce(signing, { type: "cancelled", now: 21_000 }).name).toBe("expired");
    expect(reduce(signing, { type: "cancelled", now: 1_000 }).name).toBe("live");
  });

  it("swaps in a better requote or one at most 0.5% worse and says so", () => {
    for (const premium of ["34000000", "35175000"]) {
      const first = quote("35000000", 20_000);
      const next = quote(premium, 40_000);
      expect(renew(live(first), next)).toEqual({ name: "live", quote: next, refreshed: true, accepted: first });
    }
  });

  it("never auto-accepts a requote more than 0.5% worse", () => {
    const current = quote("35000000", 20_000);
    const next = quote("35175001", 40_000);
    const changed = renew(live(current), next);
    expect(changed).toEqual({ name: "changed", quote: current, next });
    expect(reduce(changed, { type: "sign" })).toBe(changed);
    expect(reduce(changed, { type: "accept", now: 17_000 })).toEqual({ name: "live", quote: next, refreshed: false, accepted: next });
  });

  it("judges a delayed renewal against the accepted price even after the old refresh expires", () => {
    const first = quote("35000000", 20_000);
    const refreshed = quote("35140000", 30_000);
    const pending = reduce(renew(live(first), refreshed), { type: "refresh" });
    const afterExpiry = reduce(pending, { type: "tick", now: 30_000 });
    expect(reduce(afterExpiry, { type: "quoted", quote: quote("35210000", 50_000), now: 31_000 })).toEqual({ name: "changed", quote: first, next: quote("35210000", 50_000) });
  });

  it("measures every requote against the price you last accepted, so small rises can't add up", () => {
    const first = quote("35000000", 20_000);
    const rises = ["35140000", "35175000", "35210000"].map((premium, i) => quote(premium, 40_000 + i));
    const [a, b, c] = rises.map((next) => (phase: Phase) => renew(phase, next));
    const afterTwo = b!(a!(live(first)));
    expect(afterTwo).toMatchObject({ name: "live", accepted: first });
    expect(c!(afterTwo)).toEqual({ name: "changed", quote: first, next: rises[2] });
  });

  it("asks again when renewal outlasts the old price and is worse", () => {
    const current = quote("35000000", 20_000);
    const refreshing = reduce(live(current), { type: "refresh" });
    const afterExpiry = reduce(refreshing, { type: "tick", now: 20_000 });
    expect(reduce(afterExpiry, { type: "quoted", quote: quote("36000000", 45_000), now: 21_000 }).name).toBe("changed");
  });

  it("treats a higher bid as better when cashing out", () => {
    const current = quote("20000000", 20_000, "sell");
    expect(renew(live(current), quote("19000000", 40_000, "sell")).name).toBe("changed");
    expect(renew(live(current), quote("21000000", 40_000, "sell")).name).toBe("live");
  });

  it("blocks signing as soon as renewal starts and never revives the old quote on failure", () => {
    const first = quote("35000000", 20_000);
    const refreshing = reduce(live(first), { type: "refresh" });
    expect(refreshing).toEqual({ name: "refreshing", accepted: first });
    expect(reduce(refreshing, { type: "sign" })).toBe(refreshing);
    expect(reduce(refreshing, { type: "unavailable", reason: "offline", short: false })).toEqual({ name: "unavailable", reason: "offline", short: false });
    expect(reduce(refreshing, { type: "quoted", quote: quote("36000000", 40_000), now: 16_000 }).name).toBe("changed");
    expect(reduce(refreshing, { type: "quoted", quote: quote("35000000", 15_000), now: 16_000 })).toEqual({ name: "expired", accepted: first });
  });

  it("keeps unresolved submissions tied to the same quote until checking resolves them", () => {
    const first = quote("35000000", 20_000);
    const submitting = reduce(reduce(live(first), { type: "sign" }), { type: "signed", now: 1 });
    const unknown = reduce(submitting, { type: "unknown" });
    expect(unknown).toEqual({ name: "unknown", quote: first });
    expect(reduce(unknown, { type: "request" })).toBe(unknown);
    expect(reduce(unknown, { type: "sign" })).toBe(unknown);
    expect(reduce(reduce(unknown, { type: "check" }), { type: "settled", txHash: "original" })).toEqual({ name: "done", txHash: "original" });
  });

  it("ignores requotes once signing has started", () => {
    const signing = reduce(live(quote("35000000", 20_000)), { type: "sign" });
    expect(reduce(signing, { type: "quoted", quote: quote("1", 40_000), now: 16_000 })).toBe(signing);
  });

  it("does not accept a changed price that has itself expired", () => {
    const changed = renew(live(quote("35000000", 20_000)), quote("40000000", 30_000));
    expect(reduce(changed, { type: "accept", now: 30_000 }).name).toBe("expired");
  });

  it("prefetches only in the last 5 seconds of a live quote", () => {
    const phase = live(quote("35000000", 20_000));
    expect(shouldPrefetch(phase, 14_999)).toBe(false);
    expect(shouldPrefetch(phase, 15_000)).toBe(true);
    expect(shouldPrefetch({ name: "signing", quote: quote("1", 20_000) }, 19_000)).toBe(false);
  });

  it("only reports done or failed for a submitted trade", () => {
    const submitting = reduce(reduce(live(quote("35000000", 20_000)), { type: "sign" }), { type: "signed", now: 1 });
    expect(reduce(submitting, { type: "failed", reason: "x" })).toEqual({ name: "failed", reason: "x" });
    expect(reduce({ name: "idle" }, { type: "settled", txHash: "h" })).toEqual({ name: "idle" });
  });
});
