use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::{storage_cost, Contract, ContractExt};

#[near(serializers = [json])]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near]
impl Contract {
    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        require!(
            registration_only != Some(true),
            "registration_only is not supported"
        );
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        let attached = env::attached_deposit();
        let credit = self.storage_credits.get(&account_id).copied().unwrap_or(0) + attached.as_yoctonear();
        let storage_before = env::storage_usage();
        self.storage_credits.insert(account_id.clone(), credit);
        self.storage_credits.flush();
        let record = storage_cost(storage_before);
        require!(
            attached >= record,
            format!("attach at least {record} for storage")
        );
        let credit = credit - record.as_yoctonear();
        self.storage_credits.insert(account_id, credit);
        StorageBalance {
            total: U128(credit),
            available: U128(credit),
        }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.storage_credits
            .get(&account_id)
            .map(|credit| StorageBalance {
                total: U128(*credit),
                available: U128(*credit),
            })
    }
}

impl Contract {
    pub(crate) fn charge_storage_credit(&mut self, account_id: &AccountId, storage_before: u64) {
        let cost = storage_cost(storage_before).as_yoctonear();
        if cost == 0 {
            return;
        }
        let credit = self.storage_credits.get(account_id).copied().unwrap_or(0);
        let left = credit.checked_sub(cost).unwrap_or_else(|| {
            env::panic_str(&format!(
                "{account_id} needs {} more yoctoNEAR of storage credit: call storage_deposit",
                cost - credit
            ))
        });
        self.storage_credits.insert(account_id.clone(), left);
    }
}
