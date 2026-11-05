use crate::series::OptionKind;

#[allow(clippy::manual_div_ceil)]
mod wide {
    uint::construct_uint! {
        pub struct U256(4);
    }
}
use wide::U256;

fn narrow(v: U256) -> u128 {
    if v.bits() > 128 {
        near_sdk::env::panic_str("math overflow");
    }
    v.low_u128()
}

pub fn mul_div_floor(a: u128, b: u128, d: u128) -> u128 {
    narrow(U256::from(a) * U256::from(b) / U256::from(d))
}

pub fn mul_div_ceil(a: u128, b: u128, d: u128) -> u128 {
    let (q, r) = (U256::from(a) * U256::from(b)).div_mod(U256::from(d));
    narrow(if r.is_zero() { q } else { q + 1 })
}

pub struct Terms {
    pub kind: OptionKind,
    pub strike: u128,
    pub width: u128,
    pub unit: u128,
}

impl Terms {
    pub fn collateral_for(&self, amount: u128) -> u128 {
        mul_div_ceil(amount, self.width, self.unit)
    }

    pub fn options_for_collateral(&self, collateral: u128) -> u128 {
        mul_div_floor(collateral, self.unit, self.width)
    }

    pub fn pair_refund(&self, amount: u128) -> u128 {
        mul_div_floor(amount, self.width, self.unit)
    }

    pub fn long_payout(&self, amount: u128, settlement: u128) -> u128 {
        mul_div_floor(amount, self.intrinsic(settlement), self.unit)
    }

    pub fn short_payout(&self, amount: u128, settlement: u128) -> u128 {
        self.pair_refund(amount)
            .saturating_sub(mul_div_ceil(amount, self.intrinsic(settlement), self.unit))
    }

    fn intrinsic(&self, settlement: u128) -> u128 {
        match self.kind {
            OptionKind::Call => settlement.saturating_sub(self.strike),
            OptionKind::Put => self.strike.saturating_sub(settlement),
        }
        .min(self.width)
    }
}
