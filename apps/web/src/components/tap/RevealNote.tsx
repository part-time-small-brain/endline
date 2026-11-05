import { type Call, callMultiple, callPoints, termsOf } from "@endline/sdk";
import type { PositionView } from "../../app/usePositions.ts";
import { formatPrice, formatUsd } from "../../lib/money.ts";
import type { Closing } from "../../lib/reveal.ts";
import { bestWin, callCard } from "../../lib/shareCard.ts";
import { formatClock } from "../../lib/time.ts";
import { ShareButton } from "../ShareButton.tsx";

const ESTIMATE = "Estimate from Deribit's index; the final price is the median of 7 exchanges.";

interface Props {
  closing: Closing;
  price: bigint | undefined;
  stakes: PositionView[];
  calls: Call[];
  quoteDecimals: number;
}

export function RevealNote({ closing: { phase, settlement }, price, stakes, calls, quoteDecimals }: Props) {
  const at = price === undefined ? "" : formatPrice(price, quoteDecimals);
  const total = stakes.reduce((sum, v) => sum + v.payout, 0n);
  const scored = price === undefined ? [] : calls.map((call) => ({ call, points: callPoints(termsOf(call.terms), BigInt(call.ask), price) }));
  const points = scored.reduce((sum, c) => sum + c.points, 0);
  const best = scored.filter((c) => c.points > 0).reduce<(typeof scored)[number] | undefined>((top, c) => (!top || c.points > top.points ? c : top), undefined);
  const final = phase === "final" && price !== undefined;
  const card = final ? (bestWin(stakes, price, quoteDecimals) ?? (best && callCard(best.call.terms, callMultiple(termsOf(best.call.terms), BigInt(best.call.ask)), best.points, price, quoteDecimals))) : undefined;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pt-3 text-sm text-ink-2">
      <p>
        {phase === "close_only" && price !== undefined && `Final round · average so far ≈ ${at}. ${ESTIMATE}`}
        {phase === "awaiting_price" && (price === undefined ? "Ended · waiting for the final price." : `Ended · average ≈ ${at}, waiting for the final price. ${ESTIMATE}`)}
        {phase === "proposed" && settlement && `Proposed final price ${at}, final at ${formatClock(settlement.finalAt)}.`}
        {phase === "final" && `Final price ${at}.${total > 0n ? ` You get ${formatUsd(total, quoteDecimals)} back.` : ""}`}
        {scored.length > 0 && ` Your free calls: ${final ? "" : "≈ "}${points > 0 ? "+" : ""}${points} points.`}
      </p>
      {card && <ShareButton card={card} />}
    </div>
  );
}
