import type { Payload, Quote } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { checkTrade, type Expected } from "./tradeCheck.ts";

const USDC = "nep141:usdc.near";
const OPTION = "nep245:opt.near:BTC-27NOV26-110000_112000-C";
const SIGN_BY = Date.parse("2026-11-01T00:00:00.000Z");
const RECEIVED = SIGN_BY - 57_000;

const expected: Expected = { signerId: "alice.near", intentsId: "intents.near", optionAsset: OPTION, quoteAsset: USDC, side: "buy", size: "1000000" };

const quote: Quote = {
  quote_id: "q",
  series_id: "BTC-27NOV26-110000_112000-C",
  side: "buy",
  size: "1000000",
  premium: "35000000",
  pay: { asset: USDC, amount: "35000000" },
  receive: { asset: OPTION, amount: "1000000" },
  sign_by_ms: SIGN_BY,
  payload: { standard: "erc191", payload: "{}" },
};

const message = (diff: Record<string, string>, overrides: Partial<Payload> = {}): Payload => ({
  signer_id: "alice.near",
  verifying_contract: "intents.near",
  deadline: new Date(SIGN_BY).toISOString(),
  nonce: "n",
  intents: [{ intent: "token_diff", diff }],
  ...overrides,
});

const good = { [USDC]: "-35000000", [OPTION]: "1000000" };

describe("checkTrade", () => {
  it("returns the legs the card shows for an honest quote", () => {
    expect(checkTrade(message(good), quote, expected, RECEIVED)).toEqual({
      pay: { asset: USDC, amount: 35_000_000n },
      receive: { asset: OPTION, amount: 1_000_000n },
    });
  });

  it.each([
    ["pays more than quoted", { [USDC]: "-35000001", [OPTION]: "1000000" }],
    ["receives less than quoted", { [USDC]: "-35000000", [OPTION]: "999999" }],
    ["sneaks in a third asset", { ...good, "nep141:wrap.near": "-1" }],
    ["flips a sign", { [USDC]: "35000000", [OPTION]: "-1000000" }],
  ])("rejects a diff that %s", (_, diff) => {
    expect(() => checkTrade(message(diff), quote, expected, RECEIVED)).toThrow(/doesn't match/);
  });

  it("rejects the wrong signer, contract or a long-lived deadline", () => {
    expect(() => checkTrade(message(good, { signer_id: "bob.near" }), quote, expected, RECEIVED)).toThrow(/signer/);
    expect(() => checkTrade(message(good, { verifying_contract: "evil.near" }), quote, expected, RECEIVED)).toThrow(/contract/);
    expect(() => checkTrade(message(good, { deadline: new Date(SIGN_BY + 60_000).toISOString() }), quote, expected, RECEIVED)).toThrow(/deadline/);
    expect(() => checkTrade(message(good, { deadline: "not a date" }), quote, expected, RECEIVED)).toThrow(/deadline/);
  });

  it("rejects a quote that stays signable longer than any market maker deadline, even when its deadline matches", () => {
    const signableFor = (ms: number) => checkTrade(message(good, { deadline: new Date(RECEIVED + ms).toISOString() }), { ...quote, sign_by_ms: RECEIVED + ms }, expected, RECEIVED);
    expect(() => signableFor(65_000)).not.toThrow();
    expect(() => signableFor(65_001)).toThrow(/deadline/);
    expect(() => signableFor(365 * 86_400_000)).toThrow(/deadline/);
  });

  it("rejects a second intent riding along with the trade", () => {
    const transfer = { intent: "transfer" as const, receiver_id: "evil.near", tokens: { [USDC]: "1" }, msg: "", min_gas: "0" };
    const base = message(good);
    expect(() => checkTrade({ ...base, intents: [...base.intents, transfer] }, quote, expected, RECEIVED)).toThrow(/diff/);
  });

  it("rejects a quote for a different size or a mislabelled pay leg", () => {
    expect(() => checkTrade(message(good), { ...quote, size: "2000000" }, expected, RECEIVED)).toThrow(/size/);
    expect(() => checkTrade(message(good), { ...quote, pay: { asset: USDC, amount: "1" } }, expected, RECEIVED)).toThrow(/pay/);
  });

  it("checks the sell direction too", () => {
    const sell = { ...quote, side: "sell" as const, pay: { asset: OPTION, amount: "1000000" }, receive: { asset: USDC, amount: "35000000" } };
    const legs = checkTrade(message({ [OPTION]: "-1000000", [USDC]: "35000000" }), sell, { ...expected, side: "sell" }, RECEIVED);
    expect(legs.pay.asset).toBe(OPTION);
    expect(() => checkTrade(message(good), sell, { ...expected, side: "sell" }, RECEIVED)).toThrow(/diff/);
  });
});
