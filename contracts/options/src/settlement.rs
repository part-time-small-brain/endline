use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

use crate::events;
use crate::{Contract, ContractExt};

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Settlement {
    pub price: U128,
    pub source: String,
    pub proposed_by: AccountId,
    pub proposed_at: u64,
    pub final_at: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct SettlementEvent<'a> {
    underlying: &'a str,
    expiry: u64,
    settlement: &'a Settlement,
}

#[near]
impl Contract {
    #[payable]
    pub fn propose_settlement(&mut self, underlying: String, expiry: u64, price: U128) {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        require!(self.is_oracle(&caller), "only oracle");
        require!(price.0 > 0, "price must be positive");
        self.assert_listed_expiry(&underlying, expiry);
        require!(
            Self::now_sec() >= expiry + self.timing.oracle_window_sec,
            "manual settlement not open yet"
        );
        require!(
            self.settlements.get(&(underlying.clone(), expiry)).is_none(),
            "already proposed"
        );
        self.store_proposal(underlying, expiry, price.0, caller, "manual".into());
    }

    #[payable]
    pub fn override_settlement(&mut self, underlying: String, expiry: u64, price: U128) {
        assert_one_yocto();
        self.assert_owner();
        require!(price.0 > 0, "price must be positive");
        let now = Self::now_sec();
        let final_at = self
            .settlements
            .get(&(underlying.clone(), expiry))
            .unwrap_or_else(|| env::panic_str("nothing proposed"))
            .final_at;
        require!(now < final_at, "settlement already final");
        let settlement = Settlement {
            price,
            source: "owner_override".into(),
            proposed_by: env::predecessor_account_id(),
            proposed_at: now,
            final_at,
        };
        self.save_settlement("settlement_overridden", underlying, expiry, settlement);
    }

    pub fn get_settlement(&self, underlying: String, expiry: u64) -> Option<Settlement> {
        self.settlements.get(&(underlying, expiry)).cloned()
    }
}

impl Contract {
    pub(crate) fn final_price(&self, underlying: &str, expiry: u64) -> Option<u128> {
        let settlement = self.settlements.get(&(underlying.to_string(), expiry))?;
        (Self::now_sec() >= settlement.final_at).then_some(settlement.price.0)
    }

    pub(crate) fn store_proposal(
        &mut self,
        underlying: String,
        expiry: u64,
        price: u128,
        proposed_by: AccountId,
        source: String,
    ) {
        let now = Self::now_sec();
        let settlement = Settlement {
            price: U128(price),
            source,
            proposed_by,
            proposed_at: now,
            final_at: now + self.dispute_window_sec,
        };
        self.save_settlement("settlement_proposed", underlying, expiry, settlement);
    }

    fn save_settlement(&mut self, event: &str, underlying: String, expiry: u64, settlement: Settlement) {
        events::options(
            event,
            &SettlementEvent {
                underlying: &underlying,
                expiry,
                settlement: &settlement,
            },
        );
        self.settlements.insert((underlying, expiry), settlement);
    }
}
