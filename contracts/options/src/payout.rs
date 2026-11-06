use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, PromiseError};

use crate::events;
use crate::mt::{ext_mt_receiver, unused_amounts, MAX_BATCH};
use crate::{Contract, ContractExt, ONE_YOCTO};

const GAS_INTENTS_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_INTENTS_DEPOSIT: Gas = Gas::from_tgas(30);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);

#[allow(dead_code)]
#[ext_contract(ext_intents)]
pub trait Intents {
    fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    );
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct PayoutFailed<'a> {
    owner_id: &'a AccountId,
    asset: &'a str,
    amount: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct DeliveryFailed<'a> {
    owner_id: &'a AccountId,
    token_ids: Vec<String>,
    amounts: Vec<U128>,
}

#[near]
impl Contract {
    #[payable]
    pub fn withdraw_claimable(&mut self, owner_id: AccountId, asset: String) {
        assert_one_yocto();
        let amount = self
            .claimable
            .remove(&(owner_id.clone(), asset.clone()))
            .unwrap_or_else(|| env::panic_str("nothing claimable"));
        self.pay(&owner_id, &asset, amount);
    }

    #[private]
    pub fn on_payout(&mut self, owner_id: AccountId, asset: String, amount: U128) {
        if promise_failed() {
            events::options(
                "payout_failed",
                &PayoutFailed {
                    owner_id: &owner_id,
                    asset: &asset,
                    amount,
                },
            );
            let key = (owner_id, asset);
            let current = self.claimable.get(&key).copied().unwrap_or(0);
            self.claimable
                .insert(key, current.checked_add(amount.0).expect("claimable overflow"));
        }
    }

    #[payable]
    pub fn retry_delivery(&mut self, owner_id: AccountId, token_ids: Vec<String>) {
        assert_one_yocto();
        require!(
            !token_ids.is_empty() && token_ids.len() <= MAX_BATCH,
            "batch size"
        );
        let amounts = token_ids
            .iter()
            .map(|token_id| {
                self.undelivered
                    .remove(&(owner_id.clone(), token_id.clone()))
                    .map(U128)
                    .unwrap_or_else(|| env::panic_str(&format!("nothing undelivered for {token_id}")))
            })
            .collect();
        self.notify_intents(&owner_id, token_ids, amounts);
    }

    #[private]
    pub fn on_options_delivered(&mut self, owner_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>) {
        let unused = unused_amounts(&amounts, true);
        let mut failed = DeliveryFailed {
            owner_id: &owner_id,
            token_ids: vec![],
            amounts: vec![],
        };
        for ((token_id, amount), unused) in token_ids.into_iter().zip(&amounts).zip(unused) {
            let missed = unused.min(amount.0);
            if missed == 0 {
                continue;
            }
            let key = (owner_id.clone(), token_id.clone());
            let current = self.undelivered.get(&key).copied().unwrap_or(0);
            self.undelivered
                .insert(key, current.checked_add(missed).expect("undelivered overflow"));
            failed.token_ids.push(token_id);
            failed.amounts.push(U128(missed));
        }
        if !failed.token_ids.is_empty() {
            events::options("delivery_failed", &failed);
        }
    }
}

pub(crate) fn promise_failed() -> bool {
    matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed))
}

impl Contract {
    pub(crate) fn pay(&mut self, owner_id: &AccountId, asset: &str, amount: u128) {
        ext_intents::ext(self.intents_id.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_INTENTS_TRANSFER)
            .mt_transfer(
                owner_id.clone(),
                asset.to_string(),
                U128(amount),
                None,
                Some("endline payout".into()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_payout(owner_id.clone(), asset.to_string(), U128(amount)),
            )
            .detach();
    }

    pub(crate) fn deliver_options(
        &mut self,
        owner_id: &AccountId,
        token_ids: Vec<String>,
        amounts: Vec<u128>,
    ) {
        let me = env::current_account_id();
        let intents_id = self.intents_id.clone();
        self.internal_mint(&me, &token_ids, &amounts);
        for (token_id, amount) in token_ids.iter().zip(&amounts) {
            self.internal_transfer(&me, &intents_id, token_id, *amount, Some("deposit to intents"));
        }
        self.notify_intents(owner_id, token_ids, amounts.into_iter().map(U128).collect());
    }

    fn notify_intents(&self, owner_id: &AccountId, token_ids: Vec<String>, amounts: Vec<U128>) {
        let me = env::current_account_id();
        ext_mt_receiver::ext(self.intents_id.clone())
            .with_static_gas(GAS_INTENTS_DEPOSIT)
            .mt_on_transfer(
                me.clone(),
                vec![me.clone(); token_ids.len()],
                token_ids.clone(),
                amounts.clone(),
                owner_id.to_string(),
            )
            .then(Self::ext(me).with_static_gas(GAS_CALLBACK).on_options_delivered(
                owner_id.clone(),
                token_ids,
                amounts,
            ))
            .detach();
    }
}
