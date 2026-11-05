import { describe, expect, it } from "vitest";
import fixture from "../../../testdata/oneclick-quote.json" with { type: "json" };
import { verifyDepositQuote } from "./oneClick.ts";

const { request, response } = fixture;

describe("verifyDepositQuote", () => {
  it("accepts the quote 1Click signed for our request, whatever deadline we asked for", () => {
    expect(verifyDepositQuote({ ...request, deadline: new Date().toISOString() }, response)).toBe(true);
  });

  it("checks the signature against the request we sent, so fields added to 1Click's echo of it count for nothing", () => {
    const echo = { ...response.quoteRequest, referral: "mallory", customRecipientMsg: "{}" };
    expect(verifyDepositQuote(request, { ...response, quoteRequest: echo })).toBe(true);
    expect(verifyDepositQuote({ ...request, referral: "mallory" }, response)).toBe(false);
  });

  it.each([
    ["a swapped deposit address", request, { ...response, quote: { ...response.quote, depositAddress: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } }],
    ["a swapped amount out", request, { ...response, quote: { ...response.quote, amountOut: "200305978" } }],
    ["a quote signed for another recipient", { ...request, recipient: "bob.near", refundTo: "bob.near" }, response],
    ["a truncated signature", request, { ...response, signature: response.signature.slice(0, -1) }],
    ["no signature", request, { ...response, signature: undefined }],
  ])("refuses %s", (_, req, res) => {
    expect(verifyDepositQuote(req, res)).toBe(false);
  });
});
