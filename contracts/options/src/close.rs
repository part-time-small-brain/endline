use std::collections::{BTreeMap, BTreeSet};

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

use crate::events;
use crate::series::{parse_token_id, short_id, Side};
use crate::{Contract, ContractExt};

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloseAction {
    Exercise,
    Redeem,
    BurnPair,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Closed<'a> {
    action: CloseAction,
    owner_id: &'a AccountId,
    token_ids: &'a [String],
    amounts: Vec<U128>,
    payout: U128,
}

#[near]
impl Contract {
    #[payable]
    pub fn exercise(&mut self, token_id: String, amount: U128) {
        self.close_from_ledger(CloseAction::Exercise, vec![token_id], vec![amount.0]);
    }

    #[payable]
    pub fn redeem(&mut self, token_id: String, amount: U128) {
        self.close_from_ledger(CloseAction::Redeem, vec![token_id], vec![amount.0]);
    }

    #[payable]
    pub fn burn_pair(&mut self, series_id: String, amount: U128) {
        let short = short_id(&series_id);
        self.close_from_ledger(
            CloseAction::BurnPair,
            vec![series_id, short],
            vec![amount.0, amount.0],
        );
    }
}

impl Contract {
    fn close_from_ledger(&mut self, action: CloseAction, token_ids: Vec<String>, amounts: Vec<u128>) {
        assert_one_yocto();
        let holder = env::predecessor_account_id();
        self.close(Some(&holder), action, &token_ids, &amounts, &holder);
    }

    pub(crate) fn close(
        &mut self,
        burn_from: Option<&AccountId>,
        action: CloseAction,
        token_ids: &[String],
        amounts: &[u128],
        owner_id: &AccountId,
    ) {
        require!(amounts.iter().all(|a| *a > 0), "zero amount");
        let unique: BTreeSet<&String> = token_ids.iter().collect();
        require!(unique.len() == token_ids.len(), "duplicate token");

        let mut debits: BTreeMap<String, u128> = BTreeMap::new();
        let mut payout = 0u128;
        let mut add = |series_id: &str, value: u128| {
            *debits.entry(series_id.to_string()).or_default() += value;
            payout += value;
        };

        if action == CloseAction::BurnPair {
            require!(token_ids.len() == 2, "burn_pair takes exactly two tokens");
            let (series_id, first) = parse_token_id(&token_ids[0]);
            let (other_id, second) = parse_token_id(&token_ids[1]);
            require!(
                series_id == other_id && first != second && amounts[0] == amounts[1],
                "burn_pair needs one long and one short of the same series with equal amounts"
            );
            let series = self.series_or_panic(series_id);
            add(&series.id, series.terms().pair_refund(amounts[0]));
        } else {
            let wanted = if action == CloseAction::Exercise {
                Side::Long
            } else {
                Side::Short
            };
            for (token_id, amount) in token_ids.iter().zip(amounts) {
                let (series_id, side) = parse_token_id(token_id);
                require!(
                    side == wanted,
                    format!("{token_id} cannot be used for {action:?}")
                );
                let series = self.series_or_panic(series_id);
                let price = self
                    .final_price(&series.underlying, series.expiry)
                    .unwrap_or_else(|| env::panic_str(&format!("{series_id} not settled yet")));
                add(&series.id, series.payout(side, *amount, price));
            }
        }

        if let Some(holder) = burn_from {
            self.internal_burn(holder, token_ids, amounts);
        }
        for (series_id, debit) in &debits {
            let mut series = self.series_or_panic(series_id).clone();
            require!(
                *debit <= series.collateral_locked.0,
                "collateral invariant violated"
            );
            series.collateral_locked = U128(series.collateral_locked.0 - debit);
            self.series.insert(series_id.clone(), series);
        }
        if payout > 0 {
            let asset = self.quote_asset.clone();
            self.pay(owner_id, &asset, payout);
        }

        events::options(
            match action {
                CloseAction::Exercise => "exercise",
                CloseAction::Redeem => "redeem",
                CloseAction::BurnPair => "burn_pair",
            },
            &Closed {
                action,
                owner_id,
                token_ids,
                amounts: amounts.iter().copied().map(U128).collect(),
                payout: U128(payout),
            },
        );
    }
}
