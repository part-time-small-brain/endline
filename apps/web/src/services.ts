import { type Chain, rpcChain } from "./api/chain.ts";
import { deribitMarket, type Market } from "./api/market.ts";
import { oneClick, type OneClick } from "./api/oneClick.ts";
import { httpRelay, type Relay } from "./api/relay.ts";
import type { Config } from "./config.ts";

export interface Services {
  relay: Relay;
  chain: Chain;
  market: Market;
  oneClick: OneClick | null;
}

export function createServices(config: Config): Services {
  return {
    relay: httpRelay(config.relayUrl),
    chain: rpcChain(config.rpcUrls, config.intentsId, config.optionsId),
    market: deribitMarket(),
    oneClick: config.network === "mainnet" ? oneClick(config.relayUrl) : null,
  };
}
