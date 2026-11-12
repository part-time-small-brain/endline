import { expect, it } from "vitest";
import type { DepositStatus } from "../api/oneClick.ts";
import { depositStage, keepsDeposit, readPendingDeposit } from "./pendingDeposit.ts";

const DEADLINE = "2026-11-05T12:00:00.000Z";
const AT = Date.parse(DEADLINE);
const pending = {
  depositAddress: "0xdep",
  amountIn: "25000000",
  amountOut: "24975000",
  timeEstimate: 35,
  deadline: DEADLINE,
  asset: { assetId: "nep141:base-usdc", symbol: "USDC", blockchain: "base", decimals: 6, price: 1 },
};
const STATUSES: (DepositStatus | undefined)[] = [undefined, "PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT", "SUCCESS", "REFUNDED", "FAILED"];
const kept = (status: DepositStatus | undefined, nowMs: number) => keepsDeposit(depositStage(status, DEADLINE, nowMs), status);

it("reads back a saved deposit and ignores corrupt or partial entries", () => {
  expect(readPendingDeposit(JSON.stringify(pending))).toEqual(pending);
  const { asset: _, ...noAsset } = pending;
  for (const stored of ["", "{", "null", JSON.stringify(noAsset), JSON.stringify({ ...pending, deadline: "soon" }), JSON.stringify({ ...pending, amountIn: "25 USDC" })]) expect(readPendingDeposit(stored)).toBeUndefined();
});

it("stops offering the address at the send-by time unless the transfer was already seen", () => {
  expect(STATUSES.map((s) => depositStage(s, DEADLINE, AT - 1))).toEqual(["waiting", "waiting", "seen", "seen", "seen", "done", "done", "done"]);
  expect(STATUSES.map((s) => depositStage(s, DEADLINE, AT))).toEqual(["expired", "expired", "seen", "seen", "seen", "done", "done", "done"]);
});

it("forgets a deposit once it is credited, refunded or failed, or expired with nothing sent, and keeps a short one until it is refunded", () => {
  expect(STATUSES.filter((s) => kept(s, AT - 1))).toEqual([undefined, "PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"]);
  expect(STATUSES.filter((s) => kept(s, AT))).toEqual([undefined, "KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"]);
});
