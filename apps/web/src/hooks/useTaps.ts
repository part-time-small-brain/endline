import { type ListedSeries, readPayload } from "@endline/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { beforeDeadline, finalStatus, RelayError } from "../api/relay.ts";
import { useApp } from "../app/context.ts";
import { useData } from "../app/data.tsx";
import { seriesTitle } from "../lib/labels.ts";
import { formatUsd } from "../lib/money.ts";
import { decide } from "../lib/tap.ts";
import { checkTrade } from "../lib/tradeCheck.ts";
import { cachedSession, forgetSession, signSession } from "../wallet/session.ts";
import type { Wallet } from "../wallet/wallet.ts";
import { useClaim } from "./useCollect.ts";

const STATUS_TIMEOUT_MS = 60_000;
const SHOWN_MS = 3_000;
const REFUSED: Record<string, string> = {
  moved: "The price moved. Tap again for the new one.",
  expired: "The price expired. Tap again.",
};

export type TapState = { status: "busy" } | { status: "done" } | { status: "failed" };

interface TapOrder {
  series: ListedSeries;
  size: bigint;
  stake: bigint;
  // the N× on the cell, in tenths
  multiple: bigint;
}

class Cancelled extends Error {}

function messageOf(error: unknown): string {
  if (error instanceof RelayError && error.status === 429) return "Too fast. Try again in a few seconds.";
  if (error instanceof RelayError && error.status === 402) return "Not enough in your Tap balance.";
  return error instanceof Error ? error.message : "That tap didn't go through. Nothing was charged.";
}

export function useTaps(owner: string | undefined) {
  const { config, services } = useApp();
  const { optionAsset, quoteDecimals, reload } = useData();
  const claim = useClaim();
  const [states, setStates] = useState<Record<string, TapState>>({});
  const [notice, setNotice] = useState<{ text: string; failed: boolean }>();
  const queue = useRef(Promise.resolve());
  const busy = useRef(new Set<string>());
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current++;
      setStates({});
    },
    [owner],
  );

  const trade = useCallback(
    async (payer: Wallet, { series, size, stake, multiple }: TapOrder, at: number): Promise<{ paid: bigint; autoCollect: Promise<string | undefined> }> => {
      if (at !== generation.current) throw new Cancelled();
      const session = await (cachedSession(payer, config.intentsId) ?? signSession(payer, config.intentsId, services.chain.salt));
      const signer = { standard: payer.standard, signer_id: payer.accountId };
      const quote = await services.relay.quote({ series_id: series.id, side: "buy", size: size.toString(), signer, session }).catch((error: unknown) => {
        if (error instanceof RelayError && error.status === 401) forgetSession(payer, config.intentsId);
        throw error;
      });
      checkTrade(readPayload(quote.payload), quote, { signerId: payer.accountId, intentsId: config.intentsId, optionAsset: optionAsset(series.id), quoteAsset: config.quoteAsset, side: "buy", size: size.toString() }, Date.now());
      const decision = decide(quote, series, multiple, stake, Date.now());
      if (decision !== "sign") throw new Error(REFUSED[decision]);
      const signed = await payer.sign(quote.payload);
      const giveUpAt = Date.now() + STATUS_TIMEOUT_MS;
      const published = await beforeDeadline(services.relay.publish({ quote_id: quote.quote_id, signed }), giveUpAt);
      const update = await finalStatus(services.relay, quote.quote_id, published, giveUpAt);
      if (!update) throw new Error("This trade's status is unknown. Check Positions before tapping it again.");
      if (update.status !== "settled") throw new Error("Not filled. Nothing was charged.");
      const autoCollect = claim(payer, optionAsset(series.id), size, series.expiry).then(
        () => undefined,
        (error: unknown) => (error instanceof Error ? error.message : "the relay refused it"),
      );
      return { paid: BigInt(quote.premium), autoCollect };
    },
    [config, services, optionAsset, claim],
  );

  const tap = useCallback(
    (payer: Wallet, order: TapOrder) => {
      const id = order.series.id;
      if (busy.current.has(id)) return;
      busy.current.add(id);
      const at = generation.current;
      setStates((current) => ({ ...current, [id]: { status: "busy" } }));
      const finish = (state: TapState, text?: string) => {
        busy.current.delete(id);
        setStates((current) => ({ ...current, [id]: state }));
        if (text) setNotice({ text, failed: state.status === "failed" });
        reload();
        setTimeout(() => setStates((current) => (current[id] === state ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)) : current)), SHOWN_MS);
      };
      queue.current = queue.current.then(() => trade(payer, order, at)).then(
        ({ paid, autoCollect }) => {
          const bought = `Bought ${seriesTitle(order.series, quoteDecimals)} for ${formatUsd(paid, quoteDecimals)}`;
          finish({ status: "done" }, `${bought}.`);
          void autoCollect.then((reason) => reason && setNotice({ text: `${bought}, but auto-collect is off (${reason}). Collect it in Positions once the price is final.`, failed: true }));
        },
        (error: unknown) => {
          if (error instanceof Cancelled) busy.current.delete(id);
          else finish({ status: "failed" }, messageOf(error));
        },
      );
    },
    [trade, reload, quoteDecimals],
  );

  return { states, notice, tap };
}
