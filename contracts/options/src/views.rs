use std::ops::Bound;

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::{Config, Contract, ContractExt, OracleWasm, PendingOracleWasm, Series, Underlying};

#[near(serializers = [json])]
pub struct PendingOracleChanges {
    pub oracles: Vec<(AccountId, u64)>,
    pub oracle_wasm: Option<PendingOracleWasm>,
}

#[near]
impl Contract {
    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            pending_owner_id: self.pending_owner_id.clone(),
            intents_id: self.intents_id.clone(),
            quote_asset: self.quote_asset.clone(),
            quote_decimals: self.quote_decimals,
            dispute_window_sec: self.dispute_window_sec,
            oracle_delay_sec: self.oracle_delay_sec,
            timing: self.timing,
            paused: self.paused,
        }
    }

    pub fn get_oracle_wasm(&self) -> Option<OracleWasm> {
        self.active_oracle_wasm().cloned()
    }

    pub fn get_oracles(&self) -> Vec<AccountId> {
        let now = Self::now_sec();
        self.oracles
            .iter()
            .filter(|(_, &active_at)| now >= active_at)
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub fn get_pending_oracle_changes(&self) -> PendingOracleChanges {
        let now = Self::now_sec();
        PendingOracleChanges {
            oracles: self
                .oracles
                .iter()
                .filter(|(_, &active_at)| now < active_at)
                .map(|(id, &active_at)| (id.clone(), active_at))
                .collect(),
            oracle_wasm: self.next_oracle_wasm.clone().filter(|next| now < next.active_at),
        }
    }

    pub fn get_underlyings(&self) -> Vec<(String, Underlying)> {
        self.underlyings
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    pub fn get_series(&self, series_id: String) -> Option<Series> {
        self.series.get(&series_id).cloned()
    }

    pub fn list_series(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Series> {
        self.series
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(200) as usize)
            .cloned()
            .collect()
    }

    pub fn list_series_by_expiry(
        &self,
        from_expiry: u64,
        after_id: Option<String>,
        limit: Option<u32>,
    ) -> Vec<Series> {
        let start = match after_id {
            Some(id) => Bound::Excluded((from_expiry, id)),
            None => Bound::Included((from_expiry, String::new())),
        };
        self.series_by_expiry
            .range((start, Bound::Unbounded))
            .take(limit.unwrap_or(50).min(200) as usize)
            .map(|((_, id), _)| self.series_or_panic(id).clone())
            .collect()
    }

    pub fn get_claimable(&self, account_id: AccountId, asset: String) -> U128 {
        U128(self.claimable.get(&(account_id, asset)).copied().unwrap_or(0))
    }

    pub fn get_undelivered(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(
            self.undelivered
                .get(&(account_id, token_id))
                .copied()
                .unwrap_or(0),
        )
    }
}
