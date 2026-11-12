import { z } from "zod";
import { DepositAsset, DepositQuote } from "../api/oneClick.ts";

export const PENDING_DEPOSIT_KEY = "pending-deposit";

const PendingDeposit = DepositQuote.extend({ accountId: z.string(), asset: DepositAsset });
export type PendingDeposit = z.infer<typeof PendingDeposit>;

const json = (text: string | null): unknown => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
};

export function readPendingDeposit(stored: string | null, accountId: string, nowMs: number): PendingDeposit | undefined {
  const pending = PendingDeposit.safeParse(json(stored)).data;
  return pending?.accountId === accountId && Date.parse(pending.deadline) > nowMs ? pending : undefined;
}
