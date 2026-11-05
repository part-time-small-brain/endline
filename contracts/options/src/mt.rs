use near_sdk::json_types::U128;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, PromiseError, PromiseOrValue,
};

use crate::events;
use crate::series::parse_token_id;
use crate::{charge_storage, Contract, ContractExt, ONE_YOCTO};

const GAS_MT_ON_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_MT_RESOLVE_BASE_TGAS: u64 = 5;
const GAS_MT_RESOLVE_PER_TOKEN_TGAS: u64 = 1;
pub const MAX_BATCH: usize = 10;

#[near(serializers = [json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[allow(dead_code)]
#[ext_contract(ext_mt_receiver)]
pub trait MtReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
}

#[near]
impl Contract {
    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.balance_of(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids
            .iter()
            .map(|id| U128(self.balance_of(&account_id, id)))
            .collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        self.token_exists(&token_id)
            .then(|| U128(self.supply.get(&token_id).copied().unwrap_or(0)))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|id| self.mt_supply(id)).collect()
    }

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<Token>> {
        token_ids
            .into_iter()
            .map(|token_id| {
                self.token_exists(&token_id).then_some(Token {
                    token_id,
                    owner_id: None,
                })
            })
            .collect()
    }

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        require!(approval.is_none(), "approvals not supported");
        self.plain_transfer(receiver_id, vec![token_id], vec![amount], memo);
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        require!(approvals.is_none(), "approvals not supported");
        self.plain_transfer(receiver_id, token_ids, amounts, memo);
    }

    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require!(approval.is_none(), "approvals not supported");
        self.transfer_call(receiver_id, vec![token_id], vec![amount], memo, msg)
    }

    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require!(approvals.is_none(), "approvals not supported");
        self.transfer_call(receiver_id, token_ids, amounts, memo, msg)
    }

    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        previous_owner_ids: Vec<AccountId>,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
    ) -> Vec<U128> {
        let unused = unused_amounts(&amounts, receiver_id == self.intents_id);
        let mut used = Vec::with_capacity(amounts.len());
        for (i, token_id) in token_ids.iter().enumerate() {
            let refund = unused[i]
                .min(amounts[i].0)
                .min(self.balance_of(&receiver_id, token_id));
            if refund > 0 {
                self.internal_transfer(
                    &receiver_id,
                    &previous_owner_ids[i],
                    token_id,
                    refund,
                    Some("refund"),
                );
            }
            used.push(U128(amounts[i].0 - refund));
        }
        used
    }
}

fn unused_amounts(amounts: &[U128], to_intents: bool) -> Vec<u128> {
    let full = amounts.iter().map(|a| a.0).collect();
    let answer = match env::promise_result_checked(0, 4096) {
        Err(PromiseError::Failed) => return full,
        Ok(bytes) => near_sdk::serde_json::from_slice::<Vec<U128>>(&bytes).ok(),
        Err(_) => None,
    };
    match answer {
        Some(v) if v.len() == amounts.len() => v.into_iter().map(|a| a.0).collect(),
        // intents credits a deposit before it answers, so an answer we can't read refunds nothing
        _ if to_intents => vec![0; amounts.len()],
        _ => full,
    }
}

impl Contract {
    pub(crate) fn balance_of(&self, account_id: &AccountId, token_id: &str) -> u128 {
        self.balances
            .get(&(token_id.to_string(), account_id.clone()))
            .copied()
            .unwrap_or(0)
    }

    pub(crate) fn token_exists(&self, token_id: &str) -> bool {
        let (series_id, _) = parse_token_id(token_id);
        self.series.get(series_id).is_some()
    }

    fn credit(&mut self, account_id: &AccountId, token_id: &str, amount: u128) {
        let key = (token_id.to_string(), account_id.clone());
        let balance = self.balances.get(&key).copied().unwrap_or(0);
        self.balances
            .insert(key, balance.checked_add(amount).expect("balance overflow"));
    }

