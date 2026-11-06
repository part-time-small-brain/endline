import { hex } from "@scure/base";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/context.ts";
import { useWallet } from "./context.tsx";
import { signSeed, tapWallet } from "./tap.ts";
import type { Wallet } from "./wallet.ts";

interface TapBalance {
  accountId: string | undefined;
  ready: boolean;
  confirming: boolean;
  unlock(): Promise<Wallet>;
  setUp(): Promise<void>;
}

const TapContext = createContext<TapBalance | null>(null);

const stored = {
  get: (storage: () => Storage, key: string) => {
    try {
      return storage().getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (storage: () => Storage, key: string, value: string) => {
    try {
      storage().setItem(key, value);
    } catch {}
  },
};

export function TapProvider({ children }: { children: ReactNode }) {
  const { config } = useApp();
  const { wallet: main } = useWallet();
  const [accountId, setAccountId] = useState<string>();
  const [ready, setReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const unlocked = useRef<Promise<Wallet>>(undefined);
  const firstSeed = useRef<Uint8Array>(undefined);
  const current = useRef(main);
  const seenWallet = useRef(false);
  const accountKey = main ? `tap-account:${config.network}:${main.accountId}` : undefined;
  const seedKey = main ? `tap-seed:${config.network}:${main.accountId}` : undefined;

  useEffect(() => {
    current.current = main;
    firstSeed.current = undefined;
    setConfirming(false);
    seenWallet.current ||= main !== null;
    // a page load starts with no wallet, so only a connect or a disconnect clears other seeds
    if (seenWallet.current)
      try {
        for (const key of Object.keys(sessionStorage)) if (key.startsWith("tap-seed:") && key !== seedKey) sessionStorage.removeItem(key);
      } catch {}
    const seed = seedKey && stored.get(() => sessionStorage, seedKey);
    const restored = main && seed ? tapWallet(hex.decode(seed), main, config.intentsId) : undefined;
    unlocked.current = restored && Promise.resolve(restored);
    setReady(restored !== undefined);
    setAccountId(restored?.accountId ?? (accountKey && stored.get(() => localStorage, accountKey)));
  }, [main, accountKey, seedKey, config.intentsId]);

  const signed = useCallback(async () => {
    if (!main) throw new Error("Connect a wallet first");
    const seed = await signSeed(main, { network: config.network, intentsId: config.intentsId, host: window.location.host });
    if (current.current !== main) throw new Error("Another wallet connected meanwhile");
    return { seed, tap: tapWallet(seed, main, config.intentsId) };
  }, [main, config]);

  const keep = useCallback(
    (seed: Uint8Array, tap: Wallet) => {
      if (!accountKey || !seedKey) throw new Error("Connect a wallet first");
      stored.set(() => localStorage, accountKey, tap.accountId);
      stored.set(() => sessionStorage, seedKey, hex.encode(seed));
      setAccountId(tap.accountId);
      setReady(true);
      return tap;
    },
    [accountKey, seedKey],
  );

  const unlock = useCallback(() => {
    if (unlocked.current) return unlocked.current;
    const pending: Promise<Wallet> = (async () => {
      const known = accountKey && stored.get(() => localStorage, accountKey);
      if (!known) throw new Error("Set up your Tap balance first.");
      const { seed, tap } = await signed();
      if (known !== tap.accountId) throw new Error("This wallet signed differently than last time, so it can't open the same Tap balance.");
      return keep(seed, tap);
    })().catch((error: unknown) => {
      if (unlocked.current === pending) unlocked.current = undefined;
      throw error;
    });
    unlocked.current = pending;
    return pending;
  }, [accountKey, signed, keep]);

  // each signature is its own click: a wallet popup opened after an earlier one would be blocked
  const setUp = useCallback(async () => {
    const { seed, tap } = await signed();
    const first = firstSeed.current;
    firstSeed.current = first ? undefined : seed;
    setConfirming(!first);
    if (!first) return;
    if (hex.encode(first) !== hex.encode(seed)) throw new Error("This wallet signs the same message differently each time, so it can't hold a Tap balance.");
    unlocked.current = Promise.resolve(keep(seed, tap));
  }, [signed, keep]);

  const value = useMemo(() => ({ accountId, ready, confirming, unlock, setUp }), [accountId, ready, confirming, unlock, setUp]);
  return <TapContext.Provider value={value}>{children}</TapContext.Provider>;
}

export function useTap(): TapBalance {
  const value = useContext(TapContext);
  if (!value) throw new Error("TapContext missing");
  return value;
}

export function useTapPayer() {
  const { unlock } = useTap();
  const [error, setError] = useState<string>();
  const payer = async () => {
    setError(undefined);
    return unlock().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Couldn't open your Tap balance.");
      return undefined;
    });
  };
  return { payer, error };
}
