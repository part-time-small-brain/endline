import { payload, relayedTransfer, toSign, transferFee } from "@endline/sdk";
import { useCallback } from "react";
import { refusedOr } from "../api/relay.ts";
import { useApp } from "../app/context.ts";
import { useData } from "../app/data.tsx";
import type { Wallet } from "../wallet/wallet.ts";

const DEADLINE_MS = 7 * 60_000;

export function useTransfer() {
  const { config, services } = useApp();
  const { quoteDecimals, reload } = useData();
  return useCallback(
    async (from: Wallet, to: string, amount: bigint) => {
      const [relayer, salt] = await Promise.all([services.relay.relayerId(), services.chain.salt()]);
      const moves = relayedTransfer(to, relayer, config.quoteAsset, amount, transferFee(quoteDecimals));
      const random = crypto.getRandomValues(new Uint8Array(15));
      const signed = await from.sign(toSign(from.standard, payload(config.intentsId, from.accountId, Date.now() + DEADLINE_MS, salt, random, moves)));
      try {
        await refusedOr(services.relay.transfer(signed), "We couldn't confirm this move. Check both balances before you try again.");
      } finally {
        reload();
      }
    },
    [config, services, quoteDecimals, reload],
  );
}
