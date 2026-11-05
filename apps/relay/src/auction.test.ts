import type { QuoteResponse } from "@endline/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Auctions, MAX_WAIT_MS, MIN_WAIT_MS } from "./auction.ts";
import type { Bid } from "./bid.ts";
import { event } from "./test-fakes.ts";

const reply = (quoteId: string, premium: string) => ({ quote_id: quoteId, premium, signed: { standard: "nep413" } }) as QuoteResponse;

function auctions(invalid: string[] = []) {
  return new Auctions(async (_, mmId, response) => {
    if (invalid.includes(mmId)) throw new Error("invalid");
    return { mmId, premium: BigInt(response.premium), deadlineMs: 0, signed: response.signed } as Bid;
  });
}

describe("auction", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("buyer gets the lowest premium, seller the highest", async () => {
    for (const [side, winner] of [["buy", "b"], ["sell", "c"]] as const) {
      const a = auctions();
      const e = event(side);
      const result = a.run(e, ["a", "b", "c"]);
      a.respond("a", reply(e.quote_id, "200"));
      a.respond("b", reply(e.quote_id, "100"));
      a.respond("c", reply(e.quote_id, "300"));
      await vi.advanceTimersByTimeAsync(MIN_WAIT_MS);
      expect((await result)?.mmId).toBe(winner);
    }
  });

  it("breaks ties by arrival", async () => {
    const a = auctions();
    const e = event("buy");
    const result = a.run(e, ["late", "early"]);
    a.respond("early", reply(e.quote_id, "100"));
    a.respond("late", reply(e.quote_id, "100"));
    await vi.advanceTimersByTimeAsync(MIN_WAIT_MS);
    expect((await result)?.mmId).toBe("early");
  });

  it("falls back to the next price when the best quote is invalid", async () => {
    const a = auctions(["cheap"]);
    const e = event("buy");
    const result = a.run(e, ["cheap", "fair"]);
    a.respond("cheap", reply(e.quote_id, "1"));
    a.respond("fair", reply(e.quote_id, "100"));
    await vi.advanceTimersByTimeAsync(MIN_WAIT_MS);
    expect((await result)?.mmId).toBe("fair");
  });

  it("ignores uninvited MMs, second answers and answers for other quotes", async () => {
    const a = auctions();
    const e = event("buy");
    const result = a.run(e, ["a"]);
    a.respond("a", reply(e.quote_id, "100"));
    a.respond("a", reply(e.quote_id, "1"));
    a.respond("stranger", reply(e.quote_id, "1"));
    a.respond("a", reply("other", "1"));
    await vi.advanceTimersByTimeAsync(MIN_WAIT_MS);
    expect((await result)?.premium).toBe(100n);
  });

  it("never closes before the minimum wait, even when everyone answered", async () => {
    const a = auctions();
    const e = event("buy");
    let done = false;
    void a.run(e, ["a"]).then(() => (done = true));
    a.respond("a", reply(e.quote_id, "100"));
    await vi.advanceTimersByTimeAsync(MIN_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("waits for silent MMs until the maximum, then drops late answers", async () => {
    const a = auctions();
    const e = event("buy");
    const result = a.run(e, ["fast", "slow"]);
    a.respond("fast", reply(e.quote_id, "200"));
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS);
    a.respond("slow", reply(e.quote_id, "1"));
    expect((await result)?.mmId).toBe("fast");
  });
});
