import type { PendingChanges, ProposedSettlement, SettlementTerms } from "./chain.ts";

const MAX_DEV_BPS = 20;
const MIN_RESERVE_YOCTO = 2n * 10n ** 24n;
const YOCTO_PER_BYTE = 10n ** 19n;

export interface Alert {
  key: string;
  text: string;
}

export interface Contract extends SettlementTerms {
  optionsId: string;
  networkId: string;
}

export interface ExpiryState {
  underlying: string;
  expiry: number;
  settlement: ProposedSettlement | null;
  reference: number | undefined;
}

export function settlementAlert(c: Contract, s: ExpiryState, nowSec: number): Alert | undefined {
  const name = `${s.underlying} ${iso(s.expiry)}`;
  const args = { underlying: s.underlying, expiry: s.expiry, price: "<price>" };
  const reference = s.reference === undefined ? "no Deribit reference" : `Deribit ${s.reference.toFixed(2)}`;
  if (!s.settlement) {
    if (nowSec < s.expiry + c.oracleWindowSec) return undefined;
    const propose = nearCall(c, "propose_settlement", args, "1 yoctoNEAR", c.oracles[0] ?? "<oracle>");
    return { key: `missing ${s.underlying} ${s.expiry}`, text: `${name}: no settlement after the oracle window, ${reference}. Propose: ${propose}` };
  }
  if (nowSec >= s.settlement.final_at) return undefined;
  const proposed = Number(s.settlement.price) / 10 ** c.quoteDecimals;
  const off = s.reference === undefined ? undefined : bps(proposed, s.reference);
  if (off !== undefined && off <= MAX_DEV_BPS) return undefined;
  const gap = off === undefined ? "" : ` (${off.toFixed(0)} bps off)`;
  const override = nearCall(c, "override_settlement", args, "1 yoctoNEAR", c.ownerId);
  return {
    key: `settle ${s.underlying} ${s.expiry}`,
    text: `${name}: proposed ${proposed.toFixed(2)} by ${s.settlement.proposed_by}, ${reference}${gap}, final at ${iso(s.settlement.final_at)}. Override: ${override}`,
  };
}

export function reserveAlert(accountId: string, amount: bigint, storageUsage: number): Alert | undefined {
  const free = amount - BigInt(storageUsage) * YOCTO_PER_BYTE;
  if (free >= MIN_RESERVE_YOCTO) return undefined;
  return { key: `reserve ${accountId}`, text: `${accountId}: ${toNear(free)} NEAR above storage, below the ${toNear(MIN_RESERVE_YOCTO)} NEAR reserve. Top it up` };
}

export function pendingAlerts(optionsId: string, p: PendingChanges): Alert[] {
  const alerts = p.oracles.map(([id, activeAt]) => ({ key: `pending oracle ${id} ${activeAt}`, text: `${optionsId}: oracle ${id} pending, active at ${iso(activeAt)}` }));
  if (p.oracle_wasm) {
    const { oracle_wasm: w, active_at } = p.oracle_wasm;
    alerts.push({ key: `pending wasm ${w.sha256} ${active_at}`, text: `${optionsId}: oracle WASM ${w.sha256} (${w.url}, ${w.outlayer_id}) pending, active at ${iso(active_at)}` });
  }
  if (p.pending_owner_id) {
    alerts.push({ key: `pending owner ${p.pending_owner_id}`, text: `${optionsId}: owner ${p.pending_owner_id} pending, takes over when it calls accept_owner` });
  }
  return alerts;
}

export function dedupe(open: ReadonlySet<string>, alerts: Alert[]): { fresh: Alert[]; resolved: string[] } {
  const now = new Set(alerts.map((a) => a.key));
  return { fresh: alerts.filter((a) => !open.has(a.key)), resolved: [...open].filter((key) => !now.has(key)) };
}

function bps(a: number, b: number): number {
  return (Math.abs(a - b) * 10_000) / Math.min(a, b);
}

function toNear(yocto: bigint): string {
  return (Number(yocto) / 1e24).toFixed(3);
}

function iso(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString();
}

function nearCall(c: Contract, method: string, args: object, deposit: string, signer: string): string {
  return `near contract call-function as-transaction ${c.optionsId} ${method} json-args '${JSON.stringify(args)}' prepaid-gas '30 Tgas' attached-deposit '${deposit}' sign-as ${signer} network-config ${c.networkId} sign-with-legacy-keychain send`;
}
