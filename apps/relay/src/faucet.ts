import { z } from "zod";
import { JsonFile } from "./jsonFile.ts";
import { HttpError } from "./relay.ts";
import { Refunded } from "./rpc.ts";

const DAY_MS = 86_400_000;
const DAILY_CAP = 200;

const Attempt = z.object({ account_id: z.string(), client: z.string(), at_ms: z.number(), refunded: z.boolean() });
type Attempt = z.infer<typeof Attempt>;

export class Faucet {
  private file: JsonFile<Attempt[]>;
  private attempts: Attempt[] = [];

  constructor(
    private send: (accountId: string) => Promise<string>,
    dir: string,
    private dailyCap = DAILY_CAP,
  ) {
    this.file = new JsonFile(dir, "faucet.json", z.array(Attempt));
  }

  async load(): Promise<void> {
    this.attempts = await this.file.read([]);
  }

  async drip(accountId: string, client: string): Promise<string> {
    this.attempts = this.attempts.filter((attempt) => attempt.at_ms > Date.now() - DAY_MS);
    const granted = this.attempts.filter((attempt) => !attempt.refunded);
    if (granted.some((attempt) => attempt.account_id === accountId)) throw new HttpError(429, "this account already got test USDC in the last 24 hours");
    if (granted.some((attempt) => attempt.client === client)) throw new HttpError(429, "test USDC was already sent to your network in the last 24 hours");
    if (this.attempts.length >= this.dailyCap) throw new HttpError(429, "the faucet is out for today, try again tomorrow");
    const attempt = { account_id: accountId, client, at_ms: Date.now(), refunded: false };
    this.attempts.push(attempt);
    await this.file.write(this.attempts);
    try {
      return await this.send(accountId);
    } catch (error) {
      console.error("faucet transfer failed", error);
      if (!(error instanceof Refunded)) throw new HttpError(502, "the test USDC transfer may not have gone through, check your balance in a minute");
      attempt.refunded = true;
      await this.file.write(this.attempts);
      throw new HttpError(502, "the test USDC transfer failed, try again");
    }
  }
}
