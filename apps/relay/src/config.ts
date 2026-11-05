import { AccountId } from "@endline/sdk";
import { z } from "zod";

const Env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    NEAR_RPC_URL: z.url(),
    NETWORK_ID: z.enum(["mainnet", "testnet"]),
    INTENTS_ID: AccountId.default("intents.near"),
    OPTIONS_ID: AccountId,
    QUOTE_ASSET: z.string().startsWith("nep141:"),
    RELAYER_ACCOUNT_ID: AccountId,
    RELAYER_PRIVATE_KEY: z.string().regex(/^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]+$/, "ed25519:<base58> key"),
    MM_API_KEYS: z
      .string()
      .transform((list) => list.split(",").map((key) => key.trim()).filter((key) => key !== ""))
      .pipe(z.array(z.string().min(16, "api keys need at least 16 chars")).min(1)),
    DATA_DIR: z.string().min(1),
    TRUST_PROXY: z.stringbool().default(false),
    FAUCET: z.stringbool().default(false),
    APP_ORIGINS: z
      .string()
      .default("")
      .transform((list) => list.split(",").map((origin) => origin.trim()).filter((origin) => origin !== ""))
      .pipe(z.array(z.string().refine((url) => URL.canParse(url) && new URL(url).origin === url, "an origin like https://app.example.com: no path, no trailing slash"))),
    ONECLICK_JWT: z.string().min(1).optional(),
  })
  .refine((env) => env.NETWORK_ID === "testnet" || !env.FAUCET, { path: ["FAUCET"], message: "the faucet runs only on testnet" });

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new Error(`bad config:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
