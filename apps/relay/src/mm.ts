import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { MmMessage, type QuoteResponse } from "@endline/sdk";
import { WebSocket, WebSocketServer } from "ws";
import { parseJson } from "./json.ts";
import { Marks } from "./marks.ts";
import type { MarketMakers } from "./relay.ts";

const MAX_MESSAGE_BYTES = 64 * 1024;

const digest = (key: string) => createHash("sha256").update(key).digest();

export class MmHub implements MarketMakers {
  private sockets = new Map<string, WebSocket>();
  private server = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private keys: Buffer[];
  readonly marks = new Marks();

  constructor(
    keys: string[],
    private onResponse: (mmId: string, response: QuoteResponse) => void,
  ) {
    this.keys = keys.map(digest);
  }

  ids(): string[] {
    return [...this.sockets].filter(([, socket]) => socket.readyState === WebSocket.OPEN).map(([id]) => id);
  }

  send(mmId: string, message: unknown): void {
    const socket = this.sockets.get(mmId);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = new URL(request.url ?? "", "http://relay").searchParams.get("key");
    if (key === null || !this.knows(key)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    this.server.handleUpgrade(request, socket, head, (ws) => this.add(ws));
  }

  private knows(key: string): boolean {
    const candidate = digest(key);
    return this.keys.some((known) => timingSafeEqual(known, candidate));
  }

  private add(socket: WebSocket): void {
    const id = randomUUID();
    this.sockets.set(id, socket);
    socket.on("close", () => {
      this.sockets.delete(id);
      this.marks.drop(id);
    });
    socket.on("error", () => socket.terminate());
    socket.on("message", (data) => {
      const message = MmMessage.safeParse(parseJson(data.toString()));
      if (!message.success) return;
      if (message.data.method === "marks") this.marks.set(id, message.data.params, Date.now());
      else this.onResponse(id, message.data.params);
    });
  }
}
