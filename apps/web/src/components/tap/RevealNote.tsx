import type { PositionView } from "../../app/usePositions.ts";
import { formatPrice, formatUsd } from "../../lib/money.ts";
import type { Closing } from "../../lib/reveal.ts";
import { bestWin } from "../../lib/shareCard.ts";
import { formatClock } from "../../lib/time.ts";
import { ShareButton } from "../ShareButton.tsx";

const ESTIMATE = "Estimate from Deribit's index; the final price is the median of 7 exchanges.";

interface Props {
  closing: Closing;
  price: bigint | undefined;
  stakes: PositionView[];
  quoteDecimals: number;
}

export function RevealNote({ closing: { phase, settlement }, price, stakes, quoteDecimals }: Props) {
  const at = price === undefined ? "" : formatPrice(price, quoteDecimals);
  const total = stakes.reduce((sum, v) => sum + v.payout, 0n);
  const card = phase === "final" && price !== undefined ? bestWin(stakes, price, quoteDecimals) : undefined;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pt-3 text-sm text-ink-2">
      <p>
        {phase === "close_only" && price !== undefined && `Final round · average so far ≈ ${at}. ${ESTIMATE}`}
        {phase === "awaiting_price" && (price === undefined ? "Ended · waiting for the final price." : `Ended · average ≈ ${at}, waiting for the final price. ${ESTIMATE}`)}
        {phase === "proposed" && settlement && `Proposed final price ${at}, final at ${formatClock(settlement.finalAt)}.`}
        {phase === "final" && `Final price ${at}.${total > 0n ? ` You get ${formatUsd(total, quoteDecimals)} back.` : ""}`}
      </p>
      {card && <ShareButton card={card} />}
    </div>
  );
}
