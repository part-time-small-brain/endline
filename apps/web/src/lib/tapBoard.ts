import { type Call, callableAt, type ListedSeries } from "@endline/sdk";
import { closingOf } from "./reveal.ts";
import type { PositionStatus, SettlementView } from "./status.ts";

interface Stake {
  series: ListedSeries;
  status: PositionStatus;
}

export function tapBoard<V extends Stake>(symbol: string, listing: ListedSeries[], priced: ListedSeries[], views: V[], calls: Call[], settlementOf: (expiry: number) => SettlementView | null, nowSec: number) {
  const yours = views.filter((v) => v.series.underlying === symbol);
  const here = listing.filter((s) => s.underlying === symbol);
  const calledHere = new Map(calls.filter((c) => c.terms.underlying === symbol).map((c) => [c.series_id, c]));
  const closing = closingOf(here.map((s) => s.expiry), [...yours.map((v) => v.series.expiry), ...[...calledHere.values()].map((c) => c.terms.expiry)], settlementOf, nowSec);
  const stakes = closing ? yours.filter((v) => v.series.expiry === closing.expiry) : [];
  const closingCalls = [...calledHere.values()].filter((c) => c.terms.expiry === closing?.expiry);
  const kept = yours.filter((v) => v.status === "active" || v.series.expiry === closing?.expiry);
  const owned = new Set(kept.map((v) => v.series.id));
  const called = here.filter((s) => calledHere.has(s.id) && (s.expiry === closing?.expiry || callableAt(s.expiry, nowSec)));
  const held = new Set([...owned, ...called.map((s) => s.id)]);
  const open = priced.filter((s) => s.underlying === symbol && s.expiry !== closing?.expiry && !held.has(s.id));
  const rowsElsewhere = new Set([...open, ...kept.map((v) => v.series), ...called].map((s) => s.strike));
  const listed = [...open, ...here.filter((s) => s.expiry === closing?.expiry && !held.has(s.id) && rowsElsewhere.has(s.strike)), ...kept.map((v) => v.series), ...called];
  return { closing, stakes, closingCalls, calledHere, owned, held, listed };
}
