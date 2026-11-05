# Options on tokenized stocks

Over 80% of Hypercall's volume is S&P 500 and single-stock options trading 24/7.

- Ondo tokenized stocks are live on NEAR Intents (20 US stocks via solver routing).
- Collateral would be the Ondo token (calls) or USDC (puts).
- Settlement needs a stock price fixing. The oracle's crypto exchanges have none, so we'd need an equity close price source in the oracle WASM, and expiries at the US close, not 08:00 UTC.
- Open questions: corporate actions, weekend gaps, regulatory exposure.
