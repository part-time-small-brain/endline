import { defineConfig, devices } from "@playwright/test";

const PORT = 5310;
const TESTNET_PORT = 5311;
const OFFLINE_PORT = 5312;
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };
const mobile = { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const ONLY_THERE = [/testnet\.spec/, /offline\.spec/];
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
  ],
});