    fn debit(&mut self, account_id: &AccountId, token_id: &str, amount: u128) {
        let key = (token_id.to_string(), account_id.clone());
        let balance = self.balances.get(&key).copied().unwrap_or(0);
        require!(balance >= amount, "insufficient balance");
        if balance == amount {
            self.balances.remove(&key);
        } else {
            self.balances.insert(key, balance - amount);
        }
    }

    pub(crate) fn internal_mint(&mut self, owner_id: &AccountId, token_ids: &[String], amounts: &[u128]) {
        for (token_id, amount) in token_ids.iter().zip(amounts) {
            require!(*amount > 0, "zero mint");
            self.credit(owner_id, token_id, *amount);
            let supply = self.supply.get(token_id).copied().unwrap_or(0);
            self.supply.insert(
                token_id.clone(),
                supply.checked_add(*amount).expect("supply overflow"),
            );
        }
        events::mt_mint_or_burn("mt_mint", owner_id, token_ids, amounts);
    }

    pub(crate) fn internal_burn(&mut self, owner_id: &AccountId, token_ids: &[String], amounts: &[u128]) {
        for (token_id, amount) in token_ids.iter().zip(amounts) {
            require!(*amount > 0, "zero burn");
            self.debit(owner_id, token_id, *amount);
            let supply = self.supply.get(token_id).copied().unwrap_or(0);
            self.supply.insert(token_id.clone(), supply - amount);
        }
        events::mt_mint_or_burn("mt_burn", owner_id, token_ids, amounts);
    }

    pub(crate) fn internal_transfer(
        &mut self,
        sender_id: &AccountId,
        receiver_id: &AccountId,
        token_id: &str,
        amount: u128,
        memo: Option<&str>,
    ) {
        require!(sender_id != receiver_id, "sender and receiver must differ");
        require!(amount > 0, "zero transfer");
        require!(self.token_exists(token_id), "unknown token");
        self.debit(sender_id, token_id, amount);
        self.credit(receiver_id, token_id, amount);
        events::mt_transfer(sender_id, receiver_id, &[token_id.to_string()], &[amount], memo);
    }

    fn plain_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        memo: Option<String>,
    ) {
        require!(
            receiver_id != self.intents_id && receiver_id != env::current_account_id(),
            "use mt_transfer_call to send to intents or to this contract"
        );
        self.transfer_from_caller(&receiver_id, &token_ids, &amounts, memo);
    }

    fn transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require!(
            receiver_id != self.intents_id || msg.is_empty() || msg.parse::<AccountId>().is_ok(),
            "deposits to intents take an empty msg or an account id"
        );
        let sender_id = self.transfer_from_caller(&receiver_id, &token_ids, &amounts, memo);
        let previous_owner_ids = vec![sender_id.clone(); token_ids.len()];
        let resolve_gas =
            Gas::from_tgas(GAS_MT_RESOLVE_BASE_TGAS + GAS_MT_RESOLVE_PER_TOKEN_TGAS * token_ids.len() as u64);
        ext_mt_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_MT_ON_TRANSFER)
            .mt_on_transfer(
                sender_id,
                previous_owner_ids.clone(),
                token_ids.clone(),
                amounts.clone(),
                msg,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(resolve_gas)
                    .with_unused_gas_weight(0)
                    .mt_resolve_transfer(previous_owner_ids, receiver_id, token_ids, amounts),
            )
            .into()
    }

    fn transfer_from_caller(
        &mut self,
        receiver_id: &AccountId,
        token_ids: &[String],
        amounts: &[U128],
        memo: Option<String>,
    ) -> AccountId {
        require!(
            !token_ids.is_empty() && token_ids.len() <= MAX_BATCH,
            "batch size"
        );
        require!(token_ids.len() == amounts.len(), "length mismatch");
        let sender_id = env::predecessor_account_id();
        let storage_before = env::storage_usage();
        for (token_id, amount) in token_ids.iter().zip(amounts) {
            self.internal_transfer(&sender_id, receiver_id, token_id, amount.0, memo.as_deref());
        }
        self.balances.flush();
        if sender_id == self.intents_id {
            assert_one_yocto();
        } else {
            charge_storage(storage_before, ONE_YOCTO);
        }
        sender_id
    }
}
