import { defaultExpiry, type ListedSeries, longPayout, type OptionKind, quotableUntil } from "@endline/sdk";
import { useState } from "react";
import type { Side } from "../components/trade/DirectionPicker.tsx";
import { parseBudget, toNumber, toUnits } from "../lib/money.ts";
import { chance, nearestVol } from "../lib/odds.ts";
import { presets } from "../lib/targets.ts";
import { type Ticket, ticket } from "../lib/ticket.ts";
import { useData } from "./data.tsx";

const EXPIRY_CHIPS = 4;
const DEFAULT_BUDGET_USD = 25n;
const REFERENCE_BUDGET_USD = 50n;
const KINDS = ["call", "put"] as const;

const strikeOf = (s: ListedSeries) => BigInt(s.strike);
const byStrike = (a: ListedSeries, b: ListedSeries) => (strikeOf(a) < strikeOf(b) ? -1 : 1);

export function useTicket(nowSec: number) {
  const data = useData();
  const { quoteDecimals, balance } = data;
  const unit = 10n ** BigInt(quoteDecimals);
  const cutoff = data.timing?.write_cutoff_sec ?? 0;
  const open = data.listing?.series.filter((s) => s.quotable && nowSec < quotableUntil(s.expiry, cutoff)) ?? [];
  const symbols = [...new Set(open.map((s) => s.underlying))].sort();

  const [link] = useState(() => new URLSearchParams(window.location.search));
  const [symbolChoice, setSymbol] = useState<string>();
  const [kindChoice, setKind] = useState<OptionKind>();
  const [expiryChoice, setExpiry] = useState<number>();
  const [seriesChoice, setSeries] = useState(() => link.get("series") ?? undefined);
  const [budgetChoice, setBudget] = useState(() => parseBudget(link.get("pay") ?? "", quoteDecimals) ?? undefined);

  const chosen = open.find((s) => s.id === seriesChoice);
  const symbol = symbolChoice && symbols.includes(symbolChoice) ? symbolChoice : (chosen?.underlying ?? symbols[0] ?? "");

  const kind = kindChoice ?? chosen?.kind ?? "call";
  const markOf = (s: ListedSeries) => data.marks?.[s.id];
  const priced = open.filter((s) => ticket(s, unit, markOf(s)).size > 0n);
  const ceiling = priced.reduce((most, s) => {
    const { maxCost } = ticket(s, unit, markOf(s));
    return maxCost > most ? maxCost : most;
  }, 0n);
  const budget = budgetChoice ?? (ceiling > 0n && ceiling < DEFAULT_BUDGET_USD * unit ? ceiling : DEFAULT_BUDGET_USD * unit);
  const price = (s: ListedSeries, amount: bigint = budget): Ticket => ticket(s, amount, markOf(s));
  const expiries = [...new Set(priced.filter((s) => s.underlying === symbol && s.kind === kind).map((s) => s.expiry))]
    .sort((a, b) => a - b)
    .slice(0, EXPIRY_CHIPS);
  const expiry = [expiryChoice, chosen?.expiry].find((e) => e !== undefined && expiries.includes(e)) ?? defaultExpiry(expiries, nowSec);
  const spotNumber = data.market?.spot[symbol];
  const history = data.history?.[symbol] ?? [];
  const spot = spotNumber === undefined ? undefined : toUnits(spotNumber, quoteDecimals);

  const odds = (s: ListedSeries) => chance(s, spotNumber ?? 0, markOf(s)?.vol ?? 0, nowSec, quoteDecimals);
  const usdOf = (s: ListedSeries) => toNumber(strikeOf(s), quoteDecimals);
  const payoutAt = (t: Ticket, end: number) => longPayout(t.terms, t.size, toUnits(end, quoteDecimals));
  const listed = (k: OptionKind) => (spot !== undefined ? priced.filter((s) => s.underlying === symbol && s.kind === k && s.expiry === expiry).sort(byStrike) : []);
  const presetsOf = (list: ListedSeries[], k: OptionKind) => presets(list.map(strikeOf), k, spot ?? 0n);
  const balancedIn = (list: ListedSeries[], k: OptionKind) => list[presetsOf(list, k).find((p) => p.name === "Balanced")?.index ?? -1];

  const up = kind === "call";
  const strikes = listed(kind);
  const choices = presetsOf(strikes, kind);
  const balanced = balancedIn(strikes, kind);
  const series = strikes.find((s) => s.id === seriesChoice) ?? balanced;
  const current = series && price(series);
  const target = series ? strikeOf(series) : spot;
  const dates = expiries.map((end) => {
    const candidates = priced.filter((s) => s.underlying === symbol && s.kind === kind && s.expiry === end).sort(byStrike);
    const distance = (s: ListedSeries) => {
      const diff = strikeOf(s) - (target ?? 0n);
      return diff < 0n ? -diff : diff;
    };
    const closest = target === undefined ? undefined : candidates.reduce<ListedSeries | undefined>(
      (nearest, s) => !nearest || distance(s) < distance(nearest) ? s : nearest, undefined,
    );
    return { end, closest };
  });
  const vol = spot !== undefined ? nearestVol(strikes, data.marks, spot) : undefined;
  const reference = balanced && price(balanced, REFERENCE_BUDGET_USD * unit);
  const opposite = up ? "put" : "call";
  const sides: Side[] = KINDS.map((k) => {
    const shown = k === kind ? series : balancedIn(listed(opposite), opposite);
    return { kind: k, chance: shown && odds(shown) };
  });
  const first = history[0];
  const loading = !(data.market || data.marketError) || !(data.marks || data.marksError);
  const empty = loading
    ? "Loading prices…"
    : spot === undefined
      ? `No live ${symbol} price right now`
      : open.some((s) => s.underlying === symbol && s.kind === kind)
        ? "No prices right now"
        : `No ${up ? "Up" : "Down"} markets on ${symbol} right now`;

  const notice = data.listingError && !data.listing
    ? { title: "Can't reach the market", body: data.listingError }
    : !data.listing
      ? { title: "Loading markets…", body: "Getting the latest prices." }
      : !symbol
        ? { title: "No markets open", body: "New dates open regularly. Check back soon." }
        : undefined;

  return {
    data, quoteDecimals, balance, unit, symbols, symbol, kind, expiry, budget, ceiling,
    setSymbol, setKind, setExpiry, setSeries, setBudget,
    spotNumber, spot, history, odds, usdOf, payoutAt, up, strikes, choices,
    series, current, vol, reference, sides, first, empty, expiries, dates, notice, priced, loading,
  };
}
