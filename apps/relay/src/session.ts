import { type QuoteRequest, readPayload, type SignedPayload } from "@near-options/sdk";
import { HttpError } from "./relay.ts";
import { type Chain, Rejected } from "./rpc.ts";

const MAX_SESSION_MS = 7 * 86_400_000;
const MAX_SESSIONS = 10_000;

function deadlineOf(signed: SignedPayload, signer: QuoteRequest["signer"], intentsId: string): number | undefined {
  try {
    const { signer_id, verifying_contract, deadline, intents } = readPayload(signed);
    const ok = signed.standard === signer.standard && signer_id === signer.signer_id && verifying_contract === intentsId && intents.length === 0;
    return ok ? Date.parse(deadline) : undefined;
  } catch {
    return undefined;
  }
}

export class Sessions {
  private verified = new Map<string, number>();

  constructor(
    private chain: Chain,
    private intentsId: string,
  ) {}

  async check(session: SignedPayload, signer: QuoteRequest["signer"]): Promise<void> {
    const deadlineMs = deadlineOf(session, signer, this.intentsId);
    if (deadlineMs === undefined) throw new HttpError(401, "session must be an empty intents payload signed by the quote's signer");
    if (!(deadlineMs > Date.now() && deadlineMs <= Date.now() + MAX_SESSION_MS)) throw new HttpError(401, "session deadline must be within the next 7 days");
    const key = JSON.stringify(session);
    if (this.verified.has(key)) return;
    await this.chain.simulate([session]).catch((error: unknown) => {
      if (error instanceof Rejected) throw new HttpError(401, `session refused: ${error.message}`);
      throw error;
    });
    for (const [cached, deadline] of this.verified) if (deadline <= Date.now()) this.verified.delete(cached);
    if (this.verified.size >= MAX_SESSIONS) this.verified.delete(this.verified.keys().next().value!);
    this.verified.set(key, deadlineMs);
  }
}
