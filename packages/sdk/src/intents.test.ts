import { describe, expect, it } from "vitest";
import { feeOf, grossFor, netOf, unmatched } from "./fees.ts";
import { closeOptions, exerciseOptions, payload, relayedTransfer, tokenDiff, versionedNonce, writeOptions } from "./intents.ts";
import { readPayload, toSign } from "./signing.ts";
import { buyDiffs, sellDiffs } from "./trade.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const LONG = "nep245:opt.near:BTC-27NOV26-110000_112000-C";
const LIVE_FEE = 1n;

function rng(seed: bigint) {
  let s = seed;
  return (max: bigint) => {
    s = (s * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
    return (s % max) + 1n;
  };
}

describe("fees", () => {
  it("charges the ceiling of the fee on every given-up amount", () => {
    expect(feeOf(USDC, 30_000_031n, LIVE_FEE)).toBe(31n);
    expect(feeOf(USDC, 1n, LIVE_FEE)).toBe(1n);
  });

  it("exempts NEP-245 amounts of 1 or less, nothing else", () => {
    expect(feeOf(LONG, 1n, LIVE_FEE)).toBe(0n);
    expect(feeOf(LONG, 2n, LIVE_FEE)).toBe(1n);
  });

  it("gross-up that is one short leaves the receiver one unit short", () => {
    expect(netOf(USDC, 30_000_030n, LIVE_FEE)).toBe(29_999_999n);
    expect(grossFor(USDC, 30_000_000n, LIVE_FEE)).toBe(30_000_031n);
  });

  it("gross-up is exact and minimal for any amount and fee", () => {
    const next = rng(7n);
    for (let i = 0; i < 3_000; i++) {
      const net = i % 3 === 0 ? next(3n) : next(10n ** 15n);
      const pips = next(1_000_000n) - 1n;
      const asset = i % 2 === 0 ? USDC : LONG;
      const gross = grossFor(asset, net, pips);
      expect(netOf(asset, gross, pips)).toBe(net);
      if (gross > net) expect(netOf(asset, gross - 1n, pips)).toBeLessThan(net);
    }
  });

  it.each([
    ["zero amount", () => feeOf(USDC, 0n, LIVE_FEE)],
    ["negative amount", () => feeOf(USDC, -5n, LIVE_FEE)],
    ["100% fee", () => feeOf(USDC, 10n, 1_000_000n)],
    ["negative fee", () => feeOf(USDC, 10n, -1n)],
    ["not an intents asset", () => feeOf("usdc.near", 10n, LIVE_FEE)],
    ["zero gross-up", () => grossFor(USDC, 0n, LIVE_FEE)],
  ])("rejects %s", (_, call) => {
    expect(call).toThrow();
  });
});

describe("trade diffs", () => {
  it("buy and sell legs always settle exactly after fees", () => {
    const next = rng(42n);
    for (let i = 0; i < 2_000; i++) {
      const trade = { option: LONG, quote: USDC, size: next(10n ** 12n), premium: next(10n ** 12n), pips: next(1_000n) - 1n };
      for (const { user, marketMaker } of [buyDiffs(trade), sellDiffs(trade)]) {
        expect(unmatched([user, marketMaker], trade.pips)).toEqual({});
      }
    }
  });

  it("naively mirrored legs do not settle once a fee exists", () => {
    const user = { [USDC]: -35_000_000n, [LONG]: 1_000_000n };
    const mirrored = { [USDC]: 35_000_000n, [LONG]: -1_000_000n };
    expect(unmatched([user, mirrored], LIVE_FEE)).toEqual({ [USDC]: 35n, [LONG]: 1n });
  });

  it("rejects zero deltas, which the verifier refuses", () => {
    expect(() => unmatched([{ [USDC]: 0n }], LIVE_FEE)).toThrow();
  });
});

describe("intents", () => {
  const salt = Uint8Array.from([0x25, 0x28, 0x12, 0xb3]);
  const random = Uint8Array.from({ length: 15 }, (_, i) => i + 1);

  it("versioned nonce has the verifier's exact byte layout", () => {
    const deadlineMs = 1_792_742_400_000;
    const bytes = Uint8Array.from(atob(versionedNonce(salt, deadlineMs, random)), (c) => c.charCodeAt(0));
    const deadlineNs = BigInt(deadlineMs) * 1_000_000n;
    const le = Array.from({ length: 8 }, (_, i) => Number((deadlineNs >> BigInt(8 * i)) & 0xffn));
    expect(Array.from(bytes)).toEqual([0x56, 0x28, 0xf6, 0xc6, 0x00, ...salt, ...le, ...random]);
  });

  it.each([
    ["short salt", () => versionedNonce(salt.slice(0, 3), 1, random)],
    ["short random", () => versionedNonce(salt, 1, random.slice(0, 14))],
    ["unsafe deadline", () => versionedNonce(salt, Number.MAX_SAFE_INTEGER + 2, random)],
    ["zero deadline", () => versionedNonce(salt, 0, random)],
    ["deadline past i64 nanoseconds", () => versionedNonce(salt, 9_223_372_036_855, random)],
    ["empty payload", () => payload("intents.near", "alice.near", 1, salt, random, [])],
  ])("rejects %s", (_, call) => {
    expect(call).toThrow();
  });

  it("payload deadline never exceeds the nonce deadline", () => {
    const deadlineMs = 1_792_742_400_123;
    const p = payload("intents.near", "alice.near", deadlineMs, salt, random, [tokenDiff({ [USDC]: -1n, [LONG]: 1n })]);
    const bytes = Uint8Array.from(atob(p.nonce), (c) => c.charCodeAt(0));
    const nonceNs = new DataView(bytes.buffer).getBigInt64(9, true);
    expect(BigInt(Date.parse(p.deadline)) * 1_000_000n).toBe(nonceNs);
  });

  it("write and exercise messages match what the contract parses", () => {
    const write = writeOptions("opt.near", USDC, 95_000_000_000n, "BTC-27NOV26-95000_93000-P");
    expect(JSON.parse(write.intent === "transfer" ? (write.msg ?? "") : "")).toEqual({ action: "write", series_id: "BTC-27NOV26-95000_93000-P" });
    const exercise = exerciseOptions("opt.near", { [LONG]: 5n });
    expect(exercise.intent === "transfer" && JSON.parse(exercise.msg ?? "")).toEqual({ action: "exercise" });
    for (const action of ["redeem", "burn_pair"] as const) {
      const close = closeOptions("opt.near", action, { [`${LONG}-SHORT`]: 5n });
      expect(close.intent === "transfer" && JSON.parse(close.msg ?? "")).toEqual({ action });
    }
  });

  it("a relayed transfer has no msg, so intents calls nothing on either receiver, and reads back canonically", () => {
    const moves = relayedTransfer("alice.near", "relayer.near", USDC, 5_000_000n, 10_000n);
    expect(moves.filter((move) => "msg" in move || "min_gas" in move)).toEqual([]);
    const p = payload("intents.near", "a".repeat(64), 1_792_742_400_000, salt, random, moves);
    for (const standard of ["nep413", "erc191"] as const) expect(readPayload(toSign(standard, p))).toStrictEqual(p);
  });

  it.each([
    ["foreign token", () => exerciseOptions("opt.near", { [USDC]: 1n })],
    ["another contract's option", () => exerciseOptions("opt.near", { "nep245:evil.near:BTC-27NOV26-110000_112000-C": 1n })],
    ["contract-prefix lookalike", () => exerciseOptions("opt.near", { "nep245:opt.near.evil:X": 1n })],
    ["more than 10 tokens", () => exerciseOptions("opt.near", Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`${LONG}${i}`, 1n])))],
    ["zero amount", () => exerciseOptions("opt.near", { [LONG]: 0n })],
    ["foreign token in a redeem", () => closeOptions("opt.near", "redeem", { [USDC]: 1n })],
    ["zero collateral", () => writeOptions("opt.near", USDC, 0n, "BTC-27NOV26-95000_93000-P")],
    ["a zero relayed transfer", () => relayedTransfer("alice.near", "relayer.near", USDC, 0n, 10_000n)],
  ])("refuses to build a close, write or transfer with %s", (_, call) => {
    expect(call).toThrow();
  });
});
