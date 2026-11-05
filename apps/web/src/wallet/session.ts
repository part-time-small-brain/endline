import { readPayload, SignedPayload, sessionPayload, toSign } from "@endline/sdk";
import type { Wallet } from "./wallet.ts";

const SESSION_MS = 24 * 3_600_000;
const RENEW_BEFORE_MS = 60_000;

interface Session {
  deadlineMs: number;
  signed: Promise<SignedPayload>;
}

const sessions = new WeakMap<Wallet, Session>();
const keyOf = (wallet: Wallet) => `session:${wallet.standard}:${wallet.accountId}`;

const tab = {
  get: (key: string) => {
    try {
      return sessionStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (key: string, value: string) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {}
  },
  remove: (key: string) => {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  },
};

function restored(wallet: Wallet): Session | undefined {
  const text = tab.get(keyOf(wallet));
  if (!text) return undefined;
  try {
    const signed = SignedPayload.parse(JSON.parse(text));
    const { signer_id, deadline } = readPayload(signed);
    if (signer_id !== wallet.accountId) return undefined;
    const session = { deadlineMs: Date.parse(deadline), signed: Promise.resolve(signed) };
    sessions.set(wallet, session);
    return session;
  } catch {
    return undefined;
  }
}

export function cachedSession(wallet: Wallet): Promise<SignedPayload> | undefined {
  const current = sessions.get(wallet) ?? restored(wallet);
  return current && Date.now() < current.deadlineMs - RENEW_BEFORE_MS ? current.signed : undefined;
}

export function signSession(wallet: Wallet, intentsId: string, salt: () => Promise<Uint8Array>): Promise<SignedPayload> {
  const deadlineMs = Date.now() + SESSION_MS;
  const random = crypto.getRandomValues(new Uint8Array(15));
  const signed = salt().then((bytes) => wallet.sign(toSign(wallet.standard, sessionPayload(intentsId, wallet.accountId, deadlineMs, bytes, random))));
  sessions.set(wallet, { deadlineMs, signed });
  signed.then(
    (value) => {
      if (sessions.get(wallet)?.signed === signed) tab.set(keyOf(wallet), JSON.stringify(value));
    },
    () => {
      if (sessions.get(wallet)?.signed === signed) sessions.delete(wallet);
    },
  );
  return signed;
}

export function forgetSession(wallet: Wallet): void {
  sessions.delete(wallet);
  tab.remove(keyOf(wallet));
}
