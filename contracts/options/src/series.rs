use near_sdk::json_types::U128;
use near_sdk::near;

use crate::math::Terms;

const SHORT_SUFFIX: &str = "-SHORT";
const SECONDS_PER_DAY: u64 = 86_400;
const EXPIRY_TIME_OF_DAY: u64 = 8 * 3_600;

const MONTHS: [&str; 12] = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum OptionKind {
    Call,
    Put,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Series {
    pub id: String,
    pub underlying: String,
    pub kind: OptionKind,
    pub strike: U128,
    pub width: U128,
    pub expiry: u64,
    pub underlying_decimals: u8,
    pub collateral_locked: U128,
}

impl Series {
    pub fn terms(&self) -> Terms {
        Terms {
            kind: self.kind,
            strike: self.strike.0,
            width: self.width.0,
            unit: 10u128.pow(self.underlying_decimals as u32),
        }
    }

    pub fn payout(&self, side: Side, amount: u128, price: u128) -> u128 {
        let terms = self.terms();
        match side {
            Side::Long => terms.long_payout(amount, price),
            Side::Short => terms.short_payout(amount, price),
        }
    }
}

pub fn short_id(series_id: &str) -> String {
    format!("{series_id}{SHORT_SUFFIX}")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Long,
    Short,
}

pub fn parse_token_id(token_id: &str) -> (&str, Side) {
    match token_id.strip_suffix(SHORT_SUFFIX) {
        Some(series_id) => (series_id, Side::Short),
        None => (token_id, Side::Long),
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy)]
pub struct Timing {
    pub period_sec: u64,
    pub offset_sec: u64,
    pub write_cutoff_sec: u64,
    pub oracle_window_sec: u64,
    pub max_horizon_sec: u64,
}

impl Timing {
    pub const DERIBIT_DAILY: Timing = Timing {
        period_sec: SECONDS_PER_DAY,
        offset_sec: EXPIRY_TIME_OF_DAY,
        write_cutoff_sec: 1_800,
        oracle_window_sec: 6 * 3_600,
        max_horizon_sec: 180 * SECONDS_PER_DAY,
    };

    pub fn is_valid(&self) -> bool {
        self.period_sec >= 60
            && SECONDS_PER_DAY.is_multiple_of(self.period_sec)
            && self.offset_sec < self.period_sec
            && self.write_cutoff_sec <= self.period_sec
            && self.oracle_window_sec > crate::oracle::SETTLE_DELAY_SEC
            && self.max_horizon_sec >= self.period_sec
    }

    pub fn contains(&self, expiry: u64) -> bool {
        expiry % self.period_sec == self.offset_sec
    }
}

pub fn series_id(
    underlying: &str,
    expiry: u64,
    strike: u128,
    width: u128,
    quote_decimals: u8,
    kind: OptionKind,
) -> String {
    let (cap, letter) = match kind {
        OptionKind::Call => (strike + width, "C"),
        OptionKind::Put => (strike - width, "P"),
    };
    format!(
        "{}-{}-{}_{}-{}",
        underlying,
        format_expiry(expiry),
        format_strike(strike, quote_decimals),
        format_strike(cap, quote_decimals),
        letter
    )
}

fn format_expiry(expiry: u64) -> String {
    let (y, m, d) = civil_from_days((expiry / SECONDS_PER_DAY) as i64);
    let date = format!("{}{}{:02}", d, MONTHS[(m - 1) as usize], y.rem_euclid(100));
    let time_of_day = expiry % SECONDS_PER_DAY;
    if time_of_day == EXPIRY_TIME_OF_DAY {
        return date;
    }
    format!("{date}T{:02}{:02}", time_of_day / 3_600, time_of_day % 3_600 / 60)
}

fn format_strike(strike: u128, quote_decimals: u8) -> String {
    let scale = 10u128.pow(quote_decimals as u32);
    let whole = strike / scale;
    let frac = strike % scale;
    if frac == 0 {
        return whole.to_string();
    }
    let digits = format!("{:0width$}", frac, width = quote_decimals as usize);
    format!("{}d{}", whole, digits.trim_end_matches('0'))
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d)
}
