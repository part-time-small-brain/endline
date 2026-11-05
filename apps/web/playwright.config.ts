import { defineConfig, devices } from "@playwright/test";

const PORT = 5310;
const TESTNET_PORT = 5311;
const OFFLINE_PORT = 5312;
const SPLIT_PORT = 5313;
const SPLIT_APP = `http://127.0.0.1:${SPLIT_PORT}`;
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };
const mobile = { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const ONLY_THERE = [/testnet\.spec/, /offline\.spec/, /split\.spec/];
const server = (port: number, env: Record<string, string>) => ({
  command: `vite --port ${port} --strictPort`,
  env,
  url: `http://localhost:${port}/app`,
  reuseExistingServer: true,
});

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop-light", testIgnore: ONLY_THERE, use: { ...desktop, colorScheme: "light" } },
    { name: "desktop-dark", testIgnore: ONLY_THERE, use: { ...desktop, colorScheme: "dark" } },
    { name: "mobile-light", testIgnore: ONLY_THERE, use: { ...mobile, colorScheme: "light" } },
    { name: "mobile-dark", testIgnore: ONLY_THERE, use: { ...mobile, colorScheme: "dark" } },
    { name: "testnet", testMatch: [/testnet\.spec/, /positions\.spec/], use: { ...desktop, baseURL: `http://localhost:${TESTNET_PORT}` } },
    { name: "offline", testMatch: /offline\.spec/, use: { ...desktop, baseURL: `http://localhost:${OFFLINE_PORT}` } },
    { name: "split", testMatch: /split\.spec/, use: { ...desktop, baseURL: `http://localhost:${SPLIT_PORT}` } },
  ],
  webServer: [
    server(PORT, { VITE_MOCK: "1" }),
    server(TESTNET_PORT, { VITE_MOCK: "1", VITE_NETWORK: "testnet" }),
    server(OFFLINE_PORT, {
      VITE_RELAY_URL: `http://localhost:${OFFLINE_PORT}`,
      VITE_NETWORK: "testnet",
      VITE_RPC_URL: `http://localhost:${OFFLINE_PORT}/rpc`,
      VITE_INTENTS_ID: "intents.demo.testnet",
      VITE_OPTIONS_ID: "opt.demo.testnet",
      VITE_QUOTE_ASSET: "nep141:usdc.demo.testnet",
    }),
    {
      command: `vite --port ${SPLIT_PORT} --strictPort --host 127.0.0.1`,
      env: {
        VITE_APP_URL: SPLIT_APP,
        VITE_RELAY_URL: SPLIT_APP,
        VITE_NETWORK: "testnet",
        VITE_RPC_URL: `${SPLIT_APP}/rpc`,
        VITE_INTENTS_ID: "intents.demo.testnet",
        VITE_OPTIONS_ID: "opt.demo.testnet",
        VITE_QUOTE_ASSET: "nep141:usdc.demo.testnet",
      },
      url: `${SPLIT_APP}/`,
      reuseExistingServer: true,
    },
  ],
});
