import type { QuoteEvent, QuoteResponse } from "@endline/sdk";
import type { Bid } from "./bid.ts";

export const MIN_WAIT_MS = 300;
export const MAX_WAIT_MS = 1_500;

type CheckBid = (event: QuoteEvent, mmId: string, response: QuoteResponse, receivedAt: number) => Promise<Bid>;

interface Open {
  event: QuoteEvent;
  invited: Set<string>;
  answered: Set<string>;
  checks: Promise<Bid | undefined>[];
  minWaitOver: boolean;
  close: () => void;
}

function best(side: QuoteEvent["side"], bids: Bid[]): Bid | undefined {
  const better = (a: Bid, b: Bid) => (side === "buy" ? a.premium < b.premium : a.premium > b.premium);
  return bids.reduce<Bid | undefined>((top, bid) => (top === undefined || better(bid, top) ? bid : top), undefined);
}

export class Auctions {
  private open = new Map<string, Open>();

  constructor(private check: CheckBid) {}

  run(event: QuoteEvent, invited: string[]): Promise<Bid | undefined> {
    return new Promise((resolve) => {
      const timers: NodeJS.Timeout[] = [];
      const auction: Open = {
        event,
        invited: new Set(invited),
        answered: new Set(),
        checks: [],
        minWaitOver: false,
        close: () => {
          if (!this.open.delete(event.quote_id)) return;
          timers.forEach(clearTimeout);
          void Promise.all(auction.checks).then((bids) => resolve(best(event.side, bids.filter((bid) => bid !== undefined))));
        },
      };
      this.open.set(event.quote_id, auction);
      timers.push(
        setTimeout(() => {
          auction.minWaitOver = true;
          if (auction.answered.size === auction.invited.size) auction.close();
        }, MIN_WAIT_MS),
        setTimeout(auction.close, MAX_WAIT_MS),
      );
    });
  }

  respond(mmId: string, response: QuoteResponse): void {
    const auction = this.open.get(response.quote_id);
    if (!auction || !auction.invited.has(mmId) || auction.answered.has(mmId)) return;
    auction.answered.add(mmId);
    auction.checks.push(this.check(auction.event, mmId, response, Date.now()).catch(() => undefined));
    if (auction.minWaitOver && auction.answered.size === auction.invited.size) auction.close();
  }
}
