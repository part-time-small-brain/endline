import { access, constants, mkdir } from "node:fs/promises";
import { Auctions } from "./auction.ts";
import { checkBid } from "./bid.ts";
import { Calls } from "./calls.ts";
import { Claims } from "./claims.ts";
import { Collector } from "./collect.ts";
import { loadConfig } from "./config.ts";
import { Deposits } from "./deposits.ts";
import { Faucet } from "./faucet.ts";
import { Fills } from "./fills.ts";
import { MmHub } from "./mm.ts";
import { Notifier } from "./notifier.ts";
import { OneClick } from "./oneClick.ts";
import { Relay } from "./relay.ts";
import { nearChain } from "./rpc.ts";
import { createRelayServer } from "./server.ts";

const CLAIMS_MS = 60_000;
const SCORE_MS = 60_000;
const DEPOSITS_MS = 30_000;
const FAUCET_TOKENS = 100n;

const config = loadConfig(process.env);
await mkdir(config.DATA_DIR, { recursive: true });
await access(config.DATA_DIR, constants.W_OK).catch(() => {
  throw new Error(`DATA_DIR ${config.DATA_DIR} is not writable: fills and claims would be lost (see apps/relay/README.md, DATA_DIR)`);
});
const chain = nearChain(config);

const [networkId, contract] = await Promise.all([chain.networkId(), chain.contractConfig()]);
if (networkId !== config.NETWORK_ID) throw new Error(`RPC is on ${networkId}, expected ${config.NETWORK_ID}`);
if (contract.intents_id !== config.intents_id) throw new Error(`${config.options_id} settles through ${contract.intents_id}, not ${config.intents_id}`);
if (contract.quote_asset !== config.quote_asset) throw new Error(`${config.options_id} quotes in ${contract.quote_asset}, not ${config.quote_asset}`);

const notifier = new Notifier(config.ALERT_WEBHOOK_URL, config.NETWORK_ID, chain);
const notify = notifier.post.bind(notifier);
const fills = new Fills(config.DATA_DIR);
await fills.load();
const auctions = new Auctions((event, mmId, response, receivedAt) =>
  checkBid(chain, config.intents_id, event, mmId, response, receivedAt),
);
const hub = new MmHub(config.MM_API_KEYS, (mmId, response) => auctions.respond(mmId, response));
const relay = new Relay({ config, chain, fills, auctions, mms: hub, notify });
const claims = new Claims(config.DATA_DIR);
await claims.load();
const collector = new Collector(chain, config, claims, fills, notify);
let faucet: Faucet | undefined;
if (config.FAUCET) {
  const token = config.quote_asset.slice("nep141:".length);
  const amount = FAUCET_TOKENS * 10n ** BigInt(contract.quote_decimals);
  faucet = new Faucet((accountId) => chain.depositFt(token, accountId, amount), config.DATA_DIR);
  await faucet.load();
}

const submitClaims = () => void collector.submitClaims().catch(console.error).finally(() => setTimeout(submitClaims, CLAIMS_MS));
submitClaims();

const calls = new Calls(chain, relay.sessions, () => hub.marks.best(Date.now()), notify, config.DATA_DIR);
await calls.load();
const scoreCalls = () => void calls.score().catch(console.error).finally(() => setTimeout(scoreCalls, SCORE_MS));
scoreCalls();

const deposits = new Deposits(notifier);
const oneClick = new OneClick(config.quote_asset, config.ONECLICK_JWT, deposits);
const pollDeposits = () => void deposits.poll().catch(console.error).finally(() => setTimeout(pollDeposits, DEPOSITS_MS));
if (notifier.on) pollDeposits();

createRelayServer(relay, fills, hub, collector, oneClick, calls, faucet, config.TRUST_PROXY, new Set(config.APP_ORIGINS)).listen(config.PORT, () => console.log(`relay listening on :${config.PORT}`));
