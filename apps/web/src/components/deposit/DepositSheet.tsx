import { useState } from "react";
import { useApp } from "../../app/context.ts";
import { useData } from "../../app/data.tsx";
import { formatUsd } from "../../lib/money.ts";
import type { Wallet } from "../../wallet/wallet.ts";
import { Chips } from "../Chips.tsx";
import { Sheet } from "../Sheet.tsx";
import { Faucet } from "./Faucet.tsx";
import { NearDeposit } from "./NearDeposit.tsx";
import { OneClickDeposit } from "./OneClickDeposit.tsx";

type Source = "chain" | "near";

export function DepositSheet({ wallet, onClose }: { wallet: Wallet; onClose: () => void }) {
  const { config, services } = useApp();
  const { balance, quoteDecimals } = useData();
  const sources: { value: Source; label: string }[] = [
    ...(services.oneClick ? [{ value: "chain" as const, label: "Any chain" }] : []),
    ...(wallet.call ? [{ value: "near" as const, label: "NEAR wallet" }] : []),
  ];
  const [choice, setChoice] = useState<Source>();
  const source = choice ?? sources[0]?.value;

  return (
    <Sheet title="Add funds" onClose={onClose}>
      <div className="mb-5 rounded-2xl bg-well p-4">
        <p className="text-xs text-ink-2">USDC</p>
        <p className="text-2xl font-semibold">{balance === undefined ? "…" : formatUsd(balance, quoteDecimals)}</p>
        <p className="mt-1 text-xs text-ink-3">On NEAR Intents · {wallet.accountId}</p>
      </div>
      {config.network === "testnet" && (
        <div className={source ? "mb-6" : ""}>
          <Faucet accountId={wallet.accountId} />
        </div>
      )}
      {sources.length > 1 && (
        <div className="mb-4">
          <Chips label="Deposit source" columns="grid grid-cols-2" value={source} onChange={setChoice} options={sources} />
        </div>
      )}
      {source === "chain" && services.oneClick && <OneClickDeposit oneClick={services.oneClick} accountId={wallet.accountId} />}
      {source === "near" && wallet.call && <NearDeposit call={wallet.call} />}
    </Sheet>
  );
}
