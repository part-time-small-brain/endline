import { useState } from "react";
import { useApp } from "../app/context.ts";
import { type WalletKind, useWallet } from "../wallet/context.tsx";
import { hasInjectedEvm } from "../wallet/evm.ts";
import { Sheet } from "./Sheet.tsx";

const CHOICES: { kind: WalletKind; title: string; body: string }[] = [
  { kind: "demo", title: "Demo wallet", body: "Starts with $250" },
  { kind: "near", title: "NEAR wallet", body: "Meteor, Intear, Nightly and more" },
  { kind: "evm", title: "Ethereum wallet", body: "MetaMask, Rabby or any browser wallet" },
];

export function ConnectSheet({ onClose }: { onClose: () => void }) {
  const { config } = useApp();
  const { connect } = useWallet();
  const [busy, setBusy] = useState<WalletKind>();
  const [error, setError] = useState<string>();
  const choices = CHOICES.filter((choice) => choice.kind !== "demo" || config.mock);

  const pick = async (kind: WalletKind) => {
    setBusy(kind);
    setError(undefined);
    try {
      await connect(kind);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Sheet title="Connect" onClose={onClose}>
      <p className="mb-4 text-sm text-ink-2">Buys use USDC. No gas token needed.</p>
      <div className="space-y-2">
        {choices.map((choice) => {
          const unavailable = choice.kind === "evm" && !hasInjectedEvm();
          return (
            <button
              key={choice.kind}
              type="button"
              disabled={busy !== undefined || unavailable}
              onClick={() => void pick(choice.kind)}
              className="flex w-full items-center justify-between rounded-2xl bg-well p-4 text-left transition-colors hover:bg-well-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40"
            >
              <span>
                <span className="block font-semibold">{choice.title}</span>
                <span className="block text-sm text-ink-2">{unavailable ? "Install MetaMask or Rabby to use an Ethereum wallet" : choice.body}</span>
              </span>
              <span aria-hidden="true" className="text-ink-2">
                {busy === choice.kind ? "…" : "→"}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
