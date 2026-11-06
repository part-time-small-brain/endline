use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{require, AccountId};

use crate::events;
use crate::series::short_id;
use crate::Contract;

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Written<'a> {
    series_id: &'a str,
    owner_id: &'a AccountId,
    amount: U128,
    collateral: U128,
}

impl Contract {
    pub(crate) fn write(
        &mut self,
        asset: &str,
        collateral: u128,
        series_id: &str,
        owner_id: &AccountId,
    ) -> u128 {
        require!(!self.paused, "paused");
        require!(
            asset == self.quote_asset,
            format!("writes take {} as collateral", self.quote_asset)
        );
        let mut series = self.series_or_panic(series_id).clone();
        require!(
            Self::now_sec() < series.expiry - self.timing.write_cutoff_sec,
            "writes closed for this series"
        );

        let terms = series.terms();
        let amount = terms.options_for_collateral(collateral);
        let min_write = self
            .underlyings
            .get(&series.underlying)
            .expect("underlying exists")
            .min_write
            .0;
        require!(
            amount > 0 && amount >= min_write,
            format!("amount below minimum {min_write}")
        );
        let used = terms.collateral_for(amount);
        require!(used <= collateral, "collateral rounding error");

        series.collateral_locked = U128(
            series
                .collateral_locked
                .0
                .checked_add(used)
                .expect("collateral overflow"),
        );
        series.long_open = U128(series.long_open.0.checked_add(amount).expect("open overflow"));
        series.short_open = U128(series.short_open.0.checked_add(amount).expect("open overflow"));
        self.series.insert(series_id.to_string(), series);

        self.deliver_options(
            owner_id,
            vec![series_id.to_string(), short_id(series_id)],
            vec![amount, amount],
        );
        events::options(
            "write",
            &Written {
                series_id,
                owner_id,
                amount: U128(amount),
                collateral: U128(used),
            },
        );
        used
    }
}
