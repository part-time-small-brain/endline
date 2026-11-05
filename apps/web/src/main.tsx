import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AppContext } from "./app/context.ts";
import { DataProvider } from "./app/data.tsx";
import { type Config, loadConfig } from "./config.ts";
import { createServices, type Services } from "./services.ts";
import { WalletProvider } from "./wallet/context.tsx";
import { TapProvider } from "./wallet/tapBalance.tsx";
import "./index.css";

const root = createRoot(document.getElementById("root") as HTMLElement);

async function start(config: Config): Promise<Services> {
  if (!config.mock) return createServices(config);
  const { createMockServices } = await import("./mock/services.ts");
  return createMockServices(config);
}

try {
  const config = loadConfig(import.meta.env);
  const services = await start(config);
  root.render(
    <StrictMode>
      <AppContext.Provider value={{ config, services }}>
        <WalletProvider>
          <TapProvider>
            <DataProvider>
              <App />
            </DataProvider>
          </TapProvider>
        </WalletProvider>
      </AppContext.Provider>
    </StrictMode>,
  );
} catch (error) {
  root.render(
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-lg font-semibold">The app isn't configured</h1>
      <p className="mt-2 text-sm text-ink-2">Set the VITE_ variables from apps/web/README.md, or run with VITE_MOCK=1.</p>
      <pre className="mt-4 overflow-auto rounded-xl bg-surface p-4 text-xs text-ink-2">{error instanceof Error ? error.message : String(error)}</pre>
    </div>,
  );
}
