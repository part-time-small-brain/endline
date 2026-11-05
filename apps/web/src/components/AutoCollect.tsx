import { CheckCircle, HandCoins } from "@phosphor-icons/react";
import { useAutoCollect } from "../hooks/useCollect.ts";
import type { Wallet } from "../wallet/wallet.ts";
import { Button } from "./Button.tsx";

interface Props {
  wallet: Wallet;
  optionAsset: string;
  size: bigint;
  expiry: number;
  onDone: () => void;
}

export function AutoCollect({ wallet, optionAsset, size, expiry, onDone }: Props) {
  const auto = useAutoCollect(wallet, optionAsset, size, expiry);
  if (auto.status === "on")
    return (
      <div className="space-y-4">
        <div className="flex gap-3 rounded-2xl bg-up-field p-4 text-up-ink">
          <CheckCircle size={24} weight="fill" aria-hidden="true" className="shrink-0" />
          <div>
            <p className="font-semibold">Auto-collect is on</p>
            <p className="mt-1 text-sm">If you win $1 or more, it lands in your balance once the final price is set. Nothing else to do.</p>
          </div>
        </div>
        <Button size="lg" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  return (
    <div className="space-y-3">
      <div className="flex gap-3 rounded-2xl bg-well p-4">
        <HandCoins size={24} aria-hidden="true" className="shrink-0 text-ink-2" />
        <div>
          <p className="font-semibold">
            Get paid automatically <span className="ml-1 rounded-md bg-ink px-1.5 py-0.5 align-middle text-xs text-on-ink">Recommended</span>
          </p>
          <p className="mt-1 text-sm text-ink-2">One more signature. It's only used once the final price is set, so a win is paid without you coming back.</p>
          {auto.error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {auto.error}
            </p>
          )}
        </div>
      </div>
      <Button size="lg" disabled={auto.status === "signing"} onClick={() => void auto.enable()}>
        {auto.status === "signing" ? "Confirm in your wallet" : "Turn on auto-collect"}
      </Button>
      <Button size="lg" tone="ghost" disabled={auto.status === "signing"} onClick={onDone}>
        Not now
      </Button>
    </div>
  );
}
