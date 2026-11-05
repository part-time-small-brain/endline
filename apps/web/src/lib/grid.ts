import { type ListedSeries, longPayout, type Mark, type OptionKind } from "@endline/sdk";
import { payoutMultiple, type Ticket, ticket } from "./ticket.ts";

export interface GridCell {
  series: ListedSeries;
  ticket: Ticket;
  multiple: bigint | undefined;
  held: boolean;
  winning: boolean;
}

interface Grid {
  strikes: bigint[];
  expiries: number[];
  cells: (GridCell | undefined)[][];
}

export function buildGrid(listed: ListedSeries[], spot: bigint, stake: bigint, marks: Record<string, Mark> | undefined, held: ReadonlySet<string>): Grid {
  const strikes = [...new Set(listed.map((s) => s.strike))].map(BigInt).sort((a, b) => (a < b ? 1 : -1));
  const expiries = [...new Set(listed.map((s) => s.expiry))].sort((a, b) => a - b);
  const at = (strike: bigint, expiry: number, kind: OptionKind) => listed.find((s) => BigInt(s.strike) === strike && s.expiry === expiry && s.kind === kind);
  const cells = strikes.map((strike) =>
    expiries.map((expiry) => {
      const natural = strike > spot ? "call" : "put";
      const both = [at(strike, expiry, natural), at(strike, expiry, natural === "call" ? "put" : "call")];
      const series = both.find((s) => s && held.has(s.id)) ?? both[0];
      if (!series) return undefined;
      const priced = ticket(series, stake, marks?.[series.id]);
      const mine = held.has(series.id);
      const winning = mine && longPayout(priced.terms, priced.terms.unit, spot) > 0n;
      return { series, ticket: priced, multiple: payoutMultiple(priced), held: mine, winning };
    }),
  );
  return { strikes, expiries, cells };
}

export function rowOf(strikes: bigint[], price: bigint): number {
  if (strikes.length < 2) return 0;
  const below = strikes.findIndex((strike) => strike <= price);
  const i = Math.min(Math.max(below === -1 ? strikes.length - 1 : below, 1), strikes.length - 1);
  const upper = Number(strikes[i - 1]);
  const row = i - 1 + (upper - Number(price)) / (upper - Number(strikes[i]));
  return Math.min(Math.max(row, -0.5), strikes.length - 0.5);
}
