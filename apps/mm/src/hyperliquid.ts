import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { privateKeyToAccount } from "viem/accounts";
import type { Exchange, HedgeOrder } from "./hedge.ts";

const SLIPPAGE = 0.005;

class HyperliquidExchange implements Exchange {
  private readonly info: InfoClient;
  private readonly exchange: ExchangeClient;
  private readonly address: `0x${string}`;

  constructor(privateKey: `0x${string}`, account: `0x${string}` | undefined, testnet: boolean) {
    const transport = new HttpTransport({ isTestnet: testnet });
    const wallet = privateKeyToAccount(privateKey);
    this.address = account ?? wallet.address;
    this.info = new InfoClient({ transport });
    this.exchange = new ExchangeClient({ transport, wallet });
  }

  async positions(): Promise<Map<string, number>> {
    const state = await this.info.clearinghouseState({ user: this.address });
    return new Map(state.assetPositions.map(({ position }) => [position.coin, Number(position.szi)]));
  }

  async place(o: HedgeOrder): Promise<void> {
    const [meta, mids] = await Promise.all([this.info.meta(), this.info.allMids()]);
    const asset = meta.universe.findIndex((u) => u.name === o.coin);
    const mid = Number(mids[o.coin]);
    const market = meta.universe[asset];
    if (!market || !(mid > 0)) throw new Error(`no hyperliquid market for ${o.coin}`);
    const limit = mid * (o.isBuy ? 1 + SLIPPAGE : 1 - SLIPPAGE);
    const result = await this.exchange.order({
      orders: [{ a: asset, b: o.isBuy, p: formatPrice(limit, market.szDecimals), s: formatSize(o.size, market.szDecimals), r: false, t: { limit: { tif: "Ioc" } } }],
      grouping: "na",
    });
    const status = result.response.data.statuses[0];
    if (typeof status !== "object" || !("filled" in status)) throw new Error(`hedge order not filled: ${JSON.stringify(status)}`);
  }
}

class DryRunExchange implements Exchange {
  private readonly virtual = new Map<string, number>();

  constructor(private readonly log: (line: string) => void) {}

  async positions(): Promise<Map<string, number>> {
    return new Map(this.virtual);
  }

  async place(o: HedgeOrder): Promise<void> {
    this.log(`hedge disabled, would place IOC ${o.isBuy ? "buy" : "sell"} ${o.size} ${o.coin} @ ~${o.price}`);
    this.virtual.set(o.coin, (this.virtual.get(o.coin) ?? 0) + (o.isBuy ? o.size : -o.size));
  }
}

export function createExchange(
  { privateKey, account, testnet }: { privateKey?: `0x${string}` | undefined; account?: `0x${string}` | undefined; testnet: boolean },
  log: (line: string) => void,
): Exchange {
  return privateKey ? new HyperliquidExchange(privateKey, account, testnet) : new DryRunExchange(log);
}
