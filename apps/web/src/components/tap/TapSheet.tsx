import { transferFee } from "@near-options/sdk";
import { useState } from "react";
import { useData } from "../../app/data.tsx";
import { useTransfer } from "../../hooks/useTransfer.ts";
import { formatUsd } from "../../lib/money.ts";
import { useWallet } from "../../wallet/context.tsx";
import { useTap } from "../../wallet/tapBalance.tsx";
import { Button } from "../Button.tsx";
import { Sheet } from "../Sheet.tsx";
import { AmountPicker } from "../trade/AmountPicker.tsx";

const usd = (value: bigint, decimals: number) => formatUsd(value, decimals).replace(/\.00$/, "");

export function TapSheet({ onClose }: { onClose: () => void }) {
  const { wallet: main } = useWallet();
  const tap = useTap();
  const { balance, tapBalance, quoteDecimals } = useData();
  const transfer = useTransfer();
  const unit = 10n ** BigInt(quoteDecimals);
  const fee = transferFee(quoteDecimals);
  const [amount, setAmount] = useState(25n * unit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!main) return null;
  const out = (tapBalance ?? 0n) - fee;
  const run = async (action: () => Promise<unknown>, close = true) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      if (close) onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn't go through. Nothing moved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Tap balance" onClose={onClose} dismissible={!busy}>
      <p className="text-sm text-ink-2">
        Taps buy from this balance and sign in your browser, so there's no wallet prompt on each tap. It's a separate account: only what you move in can be spent from it. Each move costs {formatUsd(fee, quoteDecimals)}. Setting it up asks your wallet to sign the same message twice; that signature is the key, so sign it only here.
      </p>
      {tap.accountId === undefined ? (
        <Button size="lg" className="mt-5" disabled={busy} onClick={() => run(tap.setUp, false)}>
          {busy ? "Confirm in your wallet" : tap.confirming ? "Sign once more to check" : "Set up with your wallet"}
        </Button>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          <p className="flex items-baseline justify-between">
            <span className="text-sm text-ink-2">In your Tap balance</span>
            <span className="font-display text-2xl font-semibold">{usd(tapBalance ?? 0n, quoteDecimals)}</span>
          </p>
          {tap.ready ? (
            <>
              <AmountPicker value={amount} quoteDecimals={quoteDecimals} onChange={setAmount} />
              <Button size="lg" disabled={busy || amount < unit || (balance ?? 0n) < amount + fee} onClick={() => run(async () => transfer(main, (await tap.unlock()).accountId, amount))}>
                Move {usd(amount, quoteDecimals)} in
              </Button>
              <Button size="lg" tone="ghost" disabled={busy || out <= 0n} onClick={() => run(async () => transfer(await tap.unlock(), main.accountId, out))}>
                Move {usd(out > 0n ? out : 0n, quoteDecimals)} to your balance
              </Button>
            </>
          ) : (
            <Button size="lg" disabled={busy} onClick={() => run(tap.unlock, false)}>
              {busy ? "Confirm in your wallet" : "Open with your wallet"}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Sheet>
  );
}
