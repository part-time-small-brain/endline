import { longPayout, termsOf } from "@endline/sdk";
import type { PositionView } from "../../app/usePositions.ts";
import { formatPrice, formatUsd } from "../../lib/money.ts";
import type { Phase } from "../../lib/reveal.ts";
import { winCard } from "../../lib/shareCard.ts";
import type { SettlementView } from "../../lib/status.ts";
import { formatClock } from "../../lib/time.ts";
import { ShareButton } from "../ShareButton.tsx";

const ESTIMATE = "Estimate from Deribit's index; the final price is the median of 7 exchanges.";

interface Props {
  phase: Phase;
  price: bigint;
  settlement: SettlementView | null;
  stakes: PositionView[];
  quoteDecimals: number;
}

export function RevealNote({ phase, price, settlement, stakes, quoteDecimals }: Props) {
  const at = formatPrice(price, quoteDecimals);
  const payouts = stakes.map((view) => ({ view, payout: longPayout(termsOf(view.series), view.amount, price) }));
  const total = payouts.reduce((sum, w) => sum + w.payout, 0n);
  const best = payouts.filter((w) => w.payout > w.view.paid).reduce<(typeof payouts)[number] | undefined>((top, w) => (!top || w.payout - w.view.paid > top.payout - top.view.paid ? w : top), undefined);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pt-3 text-sm text-ink-2">
      <p>
        {phase === "final_round" && `Final round · average so far ≈ ${at}. ${ESTIMATE}`}
        {phase === "ended" && `Ended · average ≈ ${at}, waiting for the final price. ${ESTIMATE}`}
        {phase === "proposed" && settlement && `Proposed final price ${at}, final at ${formatClock(settlement.finalAt)}.`}
        {phase === "final" && `Final price ${at}.${total > 0n ? ` You get ${formatUsd(total, quoteDecimals)} back.` : ""}`}
      </p>
      {phase === "final" && best && <ShareButton card={winCard(best.view.series, best.payout, best.view.paid, price, quoteDecimals)} />}
    </div>
  );
}
