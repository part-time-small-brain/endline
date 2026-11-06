import { MmMessage, type Mark, type QuoteEvent, type QuoteResponse, RelayMessage, type StatusUpdate } from "@endline/sdk";
import WebSocket from "ws";

const RECONNECT_MS = 2_000;

interface RelayHandlers {
  quote: (event: QuoteEvent) => void;
  status: (update: StatusUpdate) => void;
}

export class RelayClient {
  private ws: WebSocket | undefined;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly handlers: RelayHandlers,
    private readonly log: (line: string) => void,
  ) {}

  start(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url, { headers: { authorization: `Bearer ${this.apiKey}` } });
    ws.on("open", () => this.log("relay connected"));
    ws.on("message", (data) => this.receive(data.toString()));
    ws.on("error", (e) => this.log(`relay error: ${e.message}`));
    ws.on("close", () => {
      this.log("relay disconnected");
      setTimeout(() => this.start(), RECONNECT_MS);
    });
    this.ws = ws;
  }

  private receive(text: string): void {
    let msg;
    try {
      msg = RelayMessage.parse(JSON.parse(text));
    } catch {
      this.log(`relay sent unknown message: ${text.slice(0, 200)}`);
      return;
    }
    if (msg.method === "quote") this.handlers.quote(msg.params);
    else this.handlers.status(msg.params);
  }

  send(response: QuoteResponse): void {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error("relay not connected");
    this.ws.send(JSON.stringify(MmMessage.parse({ method: "quote_response", params: response })));
  }

  publish(marks: Mark[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(MmMessage.parse({ method: "marks", params: marks })));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
