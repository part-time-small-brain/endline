import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useApp } from "../app/context.ts";
import { demoWallet } from "./demo.ts";
import { forgetSession } from "./session.ts";
import { connectEvm } from "./evm.ts";
import { connectNear, restoreNear } from "./near.ts";
import type { Wallet } from "./wallet.ts";

export type WalletKind = Exclude<Wallet["kind"], "tap">;

interface WalletState {
  wallet: Wallet | null;
  connect(kind: WalletKind): Promise<void>;
  disconnect(): Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { config } = useApp();
  const [wallet, setWallet] = useState<Wallet | null>(null);

  useEffect(() => {
    if (config.mock) return;
    restoreNear(config.network).then((restored) => restored && setWallet((current) => current ?? restored));
  }, [config]);

  const connect = useCallback(
    async (kind: WalletKind) => {
      setWallet(kind === "demo" ? demoWallet() : kind === "evm" ? await connectEvm() : await connectNear(config.network));
    },
    [config.network],
  );

  const disconnect = useCallback(async () => {
    if (wallet) forgetSession(wallet, config.intentsId);
    await wallet?.disconnect();
    setWallet(null);
  }, [wallet, config.intentsId]);

  return <WalletContext.Provider value={{ wallet, connect, disconnect }}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (!value) throw new Error("WalletContext missing");
  return value;
}
