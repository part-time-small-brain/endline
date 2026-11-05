import type { Quote } from "@endline/sdk";
import type { Leg } from "./tradeCheck.ts";

// a quote with the legs checked against it, so the card can never show another quote's
export type CheckedQuote = Quote & { legs: { pay: Leg; receive: Leg }; receivedAt: number };

const PREFETCH_MS = 5_000;
const TOLERANCE_PER_MILLE = 5n;

export type Phase =
  | { name: "idle" }
  | { name: "loading" }
  | { name: "refreshing"; accepted: CheckedQuote }
  | { name: "live"; quote: CheckedQuote; refreshed: boolean; accepted: CheckedQuote }
  | { name: "changed"; quote: CheckedQuote; next: CheckedQuote }
  | { name: "expired"; accepted: CheckedQuote }
  | { name: "signing"; quote: CheckedQuote }
  | { name: "late" }
  | { name: "submitting"; quote: CheckedQuote }
  | { name: "unknown"; quote: CheckedQuote }
  | { name: "done"; txHash: string | undefined }
  | { name: "failed"; reason: string }
  | { name: "unavailable"; reason: string; short: boolean };

type QuoteEvent =
  | { type: "request" }
  | { type: "refresh" }
  | { type: "check" }
  | { type: "unknown" }
  | { type: "quoted"; quote: CheckedQuote; now: number }
  | { type: "unavailable"; reason: string; short: boolean }
  | { type: "tick"; now: number }
  | { type: "accept"; now: number }
  | { type: "sign" }
  | { type: "cancelled"; now: number }
  | { type: "signed"; now: number }
  | { type: "settled"; txHash: string | undefined }
  | { type: "failed"; reason: string };

function acceptable(current: CheckedQuote, next: CheckedQuote): boolean {
  const a = BigInt(current.premium);
  const b = BigInt(next.premium);
  return current.side === "buy" ? b * 1000n <= a * (1000n + TOLERANCE_PER_MILLE) : b * 1000n >= a * (1000n - TOLERANCE_PER_MILLE);
}

const fresh = (quote: CheckedQuote, now: number) => now < quote.sign_by_ms;

function onQuote(phase: Phase, quote: CheckedQuote, now: number): Phase {
  if (!fresh(quote, now)) {
    if (phase.name === "loading") return { name: "expired", accepted: quote };
    if (phase.name === "refreshing") return { name: "expired", accepted: phase.accepted };
    return phase;
  }
  switch (phase.name) {
    case "loading":
      return { name: "live", quote, refreshed: false, accepted: quote };
    case "refreshing":
      return acceptable(phase.accepted, quote) ? { name: "live", quote, refreshed: true, accepted: phase.accepted } : { name: "changed", quote: phase.accepted, next: quote };
    default:
      return phase;
  }
}

export function reduce(phase: Phase, event: QuoteEvent): Phase {
  switch (event.type) {
    case "request":
      return phase.name === "signing" || phase.name === "submitting" || phase.name === "unknown" ? phase : { name: "loading" };
    case "refresh":
      return phase.name === "live" ? { name: "refreshing", accepted: phase.accepted } : phase;
    case "check":
      return phase.name === "unknown" ? { name: "submitting", quote: phase.quote } : phase;
    case "unknown":
      return phase.name === "submitting" ? { name: "unknown", quote: phase.quote } : phase;
    case "quoted":
      return onQuote(phase, event.quote, event.now);
    case "unavailable":
      return phase.name === "loading" || phase.name === "refreshing" ? { name: "unavailable", reason: event.reason, short: event.short } : phase;
    case "tick":
      if (phase.name === "live" && !fresh(phase.quote, event.now)) return { name: "expired", accepted: phase.accepted };
      if (phase.name === "changed" && !fresh(phase.next, event.now)) return { name: "expired", accepted: phase.quote };
      return phase;
    case "accept":
      if (phase.name !== "changed") return phase;
      return fresh(phase.next, event.now) ? { name: "live", quote: phase.next, refreshed: false, accepted: phase.next } : { name: "expired", accepted: phase.next };
    case "sign":
      return phase.name === "live" ? { name: "signing", quote: phase.quote } : phase;
    case "cancelled":
      if (phase.name !== "signing") return phase;
      return fresh(phase.quote, event.now) ? { name: "live", quote: phase.quote, refreshed: false, accepted: phase.quote } : { name: "expired", accepted: phase.quote };
    case "signed":
      if (phase.name !== "signing") return phase;
      return fresh(phase.quote, event.now) ? { name: "submitting", quote: phase.quote } : { name: "late" };
    case "settled":
      return phase.name === "submitting" ? { name: "done", txHash: event.txHash } : phase;
    case "failed":
      return phase.name === "submitting" ? { name: "failed", reason: event.reason } : phase;
  }
}

export function shouldPrefetch(phase: Phase, now: number): boolean {
  return phase.name === "live" && phase.quote.sign_by_ms - now <= PREFETCH_MS;
}
