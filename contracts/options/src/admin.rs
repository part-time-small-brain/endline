use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, NearToken};

use crate::events;
use crate::series::{self, OptionKind, Series};
use crate::{charge_storage, Contract, ContractExt, Underlying};

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct SeriesCreated<'a> {
    series: &'a Series,
    long_id: String,
    short_id: String,
}

#[near]
impl Contract {
    #[payable]
    pub fn add_underlying(&mut self, symbol: String, underlying: Underlying) {
        assert_one_yocto();
        self.assert_owner();
        let Underlying { index, decimals, .. } = &underlying;
        require!(
            !symbol.is_empty()
                && symbol
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()),
            "symbol must be uppercase alphanumeric"
        );
        require!(
            !index.is_empty() && index.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
            "index must be a lowercase Deribit index name"
        );
        require!(*decimals <= 24, "decimals too large");
        require!(self.underlyings.get(&symbol).is_none(), "underlying exists");
        self.underlyings.insert(symbol, underlying);
    }

    #[payable]
    pub fn add_oracle(&mut self, account_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        if self.oracles.get(&account_id).is_none() {
            self.oracles
                .insert(account_id, Self::now_sec() + self.oracle_delay_sec);
        }
    }

    #[payable]
    pub fn remove_oracle(&mut self, account_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        self.oracles.remove(&account_id);
    }

    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        assert_one_yocto();
        self.assert_owner();
        self.paused = paused;
    }

    #[payable]
    pub fn propose_owner(&mut self, owner_id: Option<AccountId>) {
        assert_one_yocto();
        self.assert_owner();
        self.pending_owner_id = owner_id;
    }

    #[payable]
    pub fn accept_owner(&mut self) {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        require!(
            self.pending_owner_id.as_ref() == Some(&caller),
            "only the proposed owner"
        );
        self.owner_id = caller;
        self.pending_owner_id = None;
    }

    #[payable]
    pub fn create_series(
        &mut self,
        underlying: String,
        strike: U128,
        width: U128,
        expiry: u64,
        kind: OptionKind,
    ) -> String {
        require!(!self.paused, "paused");
        let config = self
            .underlyings
            .get(&underlying)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown underlying"));
        let now = Self::now_sec();
        let cent = 10u128.pow(self.quote_decimals as u32 - 2);
        require!(strike.0 > 0, "strike must be positive");
        require!(strike.0.is_multiple_of(cent), "strike must be a whole cent");
        require!(
            width.0 > 0 && width.0.is_multiple_of(cent),
            "width must be a positive whole cent"
        );
        require!(
            matches!(kind, OptionKind::Call) || width.0 < strike.0,
            "put width must be below the strike"
        );
        require!(expiry > now, "expiry in the past");
        require!(self.timing.contains(expiry), "expiry not on the expiry grid");
        require!(expiry <= now + self.timing.max_horizon_sec, "expiry too far out");

        let id = series::series_id(&underlying, expiry, strike.0, width.0, self.quote_decimals, kind);
        require!(self.series.get(&id).is_none(), "series exists");

        let series = Series {
            id: id.clone(),
            underlying,
            kind,
            strike,
            width,
            expiry,
            underlying_decimals: config.decimals,
            collateral_locked: U128(0),
        };

        events::options(
            "series_created",
            &SeriesCreated {
                long_id: id.clone(),
                short_id: series::short_id(&id),
                series: &series,
            },
        );
        let storage_before = env::storage_usage();
        self.listed_expiries.insert((series.underlying.clone(), expiry));
        self.series_by_expiry.insert((expiry, id.clone()), ());
        // created empty so the caller pays for them: the first write arrives from intents with no deposit
        for token in [id.clone(), series::short_id(&id)] {
            self.supply.insert(token.clone(), 0);
            self.balances.insert((token, self.intents_id.clone()), 0);
        }
        self.series.insert(id.clone(), series);
        self.series.flush();
        self.series_by_expiry.flush();
        self.supply.flush();
        self.balances.flush();
        charge_storage(storage_before, NearToken::from_yoctonear(0));
        id
    }
}
