import { isDeepStrictEqual } from "node:util";
import { SignedPayload } from "@near-options/sdk";
import { z } from "zod";
import { JsonFile } from "./jsonFile.ts";

export class Claims {
  private file: JsonFile<SignedPayload[]>;
  private list: SignedPayload[] = [];

  constructor(dir: string) {
    this.file = new JsonFile(dir, "claims.json", z.array(SignedPayload));
  }

  async load(): Promise<void> {
    this.list = await this.file.read([]);
  }

  all(): SignedPayload[] {
    return [...this.list];
  }

  add(signed: SignedPayload): Promise<void> {
    if (!this.list.some((claim) => isDeepStrictEqual(claim, signed))) this.list.push(signed);
    return this.file.write(this.list);
  }

  remove(signed: SignedPayload): Promise<void> {
    this.list = this.list.filter((claim) => claim !== signed);
    return this.file.write(this.list);
  }
}
