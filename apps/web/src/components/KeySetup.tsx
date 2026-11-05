import { useState } from "react";
import { useApp } from "../app/context.ts";
import { usePoll } from "../hooks/usePoll.ts";
import { useWallet } from "../wallet/context.tsx";
import { Button } from "./Button.tsx";

const ADD_KEY_GAS = "30000000000000";

export function KeySetup() {
  const { config, services } = useApp();
  const { wallet } = useWallet();
  const [error, setError] = useState<string>();
  const publicKey = wallet?.kind === "near" ? wallet.publicKey : undefined;
  const registered = usePoll(
    wallet && publicKey ? () => services.chain.hasPublicKey(wallet.accountId, publicKey) : null,
    60_000,
    `${wallet?.accountId}:${publicKey}`,
  );
  if (!wallet?.call || !publicKey || registered.data !== false) return null;
  const call = wallet.call;

  const enable = async () => {
    setError(undefined);
    try {
      await call({ receiverId: config.intentsId, methodName: "add_public_key", args: { public_key: publicKey }, gas: ADD_KEY_GAS, deposit: "1" });
      registered.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
    }
  };

  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-surface p-4" role="status">
      <div>
        <p className="font-semibold">One-time setup</p>
        <p className="text-xs text-ink-2">{error ?? "Let this wallet sign trades on NEAR Intents."}</p>
      </div>
      <Button onClick={() => void enable()}>Enable</Button>
    </div>
  );
}
