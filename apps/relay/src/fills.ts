import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Fill } from "@endline/sdk";
import { parseJson } from "./json.ts";

export class Fills {
  private file: string;
  private accounts = new Map<string, Fill[]>();

  constructor(private dir: string) {
    this.file = join(dir, "fills.jsonl");
  }

  async load(): Promise<void> {
    const text = await readFile(this.file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    for (const line of text.split("\n")) {
      const fill = Fill.safeParse(parseJson(line));
      if (fill.success) this.remember(fill.data);
    }
  }

  async append(fill: Fill): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file, `${JSON.stringify(fill)}\n`);
    this.remember(fill);
  }

  byAccount(accountId: string): Fill[] {
    return this.accounts.get(accountId) ?? [];
  }

  private remember(fill: Fill): void {
    const fills = this.accounts.get(fill.account_id);
    if (fills) fills.push(fill);
    else this.accounts.set(fill.account_id, [fill]);
  }
}
