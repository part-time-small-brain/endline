import { DEPOSIT_SYMBOLS, type DepositAsset } from "../api/oneClick.ts";

const CHAINS: Record<string, string> = {
  base: "Base",
  arb: "Arbitrum",
  op: "Optimism",
  sol: "Solana",
  pol: "Polygon",
  bsc: "BNB Chain",
  avax: "Avalanche",
  eth: "Ethereum",
  btc: "Bitcoin",
  tron: "Tron",
  gnosis: "Gnosis",
  sui: "Sui",
  aptos: "Aptos",
  abs: "Abstract",
  hood: "Robinhood Chain",
  scroll: "Scroll",
  xlayer: "X Layer",
  monad: "Monad",
  ton: "TON",
  miden: "Miden",
};
export const CHAIN_ORDER = Object.keys(CHAINS);

export const chainName = (code: string) => CHAINS[code] ?? code.toUpperCase();

const rank = (order: string[], key: string) => {
  const at = order.indexOf(key);
  return at < 0 ? order.length : at;
};

export function depositMenu(assets: DepositAsset[]): { symbol: string; networks: DepositAsset[] }[] {
  const symbols = [...new Set(assets.map((a) => a.symbol))].sort((a, b) => rank(DEPOSIT_SYMBOLS, a) - rank(DEPOSIT_SYMBOLS, b));
  return symbols.map((symbol) => ({
    symbol,
    networks: assets.filter((a) => a.symbol === symbol).sort((a, b) => rank(CHAIN_ORDER, a.blockchain) - rank(CHAIN_ORDER, b.blockchain)),
  }));
}
