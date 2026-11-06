import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { JsonFile } from "./jsonFile.ts";

afterEach(() => vi.restoreAllMocks());

describe("JsonFile", () => {
  it("folds writes queued behind each other into one save of the latest value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "json-"));
    const file = new JsonFile(dir, "state.json", z.array(z.number()));
    const stringify = vi.spyOn(JSON, "stringify");
    await Promise.all([file.write([1]), file.write([1, 2]), file.write([1, 2, 3])]);
    expect(stringify).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))).toEqual([1, 2, 3]);
    await file.write([4]);
    expect(await file.read([])).toEqual([4]);
  });
});
