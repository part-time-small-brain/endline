import { type SignedPayload, sessionPayload, toSign } from "@endline/sdk";
import type { Wallet } from "./wallet.ts";

const SESSION_MS = 24 * 3_600_000;
const RENEW_BEFORE_MS = 60_000;

const sessions = new WeakMap<Wallet, { deadlineMs: number; signed: Promise<SignedPayload> }>();

export function cachedSession(wallet: Wallet): Promise<SignedPayload> | undefined {
  const current = sessions.get(wallet);
  return current && Date.now() < current.deadlineMs - RENEW_BEFORE_MS ? current.signed : undefined;
}

export function signSession(wallet: Wallet, intentsId: string, salt: () => Promise<Uint8Array>): Promise<SignedPayload> {
  const deadlineMs = Date.now() + SESSION_MS;
  const random = crypto.getRandomValues(new Uint8Array(15));
  const signed = salt().then((bytes) => wallet.sign(toSign(wallet.standard, sessionPayload(intentsId, wallet.accountId, deadlineMs, bytes, random))));
  sessions.set(wallet, { deadlineMs, signed });
  signed.catch(() => {
    if (sessions.get(wallet)?.signed === signed) sessions.delete(wallet);
  });
  return signed;
}

export function forgetSession(wallet: Wallet): void {
  sessions.delete(wallet);
}
