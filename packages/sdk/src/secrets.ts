import { readFileSync } from "node:fs";

export function readSecretFiles(env: Record<string, string | undefined>, names: readonly string[]): Record<string, string | undefined> {
  const resolved = { ...env };
  for (const name of names) {
    const file = env[`${name}_FILE`];
    if (file === undefined) continue;
    if (env[name] !== undefined) throw new Error(`set ${name} or ${name}_FILE, not both`);
    resolved[name] = readFileSync(file, "utf8").trim() || undefined;
  }
  return resolved;
}
