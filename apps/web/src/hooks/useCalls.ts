import { callMultiple, type ListedSeries, termsOf } from "@endline/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { RelayError } from "../api/relay.ts";
import { useApp } from "../app/context.ts";
import { useData } from "../app/data.tsx";
import { seriesTitle } from "../lib/labels.ts";
import { formatMultiple } from "../lib/money.ts";
import { useWallet } from "../wallet/context.tsx";
import { cachedSession, forgetSession, signSession } from "../wallet/session.ts";
import type { TapState } from "./useTaps.ts";

const SHOWN_MS = 3_000;

function messageOf(error: unknown): string {
  if (error instanceof RelayError && error.status === 401) return "Your wallet couldn't sign in. A NEAR wallet needs Enable first, the one-time step before your first buy.";
  const text = error instanceof RelayError && !error.message.startsWith("relay returned") ? error.message : "That call didn't go through. Try again.";
  return `${text.charAt(0).toUpperCase()}${text.slice(1).replace(/\.?$/, ".")}`;
}

export function useCalls() {
  const { config, services } = useApp();
  const { wallet } = useWallet();
  const { quoteDecimals, reloadCalls } = useData();
  const [states, setStates] = useState<Record<string, TapState>>({});
  const [notice, setNotice] = useState<{ text: string; failed: boolean }>();
  const busy = useRef(new Set<string>());
  const owner = useRef(wallet);
  useEffect(() => {
    owner.current = wallet;
    busy.current.clear();
    setStates({});
    setNotice(undefined);
  }, [wallet]);

  const call = useCallback(
    async (series: ListedSeries) => {
      const id = series.id;
      if (!wallet || busy.current.has(id)) return;
      busy.current.add(id);
      setStates((current) => ({ ...current, [id]: { status: "busy" } }));
      const finish = (state: TapState, text: string) => {
        if (owner.current !== wallet) return;
        busy.current.delete(id);
        setStates((current) => ({ ...current, [id]: state }));
        setNotice({ text, failed: state.status === "failed" });
        setTimeout(() => setStates((current) => (current[id] === state ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)) : current)), SHOWN_MS);
      };
      try {
        const session = await (cachedSession(wallet, config.intentsId) ?? signSession(wallet, config.intentsId, services.chain.salt));
        const made = await services.relay.call({ series_id: id, signer: { standard: wallet.standard, signer_id: wallet.accountId }, session });
        reloadCalls();
        finish({ status: "done" }, `Called ${seriesTitle(series, quoteDecimals)} at ${formatMultiple(callMultiple(termsOf(made.terms), BigInt(made.ask)))}.`);
      } catch (error) {
        if (error instanceof RelayError && error.status === 401) forgetSession(wallet, config.intentsId);
        finish({ status: "failed" }, messageOf(error));
      }
    },
    [wallet, config.intentsId, services, quoteDecimals, reloadCalls],
  );

  return { states, notice, call };
}
