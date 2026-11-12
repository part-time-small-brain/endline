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
    <Sheet
      title="Add funds"
      detail={
        <p className="text-sm text-ink-2">
          Balance <span className="font-semibold text-ink">{balance === undefined ? "…" : formatUsd(balance, quoteDecimals)}</span>
        </p>
      }
      onClose={onClose}
    >
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
