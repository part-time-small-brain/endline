import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

it("lets wallet iframes run their scripts by the nonce the CSP allows, the page's inline scripts by their exact hash, and the app can't be framed", async () => {
  await restoreNear("mainnet");
  const { cspNonce } = built[0] as { cspNonce: string };
  const csp = /Content-Security-Policy: (.*)/.exec(readFileSync(new URL("../../public/_headers", import.meta.url), "utf8"))?.[1]?.split("; ") ?? [];
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(([, body]) => `'sha256-${createHash("sha256").update(body ?? "").digest("base64")}'`);
  expect(hashes.length).toBeGreaterThan(0);
  expect(csp).toContain(`script-src 'self' 'nonce-${cspNonce}' ${hashes.join(" ")}`);
  expect(csp).toContain("frame-ancestors 'none'");
});

it("pins every GitHub-hosted wallet script to a commit, not a branch", () => {
  const github = manifest.wallets.map((w) => w.executor).filter((url) => url.startsWith("https://raw.githubusercontent.com/"));
  expect(github.length).toBeGreaterThan(5);
  for (const url of github) expect(url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//);
});
