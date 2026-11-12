import { z } from "zod";
import { DepositAsset, DepositQuote, type DepositStatus } from "../api/oneClick.ts";

export const pendingDepositKey = (accountId: string) => `pending-deposit:${accountId}`;

const PendingDeposit = DepositQuote.extend({ asset: DepositAsset });
export type PendingDeposit = z.infer<typeof PendingDeposit>;

export type DepositStage = "waiting" | "expired" | "seen" | "done";

const DONE: DepositStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];

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

export function depositStage(status: DepositStatus | undefined, deadline: string, nowMs: number): DepositStage {
  if (status && DONE.includes(status)) return "done";
  if (status && status !== "PENDING_DEPOSIT") return "seen";
  return nowMs >= Date.parse(deadline) ? "expired" : "waiting";
}

export const keepsDeposit = (stage: DepositStage, status: DepositStatus | undefined) => stage === "waiting" || stage === "seen" || (stage === "expired" && status === undefined);
