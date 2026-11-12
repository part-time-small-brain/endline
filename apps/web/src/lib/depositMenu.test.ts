import { expect, it } from "vitest";
import { chainName, depositMenu } from "./depositMenu.ts";

const asset = (symbol: string, blockchain: string) => ({ assetId: `nep141:${blockchain}-${symbol}`, symbol, blockchain, decimals: 6, price: 1 });

it("puts USDC first and lists its networks cheapest first, whatever order 1Click sends", () => {
  const chains = ["zora", "ton", "eth", "gnosis", "avax", "bsc", "pol", "sol", "op", "arb", "base", "aaa"];
  const menu = depositMenu([asset("SOL", "sol"), asset("ETH", "eth"), ...chains.map((c) => asset("USDC", c)), asset("USDT", "tron"), asset("BTC", "btc")]);
  expect(menu.map((t) => t.symbol)).toEqual(["USDC", "USDT", "ETH", "BTC", "SOL"]);
  expect(menu[0]?.networks.map((a) => chainName(a.blockchain))).toEqual(["Base", "Arbitrum", "Optimism", "Solana", "Polygon", "BNB Chain", "Avalanche", "Ethereum", "Gnosis", "TON", "ZORA", "AAA"]);
});
