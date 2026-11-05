use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json};
use near_sdk::{assert_one_yocto, env, near, require, AccountId, Gas, GasWeight, NearToken, Promise};

use crate::{Contract, ContractExt};

pub const SETTLE_DELAY_SEC: u64 = 300;
const PENDING_TIMEOUT_SEC: u64 = 600;
const MAX_DEV_BPS: u32 = 50;
const MIN_SETTLE_DEPOSIT: NearToken = NearToken::from_millinear(10);
const MIN_SETTLE_GAS: Gas = Gas::from_tgas(300);
const GAS_REQUEST_EXECUTION: Gas = Gas::from_tgas(100);
const GAS_ON_SETTLEMENT_RESULT: Gas = Gas::from_tgas(30);
const MAX_RESULT_LEN: usize = 2_048;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct OracleWasm {
    pub outlayer_id: AccountId,
    pub url: String,
    pub sha256: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PendingOracleWasm {
    pub oracle_wasm: OracleWasm,
    pub active_at: u64,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Fixing {
    ok: bool,
    index: String,
    expiry: u64,
    price: Option<String>,
    source: String,
}

#[near]
impl Contract {
    #[payable]
    pub fn set_oracle_wasm(&mut self, oracle_wasm: OracleWasm) {
        assert_one_yocto();
        self.assert_owner();
        require!(
            oracle_wasm.sha256.len() == 64
                && oracle_wasm
                    .sha256
                    .bytes()
                    .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
            "sha256 must be 64 lowercase hex chars"
        );
        require!(
            oracle_wasm.url.starts_with("https://")
                && oracle_wasm.url.len() <= 2_048
                && !oracle_wasm.url.chars().any(char::is_whitespace),
            "url must be https without whitespace"
        );
        let now = Self::now_sec();
        if let Some(next) = self.next_oracle_wasm.take().filter(|n| now >= n.active_at) {
            self.oracle_wasm = Some(next.oracle_wasm);
        }
        self.next_oracle_wasm = Some(PendingOracleWasm {
            oracle_wasm,
            active_at: now + self.oracle_delay_sec,
        });
    }

    #[payable]
    pub fn request_settlement(&mut self, underlying: String, expiry: u64) -> Promise {
        let wasm = self
            .active_oracle_wasm()
            .cloned()
            .unwrap_or_else(|| env::panic_str("oracle wasm not set"));
        let index = self
            .underlyings
            .get(&underlying)
            .unwrap_or_else(|| env::panic_str("unknown underlying"))
            .index
            .clone();
        self.assert_listed_expiry(&underlying, expiry);
        let now = Self::now_sec();
        require!(now >= expiry + SETTLE_DELAY_SEC, "too early to settle");
        require!(
            now < expiry + self.timing.oracle_window_sec,
            "oracle window closed, use manual settlement"
        );
        let key = (underlying.clone(), expiry);
        require!(self.settlements.get(&key).is_none(), "already proposed");
        if let Some(requested_at) = self.pending_settlements.get(&key) {
            require!(
                now >= requested_at + PENDING_TIMEOUT_SEC,
                "settlement already requested"
            );
        }
        let deposit = env::attached_deposit();
        require!(
            deposit >= MIN_SETTLE_DEPOSIT,
            format!("attach at least {MIN_SETTLE_DEPOSIT}")
        );
        require!(
            env::prepaid_gas() >= MIN_SETTLE_GAS,
            "send with at least 300 TGas"
        );
        self.pending_settlements.insert(key, now);

        let input = json!({
            "index": index,
            "expiry": expiry,
            "quote_decimals": self.quote_decimals,
            "max_dev_bps": MAX_DEV_BPS,
        });
        let args = json!({
            "source": { "WasmUrl": { "url": wasm.url, "hash": wasm.sha256, "build_target": "wasm32-wasip2" } },
            "resource_limits": { "max_instructions": 10_000_000_000u64, "max_memory_mb": 128, "max_execution_seconds": 60 },
            "input_data": input.to_string(),
            "response_format": "Json",
            "payer_account_id": env::predecessor_account_id(),
        });
        Promise::new(wasm.outlayer_id.clone())
            .function_call_weight(
                "request_execution",
                args.to_string().into_bytes(),
                deposit,
                GAS_REQUEST_EXECUTION,
                GasWeight(1),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_SETTLEMENT_RESULT)
                    .on_settlement_result(underlying, expiry, wasm.outlayer_id.clone(), now),
            )
    }

    #[private]
    pub fn on_settlement_result(
        &mut self,
        underlying: String,
        expiry: u64,
        outlayer_id: AccountId,
        requested_at: u64,
    ) -> bool {
        let key = (underlying.clone(), expiry);
        if self.pending_settlements.get(&key) == Some(&requested_at) {
            self.pending_settlements.remove(&key);
        }
        match self.accepted_price(&underlying, expiry) {
            Ok((price, source)) => {
                self.store_proposal(underlying, expiry, price, outlayer_id, source);
                true
            }
            Err(reason) => {
                env::log_str(&format!("settlement rejected: {reason}"));
                false
            }
        }
    }
}

impl Contract {
    pub(crate) fn active_oracle_wasm(&self) -> Option<&OracleWasm> {
        match &self.next_oracle_wasm {
            Some(next) if Self::now_sec() >= next.active_at => Some(&next.oracle_wasm),
            _ => self.oracle_wasm.as_ref(),
        }
    }

    pub(crate) fn is_oracle(&self, account_id: &AccountId) -> bool {
        self.oracles
            .get(account_id)
            .is_some_and(|&active_at| Self::now_sec() >= active_at)
    }

    fn accepted_price(&self, underlying: &str, expiry: u64) -> Result<(u128, String), String> {
        if self.settlements.get(&(underlying.to_string(), expiry)).is_some() {
            return Err("already proposed".into());
        }
        let bytes = env::promise_result_checked(0, MAX_RESULT_LEN).map_err(|e| format!("outlayer: {e:?}"))?;
        let fixing: Fixing = serde_json::from_slice(&bytes).map_err(|_| "no fixing returned".to_string())?;
        let index = &self
            .underlyings
            .get(underlying)
            .ok_or("unknown underlying")?
            .index;
        if !fixing.ok || &fixing.index != index || fixing.expiry != expiry {
            return Err(format!("fixing not usable: {}", fixing.source));
        }
        let price: u128 = fixing.price.and_then(|p| p.parse().ok()).ok_or("bad price")?;
        if price == 0 {
            return Err("zero price".into());
        }
        Ok((price, fixing.source))
    }
}
