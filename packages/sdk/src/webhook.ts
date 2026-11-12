import { z } from "zod";

const TIMEOUT_MS = 5_000;
const Sent = z.object({ result: z.object({ message_id: z.number() }) });

export async function postWebhook(webhookUrl: string, message: string, replyTo?: number): Promise<number | undefined> {
  // only Telegram returns a message_id, so only Telegram ever gets reply_parameters
  const reply = replyTo === undefined ? {} : { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: message, content: message, ...reply }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Sent.safeParse(await res.json().catch(() => undefined)).data?.result.message_id;
}
