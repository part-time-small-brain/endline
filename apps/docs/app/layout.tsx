import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import { openGraph, siteUrl } from "@/lib/layout";
import "./global.css";

export const metadata: Metadata = {
  title: { template: "%s · Endline docs", default: "Endline docs" },
  description: "Endline: crypto options on NEAR Intents.",
  metadataBase: new URL(siteUrl),
  openGraph,
  twitter: { card: "summary_large_image" },
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
