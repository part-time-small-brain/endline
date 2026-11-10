import { type Call, type Fill, intentsAssetId, type ListedSeries, type Mark, type SeriesListing, type Timing } from "@endline/sdk";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { chartPoints, type MarketSnapshot, type PricePoint } from "../api/market.ts";
import { usePoll } from "../hooks/usePoll.ts";
import { verifiedListing } from "../lib/listing.ts";
import type { SettlementView } from "../lib/status.ts";
import { useWallet } from "../wallet/context.tsx";
import { useApp } from "./context.ts";

export interface AppData {
  listing: SeriesListing | undefined;
  listingError: string | undefined;
  quoteDecimals: number;
  market: MarketSnapshot | undefined;
  marketError: string | undefined;
  marks: Record<string, Mark> | undefined;
  marksError: string | undefined;
  history: Record<string, PricePoint[]> | undefined;
  minutes: Record<string, PricePoint[]> | undefined;
  timing: Timing | undefined;
  balances: Record<string, bigint> | undefined;
  balance: bigint | undefined;
  fills: Fill[] | undefined;
  calls: Call[] | undefined;
  settlements: Record<string, SettlementView | null>;
  optionAsset(seriesId: string): string;
  reload(): void;
  reloadCalls(): void;
}

export const settlementKey = (s: Pick<ListedSeries, "underlying" | "expiry">) => `${s.underlying}:${s.expiry}`;

const DataContext = createContext<AppData | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { config, services } = useApp();
  const { wallet } = useWallet();
  const account = wallet?.accountId ?? "";

  const relayListing = usePoll(() => services.relay.listing(), 15_000, "listing");
  const contract = usePoll(() => services.chain.contract(), 60_000, "contract");
  const listing = useMemo(
    () => (relayListing.data && contract.data ? verifiedListing(relayListing.data, contract.data) : undefined),
    [relayListing.data, contract.data],
  );
  const underlyings = useMemo(() => [...new Set(listing?.series.map((s) => s.underlying))].sort(), [listing]);
  const market = usePoll(underlyings.length ? () => services.market.snapshot(underlyings) : null, 5_000, underlyings.join());
  const marks = usePoll(() => services.relay.marks(), 5_000, "marks");
  const marksById = useMemo(() => marks.data && Object.fromEntries(marks.data.map((m) => [m.series_id, m])), [marks.data]);
  const history = usePoll(
    underlyings.length ? async () => Object.fromEntries(await Promise.all(underlyings.map(async (u) => [u, await services.market.history(u)] as const))) : null,
    60_000,
    underlyings.join(),
  );

  const charts = useMemo(() => history.data && Object.fromEntries(Object.entries(history.data).map(([u, points]) => [u, chartPoints(points)])), [history.data]);
  const optionAsset = useCallback((seriesId: string) => intentsAssetId(config.optionsId, seriesId), [config.optionsId]);
  const assets = useMemo(
    () => [config.quoteAsset, ...(listing?.series.map((s) => optionAsset(s.id)) ?? [])],
    [config.quoteAsset, listing, optionAsset],
  );
  const balances = usePoll(account && listing ? () => services.chain.balances(account, assets) : null, 10_000, `${account}:${assets.length}`);
  const fills = usePoll(account ? () => services.relay.fills(account) : null, 15_000, account);
  const calls = usePoll(account ? () => services.relay.calls(account) : null, 60_000, account);

  const ended = useMemo(() => {
    const nowSec = Date.now() / 1000;
    const touched = new Set((fills.data ?? []).map((f) => f.series_id));
    const keys = (listing?.series ?? [])
      .filter((s) => s.expiry <= nowSec && (touched.has(s.id) || (balances.data?.[optionAsset(s.id)] ?? 0n) > 0n))
      .map(settlementKey);
    const called = (calls.data ?? []).filter((c) => c.terms.expiry <= nowSec).map((c) => settlementKey(c.terms));
    return [...new Set([...keys, ...called])].sort();
  }, [listing, fills.data, balances.data, calls.data, optionAsset]);
  const settlements = usePoll(
    ended.length
      ? async () => {
          const entries = await Promise.all(
            ended.map(async (key) => {
              const [underlying = "", expiry = "0"] = key.split(":");
              return [key, await services.chain.settlement(underlying, Number(expiry))] as const;
            }),
          );
          return Object.fromEntries(entries);
        }
      : null,
    15_000,
    ended.join(),
  );

  const reload = useCallback(() => {
    balances.reload();
    fills.reload();
    settlements.reload();
    calls.reload();
  }, [balances.reload, fills.reload, settlements.reload, calls.reload]);

  const value: AppData = {
    listing,
    listingError: relayListing.error ?? contract.error,
    quoteDecimals: contract.data?.quoteDecimals ?? 6,
    market: market.error ? undefined : market.data,
    marketError: market.error,
    marks: marks.error ? undefined : marksById,
    marksError: marks.error,
    history: history.error ? undefined : charts,
    minutes: history.error ? undefined : history.data,
    timing: contract.data?.timing,
    balances: balances.data,
    balance: balances.data?.[config.quoteAsset],
    fills: fills.data,
    calls: calls.data,
    settlements: settlements.data ?? {},
    optionAsset,
    reload,
    reloadCalls: calls.reload,
  };
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): AppData {
  const value = useContext(DataContext);
  if (!value) throw new Error("DataContext missing");
  return value;
}
