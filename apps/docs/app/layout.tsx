import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import "./global.css";

export const metadata: Metadata = {
  title: { template: "%s · near-options docs", default: "near-options docs" },
  description: "Up/Down options on BTC and ETH, settled through NEAR Intents.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
