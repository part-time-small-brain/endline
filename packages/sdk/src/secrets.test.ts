import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSecretFiles } from "./secrets.ts";

const dir = mkdtempSync(join(tmpdir(), "secrets-"));
const file = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

describe("readSecretFiles", () => {
  it("reads <NAME>_FILE and drops the trailing newline, CRLF included", () => {
    expect(readSecretFiles({ KEY_FILE: file("key", "ed25519:abc\r\n") }, ["KEY"]).KEY).toBe("ed25519:abc");
  });

  it("treats an empty file as unset, so an optional secret can have an empty file", () => {
    expect(readSecretFiles({ JWT_FILE: file("empty", "\n") }, ["JWT"]).JWT).toBeUndefined();
  });

  it("keeps a plain env var when there is no file", () => {
    expect(readSecretFiles({ KEY: "ed25519:abc" }, ["KEY"]).KEY).toBe("ed25519:abc");
  });

  it("refuses both, so a stale env var never shadows or hides behind the file", () => {
    expect(() => readSecretFiles({ KEY: "a", KEY_FILE: file("both", "b") }, ["KEY"])).toThrow("set KEY or KEY_FILE, not both");
  });

  it("refuses a missing file instead of starting without the secret", () => {
    expect(() => readSecretFiles({ KEY_FILE: join(dir, "nope") }, ["KEY"])).toThrow(/ENOENT/);
  });

  it("ignores _FILE vars it was not asked for", () => {
    expect(readSecretFiles({ SSL_CERT_FILE: join(dir, "nope") }, ["KEY"])).toEqual({ SSL_CERT_FILE: join(dir, "nope") });
  });
});
