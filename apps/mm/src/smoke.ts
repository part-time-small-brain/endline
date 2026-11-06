import { exerciseOptions, payload, Quote, readPayload, sessionPayload, StatusUpdate } from "@endline/sdk";
import type { KeyPairString } from "near-api-js";
import { nep413Signer } from "./signer.ts";

const [relayUrl, seriesId, action, size] = process.argv.slice(2);
const accountId = process.env.USER_ACCOUNT_ID;
const privateKey = process.env.USER_PRIVATE_KEY as KeyPairString | undefined;
if (!relayUrl || !seriesId || !["buy", "sell", "collect", "claim"].includes(action ?? "") || !size || !accountId || !privateKey) {
  throw new Error("usage: USER_ACCOUNT_ID=… USER_PRIVATE_KEY=… INTENTS_ID=… OPTIONS_ID=… tsx src/smoke.ts <relay-url> <series-id> buy|sell|collect|claim <size>");
}

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${relayUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  console.log(`${path} -> ${response.status}`, JSON.stringify(json));
  return json;
}

const sign = nep413Signer(privateKey);

async function currentSalt(rpcUrl: string, intentsId: string): Promise<string> {
  const params = { request_type: "call_function", finality: "final", account_id: intentsId, method_name: "current_salt", args_base64: "e30=" };
  const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }) });
  const { result } = (await response.json()) as { result: { result: number[] } };
  return JSON.parse(Buffer.from(result.result).toString());
}

const { INTENTS_ID: intentsId, OPTIONS_ID: optionsId, NEAR_RPC_URL: rpcUrl } = process.env;
if (!intentsId || !rpcUrl) throw new Error("smoke needs INTENTS_ID and NEAR_RPC_URL");
const salt = Uint8Array.from(Buffer.from(await currentSalt(rpcUrl, intentsId), "hex"));
const random = crypto.getRandomValues(new Uint8Array(15));
const deadlineMs = Date.now() + 300_000;

if (action === "collect" || action === "claim") {
  if (!optionsId) throw new Error(`${action} needs OPTIONS_ID`);
  const tokens = { [`nep245:${optionsId}:${seriesId}`]: BigInt(size) };
  const deadline = action === "claim" ? Date.now() + 7 * 86_400_000 : deadlineMs;
  const signed = await sign(payload(intentsId, accountId, deadline, salt, random, [exerciseOptions(optionsId, tokens)]));
  await post(action === "claim" ? "/claims" : "/execute", { signed });
} else {
  const session = await sign(sessionPayload(intentsId, accountId, deadlineMs, salt, random));
  const quote = Quote.parse(await post("/quote", { series_id: seriesId, side: action, size, signer: { standard: "nep413", signer_id: accountId }, session }));
  StatusUpdate.parse(await post("/publish", { quote_id: quote.quote_id, signed: await sign(readPayload(quote.payload)) }));
}
