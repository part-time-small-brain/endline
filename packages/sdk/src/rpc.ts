import { JsonRpcProvider } from "near-api-js";

const READ_TIMEOUT_MS = 5_000;
const LONG_TIMEOUT_MS = 30_000;
const MIN_COOLDOWN_MS = 2_000;
const MAX_COOLDOWN_MS = 300_000;
const PASSES = 3;
const MAX_PASS_WAIT_MS = 5_000;
const SEND_METHODS = new Set(["send_tx", "broadcast_tx_commit", "broadcast_tx_async"]);
const LONG_METHODS = new Set([...SEND_METHODS, "tx", "EXPERIMENTAL_tx_status"]);
const TRANSPORT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const ENDPOINT_ERROR = /Unknown RPC error|JSON RPC response must include|NO_SYNCED_BLOCKS|NoSyncedBlocks|NODE_IS_SYNCING|NodeIsSyncing|NOT_SYNCED_YET|NotSyncedYet|UNAVAILABLE_SHARD|UnavailableShard|DOES_NOT_TRACK_SHARD|DoesNotTrackShard|GARBAGE_COLLECTED_BLOCK|GarbageCollectedBlock/;

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
  cooledAt: number;
  coolUntil: number;
}

type Failure = "chain" | "refused" | "unclear";

export function rpcUrls(fallback: string, extra: string | undefined): string[] {
  const listed = (extra ?? "").split(",").map((url) => url.trim()).filter((url) => url !== "");
  for (const url of listed) if (!URL.canParse(url) || !url.startsWith("https://")) throw new Error(`NEAR_RPC_URLS entry ${URL.canParse(url) ? new URL(url).host : "?"} must be an https URL`);
  return [...new Set([...listed, fallback])];
}

function failure(e: unknown): Failure {
  if (!(e instanceof Error)) return "unclear";
  const cause = (e as { cause?: unknown }).cause;
  if (cause === 429 || /rate limit|too many requests/i.test(e.message)) return "refused";
  if (typeof cause === "number" && TRANSPORT_STATUS.has(cause)) return "unclear";
  if (e.name === "TimeoutError" || e instanceof SyntaxError || (e instanceof TypeError && /fetch failed/i.test(e.message))) return "unclear";
  return ENDPOINT_ERROR.test(`${e.name} ${e.message} ${typeof cause === "object" ? JSON.stringify(cause) : ""}`) ? "unclear" : "chain";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`RPC call timed out after ${ms} ms`), { name: "TimeoutError" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function endpointOf(url: string): Endpoint {
  const parsed = new URL(url);
  const headers = Object.fromEntries(new URLSearchParams(parsed.hash.slice(1)));
  parsed.hash = "";
  return { provider: new JsonRpcProvider({ url: parsed.toString(), headers }, { retries: 1 }), host: parsed.host, latencyMs: 0, failures: 0, cooledAt: 0, coolUntil: 0 };
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
    super({ url: "https://routed.invalid" });
    this.expected = rpc.network;
    this.endpoints = urls.map(endpointOf);
  }

  override async sendJsonRpc(method: Parameters<JsonRpcProvider["sendJsonRpc"]>[0], params: unknown): Promise<any> {
    const long = LONG_METHODS.has(method);
    let last: Error | undefined;
    for (let pass = 0; pass < PASSES; pass++) {
      if (pass > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(this.soonest() - Date.now(), 0), MAX_PASS_WAIT_MS)));
      for (const endpoint of this.order()) {
        if (!(await this.onNetwork(endpoint))) continue;
        const started = Date.now();
        try {
          const result = await withTimeout(endpoint.provider.sendJsonRpc(method, params as never), long ? LONG_TIMEOUT_MS : READ_TIMEOUT_MS);
          this.succeeded(endpoint, long ? undefined : Date.now() - started);
          return result;
        } catch (e) {
          const kind = failure(e);
          if (kind === "chain") throw e;
          last = this.failed(endpoint, e, started);
          if (kind === "unclear" && SEND_METHODS.has(method)) throw last;
        }
      }
    }
    throw last ?? new Error(`no RPC endpoint on ${this.expected} answered`);
  }

  private order(): Endpoint[] {
    const now = Date.now();
    const ready = this.endpoints.filter((e) => e.coolUntil <= now).sort((a, b) => a.latencyMs - b.latencyMs);
    const cooling = this.endpoints.filter((e) => e.coolUntil > now).sort((a, b) => a.coolUntil - b.coolUntil);
    return [...ready, ...cooling];
  }

  private soonest(): number {
    return Math.min(...this.endpoints.filter((e) => e.network === undefined || e.network === this.expected).map((e) => e.coolUntil));
  }

  private async onNetwork(endpoint: Endpoint): Promise<boolean> {
    if (endpoint.network === undefined) {
      const started = Date.now();
      try {
        const status = (await withTimeout(endpoint.provider.sendJsonRpc("status" as never, [] as never), READ_TIMEOUT_MS)) as { chain_id: string };
        endpoint.network = status.chain_id;
      } catch (e) {
        this.failed(endpoint, e, started);
        return false;
      }
      if (endpoint.network !== this.expected) this.log(`rpc ${endpoint.host} is on ${endpoint.network}, not ${this.expected}: never used`);
    }
    return endpoint.network === this.expected;
  }

  private succeeded(endpoint: Endpoint, ms: number | undefined): void {
    if (ms !== undefined) endpoint.latencyMs = endpoint.latencyMs === 0 ? ms : 0.8 * endpoint.latencyMs + 0.2 * ms;
    endpoint.failures = 0;
    endpoint.coolUntil = 0;
  }

  private failed(endpoint: Endpoint, e: unknown, started: number): Error {
    const cause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
    const reason = e instanceof Error && e.name === "TimeoutError" ? "timed out" : `failed (${typeof cause === "number" ? cause : e instanceof Error ? e.name : "unknown"})`;
    if (started > endpoint.cooledAt) {
      const now = Date.now();
      endpoint.failures += 1;
      const cooldown = Math.min(MIN_COOLDOWN_MS * 2 ** (endpoint.failures - 1), MAX_COOLDOWN_MS);
      endpoint.cooledAt = now;
      endpoint.coolUntil = now + cooldown;
      this.log(`rpc ${endpoint.host} ${reason}, cooling ${Math.round(cooldown / 1000)} s`);
    }
    return Object.assign(new Error(`rpc ${endpoint.host} ${reason}`), { name: "RpcEndpointError", cause });
  }
}
