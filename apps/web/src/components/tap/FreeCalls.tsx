import { type Call, callMultiple, type Standing, termsOf } from "@endline/sdk";
import { useApp } from "../../app/context.ts";
import { usePoll } from "../../hooks/usePoll.ts";
import { seriesTitle, shortAccount } from "../../lib/labels.ts";
import { formatMultiple } from "../../lib/money.ts";
import { dayLabel, formatUtcDay } from "../../lib/time.ts";

const SHOWN = 10;

interface Props {
  calls: Call[];
  accountId: string | undefined;
  nowSec: number;
  quoteDecimals: number;
}

const points = (value: number) => `${value > 0 ? "+" : ""}${value}`;

export function FreeCalls({ calls, accountId, nowSec, quoteDecimals }: Props) {
  const { services } = useApp();
  const board = usePoll(() => services.relay.leaderboard(accountId), 60_000, accountId ?? "");
  return (
    <section aria-label="Free calls" className="flex flex-col gap-4 rounded-md border border-rule bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] font-medium tracking-[0.14em] text-ink-3 uppercase">Your free calls</h2>
        {calls.length === 0 && <p className="text-sm text-ink-2">Tap a cell in the next round to call it. No money moves.</p>}
        {calls.map((c) => (
          <p key={c.series_id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              {seriesTitle(c.terms, quoteDecimals)}{" "}
              <span className="font-mono text-xs text-ink-3">
                · {dayLabel(c.terms.expiry, nowSec)} · at {formatMultiple(callMultiple(termsOf(c.terms), BigInt(c.ask)))}
              </span>
            </span>
            <span className={`font-mono ${!c.result ? "text-ink-3" : c.result.points > 0 ? "text-up-ink" : "text-down-ink"}`}>{c.result ? `${points(c.result.points)} pts` : "open"}</span>
          </p>
        ))}
      </div>
      {board.data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Board title={board.data.round ? `Round ${formatUtcDay(Date.parse(board.data.round) / 1000)}` : "Last round"} rows={board.data.today} you={board.data.you?.today ?? null} />
          <Board title="7 days" rows={board.data.week} you={board.data.you?.week ?? null} />
        </div>
      )}
      <p className="text-xs text-ink-3">Points only, no prizes. Names are NEAR Intents account ids, so they're public.</p>
    </section>
  );
}

function Board({ title, rows, you }: { title: string; rows: Standing[]; you: Standing | null }) {
  const shown = rows.slice(0, SHOWN);
  const extra = you && !shown.some((s) => s.account_id === you.account_id) ? you : undefined;
  return (
    <div>
      <h3 className="mb-2 font-mono text-[10px] font-medium tracking-[0.14em] text-ink-3 uppercase">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">No results yet.</p>
      ) : (
        <ol aria-label={title} className="flex flex-col gap-1 font-mono text-sm">
          {[...shown, ...(extra ? [extra] : [])].map((s) => (
            <li key={s.account_id} className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${s.account_id === you?.account_id ? "bg-well text-ink" : "text-ink-2"}`}>
              <span className="min-w-0 truncate">
                {s.rank}. {shortAccount(s.account_id)}
              </span>
              <span className="shrink-0">
                {points(s.points)}
                {s.streak > 1 && <span className="ml-2 text-xs text-teal">{s.streak}-day streak</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
