import { useState } from "react";
import { useApp } from "../../app/context.ts";
import { useData } from "../../app/data.tsx";
import { parseUnits } from "../../lib/money.ts";
import type { NearCall } from "../../wallet/wallet.ts";
import { Button } from "../Button.tsx";

const FT_TRANSFER_CALL_GAS = "100000000000000";

export function NearDeposit({ call }: { call: (call: NearCall) => Promise<void> }) {
  const { config } = useApp();
  const { quoteDecimals, reload } = useData();
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string>();
  const units = parseUnits(amount, quoteDecimals);

  const deposit = async () => {
    if (!units) return;
    setState("busy");
    setError(undefined);
    try {
      await call({
        receiverId: config.quoteAsset.replace(/^nep141:/, ""),
        methodName: "ft_transfer_call",
        args: { receiver_id: config.intentsId, amount: units.toString(), msg: "" },
        gas: FT_TRANSFER_CALL_GAS,
        deposit: "1",
      });
      setState("done");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
      setState("idle");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">Move USDC from your NEAR wallet into your trading balance. One transaction.</p>
      <label className="flex h-12 items-center gap-2 rounded-xl border border-rule bg-well px-4 focus-within:border-ink">
        <input
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-label="USDC to deposit"
          className="w-full bg-transparent outline-none placeholder:text-ink-3"
        />
        <span className="text-ink-2">USDC</span>
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      {state === "done" && <p className="text-sm font-semibold text-ink">Deposited. Your balance updates in a few seconds.</p>}
      <Button size="lg" disabled={!units || state === "busy"} onClick={() => void deposit()}>
        {state === "busy" ? "Confirm in your wallet…" : "Deposit USDC"}
      </Button>
    </div>
  );
}
