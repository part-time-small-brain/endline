import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const testnet = readFileSync(new URL("../../../deploy/testnet.json", import.meta.url), "utf8");

vi.mock("node:fs", async (load) => {
  const fs = await load<typeof import("node:fs")>();
  return { ...fs, existsSync: () => true, readFileSync: (file: URL, encoding: "utf8") => (String(file).endsWith("mainnet.json") ? testnet : fs.readFileSync(file, encoding)) };
});

const { readDeployment } = await import("./deployment.ts");

describe("readDeployment", () => {
  it("refuses a file written for another network", () => {
    expect(readDeployment("testnet").network).toBe("testnet");
    expect(() => readDeployment("mainnet")).toThrow("deploy/mainnet.json is for testnet");
  });
});
