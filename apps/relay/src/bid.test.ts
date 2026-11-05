import { describe, expect, it } from "vitest";
import { checkBid } from "./bid.ts";
import { event, fakeChain, INTENTS, mmSigned, OPTION, USDC } from "./test-fakes.ts";

const PREMIUM = 15_000_000n;

function check(signed: unknown, receivedAt = Date.now()) {
  const e = event("buy");
  return checkBid(fakeChain().chain, INTENTS, e, "mm1", { quote_id: e.quote_id, premium: PREMIUM.toString(), signed: signed as never }, receivedAt);
}

describe("checkBid", () => {
  it.each([
    ["a naively mirrored diff (no fee gross-up)", { [USDC]: PREMIUM, [OPTION]: -1_000_000n }],
    ["one unit short on the option leg", { [USDC]: 14_999_985n, [OPTION]: -1_000_000n }],
    ["a premium different from the one quoted", { [USDC]: 13_999_986n, [OPTION]: -1_000_001n }],
    ["a foreign asset", { "nep141:fake.test": 14_999_985n, [OPTION]: -1_000_001n }],
    ["an extra asset", { [USDC]: 14_999_985n, [OPTION]: -1_000_001n, "nep141:btc.test": -1n }],
  ])("rejects %s", async (_, diff) => {
    await expect(check(mmSigned(event("buy"), PREMIUM, { diff }))).rejects.toThrow("diff mismatch");
  });

  it.each([
    ["19.9 s", 19_900],
    ["60.1 s", 60_100],
    ["already past", -1],
  ])("rejects a deadline %s after receipt", async (_, offset) => {
    const now = Date.now();
    await expect(check(mmSigned(event("buy"), PREMIUM, { deadlineMs: now + offset }), now)).rejects.toThrow("deadline");
  });

  it("rejects a buy priced at or above the most the option can pay, from any market maker", async () => {
    const e = event("buy");
    const max = 20_000_000n;
    const bid = (premium: bigint) => checkBid(fakeChain().chain, INTENTS, e, "mm1", { quote_id: e.quote_id, premium: premium.toString(), signed: mmSigned(e, premium) }, Date.now());
    await expect(bid(max)).rejects.toThrow("max payout");
    await expect(bid(max - 1n)).resolves.toBeDefined();
  });

  it("accepts deadlines exactly on the window edges", async () => {
    const now = Date.now();
    for (const offset of [20_000, 60_000]) {
      await expect(check(mmSigned(event("buy"), PREMIUM, { deadlineMs: now + offset }), now)).resolves.toBeDefined();
    }
  });

  it("rejects a leg built for a fee the verifier no longer charges", async () => {
    const stale = { ...event("buy"), fee_pips: 0 };
    const response = { quote_id: stale.quote_id, premium: PREMIUM.toString(), signed: mmSigned(stale, PREMIUM) };
    await expect(checkBid(fakeChain().chain, INTENTS, stale, "mm1", response, Date.now())).rejects.toThrow("simulation");
  });

  it("rejects a quote for another verifier", async () => {
    await expect(check(mmSigned(event("buy"), PREMIUM, { verifyingContract: "evil.test" }))).rejects.toThrow("verifying contract");
  });

  it("rejects a legacy nonce", async () => {
    const signed = mmSigned(event("buy"), PREMIUM);
    signed.payload.nonce = Buffer.alloc(32, 7).toString("base64");
    await expect(check(signed)).rejects.toThrow("nonce");
  });

  it("rejects an extra intent smuggled into the payload", async () => {
    const signed = mmSigned(event("buy"), PREMIUM);
    const message = JSON.parse(signed.payload.message);
    message.intents.push({ intent: "transfer", receiver_id: "evil.test", tokens: { [USDC]: "1" }, msg: "", min_gas: "1" });
    await expect(check({ ...signed, payload: { ...signed.payload, message: JSON.stringify(message) } })).rejects.toThrow("diff mismatch");
  });
});
