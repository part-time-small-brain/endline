import { expect, it, vi } from "vitest";
import manifest from "./manifest.json" with { type: "json" };
import { restoreNear } from "./near.ts";

const built = vi.hoisted(() => [] as unknown[]);

vi.mock("@hot-labs/near-connect", () => ({
  NearConnector: vi.fn(function NearConnector(options: unknown) {
    built.push(options);
    return {
      getConnectedWallet: async () => {
        throw new Error("no wallet");
      },
    };
  }),
}));

it("builds the wallet selector from the pinned manifest, never one fetched at runtime", async () => {
  expect(await restoreNear("mainnet")).toBeNull();
  expect(built).toEqual([expect.objectContaining({ manifest })]);
});

it("pins every GitHub-hosted wallet script to a commit, not a branch", () => {
  const github = manifest.wallets.map((w) => w.executor).filter((url) => url.startsWith("https://raw.githubusercontent.com/"));
  expect(github.length).toBeGreaterThan(5);
  for (const url of github) expect(url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//);
});
