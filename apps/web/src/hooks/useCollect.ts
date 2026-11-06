import { CLAIM_WINDOW_SEC, exerciseOptions, type Diff, payload, type SignedPayload, toSign } from "@endline/sdk";
import { useCallback, useState } from "react";
import { refusedOr } from "../api/relay.ts";
import { useApp } from "../app/context.ts";
import { useData } from "../app/data.tsx";
import type { PositionView } from "../app/usePositions.ts";
import { collectBatches, minRelayedPayout } from "../lib/collect.ts";
import { useWallet } from "../wallet/context.tsx";
import type { Wallet } from "../wallet/wallet.ts";

const DEADLINE_MS = 7 * 60_000;
const EXECUTE_GAS = "300000000000000";

interface CollectState {
  busy: boolean;
  done: boolean;
  error: string | undefined;
  txHash: string | undefined;
}

type AutoCollectState = { status: "off" | "signing" | "on"; error?: string };

function useSignExercise() {
  const { config, services } = useApp();
  return useCallback(
    async (wallet: Wallet, tokens: Diff, deadlineMs: number): Promise<SignedPayload> => {
      const salt = await services.chain.salt();
      const random = crypto.getRandomValues(new Uint8Array(15));
      const p = payload(config.intentsId, wallet.accountId, deadlineMs, salt, random, [exerciseOptions(config.optionsId, tokens)]);
      return wallet.sign(toSign(wallet.standard, p));
    },
    [config, services],
  );
}

export function useCollect() {
  const { config, services } = useApp();
  const { wallet } = useWallet();
  const { optionAsset, quoteDecimals, reload } = useData();
  const signExercise = useSignExercise();
  const [state, setState] = useState<CollectState>({ busy: false, done: false, error: undefined, txHash: undefined });

  const collect = useCallback(
    async (views: PositionView[]) => {
      if (!wallet || views.length === 0) return;
      setState({ busy: true, done: false, error: undefined, txHash: undefined });
      let txHash: string | undefined;
      try {
        for (const batch of collectBatches(views, minRelayedPayout(quoteDecimals))) {
          const call = wallet.call;
          if (!batch.relayed && !call) throw new Error("Payouts under $1 are too small to collect without gas. Collect them from a NEAR wallet.");
          const tokens = Object.fromEntries(batch.views.map((v) => [optionAsset(v.series.id), v.held]));
          const signed = await signExercise(wallet, tokens, Date.now() + DEADLINE_MS);
          if (batch.relayed) txHash = await refusedOr(services.relay.execute(signed), "We couldn't confirm this collect. Check your balance before you try again.");
          else await call?.({ receiverId: config.intentsId, methodName: "execute_intents", args: { signed: [signed] }, gas: EXECUTE_GAS, deposit: "0" });
        }
        setState({ busy: false, done: true, error: undefined, txHash });
      } catch (error) {
        setState({ busy: false, done: false, error: error instanceof Error ? error.message : "Collect failed", txHash });
      } finally {
        reload();
      }
    },
    [wallet, config, services, signExercise, optionAsset, quoteDecimals, reload],
  );

  return { ...state, collect };
}

export function useAutoCollect(wallet: Wallet, optionAsset: string, size: bigint, expiry: number) {
  const { services } = useApp();
  const signExercise = useSignExercise();
  const [state, setState] = useState<AutoCollectState>({ status: "off" });

  const enable = useCallback(async () => {
    setState({ status: "signing" });
    try {
      await services.relay.claim(await signExercise(wallet, { [optionAsset]: size }, (expiry + CLAIM_WINDOW_SEC) * 1000));
      setState({ status: "on" });
    } catch (error) {
      setState({ status: "off", error: error instanceof Error ? error.message : "Auto-collect failed" });
    }
  }, [wallet, services, signExercise, optionAsset, size, expiry]);

  return { ...state, enable };
}
