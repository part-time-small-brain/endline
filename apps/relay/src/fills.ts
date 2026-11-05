import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Fill } from "@near-options/sdk";
import { parseJson } from "./json.ts";

export class Fills {
  private file: string;

  constructor(private dir: string) {
    this.file = join(dir, "fills.jsonl");
  }

  async append(fill: Fill): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file, `${JSON.stringify(fill)}\n`);
  }

  async byAccount(accountId: string): Promise<Fill[]> {
    const text = await readFile(this.file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return text.split("\n").flatMap((line) => {
      const fill = Fill.safeParse(parseJson(line));
      return fill.success && fill.data.account_id === accountId ? [fill.data] : [];
    });
  }
}
