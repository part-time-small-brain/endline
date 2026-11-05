import { type Call, callMultiple, callPoints, longPayout, termsOf } from "@endline/sdk";
import type { PositionView } from "../../app/usePositions.ts";
import { formatPrice, formatUsd } from "../../lib/money.ts";
import type { Phase } from "../../lib/reveal.ts";
import { bestWin, callCard } from "../../lib/shareCard.ts";
import type { SettlementView } from "../../lib/status.ts";
import { formatClock } from "../../lib/time.ts";
import { ShareButton } from "../ShareButton.tsx";

const ESTIMATE = "Estimate from Deribit's index; the final price is the median of 7 exchanges.";

interface Props {
  phase: Phase;
  price: bigint;
  settlement: SettlementView | null;
  stakes: PositionView[];
  calls: Call[];
  quoteDecimals: number;
}

export function RevealNote({ phase, price, settlement, stakes, calls, quoteDecimals }: Props) {
  const at = formatPrice(price, quoteDecimals);
  const total = stakes.reduce((sum, v) => sum + longPayout(termsOf(v.series), v.amount, price), 0n);
  const scored = calls.map((call) => ({ call, points: callPoints(termsOf(call.terms), BigInt(call.ask), price) }));
  const points = scored.reduce((sum, c) => sum + c.points, 0);
  const bestCall = scored.filter((c) => c.points > 0).sort((a, b) => b.points - a.points)[0];
  const callShare = bestCall && callCard(bestCall.call.terms, callMultiple(termsOf(bestCall.call.terms), BigInt(bestCall.call.ask)), bestCall.points, price, quoteDecimals);
  const card = phase === "final" ? (bestWin(stakes, price, quoteDecimals) ?? callShare) : undefined;
  const called = calls.length === 0 ? "" : ` Your free calls: ${phase === "final" ? "" : "≈ "}${points > 0 ? "+" : ""}${points} points.`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pt-3 text-sm text-ink-2">
      <p>
        {phase === "close_only" && `Final round · average so far ≈ ${at}. ${ESTIMATE}`}
        {phase === "awaiting_price" && `Ended · average ≈ ${at}, waiting for the final price. ${ESTIMATE}`}
        {phase === "proposed" && settlement && `Proposed final price ${at}, final at ${formatClock(settlement.finalAt)}.`}
        {phase === "final" && `Final price ${at}.${total > 0n ? ` You get ${formatUsd(total, quoteDecimals)} back.` : ""}`}
        {called}
      </p>
      {card && <ShareButton card={card} />}
    </div>
  );
}
