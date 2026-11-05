import { type Fill, intentsAssetId, type ListedSeries, type Mark, type SeriesListing, type Timing } from "@near-options/sdk";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import type { MarketSnapshot, PricePoint } from "../api/market.ts";
import { usePoll } from "../hooks/usePoll.ts";
import { verifiedListing } from "../lib/listing.ts";
import type { SettlementView } from "../lib/status.ts";
import { useWallet } from "../wallet/context.tsx";
import { useTap } from "../wallet/tapBalance.tsx";
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
  timing: Timing | undefined;
  balances: Record<string, bigint> | undefined;
  balance: bigint | undefined;
  fills: Fill[] | undefined;
  tapBalances: Record<string, bigint> | undefined;
  tapBalance: bigint | undefined;
  tapFills: Fill[] | undefined;
  settlements: Record<string, SettlementView | null>;
  optionAsset(seriesId: string): string;
  reload(): void;
}

export const settlementKey = (s: Pick<ListedSeries, "underlying" | "expiry">) => `${s.underlying}:${s.expiry}`;

const DataContext = createContext<AppData | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { config, services } = useApp();
  const { wallet } = useWallet();
  const account = wallet?.accountId ?? "";
  const tapAccount = useTap().accountId ?? "";

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

  const optionAsset = useCallback((seriesId: string) => intentsAssetId(config.optionsId, seriesId), [config.optionsId]);
  const assets = useMemo(
    () => [config.quoteAsset, ...(listing?.series.map((s) => optionAsset(s.id)) ?? [])],
    [config.quoteAsset, listing, optionAsset],
  );
  const balances = usePoll(account && listing ? () => services.chain.balances(account, assets) : null, 10_000, `${account}:${assets.length}`);
  const fills = usePoll(account ? () => services.relay.fills(account) : null, 15_000, account);
  const tapBalances = usePoll(tapAccount && listing ? () => services.chain.balances(tapAccount, assets) : null, 10_000, `${tapAccount}:${assets.length}`);
  const tapFills = usePoll(tapAccount ? () => services.relay.fills(tapAccount) : null, 15_000, tapAccount);

  const ended = useMemo(() => {
    const nowSec = Date.now() / 1000;
    const touched = new Set([...(fills.data ?? []), ...(tapFills.data ?? [])].map((f) => f.series_id));
    const held = (s: ListedSeries) => [balances.data, tapBalances.data].some((owned) => (owned?.[optionAsset(s.id)] ?? 0n) > 0n);
    const keys = (listing?.series ?? [])
      .filter((s) => s.expiry <= nowSec && (touched.has(s.id) || held(s)))
      .map(settlementKey);
    return [...new Set(keys)].sort();
  }, [listing, fills.data, balances.data, tapFills.data, tapBalances.data, optionAsset]);
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
    tapBalances.reload();
    tapFills.reload();
    settlements.reload();
    marks.reload();
  }, [balances.reload, fills.reload, tapBalances.reload, tapFills.reload, settlements.reload, marks.reload]);

  const value: AppData = {
    listing,
    listingError: relayListing.error ?? contract.error,
    quoteDecimals: contract.data?.quoteDecimals ?? 6,
    market: market.data,
    marketError: market.error,
    marks: marks.error ? undefined : marksById,
    marksError: marks.error,
    history: history.data,
    timing: contract.data?.timing,
    balances: balances.data,
    balance: balances.data?.[config.quoteAsset],
    fills: fills.data,
    tapBalances: tapBalances.data,
    tapBalance: tapBalances.data?.[config.quoteAsset],
    tapFills: tapFills.data,
    settlements: settlements.data ?? {},
    optionAsset,
    reload,
  };
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): AppData {
  const value = useContext(DataContext);
  if (!value) throw new Error("DataContext missing");
  return value;
}
