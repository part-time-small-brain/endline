import { type ListedSeries, maxPayout, type Quote, termsOf } from "@endline/sdk";
import { useEffect, useRef } from "react";
import { useApp } from "../app/context.ts";
import { useData } from "../app/data.tsx";
import { useQuoteFlow } from "../hooks/useQuoteFlow.ts";
import { seriesTitle } from "../lib/labels.ts";
import { formatUsd } from "../lib/money.ts";
import { formatEnds } from "../lib/time.ts";
import type { Wallet } from "../wallet/wallet.ts";
import { AutoCollect } from "./AutoCollect.tsx";
import { Button } from "./Button.tsx";
import { Ring } from "./Ring.tsx";
import { Sheet } from "./Sheet.tsx";
import { TradeCard } from "./TradeCard.tsx";
import { TxLink } from "./TxLink.tsx";

export interface QuoteSelection {
  wallet: Wallet;
  series: ListedSeries;
  side: Quote["side"];
  size: bigint;
  budget?: bigint;
}

interface Props extends QuoteSelection {
  onClose: () => void;
  onAddFunds: () => void;
}

export function QuoteSheet({ wallet, series, side, size, budget, onClose, onAddFunds }: Props) {
  const { config } = useApp();
  const data = useData();
  const { quoteDecimals, balance } = data;
  const flow = useQuoteFlow({ wallet, seriesId: series.id, optionAsset: data.optionAsset(series.id), side, size });
  const { phase, now } = flow;
  const frozen = useRef(0);
  const usd = (amount: bigint | string) => formatUsd(BigInt(amount), quoteDecimals, side === "buy" ? "up" : "down");
  const buying = side === "buy";
  const tone = buying ? (series.kind === "call" ? "up" : "down") : "primary";
  const winUpTo = formatUsd(maxPayout(termsOf(series), size), quoteDecimals).replace(/\.00$/, "");

  const { request } = flow;
  useEffect(request, [request]);

  useEffect(() => {
    if (phase.name === "done") data.reload();
  }, [phase.name, data.reload]);

  if (phase.name === "done") {
    return (
      <Sheet title={buying ? "Bought" : "Sold back"} onClose={onClose}>
        <div className="flex flex-col items-center pt-2 pb-6 text-center">
          <div className="grid size-16 place-items-center rounded-full bg-up-field text-up-ink">
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <p className="mt-4 text-2xl font-semibold">{buying ? "You're in" : "Sold"}</p>
          <p className="mt-1 text-ink-2">{buying ? `${seriesTitle(series, quoteDecimals)} · win up to ${winUpTo}` : wallet.kind === "tap" ? "Added to your Tap balance" : "Added to your balance"}</p>
          {buying && <p className="text-sm text-ink-3">Ends {formatEnds(series.expiry)}</p>}
          {phase.txHash && <TxLink hash={phase.txHash} className="mt-3" />}
        </div>
        {buying ? (
          <AutoCollect wallet={wallet} optionAsset={data.optionAsset(series.id)} size={size} expiry={series.expiry} onDone={onClose} />
        ) : (
          <Button size="lg" onClick={onClose}>
            Done
          </Button>
        )}
      </Sheet>
    );
  }

  const live = phase.name === "live" || phase.name === "signing" ? phase.quote : undefined;
  const short = buying && phase.name === "live" && balance !== undefined && balance < BigInt(phase.quote.premium);
  const overBudget = buying && live && budget !== undefined && BigInt(live.premium) > budget;

  return (
    <Sheet title={buying ? "Confirm" : "Sell back"} onClose={onClose} dismissible={!["idle", "loading", "refreshing", "signing", "submitting", "unknown"].includes(phase.name)}>
      {(phase.name === "loading" || phase.name === "idle") && flow.sessionPrompt ? (
        <Status title="Confirm in your wallet" body="One signature lets you get prices for 24 h. No funds move." />
      ) : phase.name === "loading" || phase.name === "idle" ? (
        <Status title="Getting a price…" body="Asking market makers for a firm price." />
      ) : phase.name === "refreshing" ? (
        <div className="space-y-4">
          <Status title="Refreshing price…" body="Getting a new firm price. No signature needed yet." />
          <Button size="lg" disabled>Refreshing price…</Button>
        </div>
      ) : phase.name === "unavailable" && phase.short ? (
        <Retry title="Not enough funds" body={phase.reason} action="Add funds to buy" onRetry={onAddFunds} />
      ) : phase.name === "unavailable" ? (
        <Retry title="No price right now" body={phase.reason} onRetry={request} />
      ) : phase.name === "late" ? (
        <Retry title="Price expired while you were signing" body="Nothing was charged." onRetry={request} />
      ) : phase.name === "expired" ? (
        <Retry title="Price expired" body="Prices hold for a few seconds." onRetry={request} />
      ) : phase.name === "failed" ? (
        <Retry title="Not filled, nothing was charged" body={phase.reason} onRetry={request} />
      ) : phase.name === "unknown" ? (
        <Retry title="Trade status unknown" body="Your trade may have gone through. Check this trade's status before buying again." action="Check status" onRetry={flow.checkStatus} />
      ) : phase.name === "submitting" ? (
        <Status title={buying ? "Buying…" : "Selling…"} body="Settling on NEAR Intents." />
      ) : phase.name === "changed" ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-well p-4">
            <p className="font-semibold">Price changed</p>
            <p className="mt-1 text-lg">
              <span className="text-ink-2 line-through">{usd(phase.quote.premium)}</span> → <span className="font-semibold">{usd(phase.next.premium)}</span>
            </p>
          </div>
          <Button size="lg" tone={tone} onClick={flow.accept}>
            Accept new price
          </Button>
          <Button size="lg" tone="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Ring
              remainingMs={phase.name === "signing" ? frozen.current : phase.quote.sign_by_ms - now}
              totalMs={phase.quote.sign_by_ms - phase.quote.receivedAt}
              frozen={phase.name === "signing"}
            />
            <div>
              <p className="text-3xl font-semibold tabular-nums">{usd(phase.quote.premium)}</p>
              <p className="text-sm text-ink-2">
                {phase.name === "signing" ? "Confirm in your wallet" : phase.refreshed ? "Price refreshed" : "Firm price"}
              </p>
            </div>
            {buying && (
              <div className="ml-auto text-right">
                <p className="text-sm text-ink-2">Win up to</p>
                <p className={`text-2xl font-semibold tabular-nums ${series.kind === "call" ? "text-up-ink" : "text-down-ink"}`}>{winUpTo}</p>
              </div>
            )}
          </div>
          <TradeCard series={series} legs={phase.quote.legs} quoteAsset={config.quoteAsset} quoteDecimals={quoteDecimals} />
          {buying && (
            <p className="rounded-xl bg-well px-4 py-3 text-sm text-ink-2">
              If {series.underlying} {series.kind === "call" ? "rises" : "falls"} too little or too slowly, this can still lose value. Max loss {usd(phase.quote.premium)}.
            </p>
          )}
          {overBudget && <p className="text-sm font-semibold text-ink">Above the {usd(budget)} you picked</p>}
          {flow.walletError && <p className="text-sm text-danger">{flow.walletError}</p>}
          {short ? (
            <Button size="lg" onClick={onAddFunds}>
              Add funds to buy
            </Button>
          ) : (
            <Button
              size="lg"
              tone={tone}
              disabled={phase.name === "signing"}
              onClick={() => {
                frozen.current = phase.quote.sign_by_ms - Date.now();
                void flow.confirm();
              }}
            >
              {phase.name === "signing" ? "Confirm in your wallet" : `${buying ? "Buy" : "Sell back"} for ${usd(phase.quote.premium)}`}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Status({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center py-8 text-center" role="status">
      <span aria-hidden="true" className="block size-8 animate-spin rounded-full border-[3px] border-rule border-t-ink" />
      <p className="mt-4 text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm text-ink-2">{body}</p>
    </div>
  );
}

function Retry({ title, body, action = "Get new price", onRetry }: { title: string; body: string; action?: string; onRetry: () => void }) {
  return (
    <div className="space-y-4">
      <div className="py-4 text-center" role="alert">
        <p className="text-lg font-semibold">{title}</p>
        <p className="mt-1 text-sm text-ink-2">{body}</p>
      </div>
      <Button size="lg" onClick={onRetry}>
        {action}
      </Button>
    </div>
  );
}
