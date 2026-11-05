import { HttpTransport } from "@nktkas/hyperliquid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS } from "./fixtures/desk.ts";
import { type Exchange, type HedgeOrder, Hedger, hedgeOrders, MIN_HEDGE_USD } from "./hedge.ts";
import { createExchange } from "./hyperliquid.ts";
import { KillSwitch } from "./killswitch.ts";

const hl = vi.hoisted(() => ({ exchange: vi.fn(), info: vi.fn(), order: vi.fn() }));

vi.mock("@nktkas/hyperliquid", () => ({
  HttpTransport: vi.fn(),
  InfoClient: hl.info,
  ExchangeClient: vi.fn(function ExchangeClient(...args: unknown[]) {
    hl.exchange(...args);
    return { order: hl.order };
  }),
}));

const BTC = 80_000;
const spot = (coin: string) => (coin === "BTC" ? BTC : undefined);
const exposures = (delta: number) => () => new Map([["BTC", { delta, vega: 0 }]]);

class FillingExchange implements Exchange {
  readonly held = new Map<string, number>();
  orders = 0;
  constructor(private failures = 0) {}
  async positions(): Promise<Map<string, number>> {
    return new Map(this.held);
  }
  async place(o: HedgeOrder): Promise<void> {
    if (this.failures-- > 0) throw new Error("rejected");
    this.orders++;
    this.held.set(o.coin, (this.held.get(o.coin) ?? 0) + (o.isBuy ? o.size : -o.size));
  }
}

describe("hedging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never touches the Hyperliquid client without HL_PRIVATE_KEY, but still logs the order", async () => {
    const lines: string[] = [];
    const kill = new KillSwitch(() => {});
    const hedger = new Hedger(createExchange({ testnet: false }, (l) => lines.push(l)), kill, SETTINGS, () => {});
    const positions = await hedger.rebalance(exposures(0.02), spot);
    expect(hl.exchange).not.toHaveBeenCalled();
    expect(hl.info).not.toHaveBeenCalled();
    expect(hl.order).not.toHaveBeenCalled();
    expect(lines).toEqual(["hedge disabled, would place IOC sell 0.02 BTC @ ~80000"]);
    expect(positions?.get("BTC")).toBe(-0.02);
    expect(kill.reason()).toBeUndefined();
  });

  it("sells perps against long delta, buys against short delta, and skips anything under $10 or the band", () => {
    expect(hedgeOrders(exposures(0.01)(), new Map(), spot, 0, 1e9)).toEqual([{ coin: "BTC", isBuy: false, size: 0.01, price: BTC }]);
    expect(hedgeOrders(exposures(-0.01)(), new Map([["BTC", 0.005]]), spot, 0, 1e9)).toEqual([{ coin: "BTC", isBuy: true, size: 0.005, price: BTC }]);
    expect(hedgeOrders(exposures((MIN_HEDGE_USD - 0.01) / BTC)(), new Map(), spot, 0, 1e9)).toEqual([]);
    expect(hedgeOrders(exposures(40 / BTC)(), new Map(), spot, 50, 1e9)).toEqual([]);
    expect(hedgeOrders(new Map(), new Map([["BTC", -0.02]]), spot, 0, 1e9)).toEqual([{ coin: "BTC", isBuy: true, size: 0.02, price: BTC }]);
  });

  it("refuses to size a hedge without a spot price", () => {
    expect(() => hedgeOrders(exposures(0.01)(), new Map(), () => undefined, 0, 1e9)).toThrow();
  });

  it("halts quoting after two failed hedges in a row and resumes after a success", async () => {
    const kill = new KillSwitch(() => {});
    const hedger = new Hedger(new FillingExchange(2), kill, { ...SETTINGS, maxDeltaUsd: 1e9 }, () => {});
    await hedger.rebalance(exposures(0.05), spot);
    expect(kill.reason()).toBeUndefined();
    await hedger.rebalance(exposures(0.05), spot);
    expect(kill.reason()).toMatch(/^hedge/);
    await hedger.rebalance(exposures(0.05), spot);
    expect(kill.reason()).toBeUndefined();
  });

  it("counts a portfolio it can't price as a failed hedge", async () => {
    const kill = new KillSwitch(() => {});
    const hedger = new Hedger(createExchange({ testnet: false }, () => {}), kill, SETTINGS, () => {});
    const unpriced = () => {
      throw new Error("no market data");
    };
    await hedger.rebalance(unpriced, spot);
    await hedger.rebalance(unpriced, spot);
    expect(kill.reason()).toMatch(/^hedge/);
  });

  it("trips the delta and vega kill switches when the hedged book is still over the limits", async () => {
    const kill = new KillSwitch(() => {});
    await new Hedger(new FillingExchange(), kill, SETTINGS, () => {}).rebalance(() => new Map([["BTC", { delta: 0.1, vega: -500 }]]), spot);
    expect(kill.reason()).toMatch(/delta.*vega/);
  });

  it("caps each order at the delta limit, so a wrong position read can't hedge without bound", () => {
    expect(hedgeOrders(exposures(1)(), new Map(), spot, 0, 2_000)).toEqual([{ coin: "BTC", isBuy: false, size: 0.025, price: BTC }]);
  });

  it("stops placing orders, until restart, once filled orders twice leave the position it reads unchanged", async () => {
    const kill = new KillSwitch(() => {});
    const exchange = new FillingExchange();
    const wrongAccount: Exchange = { positions: async () => new Map(), place: (o) => exchange.place(o) };
    const hedger = new Hedger(wrongAccount, kill, SETTINGS, () => {});
    for (let i = 0; i < 4; i++) await hedger.rebalance(exposures(0.05), spot);
    expect(exchange.orders).toBe(2);
    expect(kill.reason()).toMatch(/hedge: .*HL_ACCOUNT_ADDRESS/);
  });

  it("rides out a position read that lags one fill behind", async () => {
    const kill = new KillSwitch(() => {});
    const exchange = new FillingExchange();
    let lagging: Map<string, number> | undefined;
    const laggy: Exchange = {
      positions: async () => {
        const read = lagging ?? exchange.positions();
        lagging = undefined;
        return read;
      },
      place: async (o) => {
        lagging = await exchange.positions();
        await exchange.place(o);
      },
    };
    const hedger = new Hedger(laggy, kill, SETTINGS, () => {});
    for (let i = 0; i < 4; i++) await hedger.rebalance(exposures(0.02), spot);
    expect(exchange.orders).toBe(1);
    expect(kill.reason()).toBeUndefined();
  });

  it("reads positions of HL_ACCOUNT_ADDRESS when set, on Hyperliquid testnet unless NEAR is on mainnet", async () => {
    const clearinghouseState = vi.fn(async () => ({ assetPositions: [{ position: { coin: "BTC", szi: "-0.5" } }] }));
    hl.info.mockImplementation(function InfoClient() {
      return { clearinghouseState };
    });
    const privateKey = `0x${"11".repeat(32)}` as const;
    const account = `0x${"ab".repeat(20)}` as const;
    expect(await createExchange({ privateKey, account, testnet: true }, () => {}).positions()).toEqual(new Map([["BTC", -0.5]]));
    expect(clearinghouseState).toHaveBeenCalledWith({ user: account });
    expect(HttpTransport).toHaveBeenCalledWith({ isTestnet: true });
    await createExchange({ privateKey, testnet: false }, () => {}).positions();
    expect(clearinghouseState).toHaveBeenLastCalledWith({ user: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A" });
    expect(HttpTransport).toHaveBeenLastCalledWith({ isTestnet: false });
  });
});
