# Back-to-back hedge on Derive

Our MM hedges delta on Hyperliquid, but carries vega and gamma risk. Derive V3 (Oct 2026) opens its order book, risk engine and MM liquidity to third-party apps through one API.

- The MM could offset each option it sells with the same instrument on Derive, keeping only the spread.
- Caveats:
  - custody on Ethereum;
  - KYC and geo-gating;
  - a centralized API dependency.

  So use it as an MM hedge, never in the user path.
