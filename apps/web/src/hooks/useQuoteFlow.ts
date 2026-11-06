import { type Quote, readPayload, type SignedPayload, type StatusUpdate } from "@endline/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { beforeDeadline, finalStatus, RelayError } from "../api/relay.ts";
import { useApp } from "../app/context.ts";
import { type CheckedQuote, type Phase, reduce, shouldPrefetch } from "../lib/quoteMachine.ts";
import { checkTrade } from "../lib/tradeCheck.ts";
import { cachedSession, forgetSession, signSession } from "../wallet/session.ts";
import type { Wallet } from "../wallet/wallet.ts";
import { useNow } from "./useNow.ts";

const STATUS_TIMEOUT_MS = 60_000;

interface Args {
  wallet: Wallet;
  seriesId: string;
  optionAsset: string;
  side: Quote["side"];
  size: bigint;
}

export function useQuoteFlow({ wallet, seriesId, optionAsset, side, size }: Args) {
  const { config, services } = useApp();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const currentPhase = useRef(phase);
  const dispatch = useCallback((event: Parameters<typeof reduce>[1]) => {
    currentPhase.current = reduce(currentPhase.current, event);
    setPhase(currentPhase.current);
  }, []);
  const [walletError, setWalletError] = useState<string>();
  const [sessionPrompt, setSessionPrompt] = useState(false);
  const now = useNow(200);
  const generation = useRef(0);

  const fetchQuote = useCallback(async (signedSession: Promise<SignedPayload>): Promise<CheckedQuote> => {
    const quoteRequest = {
      series_id: seriesId,
      side,
      size: size.toString(),
      signer: { standard: wallet.standard, signer_id: wallet.accountId },
      session: await signedSession,
    };
    const quote = await services.relay.quote(quoteRequest).catch((error: unknown) => {
      if (error instanceof RelayError && error.status === 401) forgetSession(wallet, config.intentsId);
      throw error;
    });
    const receivedAt = Date.now();
    const legs = checkTrade(readPayload(quote.payload), quote, {
      signerId: wallet.accountId,
      intentsId: config.intentsId,
      optionAsset,
      quoteAsset: config.quoteAsset,
      side,
      size: size.toString(),
    }, receivedAt);
    return { ...quote, legs, receivedAt };
  }, [services, config, wallet, seriesId, optionAsset, side, size]);

  const request = useCallback(() => {
    if (["loading", "refreshing", "signing", "submitting", "unknown"].includes(currentPhase.current.name)) return;
    const current = ++generation.current;
    dispatch({ type: "request" });
    let signedSession = cachedSession(wallet, config.intentsId);
    if (!signedSession) {
      setSessionPrompt(true);
      signedSession = signSession(wallet, config.intentsId, services.chain.salt);
      const prompted = () => setSessionPrompt(false);
      signedSession.then(prompted, prompted);
    }
    fetchQuote(signedSession).then(
      (quote) => current === generation.current && dispatch({ type: "quoted", quote, now: Date.now() }),
      (error: unknown) =>
        current === generation.current &&
        dispatch({
          type: "unavailable",
          reason: error instanceof Error ? error.message : "No price right now",
          short: side === "buy" && error instanceof RelayError && error.status === 402,
        }),
    );
  }, [dispatch, fetchQuote, wallet, config, services, side]);

  useEffect(() => dispatch({ type: "tick", now }), [dispatch, now]);

  useEffect(() => {
    const signedSession = cachedSession(wallet, config.intentsId);
    if (!shouldPrefetch(currentPhase.current, now) || !signedSession) return;
    dispatch({ type: "refresh" });
    const current = ++generation.current;
    fetchQuote(signedSession).then(
      (quote) => current === generation.current && dispatch({ type: "quoted", quote, now: Date.now() }),
      (error: unknown) => current === generation.current && dispatch({
        type: "unavailable",
        reason: error instanceof Error ? error.message : "No price right now",
        short: side === "buy" && error instanceof RelayError && error.status === 402,
      }),
    );
  }, [dispatch, phase, now, fetchQuote, wallet, side]);

  const reconcile = useCallback(async (quote: CheckedQuote, initial?: StatusUpdate, giveUpAt = Date.now() + STATUS_TIMEOUT_MS) => {
    const update = await finalStatus(services.relay, quote.quote_id, initial, giveUpAt);
    if (!update) dispatch({ type: "unknown" });
    else if (update.status === "settled") dispatch({ type: "settled", txHash: update.tx_hash });
    else dispatch({ type: "failed", reason: update.reason ?? update.status });
  }, [dispatch, services]);

  const checkStatus = useCallback(() => {
    if (currentPhase.current.name !== "unknown") return;
    const { quote } = currentPhase.current;
    dispatch({ type: "check" });
    void reconcile(quote);
  }, [dispatch, reconcile]);

  const confirm = useCallback(async () => {
    if (currentPhase.current.name !== "live") return;
    const { quote } = currentPhase.current;
    if (Date.now() >= quote.sign_by_ms) {
      dispatch({ type: "tick", now: Date.now() });
      return;
    }
    setWalletError(undefined);
    dispatch({ type: "sign" });
    let signed: SignedPayload;
    try {
      signed = await wallet.sign(quote.payload);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Signature cancelled");
      dispatch({ type: "cancelled", now: Date.now() });
      return;
    }
    const signedAt = Date.now();
    dispatch({ type: "signed", now: signedAt });
    if (signedAt >= quote.sign_by_ms) return;
    const giveUpAt = Date.now() + STATUS_TIMEOUT_MS;
    const update = await beforeDeadline(services.relay.publish({ quote_id: quote.quote_id, signed }), giveUpAt);
    await reconcile(quote, update, giveUpAt);
  }, [dispatch, wallet, services, reconcile]);

  return { phase, now, walletError, sessionPrompt, request, confirm, checkStatus, accept: () => dispatch({ type: "accept", now: Date.now() }) };
}
