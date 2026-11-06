use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{assert_one_yocto, env, ext_contract, near, AccountId, Gas, PromiseError};

use crate::events;
use crate::mt::ext_mt_receiver;
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

    #[private]
    pub fn on_options_delivered(&mut self, owner_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>) {
        if !promise_failed() {
            return;
        }
        let intents_id = self.intents_id.clone();
        for (token_id, amount) in token_ids.iter().zip(&amounts) {
            let back = amount.0.min(self.balance_of(&intents_id, token_id));
            if back > 0 {
                self.internal_transfer(
                    &intents_id,
                    &owner_id,
                    token_id,
                    back,
                    Some("intents deposit failed"),
                );
            }
        }
    }
}

fn promise_failed() -> bool {
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
        let amounts: Vec<U128> = amounts.into_iter().map(U128).collect();
        ext_mt_receiver::ext(intents_id)
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
