use std::collections::BTreeMap;

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise};

use crate::events;
use crate::payout::promise_failed;
use crate::series::{short_id, Series};
use crate::{Contract, ContractExt};

// auto-collect claims, the relay's series list and free-call scores all look back a week after the end
const DELETE_AFTER_SEC: u64 = 7 * 86_400;
const MAX_DELETES: usize = 20;
const GAS_REFUND_CALLBACK: Gas = Gas::from_tgas(5);

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Deleted<'a> {
    series_id: &'a str,
    created_by: &'a AccountId,
    refund: NearToken,
    dust: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct RefundFailed<'a> {
    account_id: &'a AccountId,
    amount: NearToken,
}

#[near]
impl Contract {
    pub fn delete_series(&mut self, series_ids: Vec<String>) -> Vec<String> {
        require!(
            !series_ids.is_empty() && series_ids.len() <= MAX_DELETES,
            format!("delete 1 to {MAX_DELETES} series at a time")
        );
        let mut refunds: BTreeMap<AccountId, NearToken> = BTreeMap::new();
        let mut deleted = Vec::new();
        for id in series_ids {
            let Some(series) = self.series.get(&id).cloned().filter(|s| self.deletable(s)) else {
                continue;
            };
            let before = env::storage_usage();
            self.series.remove(&id);
            self.series_by_expiry.remove(&(series.expiry, id.clone()));
            for token in [id.clone(), short_id(&id)] {
                self.supply.remove(&token);
                self.balances.remove(&(token, self.intents_id.clone()));
            }
            self.series.flush();
            self.series_by_expiry.flush();
            self.supply.flush();
            self.balances.flush();
            let freed = before.saturating_sub(env::storage_usage());
            let refund = series
                .storage_paid
                .min(env::storage_byte_cost().saturating_mul(freed as u128));
            let total = refunds
                .entry(series.created_by.clone())
                .or_insert(NearToken::from_yoctonear(0));
            *total = total.saturating_add(refund);
            events::options(
                "series_deleted",
                &Deleted {
                    series_id: &id,
                    created_by: &series.created_by,
                    refund,
                    dust: series.collateral_locked,
                },
            );
            deleted.push(id);
        }
        for (account_id, amount) in refunds.into_iter().filter(|(_, amount)| !amount.is_zero()) {
            Promise::new(account_id.clone())
                .transfer(amount)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_REFUND_CALLBACK)
                        .on_storage_refund(account_id, amount),
                )
                .detach();
        }
        deleted
    }

    pub fn deletable_series(&self, series_ids: Vec<String>) -> Vec<String> {
        series_ids
            .into_iter()
            .filter(|id| self.series.get(id).is_some_and(|s| self.deletable(s)))
            .collect()
    }

    #[private]
    pub fn on_storage_refund(&mut self, account_id: AccountId, amount: NearToken) {
        if promise_failed() {
            events::options(
                "storage_refund_failed",
                &RefundFailed {
                    account_id: &account_id,
                    amount,
                },
            );
        }
    }
}

impl Contract {
    fn deletable(&self, series: &Series) -> bool {
        if Self::now_sec() < series.expiry + DELETE_AFTER_SEC {
            return false;
        }
        let (long, short) = (series.long_open.0, series.short_open.0);
        if long == 0 && short == 0 {
            return true;
        }
        let terms = series.terms();
        // each bound floors a total, so it also covers every holder's own rounded close
        self.final_price(&series.underlying, series.expiry)
            .is_some_and(|price| {
                terms.long_payout(long, price) == 0
                    && terms.max_short_payout(short, price) == 0
                    && terms.pair_refund(long.min(short)) == 0
            })
    }
}
