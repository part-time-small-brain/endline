import { z } from "zod";
import { DepositAsset, DepositQuote, type DepositStatus } from "../api/oneClick.ts";

export const pendingDepositKey = (accountId: string) => `pending-deposit:${accountId}`;

const PendingDeposit = DepositQuote.extend({ asset: DepositAsset });
export type PendingDeposit = z.infer<typeof PendingDeposit>;

export type DepositStage = "waiting" | "late" | "expired" | "seen" | "done";

const DONE: DepositStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];
const GRACE_MS = 10 * 60_000;

const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export function readPendingDeposit(stored: string): PendingDeposit | undefined {
  return PendingDeposit.safeParse(json(stored)).data;
}

export function depositStage(status: DepositStatus | undefined, deposit: PendingDeposit, nowMs: number): DepositStage {
  if (status && DONE.includes(status)) return "done";
  if (status && status !== "PENDING_DEPOSIT") return "seen";
  const at = nowMs + deposit.clockOffsetMs;
  if (at < Date.parse(deposit.sendBefore)) return "waiting";
  return at < Date.parse(deposit.deadline) + deposit.timeEstimate * 1000 + GRACE_MS ? "late" : "expired";
}

export const keepsDeposit = (stage: DepositStage, status: DepositStatus | undefined) => stage !== "done" && (stage !== "expired" || status === undefined);
