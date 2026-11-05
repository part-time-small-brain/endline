# Covered call / cash-secured put vault

"Get paid to sell BTC higher" and "get paid to buy lower" (Rysk and Aevo framing).

- Users deposit BTC (or USDC) from any chain into a vault.
- Each week the vault writes an out-of-the-money call (or put) and sells the long side to the MM over RFQ. The premium goes back to depositors.
- It reuses `write` and the RFQ sell flow, so no new option logic is needed.
- Open questions:
  - Epoch accounting (shares minted at epoch start).
  - Strike selection (delta target off Deribit IV).
  - Whether the vault is a separate contract or an MM-run account.
- Prior art: Ribbon/Aevo DOVs, Spin (NEAR, dead), Rysk V12, Thetanuts. Spin died on liquidity and a chain move, not on the product.
