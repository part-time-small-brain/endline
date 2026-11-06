import { useState } from "react";
import { Faq } from "../components/landing/Faq.tsx";
import { FinalCta } from "../components/landing/FinalCta.tsx";
import { FloorDemo } from "../components/landing/FloorDemo.tsx";
import { Footer } from "../components/landing/Footer.tsx";
import { Hero } from "../components/landing/Hero.tsx";
import { HowItWorks } from "../components/landing/HowItWorks.tsx";
import { Intents } from "../components/landing/Intents.tsx";
import { Nav } from "../components/landing/Nav.tsx";
import { Safety } from "../components/landing/Safety.tsx";
import { Tagline } from "../components/landing/Tagline.tsx";
import { balancedOf, type DemoMarket, useDemoMarket } from "../components/landing/useDemoMarket.ts";
import { useNow } from "../hooks/useNow.ts";

export function Landing() {
  const nowSec = Math.floor(useNow(1000) / 1000);
  const [startSec] = useState(nowSec);
  const { market, example } = useDemoMarket(nowSec);
  const [pinned, setPinned] = useState<DemoMarket>();
  if (market && !pinned) setPinned(market);
  const still = pinned ?? example;
  const asset = still.assets.find((a) => a.symbol === "BTC") ?? still.assets[0];
  const strike = asset && balancedOf(asset, "call", still.quoteDecimals);

  return (
    <>
      <a href="#main" className="sr-only z-50 rounded-lg bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero nowSec={nowSec} />
        <Tagline />
        {asset && (
          <>
            <HowItWorks asset={asset} quoteDecimals={still.quoteDecimals} nowSec={startSec} />
            <FloorDemo key={asset.symbol + still.live} asset={asset} quoteDecimals={still.quoteDecimals} />
            {strike && <Intents symbol={asset.symbol} strike={BigInt(strike.strike)} quoteDecimals={still.quoteDecimals} />}
          </>
        )}
        <Safety nowSec={startSec} />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
