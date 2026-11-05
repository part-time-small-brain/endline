import type { AddressInfo } from "node:net";
import { MmMessage, type QuoteEvent } from "@near-options/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { PUT, quoteEvent } from "./fixtures/desk.ts";
import { RelayClient } from "./relay.ts";

let server: WebSocketServer | undefined;
afterEach(() => server?.close());

describe("relay client", () => {
  it("authenticates with ?key=, skips malformed frames and answers and publishes marks in the relay's MmMessage shape", async () => {
    server = new WebSocketServer({ port: 0 });
    const { port } = server.address() as AddressInfo;
    const received: unknown[] = [];
    const urls: string[] = [];
    server.on("connection", (socket, request) => {
      urls.push(request.url ?? "");
      socket.on("message", (data) => received.push(JSON.parse(data.toString())));
      socket.send("not json");
      socket.send(JSON.stringify({ method: "quote", params: { quote_id: "missing fields" } }));
      socket.send(JSON.stringify({ method: "quote", params: quoteEvent(PUT, "buy", 1_000_000n, { quote_id: "q1" }) }));
    });

    const quotes: QuoteEvent[] = [];
    const client = new RelayClient(`ws://127.0.0.1:${port}/mm`, "secret key with spaces&=", { quote: (ev) => quotes.push(ev), status: () => {} }, () => {});
    client.start();
    await expect.poll(() => quotes.length).toBe(1);
    client.send({ quote_id: "q1", premium: "30000000", signed: { standard: "erc191", payload: "{}", signature: "secp256k1:s" } });
    client.publish([{ series_id: PUT.id, ask: "650000000", vol: 0.4 }]);
    await expect.poll(() => received.length).toBe(2);
    client.close();

    expect(new URL(urls[0] ?? "", "ws://x").searchParams.get("key")).toBe("secret key with spaces&=");
    expect(quotes[0]?.quote_id).toBe("q1");
    expect(received.map((m) => MmMessage.parse(m))).toEqual(received);
    expect(received[1]).toMatchObject({ method: "marks", params: [{ series_id: PUT.id }] });
  });
});
