import { randomBytes } from "node:crypto";
import { payload, type QuoteEvent, type QuoteResponse, type StatusUpdate, tokenDiff } from "@near-options/sdk";
import type { Settings } from "./config.ts";
import { type Desk, decide } from "./quote.ts";
import type { SignPayload } from "./signer.ts";

interface QuoterDeps {
  desk: Desk;
  settings: Settings;
  intentsId: string;
  accountId: string;
  sign: SignPayload;
  send: (response: QuoteResponse) => void;
  onFill: () => void;
  log: (line: string) => void;
}

export class Quoter {
  constructor(private readonly deps: QuoterDeps) {}

  async onQuote(ev: QuoteEvent): Promise<void> {
    const { desk, settings, log } = this.deps;
    const label = `quote ${ev.quote_id} ${ev.side} ${ev.size} ${ev.series_id}`;
    let reserved = false;
    try {
      const decision = decide(ev, desk, settings, Date.now());
      if (!decision.ok) {
        log(`${label}: skip, ${decision.reason}`);
        return;
      }
      desk.inventory.reserve(ev.quote_id, decision.diff, decision.deadlineMs);
      reserved = true;
      const signed = await this.deps.sign(
        payload(this.deps.intentsId, this.deps.accountId, decision.deadlineMs, desk.intents.salt, randomBytes(15), [tokenDiff(decision.diff)]),
      );
      this.deps.send({ quote_id: ev.quote_id, premium: decision.premium.toString(), signed });
      log(`${label}: premium ${decision.premium}`);
    } catch (e) {
      if (reserved) desk.inventory.release(ev.quote_id);
      log(`${label}: failed, ${e instanceof Error ? e.message : e}`);
    }
  }

  // the relay's word frees nothing: our signed leg stays fillable until its deadline, when setBalances drops the reservation
  onStatus(update: StatusUpdate): void {
    if (update.status !== "settled") return;
    this.deps.log(`quote ${update.quote_id} settled ${update.tx_hash ?? ""}`);
    this.deps.onFill();
  }
}
