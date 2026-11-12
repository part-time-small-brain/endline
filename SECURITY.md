# Security

Endline runs on NEAR mainnet with real funds. The contract is not audited.

## Report a vulnerability

Don't open a public issue. Report it privately through [GitHub private vulnerability reporting](https://github.com/part-time-small-brain/endline/security/advisories/new) or email parttimesmallbrain@protonmail.com.

Say what's affected, how to reproduce it and what an attacker gains. We reply within 72 hours.

## Scope

- `opt.endline.near`, the options contract (reproducible build of commit `1339f7c`, code hash `D6Y3uQ1gvt6AUU2j9TCkwLFnnAMbVGL1RcboyzsUSwCg`)
- the oracle WASM pinned on that contract (`get_oracle_wasm`)
- the relay and market maker behind app.endline.trade, and the web app
- the code in this repo

Out of scope: third-party services (NEAR Intents, 1Click, OutLayer, wallets), volume-based denial of service, testnet, and the [known gaps](https://docs.endline.trade/developers/security#known-gaps).
