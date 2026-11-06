import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";

export class JsonFile<T> {
  private file: string;
  private saving = Promise.resolve();
  private queued: Promise<void> | undefined;
  private latest: T | undefined;

  constructor(
    private dir: string,
    name: string,
    private schema: z.ZodType<T>,
  ) {
    this.file = join(dir, name);
  }

  async read(empty: T): Promise<T> {
    const text = await readFile(this.file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    return text === undefined ? empty : this.schema.parse(JSON.parse(text));
  }

  write(value: T): Promise<void> {
    this.latest = value;
    if (this.queued) return this.queued;
    const write = async () => {
      this.queued = undefined;
      await mkdir(this.dir, { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(this.latest));
      await rename(`${this.file}.tmp`, this.file);
    };
    this.queued = this.saving.then(write, write);
    this.saving = this.queued;
    return this.queued;
  }
}
