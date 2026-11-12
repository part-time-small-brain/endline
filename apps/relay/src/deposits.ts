import { z } from "zod";
import type { Deposit } from "./activity.ts";
import type { Notifier } from "./notifier.ts";
import { ONECLICK_API, TIMEOUT_MS } from "./oneClick.ts";

const GRACE_MS = 60 * 60_000;
const MAX_TRACKED = 200;
const CONCURRENCY = 3;
const WAITING_EVERY_MS = 2 * 60_000;
const TERMINAL = ["SUCCESS", "REFUNDED", "FAILED"] as const;

const Issued = z.object({ quote: z.object({ depositAddress: z.string().min(1), amountInFormatted: z.string(), amountOut: z.string().regex(/^\d+$/) }) });
const Status = z.object({ status: z.string() });
const Token = z.object({ assetId: z.string(), symbol: z.string(), blockchain: z.string() });

interface Request {
  originAsset: string;
  recipient: string;
  deadline: string;
}

export class Deposits {
  private pending = new Map<string, Deposit>();
  private tokens: Promise<Map<string, string>> | undefined;

  constructor(private notifier: Pick<Notifier, "on" | "post">) {}

  track(request: Request, response: unknown): void {
    const quote = Issued.safeParse(response).data?.quote;
    if (!this.notifier.on || !quote) return;
    void this.tokenName(request.originAsset)
      .then((token) => {
        const oldest = this.pending.size >= MAX_TRACKED ? this.pending.keys().next().value : undefined;
        if (oldest !== undefined) this.pending.delete(oldest);
        this.pending.set(quote.depositAddress, { address: quote.depositAddress, accountId: request.recipient, sent: `${quote.amountInFormatted} ${token}`, amountOut: BigInt(quote.amountOut), deadlineMs: Date.parse(request.deadline) });
      })
      .catch(console.error);
  }

  async poll(): Promise<void> {
    const now = Date.now();
    const due = [...this.pending.values()].filter((deposit) => (deposit.nextAt ?? 0) <= now);
    const work = async (): Promise<void> => {
      for (let deposit = due.shift(); deposit !== undefined; deposit = due.shift()) await this.check(deposit);
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));
  }

  private async check(deposit: Deposit): Promise<void> {
    try {
      deposit.status = await this.status(deposit.address);
    } catch (error) {
      console.error(`deposits: 1click status of ${deposit.address}: ${error}`);
    }
    const outcome = TERMINAL.find((status) => status === deposit.status);
    const waiting = deposit.status === undefined || deposit.status === "PENDING_DEPOSIT";
    if (outcome !== undefined || (waiting && Date.now() > deposit.deadlineMs + GRACE_MS)) this.pending.delete(deposit.address);
    if (outcome !== undefined) return this.notifier.post({ kind: "deposit", deposit, outcome });
    deposit.nextAt = waiting ? Date.now() + WAITING_EVERY_MS : 0;
  }

  private async status(address: string): Promise<string> {
    const response = await fetch(`${ONECLICK_API}/status?depositAddress=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Status.parse(await response.json()).status;
  }

  private tokenName(assetId: string): Promise<string> {
    this.tokens ??= fetch(`${ONECLICK_API}/tokens`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const tokens = z.array(z.unknown()).parse(await response.json()).flatMap((token) => Token.safeParse(token).data ?? []);
      return new Map(tokens.map((token) => [token.assetId, `${token.symbol} on ${token.blockchain}`]));
    });
    return this.tokens.then(
      (names) => names.get(assetId) ?? assetId,
      (error: unknown) => {
        console.error(`deposits: 1click tokens: ${error}`);
        this.tokens = undefined;
        return assetId;
      },
    );
  }
}
