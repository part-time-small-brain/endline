import { FREE_CALLS_PER_ROUND, MAX_CALL_MULTIPLE } from "@endline/sdk";
import type { BudgetChoice } from "../../app/useTicket.ts";
import { formatUsd } from "../../lib/money.ts";
import { Chips } from "../Chips.tsx";
import { AmountPicker } from "../trade/AmountPicker.tsx";

interface Props {
  free: boolean;
  left: number;
  budget: bigint;
  atMax: boolean;
  ceiling: bigint;
  quoteDecimals: number;
  onFree: (free: boolean) => void;
  onBudget: (choice: BudgetChoice) => void;
}

export function TapMode({ free, left, budget, atMax, ceiling, quoteDecimals, onFree, onBudget }: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-rule bg-surface p-4 sm:p-6">
      <Chips
        label="Tap to"
        columns="grid grid-cols-2"
        value={free ? "free" : "buy"}
        onChange={(mode) => onFree(mode === "free")}
        options={[
          { value: "buy", label: "Buy", hint: "With real money" },
          { value: "free", label: "Free call", hint: `${left} of ${FREE_CALLS_PER_ROUND} left this round` },
        ]}
      />
      {free ? (
        <p className="text-sm text-ink-2">Each tap calls a cell of the next round for free: it stakes 100 points at the cell's multiple, up to {MAX_CALL_MULTIPLE}×, and scores at the final price. No money moves; you need $1 in your balance to play.</p>
      ) : (
        <>
          {ceiling > 0n && <AmountPicker value={budget} atMax={atMax} max={ceiling} quoteDecimals={quoteDecimals} onChange={onBudget} />}
          <p className="text-sm text-ink-2">
            Each tap gets a firm quote for up to {formatUsd(ceiling > 0n && budget > ceiling ? ceiling : budget, quoteDecimals, "up").replace(/\.00$/, "")}. Long shots cost less, since one trade's payout is capped. You confirm it before anything is bought.
          </p>
        </>
      )}
    </div>
  );
}
