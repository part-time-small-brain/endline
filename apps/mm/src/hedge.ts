import type { Settings } from "./config.ts";
import type { KillSwitch } from "./killswitch.ts";
import type { Exposure } from "./portfolio.ts";

export const MIN_HEDGE_USD = 10;
const FAILURES_TO_HALT = 2;
const UNMOVED_TO_HALT = 2;

export interface HedgeOrder {
  coin: string;
  isBuy: boolean;
  size: number;
  price: number;
}

export interface Exchange {
  positions(): Promise<Map<string, number>>;
  place(order: HedgeOrder): Promise<void>;
}

export function hedgeOrders(exposures: Map<string, Exposure>, positions: Map<string, number>, spot: (coin: string) => number | undefined, bandUsd: number, maxOrderUsd: number): HedgeOrder[] {
  const orders: HedgeOrder[] = [];
  for (const coin of new Set([...exposures.keys(), ...positions.keys()])) {
    const diff = -(exposures.get(coin)?.delta ?? 0) - (positions.get(coin) ?? 0);
    const price = spot(coin);
    if (price === undefined) throw new Error(`no spot price for ${coin}`);
    if (Math.abs(diff) * price < Math.max(MIN_HEDGE_USD, bandUsd)) continue;
    orders.push({ coin, isBuy: diff > 0, size: Math.min(Math.abs(diff), maxOrderUsd / price), price });
  }
  return orders;
}

export class Hedger {
  private failures = 0;
  private running = false;
  private unmoved = 0;
  private stuck = false;

  constructor(
    private readonly exchange: Exchange,
    private readonly kill: KillSwitch,
    private readonly settings: Settings,
    private readonly log: (line: string) => void,
  ) {}

  async rebalance(exposures: () => Map<string, Exposure>, spot: (coin: string) => number | undefined): Promise<Map<string, number> | undefined> {
    if (this.running || this.stuck) return undefined;
    this.running = true;
    try {
      const target = exposures();
      const before = await this.exchange.positions();
      const orders = hedgeOrders(target, before, spot, this.settings.hedgeBandUsd, this.settings.maxDeltaUsd);
      for (const order of orders) await this.exchange.place(order);
      const positions = await this.exchange.positions();
      this.unmoved = orders.every(({ coin }) => positions.get(coin) !== before.get(coin)) ? 0 : this.unmoved + 1;
      if (this.unmoved >= UNMOVED_TO_HALT) {
        this.stuck = true;
        this.kill.trip("hedge", "a filled order didn't move the position read back: check HL_ACCOUNT_ADDRESS, then restart");
        return undefined;
      }
      this.failures = 0;
      this.kill.clear("hedge");
      this.checkLimits(target, positions, spot);
      return positions;
    } catch (e) {
      this.failures += 1;
      this.log(`hedge failed (${this.failures}): ${e instanceof Error ? e.message : e}`);
      if (this.failures >= FAILURES_TO_HALT) this.kill.trip("hedge", `${this.failures} failures in a row`);
      return undefined;
    } finally {
      this.running = false;
    }
  }

  private checkLimits(target: Map<string, Exposure>, positions: Map<string, number>, spot: (coin: string) => number | undefined): void {
    let deltaUsd = 0;
    let vega = 0;
    for (const [coin, e] of target) {
      deltaUsd = Math.max(deltaUsd, Math.abs(e.delta + (positions.get(coin) ?? 0)) * (spot(coin) ?? Infinity));
      vega += e.vega;
    }
    if (deltaUsd > this.settings.maxDeltaUsd) this.kill.trip("delta", `net delta $${deltaUsd.toFixed(0)}`);
    else this.kill.clear("delta");
    if (Math.abs(vega) > this.settings.maxVegaUsd) this.kill.trip("vega", `net vega $${vega.toFixed(0)}`);
    else this.kill.clear("vega");
  }
}
