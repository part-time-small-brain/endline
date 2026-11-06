import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fill } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { Fills } from "./fills.ts";

const fill = (account_id: string, quote_id: string): Fill => ({ quote_id, series_id: "S", side: "buy", account_id, size: "1", premium: "1", tx_hash: "tx", at_ms: 0 });

describe("fills", () => {
  it("reads fills.jsonl once at load, skipping lines it can't parse, then answers from memory with every append", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-"));
    const file = join(dir, "fills.jsonl");
    const old = fill("alice.test", "q0");
    writeFileSync(file, `${JSON.stringify(old)}\nnot json\n${JSON.stringify({ ...old, size: "-1" })}\n${JSON.stringify(fill("bob.test", "q1"))}\n`);
    const fills = new Fills(dir);
    await fills.load();
    writeFileSync(file, "");
    expect(fills.byAccount("alice.test")).toEqual([old]);
    const next = fill("alice.test", "q2");
    await fills.append(next);
    expect(fills.byAccount("alice.test")).toEqual([old, next]);
    expect(fills.byAccount("bob.test")).toEqual([fill("bob.test", "q1")]);
    expect(fills.byAccount("carol.test")).toEqual([]);
    const reloaded = new Fills(dir);
    await reloaded.load();
    expect(reloaded.byAccount("alice.test")).toEqual([next]);
  });
});
