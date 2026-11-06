mod admin;
mod close;
mod events;
mod math;
mod mt;
mod oracle;
mod payout;
mod receiver;
mod series;
mod settlement;
mod storage;
mod views;
mod write;

#[cfg(test)]
mod tests;

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap, LookupSet, TreeMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

pub use oracle::{OracleWasm, PendingOracleWasm};
pub use series::{OptionKind, Series, Timing};
pub use settlement::Settlement;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Oracles,
    Underlyings,
    Series,
    Balances,
    Supply,
    Settlements,
    Claimable,
    PendingSettlements,
    ListedExpiries,
    SeriesByExpiry,
    StorageCredits,
    Undelivered,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Underlying {
    pub index: String,
    pub decimals: u8,
    pub min_write: U128,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub pending_owner_id: Option<AccountId>,
    pub intents_id: AccountId,
    pub quote_asset: String,
    pub quote_decimals: u8,
    pub dispute_window_sec: u64,
    pub oracle_delay_sec: u64,
    pub timing: Timing,
    pub paused: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    pending_owner_id: Option<AccountId>,
    intents_id: AccountId,
    quote_asset: String,
    quote_decimals: u8,
    dispute_window_sec: u64,
    oracle_delay_sec: u64,
    timing: Timing,
    paused: bool,
    oracles: IterableMap<AccountId, u64>,
    underlyings: IterableMap<String, Underlying>,
    series: IterableMap<String, Series>,
    balances: LookupMap<(String, AccountId), u128>,
    supply: LookupMap<String, u128>,
    settlements: LookupMap<(String, u64), Settlement>,
    claimable: LookupMap<(AccountId, String), u128>,
    // read through active_oracle_wasm(): a matured next_oracle_wasm supersedes this
    oracle_wasm: Option<OracleWasm>,
    next_oracle_wasm: Option<PendingOracleWasm>,
    pending_settlements: LookupMap<(String, u64), u64>,
    listed_expiries: LookupSet<(String, u64)>,
    series_by_expiry: TreeMap<(u64, String), ()>,
    storage_credits: LookupMap<AccountId, u128>,
    undelivered: LookupMap<(AccountId, String), u128>,
}

#[near]
impl Contract {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        owner_id: AccountId,
        intents_id: AccountId,
        quote_asset: String,
        quote_decimals: u8,
        dispute_window_sec: u64,
        oracle_delay_sec: u64,
        timing: Option<Timing>,
    ) -> Self {
        let timing = timing.unwrap_or(Timing::DERIBIT_DAILY);
        require!(timing.is_valid(), "invalid timing");
        require!((2..=24).contains(&quote_decimals), "quote decimals out of range");
        require!(
            (MIN_DISPUTE_WINDOW_SEC..=MAX_DISPUTE_WINDOW_SEC).contains(&dispute_window_sec),
            "dispute window out of range"
        );
        require!(
            (MIN_ORACLE_DELAY_SEC..=MAX_ORACLE_DELAY_SEC).contains(&oracle_delay_sec),
            "oracle delay out of range"
        );
        require!(
            is_intents_asset(&quote_asset),
            "quote must be an intents asset id"
        );
        Self {
            owner_id,
            pending_owner_id: None,
            intents_id,
            quote_asset,
            quote_decimals,
            dispute_window_sec,
            oracle_delay_sec,
            timing,
            paused: false,
            oracles: IterableMap::new(StorageKey::Oracles),
            underlyings: IterableMap::new(StorageKey::Underlyings),
            series: IterableMap::new(StorageKey::Series),
            balances: LookupMap::new(StorageKey::Balances),
            supply: LookupMap::new(StorageKey::Supply),
            settlements: LookupMap::new(StorageKey::Settlements),
            claimable: LookupMap::new(StorageKey::Claimable),
            oracle_wasm: None,
            next_oracle_wasm: None,
            pending_settlements: LookupMap::new(StorageKey::PendingSettlements),
            listed_expiries: LookupSet::new(StorageKey::ListedExpiries),
            series_by_expiry: TreeMap::new(StorageKey::SeriesByExpiry),
            storage_credits: LookupMap::new(StorageKey::StorageCredits),
            undelivered: LookupMap::new(StorageKey::Undelivered),
        }
    }
}

const MIN_DISPUTE_WINDOW_SEC: u64 = 60;
const MAX_DISPUTE_WINDOW_SEC: u64 = 86_400;
const MIN_ORACLE_DELAY_SEC: u64 = 60;
const MAX_ORACLE_DELAY_SEC: u64 = 7 * 86_400;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

fn storage_cost(storage_before: u64) -> NearToken {
    let used = env::storage_usage().saturating_sub(storage_before);
    env::storage_byte_cost().saturating_mul(used as u128)
}

fn charge_storage(storage_before: u64, keep: NearToken) {
    let cost = storage_cost(storage_before).saturating_add(keep);
    let attached = env::attached_deposit();
    require!(attached >= cost, format!("attach at least {cost} for storage"));
    let refund = attached.saturating_sub(cost);
    if !refund.is_zero() {
        Promise::new(env::predecessor_account_id())
            .transfer(refund)
            .detach();
    }
}

fn is_intents_asset(asset: &str) -> bool {
    asset.starts_with("nep141:") || asset.starts_with("nep245:")
}

impl Contract {
    fn now_sec() -> u64 {
        env::block_timestamp() / 1_000_000_000
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "only owner");
    }

    fn assert_listed_expiry(&self, underlying: &str, expiry: u64) {
        require!(
            self.listed_expiries.contains(&(underlying.to_string(), expiry)),
            "no series at this expiry"
        );
    }

    fn series_or_panic(&self, series_id: &str) -> &Series {
        self.series
            .get(series_id)
            .unwrap_or_else(|| env::panic_str(&format!("unknown series {series_id}")))
    }
}
