import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Series } from "@endline/sdk";
import { Account, type KeyPairString, teraToGas } from "near-api-js";
import { z } from "zod";
import { ChainReader } from "./chain.ts";
import type { ProposerConfig } from "./config.ts";

const TICK_MS = 60_000;
const RUN_TIMEOUT_MS = 90_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_DEV_BPS = 50;
const MAX_AGE_SEC = 86_400;
const OracleWasm = z.object({ url: z.url(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });
type OracleWasm = z.infer<typeof OracleWasm>;
const Fixing = z.object({ ok: z.boolean(), price: z.string().regex(/^[1-9][0-9]*$/).nullable(), source: z.string() }).loose();
export type Fixing = z.infer<typeof Fixing>;

export function due(series: Series[], settled: Set<string>, nowSec: number, fromSec: number, untilSec: number): { underlying: string; expiry: number }[] {
  const keys = new Map(series.map((s) => [`${s.underlying} ${s.expiry}`, { underlying: s.underlying, expiry: s.expiry }]));
  return [...keys].filter(([key, { expiry }]) => !settled.has(key) && nowSec >= expiry + fromSec && nowSec < expiry + untilSec).map(([, v]) => v);
}

export function verifiedWasm(bytes: Uint8Array, sha256: string): Uint8Array {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw new Error(`oracle wasm sha256 ${actual}, contract pins ${sha256}`);
  return bytes;
}

export function parseFixing(stdout: string): Fixing {
  return Fixing.parse(JSON.parse(stdout));
}

class OracleChain extends ChainReader {
  private readonly account: Account;

  constructor(config: ProposerConfig) {
    super(config.rpcUrl, config.optionsId);
    this.account = new Account(config.oracleAccountId, this.provider, config.oraclePrivateKey as KeyPairString);
  }

  async oracleWasm(): Promise<OracleWasm> {
    return OracleWasm.parse(await this.view(this.optionsId, "get_oracle_wasm"));
  }

  async propose(underlying: string, expiry: number, price: string): Promise<string> {
    const outcome = await this.account.callFunctionRaw({
      contractId: this.optionsId,
      methodName: "propose_settlement",
      args: { underlying, expiry, price },
      gas: teraToGas(30),
      deposit: 1n,
    });
    return outcome.transaction_outcome.id;
  }
}

function run(wasmtime: string, wasmPath: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(wasmtime, ["run", "-S", "http", "--env", `NEAR_BLOCK_TIMESTAMP=${BigInt(Date.now()) * 1_000_000n}`, wasmPath], {
      env: { PATH: process.env.PATH },
      timeout: RUN_TIMEOUT_MS,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`wasmtime exited ${code}: ${err.trim()}`))));
    child.stdin.end(input);
  });
}

async function download(pinned: OracleWasm): Promise<string> {
  const response = await fetch(pinned.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const wasm = verifiedWasm(new Uint8Array(await response.arrayBuffer()), pinned.sha256);
  const path = join(await mkdtemp(join(tmpdir(), "oracle-")), `${pinned.sha256}.wasm`);
  await writeFile(path, wasm);
  console.log(`propose: running oracle wasm ${pinned.sha256}`);
  return path;
}

async function intact({ sha256, path }: { sha256: string; path: string }): Promise<boolean> {
  return readFile(path).then(
    (bytes) => createHash("sha256").update(bytes).digest("hex") === sha256,
    () => false,
  );
}

export async function proposeCommand(config: ProposerConfig, once: boolean): Promise<void> {
  const chain = new OracleChain(config);
  const network = await chain.networkId();
  if (network === "mainnet") throw new Error("propose runs on testnet only: mainnet settles through OutLayer (settle)");
  const settled = new Set<string>();
  let loaded: { sha256: string; path: string } | undefined;
  for (;;) {
    try {
      const pinned = await chain.oracleWasm();
      if (pinned.sha256 !== loaded?.sha256 || !(await intact(loaded))) loaded = { sha256: pinned.sha256, path: await download(pinned) };
      const wasmPath = loaded.path;
      const nowSec = Math.floor(Date.now() / 1000);
      const [terms, underlyings, series] = await Promise.all([chain.settlementTerms(), chain.underlyings(), chain.seriesFrom(nowSec - MAX_AGE_SEC)]);
      const indexes = new Map(underlyings.map((u) => [u.symbol, u.index]));
      for (const { underlying, expiry } of due(series, settled, nowSec, terms.oracleWindowSec, MAX_AGE_SEC)) {
        if (await chain.settlement(underlying, expiry)) {
          settled.add(`${underlying} ${expiry}`);
          continue;
        }
        const input = JSON.stringify({ index: indexes.get(underlying), expiry, quote_decimals: terms.quoteDecimals, max_dev_bps: MAX_DEV_BPS });
        const fixing = parseFixing(await run(config.wasmtime, wasmPath, input));
        if (!fixing.ok || !fixing.price) {
          console.error(`propose: ${underlying} ${expiry}: no fixing ${JSON.stringify(fixing)}`);
          continue;
        }
        console.log(`propose: ${underlying} ${expiry} at ${fixing.price} (${fixing.source}): tx ${await chain.propose(underlying, expiry, fixing.price)}`);
        settled.add(`${underlying} ${expiry}`);
      }
    } catch (e) {
      console.error(`propose: ${e}`);
    }
    if (once) return;
    await sleep(TICK_MS);
  }
}
