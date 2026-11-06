mod sources;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub use sources::Market;
use sources::{usdt_usd_venues, Quote};

const SECONDS_PER_DAY: u64 = 86_400;
const DELIVERY_TIME_OF_DAY: u64 = 8 * 3_600;
const TWAP_WINDOW_SEC: u64 = 1_800;
const MIN_CANDLES: usize = 25;
const MIN_SOURCES: usize = 4;
const MIN_DELAY_AFTER_EXPIRY_SEC: u64 = 60;
const MAX_QUOTE_DECIMALS: u8 = 9;
const USDT_USD_BOUNDS: (f64, f64) = (0.97, 1.03);
const USDT_USD_MAX_GAP_BPS: u32 = 20;

pub trait Http {
    fn get(&self, url: &str) -> Result<String, String>;
}

#[derive(Deserialize)]
pub struct Request {
    pub index: String,
    pub expiry: u64,
    pub quote_decimals: u8,
    pub max_dev_bps: u32,
}

#[derive(Serialize)]
pub struct Fixing {
    pub ok: bool,
    pub index: String,
    pub expiry: u64,
    pub price: Option<String>,
    pub source: &'static str,
    pub deribit: Option<f64>,
    pub cex_median: Option<f64>,
    pub usdt_usd: Option<f64>,
    pub venues: BTreeMap<&'static str, f64>,
}

pub fn fix(req: &Request, now: Option<u64>, http: &impl Http) -> Fixing {
    let mut out = Fixing {
        ok: false,
        index: req.index.clone(),
        expiry: req.expiry,
        price: None,
        source: "none",
        deribit: None,
        cex_median: None,
        usdt_usd: None,
        venues: BTreeMap::new(),
    };
    let Some(market) = Market::for_index(&req.index) else {
        out.source = "unknown index";
        return out;
    };
    if req.quote_decimals > MAX_QUOTE_DECIMALS {
        out.source = "unsupported decimals";
        return out;
    }
    if now.is_some_and(|n| n < req.expiry + MIN_DELAY_AFTER_EXPIRY_SEC) {
        out.source = "too early";
        return out;
    }

    let start = req.expiry - TWAP_WINDOW_SEC;
    let daily = req.expiry % SECONDS_PER_DAY == DELIVERY_TIME_OF_DAY;
    out.deribit = daily.then(|| market.deribit_delivery(http, req.expiry)).flatten();
    let usdt_venues = usdt_usd_venues(start, req.expiry);
    let rates: Vec<f64> = usdt_venues
        .iter()
        .filter_map(|v| v.twap(http, start, req.expiry))
        .collect();
    let agree = rates.len() == usdt_venues.len()
        && rates
            .iter()
            .all(|r| within_bps(*r, rates[0], USDT_USD_MAX_GAP_BPS));
    out.usdt_usd = agree
        .then(|| median(rates))
        .flatten()
        .filter(|r| (USDT_USD_BOUNDS.0..=USDT_USD_BOUNDS.1).contains(r));
    for venue in market.venues(start, req.expiry) {
        let usd = match (venue.quote, out.usdt_usd) {
            (Quote::Usd, _) => venue.twap(http, start, req.expiry),
            (Quote::Usdt, Some(rate)) => venue.twap(http, start, req.expiry).map(|p| p * rate),
            (Quote::Usdt, None) => None,
        };
        if let Some(usd) = usd {
            out.venues.insert(venue.name, usd);
        }
    }
    out.cex_median = (out.venues.len() >= MIN_SOURCES)
        .then(|| median(out.venues.values().copied().collect()))
        .flatten();

    let (price, source) = match (out.cex_median, out.deribit) {
        (None, _) => (None, "no data"),
        (Some(_), None) if daily => (None, "deribit unavailable"),
        (Some(m), Some(d)) if !within_bps(m, d, req.max_dev_bps) => (None, "sources disagree"),
        (Some(m), _) => (Some(m), "cex_twap_median"),
    };
    out.source = source;
    out.price = price.map(|p| to_quote_units(p, req.quote_decimals));
    out.ok = out.price.is_some();
    out
}

pub fn median(mut values: Vec<f64>) -> Option<f64> {
    values.sort_by(f64::total_cmp);
    let n = values.len();
    match n {
        0 => None,
        _ if n % 2 == 1 => Some(values[n / 2]),
        _ => Some((values[n / 2 - 1] + values[n / 2]) / 2.0),
    }
}

pub fn within_bps(a: f64, b: f64, bps: u32) -> bool {
    (a - b).abs() <= a.min(b) * bps as f64 / 10_000.0
}

fn to_quote_units(price: f64, decimals: u8) -> String {
    format!("{:.0}", (price * 10f64.powi(decimals as i32)).round())
}

pub fn ymd(unix: u64) -> String {
    let z = (unix / SECONDS_PER_DAY) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}
