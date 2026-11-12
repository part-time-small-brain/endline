import { expect, it } from "vitest";
import { readPendingDeposit } from "./pendingDeposit.ts";

const DEADLINE = "2026-11-05T12:00:00.000Z";
const pending = {
  depositAddress: "0xdep",
  amountIn: "25000000",
  amountOut: "24975000",
  timeEstimate: 35,
  deadline: DEADLINE,
  accountId: "alice.near",
  asset: { assetId: "nep141:base-usdc", symbol: "USDC", blockchain: "base", decimals: 6, price: 1 },
};
const before = Date.parse(DEADLINE) - 1;

it("reopens the deposit for the account that asked for it until the address expires", () => {
  expect(readPendingDeposit(JSON.stringify(pending), "alice.near", before)).toEqual(pending);
  expect(readPendingDeposit(JSON.stringify(pending), "alice.near", Date.parse(DEADLINE))).toBeUndefined();
});

it("never shows another account's deposit address", () => {
  expect(readPendingDeposit(JSON.stringify(pending), "bob.near", before)).toBeUndefined();
});

it("ignores missing, corrupt or partial entries", () => {
  const { asset: _, ...noAsset } = pending;
  for (const stored of [null, "", "{", "null", JSON.stringify(noAsset), JSON.stringify({ ...pending, deadline: "soon" }), JSON.stringify({ ...pending, amountIn: "25 USDC" })]) expect(readPendingDeposit(stored, "alice.near", before)).toBeUndefined();
});
