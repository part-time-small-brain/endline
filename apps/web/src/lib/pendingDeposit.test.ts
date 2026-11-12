import { expect, it } from "vitest";
import type { DepositStatus } from "../api/oneClick.ts";
import { depositStage, keepsDeposit, readPendingDeposit } from "./pendingDeposit.ts";

const MINUTE = 60_000;
const SEND_BEFORE = Date.parse("2026-11-05T12:00:00.000Z");
const DEADLINE = SEND_BEFORE + 120 * MINUTE;
const GRACE_END = DEADLINE + 35_000 + 10 * MINUTE;
const pending = {
  depositAddress: "0xdep",
  amountIn: "25000000",
  amountOut: "24975000",
  timeEstimate: 35,
  sendBefore: new Date(SEND_BEFORE).toISOString(),
  deadline: new Date(DEADLINE).toISOString(),
  clockOffsetMs: 0,
  asset: { assetId: "nep141:base-usdc", symbol: "USDC", blockchain: "base", decimals: 6, price: 1 },
};
const STATUSES: (DepositStatus | undefined)[] = [undefined, "PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT", "SUCCESS", "REFUNDED", "FAILED"];
const stages = (nowMs: number, deposit = pending) => STATUSES.map((s) => depositStage(s, deposit, nowMs));
const kept = (nowMs: number) => STATUSES.filter((s) => keepsDeposit(depositStage(s, pending, nowMs), s));

it("reads back a saved deposit and ignores corrupt or partial entries", () => {
  expect(readPendingDeposit(JSON.stringify(pending))).toEqual(pending);
  const { asset: _, ...noAsset } = pending;
  const { sendBefore: __, ...noSendBefore } = pending;
  for (const stored of ["", "{", "null", JSON.stringify(noAsset), JSON.stringify(noSendBefore), JSON.stringify({ ...pending, deadline: "soon" }), JSON.stringify({ ...pending, amountIn: "25 USDC" })]) expect(readPendingDeposit(stored)).toBeUndefined();
});

it("stops offering the address at the send-by time but keeps checking until the refund deadline plus the transfer time and 10 min", () => {
  expect(stages(SEND_BEFORE - 1)).toEqual(["waiting", "waiting", "seen", "seen", "seen", "done", "done", "done"]);
  expect(stages(SEND_BEFORE)).toEqual(["late", "late", "seen", "seen", "seen", "done", "done", "done"]);
  expect(stages(GRACE_END - 1)).toEqual(["late", "late", "seen", "seen", "seen", "done", "done", "done"]);
  expect(stages(GRACE_END)).toEqual(["expired", "expired", "seen", "seen", "seen", "done", "done", "done"]);
});

it("times the send-by and the grace window on 1Click's clock, so a device clock 20 min slow still stops on time", () => {
  const slow = { ...pending, clockOffsetMs: 20 * MINUTE };
  expect(stages(SEND_BEFORE - 20 * MINUTE - 1, slow)[1]).toBe("waiting");
  expect(stages(SEND_BEFORE - 20 * MINUTE, slow)[1]).toBe("late");
  expect(stages(GRACE_END - 20 * MINUTE, slow)[1]).toBe("expired");
});

it("keeps a deposit saved through the grace window and a short one until it is refunded, and forgets it once credited, refunded or failed, or nothing arrived", () => {
  expect(kept(SEND_BEFORE)).toEqual([undefined, "PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"]);
  expect(kept(GRACE_END)).toEqual([undefined, "KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"]);
});
