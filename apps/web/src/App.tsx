import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { useState } from "react";
import { useApp } from "./app/context.ts";
import { useData } from "./app/data.tsx";
import { Link, navigate, usePathname } from "./app/router.tsx";
import { usePositions } from "./app/usePositions.ts";
import { CollectBanner } from "./components/CollectBanner.tsx";
import { ConnectSheet } from "./components/ConnectSheet.tsx";
import { DepositSheet } from "./components/deposit/DepositSheet.tsx";
import { Header } from "./components/Header.tsx";
import { KeySetup } from "./components/KeySetup.tsx";
import { Notice } from "./components/Notice.tsx";
import { QuoteSheet, type QuoteSelection } from "./components/QuoteSheet.tsx";
import { useNow } from "./hooks/useNow.ts";
import { useTradeMode } from "./hooks/useTradeMode.ts";
import { type Route, routeOf } from "./lib/route.ts";
import { Landing } from "./screens/Landing.tsx";
import { Positions } from "./screens/Positions.tsx";
import { Trade } from "./screens/Trade.tsx";
import { useWallet } from "./wallet/context.tsx";

export function App() {
  const route = routeOf(usePathname(), useApp().config.paths);
  const { wallet } = useWallet();
  const [sheet, setSheet] = useState<"connect" | "deposit" | QuoteSelection>();
  const connect = () => setSheet("connect");
  const addFunds = () => setSheet(wallet ? "deposit" : "connect");
  const quote = (selection: QuoteSelection) => setSheet((current) => current ?? selection);
  const close = () => setSheet(undefined);
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        {route === "landing" ? <Landing /> : <Shell route={route} onConnect={connect} onAddFunds={addFunds} onQuote={quote} />}
        {sheet === "connect" && <ConnectSheet onClose={close} />}
        {sheet === "deposit" && wallet && <DepositSheet wallet={wallet} onClose={close} />}
        {typeof sheet === "object" && <QuoteSheet {...sheet} onClose={close} onAddFunds={addFunds} />}
      </MotionConfig>
    </LazyMotion>
  );
}

function Shell({ route, onConnect, onAddFunds, onQuote }: {
  route: Exclude<Route, "landing">;
  onConnect: () => void;
  onAddFunds: () => void;
  onQuote: (selection: QuoteSelection) => void;
}) {
  const mode = useTradeMode();
  const { paths } = useApp().config;
  const { quoteDecimals } = useData();
  const nowSec = Math.floor(useNow(1000) / 1000);
  const views = usePositions(nowSec);
  const open = views?.filter((v) => v.status !== "paid" && v.status !== "expired").length ?? 0;
  const toCollect = views?.filter((v) => v.status === "collect").length ?? 0;
  const lite = route === "trade" && mode === "lite";

  return (
    <div className={`flex min-h-dvh flex-col ${route === "trade" ? "lg:h-dvh" : ""}`}>
      <Header route={route} open={open} toCollect={toCollect} onConnect={onConnect} onAddFunds={onAddFunds} />
      <KeySetup />
      {views && (
        <div className={`mx-auto w-full ${route === "positions" || lite ? "max-w-2xl" : route === "trade" && mode === "tap" ? "max-w-5xl" : ""}`}>
          <CollectBanner views={views} quoteDecimals={quoteDecimals} />
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col">
        {route === "trade" && <Trade mode={mode} nowSec={nowSec} views={views} onConnect={onConnect} onAddFunds={onAddFunds} onQuote={onQuote} />}
        {route === "positions" && (
          <div className="mx-auto w-full max-w-2xl px-4 pt-2 pb-10 lg:px-6">
            <Positions views={views} nowSec={nowSec} onConnect={onConnect} onTrade={() => navigate(paths.trade)} onQuote={onQuote} />
          </div>
        )}
        {route === "missing" && (
          <div className="mx-auto w-full max-w-md px-4 pt-16">
            <Notice title="Nothing here" body="This page doesn't exist.">
              <Link href={paths.trade} className="mt-5 inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-on-ink">
                Go to Trade
              </Link>
            </Notice>
          </div>
        )}
      </main>
    </div>
  );
}
