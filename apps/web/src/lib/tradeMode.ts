export type TradeMode = "lite" | "pro" | "tap";

export const TRADE_MODE_KEY = "trade-mode";

export function readTradeMode(stored: string | null): TradeMode {
  return stored === "pro" || stored === "tap" ? stored : "lite";
}

export function tradeModeAfterStorage(key: string | null, value: string | null, current: TradeMode): TradeMode {
  return key === null || key === TRADE_MODE_KEY ? readTradeMode(value) : current;
}
