import { Call, type CallRequest, Fill, Leaderboard, Mark, type PublishRequest, Quote, type QuoteRequest, SeriesListing, type SignedPayload, StatusUpdate } from "@endline/sdk";
import { z } from "zod";

export interface Relay {
  listing(): Promise<SeriesListing>;
  marks(): Promise<Mark[]>;
  quote(request: QuoteRequest): Promise<Quote>;
  publish(request: PublishRequest): Promise<StatusUpdate>;
  status(quoteId: string): Promise<StatusUpdate>;
  fills(accountId: string): Promise<Fill[]>;
  execute(signed: SignedPayload): Promise<string>;
  transfer(signed: SignedPayload): Promise<string>;
  relayerId(): Promise<string>;
  claim(signed: SignedPayload): Promise<void>;
  faucet(accountId: string): Promise<string>;
  call(request: CallRequest): Promise<Call>;
  calls(accountId: string): Promise<Call[]>;
  leaderboard(accountId?: string): Promise<Leaderboard>;
}

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const MARKS_TIMEOUT_MS = 5_000;
const STATUS_POLL_MS = 1_000;
const DONE = new Set(["settled", "failed", "expired"]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function beforeDeadline<T>(request: Promise<T>, deadline: number): Promise<T | undefined> {
  let cancel = () => {};
  try {
    return await Promise.race([
      request.catch(() => undefined),
      new Promise<undefined>((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
        cancel = () => clearTimeout(timer);
      }),
    ]);
  } finally {
    cancel();
  }
}

export async function finalStatus(relay: Pick<Relay, "status">, quoteId: string, initial: StatusUpdate | undefined, giveUpAt: number): Promise<StatusUpdate | undefined> {
  let update = initial;
  while (true) {
    if (update?.quote_id === quoteId && DONE.has(update.status)) return update;
    if (Date.now() >= giveUpAt) return undefined;
    if (update) await sleep(STATUS_POLL_MS);
    update = await beforeDeadline(relay.status(quoteId), giveUpAt);
    if (!update && Date.now() < giveUpAt) await sleep(STATUS_POLL_MS);
  }
}

export function refusedOr<T>(request: Promise<T>, unconfirmed: string): Promise<T> {
  return request.catch((error: unknown) => {
    if (error instanceof RelayError && error.status < 500) throw error;
    throw new Error(unconfirmed);
  });
}

const Executed = z.object({ tx_hash: z.string() });
const Claimed = z.object({ ok: z.literal(true) });
const Health = z.object({ relayer_id: z.string() });

async function call<T>(url: string, schema: z.ZodType<T>, body?: unknown, signal: AbortSignal | null = null): Promise<T> {
  const init = body === undefined ? { signal } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal };
  const response = await fetch(url, init);
  const json: unknown = await response.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (parsed.success) return parsed.data;
  const error = z.object({ error: z.string() }).safeParse(json);
  throw new RelayError(error.success ? error.data.error : `relay returned ${response.status}`, response.status);
}

export function httpRelay(baseUrl: string): Relay {
  const url = (path: string) => new URL(path, baseUrl).toString();
  return {
    listing: () => call(url("/series"), SeriesListing),
    marks: () => call(url("/marks"), Mark.array(), undefined, AbortSignal.timeout(MARKS_TIMEOUT_MS)),
    quote: (request) => call(url("/quote"), Quote, request),
    publish: (request) => call(url("/publish"), StatusUpdate, request),
    status: (quoteId) => call(url(`/status/${encodeURIComponent(quoteId)}`), StatusUpdate),
    fills: (accountId) => call(url(`/fills/${encodeURIComponent(accountId)}`), Fill.array()),
    execute: async (signed) => (await call(url("/execute"), Executed, { signed })).tx_hash,
    transfer: async (signed) => (await call(url("/transfer"), Executed, { signed })).tx_hash,
    relayerId: async () => (await call(url("/health"), Health)).relayer_id,
    claim: async (signed) => {
      await call(url("/claims"), Claimed, { signed });
    },
    faucet: async (accountId) => (await call(url("/faucet"), Executed, { account_id: accountId })).tx_hash,
    call: (request) => call(url("/calls"), Call, request),
    calls: (accountId) => call(url(`/calls/${encodeURIComponent(accountId)}`), Call.array()),
    leaderboard: (accountId) => call(url(accountId === undefined ? "/leaderboard" : `/leaderboard/${encodeURIComponent(accountId)}`), Leaderboard),
  };
}
