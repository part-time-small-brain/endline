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
    { name: "desktop", testIgnore: ONLY_THERE, use: desktop },
    { name: "mobile", testIgnore: ONLY_THERE, use: mobile },
    { name: "testnet", testMatch: [/testnet\.spec/, /positions\.spec/], use: { ...desktop, baseURL: `http://localhost:${TESTNET_PORT}` } },
    { name: "offline", testMatch: /offline\.spec/, use: { ...desktop, baseURL: `http://localhost:${OFFLINE_PORT}` } },
    { name: "split", testMatch: /split\.spec/, use: { ...desktop, baseURL: `http://localhost:${SPLIT_PORT}` } },
  ],
  webServer: [
    server(PORT, { VITE_MOCK: "1" }),
    server(TESTNET_PORT, { VITE_MOCK: "1", VITE_NETWORK: "testnet" }),
    server(OFFLINE_PORT, { VITE_RELAY_URL: `http://localhost:${OFFLINE_PORT}`, VITE_NETWORK: "testnet" }),
    {
      command: `vite --port ${SPLIT_PORT} --strictPort --host 127.0.0.1`,
      env: { VITE_APP_URL: SPLIT_APP, VITE_RELAY_URL: SPLIT_APP, VITE_NETWORK: "testnet" },
      url: `${SPLIT_APP}/`,
      reuseExistingServer: true,
    },
  ],
});
