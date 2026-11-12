import { postWebhook } from "@endline/sdk/webhook";
import { type Activity, type Network, render } from "./activity.ts";
import type { Chain } from "./rpc.ts";

// Telegram allows about one message a second per chat
const GAP_MS = 1_000;
const MAX_WAITING = 50;

export class Notifier {
  private waiting: string[] = [];
  private sending = false;

  constructor(
    private webhookUrl: string | undefined,
    private network: Network,
    private chain: Pick<Chain, "listSeries" | "contractConfig">,
  ) {}

  get on(): boolean {
    return this.webhookUrl !== undefined;
  }

  post(activity: Activity): void {
    const url = this.webhookUrl;
    if (url === undefined) return;
    void this.text(activity).then(
      (text) => this.enqueue(url, text),
      (error: unknown) => console.error(`notify: can't describe a ${activity.kind}`, error),
    );
  }

  private async text(activity: Activity): Promise<string> {
    const [listing, contract] = await Promise.all([this.chain.listSeries(), this.chain.contractConfig()]);
    return render(this.network, activity, new Map(listing.map((series) => [series.id, series])), contract.quote_decimals);
  }

  private enqueue(url: string, text: string): void {
    if (this.waiting.length >= MAX_WAITING) return console.error(`notify: ${MAX_WAITING} messages already waiting, dropped one`);
    this.waiting.push(text);
    if (!this.sending) void this.drain(url);
  }

  private async drain(url: string): Promise<void> {
    this.sending = true;
    for (let text = this.waiting.shift(); text !== undefined; text = this.waiting.shift()) {
      await postWebhook(url, text).catch((error: unknown) => console.error(`notify: webhook: ${error}`));
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }
    this.sending = false;
  }
}
