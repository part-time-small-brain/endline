import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";

export class JsonFile<T> {
  private file: string;
  private saving = Promise.resolve();

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
    const write = async () => {
      await mkdir(this.dir, { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(value));
      await rename(`${this.file}.tmp`, this.file);
    };
    this.saving = this.saving.then(write, write);
    return this.saving;
  }
}
