import { access, constants, mkdir } from "node:fs/promises";
import { Auctions } from "./auction.ts";
import { checkBid } from "./bid.ts";
import { Claims } from "./claims.ts";
import { Collector } from "./collect.ts";
import { loadConfig } from "./config.ts";
import { Faucet } from "./faucet.ts";
import { Fills } from "./fills.ts";
import { MmHub } from "./mm.ts";
import { OneClick } from "./oneClick.ts";
import { Relay } from "./relay.ts";
import { nearChain } from "./rpc.ts";
import { createRelayServer } from "./server.ts";

const CLAIMS_MS = 60_000;
const FAUCET_TOKENS = 100n;

const config = loadConfig(process.env);
await mkdir(config.DATA_DIR, { recursive: true });
await access(config.DATA_DIR, constants.W_OK).catch(() => {
  throw new Error(`DATA_DIR ${config.DATA_DIR} is not writable: fills and claims would be lost (docs/runbook.md, Deploy)`);
});
const chain = nearChain(config);

const [networkId, contract] = await Promise.all([chain.networkId(), chain.contractConfig()]);
if (networkId !== config.NETWORK_ID) throw new Error(`RPC is on ${networkId}, expected ${config.NETWORK_ID}`);
if (contract.intents_id !== config.INTENTS_ID) throw new Error(`${config.OPTIONS_ID} settles through ${contract.intents_id}, not ${config.INTENTS_ID}`);
if (contract.quote_asset !== config.QUOTE_ASSET) throw new Error(`${config.OPTIONS_ID} quotes in ${contract.quote_asset}, not ${config.QUOTE_ASSET}`);

const fills = new Fills(config.DATA_DIR);
const auctions = new Auctions((event, mmId, response, receivedAt) =>
  checkBid(chain, config.INTENTS_ID, event, mmId, response, receivedAt),
);
const hub = new MmHub(config.MM_API_KEYS, (mmId, response) => auctions.respond(mmId, response));
const relay = new Relay({ config, chain, fills, auctions, mms: hub });
const claims = new Claims(config.DATA_DIR);
await claims.load();
const collector = new Collector(chain, config, claims, fills);
let faucet: Faucet | undefined;
if (config.FAUCET) {
  const token = config.QUOTE_ASSET.slice("nep141:".length);
  const amount = FAUCET_TOKENS * 10n ** BigInt(contract.quote_decimals);
  faucet = new Faucet((accountId) => chain.depositFt(token, accountId, amount), config.DATA_DIR);
  await faucet.load();
}

const submitClaims = () => void collector.submitClaims().catch(console.error).finally(() => setTimeout(submitClaims, CLAIMS_MS));
submitClaims();

const oneClick = new OneClick(config.QUOTE_ASSET, config.ONECLICK_JWT);

createRelayServer(relay, fills, hub, collector, oneClick, faucet, config.TRUST_PROXY).listen(config.PORT, () => console.log(`relay listening on :${config.PORT}`));
