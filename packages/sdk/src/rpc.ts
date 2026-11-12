import { JsonRpcProvider } from "near-api-js";

const TIMEOUT_MS = 15_000;
const TX_TIMEOUT_MS = 30_000;
const MIN_COOLDOWN_MS = 2_000;
const MAX_COOLDOWN_MS = 300_000;
const TX_METHODS = new Set(["send_tx", "broadcast_tx_commit", "broadcast_tx_async", "tx", "EXPERIMENTAL_tx_status"]);
const TRANSPORT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export interface Rpc {
  urls: string[];
  network: string;
}

interface Endpoint {
  provider: JsonRpcProvider;
  host: string;
  network?: string;
  latencyMs: number;
  failures: number;
  coolUntil: number;
}

export function rpcUrls(fallback: string, extra: string | undefined): string[] {
  const listed = (extra ?? "").split(",").map((url) => url.trim()).filter((url) => url !== "");
  for (const url of listed) if (!URL.canParse(url) || !url.startsWith("https://")) throw new Error(`NEAR_RPC_URLS entry ${URL.canParse(url) ? new URL(url).host : "?"} must be an https URL`);
  return [...new Set([...listed, fallback])];
}

export function isTransportError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const cause = (e as { cause?: unknown }).cause;
  if (typeof cause === "number" && TRANSPORT_STATUS.has(cause)) return true;
  if (e.name === "TimeoutError" || e instanceof SyntaxError) return true;
  if (e instanceof TypeError && /fetch failed/i.test(e.message)) return true;
  return /rate limit|too many requests|Exceeded \d+ attempts/i.test(e.message);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`RPC call timed out after ${ms} ms`), { name: "TimeoutError" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class RoutedRpcProvider extends JsonRpcProvider {
  private readonly endpoints: Endpoint[];
  private readonly expected: string;

  constructor(
    rpc: Rpc,
    private readonly log: (message: string) => void = (message) => console.warn(message),
  ) {
    const urls = [...new Set(rpc.urls)];
    if (urls[0] === undefined) throw new Error("no RPC endpoints");
    super({ url: urls[0] });
    this.expected = rpc.network;
    this.endpoints = urls.map((url) => ({ provider: new JsonRpcProvider({ url }, { retries: 1 }), host: new URL(url).host, latencyMs: 0, failures: 0, coolUntil: 0 }));
  }

  override async sendJsonRpc(method: Parameters<JsonRpcProvider["sendJsonRpc"]>[0], params: unknown): Promise<any> {
    let last: unknown;
    for (const endpoint of this.order()) {
      if (!(await this.onNetwork(endpoint))) continue;
      const started = Date.now();
      try {
        const result = await withTimeout(endpoint.provider.sendJsonRpc(method, params as never), TX_METHODS.has(method) ? TX_TIMEOUT_MS : TIMEOUT_MS);
        this.succeeded(endpoint, Date.now() - started);
        return result;
      } catch (e) {
        if (!isTransportError(e)) throw e;
        this.failed(endpoint, e);
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error(`no RPC endpoint on ${this.expected} answered`);
  }

  private order(): Endpoint[] {
    const now = Date.now();
    const ready = this.endpoints.filter((e) => e.coolUntil <= now).sort((a, b) => a.latencyMs - b.latencyMs);
    const cooling = this.endpoints.filter((e) => e.coolUntil > now).sort((a, b) => a.coolUntil - b.coolUntil);
    return [...ready, ...cooling];
  }

  private async onNetwork(endpoint: Endpoint): Promise<boolean> {
    if (endpoint.network === undefined) {
      try {
        const status = await withTimeout(endpoint.provider.sendJsonRpc("status" as never, [] as never) as Promise<{ chain_id: string }>, TIMEOUT_MS);
        endpoint.network = status.chain_id;
      } catch (e) {
        if (!isTransportError(e)) throw e;
        this.failed(endpoint, e);
        return false;
      }
      if (endpoint.network !== this.expected) this.log(`rpc ${endpoint.host} is on ${endpoint.network}, not ${this.expected}: never used`);
    }
    return endpoint.network === this.expected;
  }

  private succeeded(endpoint: Endpoint, ms: number): void {
    endpoint.latencyMs = endpoint.latencyMs === 0 ? ms : 0.8 * endpoint.latencyMs + 0.2 * ms;
    endpoint.failures = 0;
    endpoint.coolUntil = 0;
  }

  private failed(endpoint: Endpoint, e: unknown): void {
    endpoint.failures += 1;
    const cooldown = Math.min(MIN_COOLDOWN_MS * 2 ** (endpoint.failures - 1), MAX_COOLDOWN_MS);
    endpoint.coolUntil = Date.now() + cooldown;
    const reason = e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : `failed (${(e as { cause?: unknown }).cause ?? e.name})`) : "failed";
    this.log(`rpc ${endpoint.host} ${reason}, cooling ${Math.round(cooldown / 1000)} s`);
  }
}
