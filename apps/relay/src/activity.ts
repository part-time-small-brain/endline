import { type Call, callMultiple, type Fill, formatMultiple, formatToken, formatUsd, type Series, seriesTitle, termsOf } from "@endline/sdk";

export type Network = "mainnet" | "testnet";

export interface Deposit {
  address: string;
  accountId: string;
  sent: string;
  amountOut: bigint;
  deadlineMs: number;
  status?: string;
}

export type Activity =
  | { kind: "trade"; fill: Fill }
  | { kind: "collect"; accountId: string; legs: { series: Series; amount: bigint }[]; payout: bigint; txHash: string; auto: boolean }
  | { kind: "call"; call: Call }
  | { kind: "deposit"; deposit: Deposit; outcome: "issued" | "SUCCESS" | "REFUNDED" | "FAILED" | "expired" };

const DEPOSIT_TITLES = {
  issued: ["📥", "Deposit address issued"],
  SUCCESS: ["💵", "Deposit credited"],
  REFUNDED: ["↩️", "Deposit refunded"],
  FAILED: ["❌", "Deposit failed"],
  expired: ["⌛", "Deposit expired"],
} as const;

const utc = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function render(network: Network, activity: Activity, listing: ReadonlyMap<string, Series>, quoteDecimals: number): string {
  const message = (icon: string, title: string, details: string[]) => `${icon} ${network} · ${title}\n${details.join(" · ")}`;
  const link = (txHash: string) => `https://${network === "testnet" ? "testnet." : ""}nearblocks.io/txns/${txHash}`;
  const name = (series: Omit<Series, "id">) => `${seriesTitle(series, quoteDecimals)}, ends ${utc.format(series.expiry * 1000).replace(",", "")} UTC`;
  const usd = (amount: bigint) => formatUsd(amount, quoteDecimals);
  switch (activity.kind) {
    case "trade": {
      const { fill } = activity;
      const series = listing.get(fill.series_id);
      if (!series) throw new Error(`unknown series ${fill.series_id}`);
      const buy = fill.side === "buy";
      const size = `${formatToken(BigInt(fill.size), series.underlying_decimals)} ${series.underlying}`;
      return message(buy ? "🟢" : "🟠", `${buy ? "Buy" : "Sell back"} ${name(series)}`, [`${usd(BigInt(fill.premium))} for ${size}`, fill.account_id, link(fill.tx_hash)]);
    }
    case "collect": {
      const legs = activity.legs.map(({ series, amount }) => `${formatToken(amount, series.underlying_decimals)} × ${name(series)}`);
      return message("💰", `${activity.auto ? "Auto-collect" : "Collect"} ${usd(activity.payout)}`, [...legs, activity.accountId, link(activity.txHash)]);
    }
    case "call": {
      const { call } = activity;
      return message("🎯", `Free call ${name(call.terms)}`, [`pays up to ${formatMultiple(callMultiple(termsOf(call.terms), BigInt(call.ask)))}`, call.account_id]);
    }
    case "deposit": {
      const { deposit, outcome } = activity;
      const [icon, title] = DEPOSIT_TITLES[outcome];
      const last = outcome === "expired" ? [`last status ${deposit.status ?? "unknown"}`] : [];
      return message(icon, title, [`${deposit.sent} for about ${usd(deposit.amountOut)}`, deposit.accountId, ...last]);
    }
  }
}
