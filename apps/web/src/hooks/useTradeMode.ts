import { useSyncExternalStore } from "react";
import { readTradeMode, TRADE_MODE_KEY, tradeModeAfterStorage, type TradeMode } from "../lib/tradeMode.ts";

const listeners = new Set<() => void>();

function stored(): string | null {
  try {
    return localStorage.getItem(TRADE_MODE_KEY);
  } catch {
    return null;
  }
}

let mode = readTradeMode(stored());

function notify() {
  for (const listener of listeners) listener();
}

addEventListener("storage", (event) => {
  mode = tradeModeAfterStorage(event.key, event.newValue, mode);
  notify();
});

export function setTradeMode(next: TradeMode) {
  mode = next;
  try {
    localStorage.setItem(TRADE_MODE_KEY, next);
  } catch {}
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTradeMode(): TradeMode {
  return useSyncExternalStore(subscribe, () => mode);
}
