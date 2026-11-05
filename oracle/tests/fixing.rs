use std::cell::RefCell;
use std::collections::HashMap;

use oracle::{fix, median, within_bps, ymd, Http, Market, Request};
use serde_json::json;

const EXPIRY: u64 = 1_792_742_400;
const START: u64 = EXPIRY - 1_800;
const AFTER: Option<u64> = Some(EXPIRY + 300);
const DAY: u64 = 86_400;
const MEDIAN_OF_SEVEN: f64 = 81_593.524_333_333_33;

const FIXTURES: [(&str, &str); 10] = [
    ("deribit.com", include_str!("fixtures/deribit_btc_usd.json")),
    ("products/BTC-USD", include_str!("fixtures/coinbase_btc_usd.json")),
    (
        "products/USDT-USD",
        include_str!("fixtures/coinbase_usdtusd.json"),
    ),
    ("pair=XBTUSD", include_str!("fixtures/kraken_xbtusd.json")),
    ("pair=USDTUSD", include_str!("fixtures/kraken_usdtusd.json")),
    ("bitstamp.net", include_str!("fixtures/bitstamp_btcusd.json")),
    ("bitfinex.com", include_str!("fixtures/bitfinex_btcusd.json")),
    ("binance.vision", include_str!("fixtures/binance_btcusdt.json")),
    ("okx.com", include_str!("fixtures/okx_btcusdt.json")),
    ("bybit.com", include_str!("fixtures/bybit_btcusdt.json")),
];

struct Recorded {
    bodies: HashMap<&'static str, String>,
    seen: RefCell<Vec<String>>,
}

impl Http for Recorded {
    fn get(&self, url: &str) -> Result<String, String> {
        self.seen.borrow_mut().push(url.to_string());
        self.bodies
            .iter()
            .find(|(key, _)| url.contains(*key))
            .map(|(_, body)| body.clone())
            .ok_or_else(|| format!("offline: {url}"))
    }
}

impl Recorded {
    fn filtered(keep: impl Fn(&str) -> bool) -> Self {
        let bodies = FIXTURES
            .iter()
            .filter(|(k, _)| keep(k))
            .map(|(k, b)| (*k, b.to_string()))
            .collect();
        Recorded {
            bodies,
            seen: RefCell::new(vec![]),
        }
    }

    fn without(keys: &[&str]) -> Self {
        Self::filtered(|k| !keys.contains(&k))
    }

    fn only(keys: &[&str]) -> Self {
        Self::filtered(|k| keys.contains(&k))
    }

    fn with(mut self, key: &'static str, body: String) -> Self {
        self.bodies.insert(key, body);
        self
    }
}

fn flat_candles(price: f64) -> String {
    json!((0..30)
        .map(|i| json!([START + i * 60, price, price, price, price, 1.0]))
        .collect::<Vec<_>>())
    .to_string()
}

fn btc(expiry: u64) -> Request {
    Request {
        index: "btc_usd".into(),
        expiry,
        quote_decimals: 6,
        max_dev_bps: 50,
    }
}

#[test]
fn recorded_day_settles_on_the_median_of_seven_venues_with_deribit_only_checking() {
    let f = fix(&btc(EXPIRY), AFTER, &Recorded::without(&[]));
    assert_eq!(f.price.as_deref(), Some("81593524333"));
    assert_eq!(f.source, "cex_twap_median");
    assert_eq!(f.deribit, Some(81_594.54));
    assert_eq!(f.venues.len(), 7);
    assert_eq!(f.cex_median, Some(MEDIAN_OF_SEVEN));
    assert!((f.usdt_usd.unwrap() - 0.998_626_67).abs() < 1e-8);
    assert!((f.venues["binance"] - 81_708.933_333 * f.usdt_usd.unwrap()).abs() < 1e-3);
}

#[test]
fn deribit_down_blocks_a_daily_price_so_its_check_cannot_be_skipped() {
    let f = fix(&btc(EXPIRY), AFTER, &Recorded::without(&["deribit.com"]));
    assert_eq!(
        (f.ok, f.source, f.price, f.cex_median),
        (false, "deribit unavailable", None, Some(MEDIAN_OF_SEVEN))
    );
}

#[test]
fn off_hour_expiry_settles_on_the_median_alone() {
    let expiry = EXPIRY + 3_600;
    let rows = |p: f64| {
        (0..30)
            .map(|i| json!([expiry - 1_800 + i * 60, p, p, p, p, 1.0]))
            .collect::<Vec<_>>()
    };
    let bitstamp = (0..30)
        .map(|i| json!({"timestamp": (expiry - 1_800 + i * 60).to_string(), "close": "81010"}))
        .collect::<Vec<_>>();
    let http = Recorded::only(&[])
        .with("products/BTC-USD", json!(rows(81_000.0)).to_string())
        .with(
            "pair=XBTUSD",
            json!({"result": {"XXBTZUSD": rows(81_020.0)}}).to_string(),
        )
        .with("bitstamp.net", json!({"data": {"ohlc": bitstamp}}).to_string());
    let f = fix(&btc(expiry), Some(expiry + 300), &http);
    assert_eq!(
        (f.ok, f.source, f.deribit, f.price.as_deref()),
        (true, "cex_twap_median", None, Some("81010000000"))
    );
}

#[test]
fn a_usdt_rate_needs_both_sources_within_20_bps() {
    let usdt_venues = |f: &oracle::Fixing| {
        ["binance", "okx", "bybit"]
            .iter()
            .filter(|v| f.venues.contains_key(*v))
            .count()
    };
    let one_source = fix(&btc(EXPIRY), AFTER, &Recorded::without(&["pair=USDTUSD"]));
    assert_eq!((one_source.usdt_usd, usdt_venues(&one_source)), (None, 0));
    let close = fix(
        &btc(EXPIRY),
        AFTER,
        &Recorded::without(&[]).with("products/USDT-USD", flat_candles(1.0)),
    );
    assert!(close.usdt_usd.is_some() && usdt_venues(&close) == 3);
    let apart = fix(
        &btc(EXPIRY),
        AFTER,
        &Recorded::without(&[]).with("products/USDT-USD", flat_candles(1.001)),
    );
    assert_eq!((apart.usdt_usd, usdt_venues(&apart)), (None, 0));
}

#[test]
fn picks_the_row_for_the_exact_date_not_the_latest() {
    let expiry = EXPIRY - DAY;
    let f = fix(
        &btc(expiry),
        Some(expiry + 300),
        &Recorded::only(&["deribit.com"]),
    );
    assert_eq!(f.deribit, Some(82_174.41));
}

#[test]
fn deribit_alone_never_settles() {
    let f = fix(&btc(EXPIRY), AFTER, &Recorded::only(&["deribit.com"]));
    assert_eq!((f.ok, f.source, f.deribit.is_some()), (false, "no data", true));
}

#[test]
fn no_delivery_row_for_the_date_means_no_deribit_price() {
    let expiry = EXPIRY + DAY;
    let f = fix(
        &btc(expiry),
        Some(expiry + 300),
        &Recorded::only(&["deribit.com"]),
    );
    assert_eq!((f.ok, f.source, f.deribit), (false, "no data", None));
}

#[test]
fn off_hour_expiry_never_asks_deribit() {
    let http = Recorded::without(&[]);
    let expiry = EXPIRY + 3_600;
    let _ = fix(&btc(expiry), Some(expiry + 300), &http);
    assert!(http.seen.borrow().iter().all(|url| !url.contains("deribit")));
}

#[test]
fn rejects_disagreeing_sources() {
    let body = r#"{"result":{"data":[{"date":"2026-10-23","delivery_price":90000.0}]}}"#.to_string();
    let f = fix(
        &btc(EXPIRY),
        AFTER,
        &Recorded::without(&[]).with("deribit.com", body),
    );
    assert_eq!((f.ok, f.source), (false, "sources disagree"));
}

#[test]
fn two_venues_are_not_enough_for_a_median() {
    let http = Recorded::only(&["products/BTC-USD", "bitstamp.net"]);
    let f = fix(&btc(EXPIRY), AFTER, &http);
    assert_eq!((f.ok, f.venues.len(), f.cex_median), (false, 2, None));
}

#[test]
fn usdt_venues_dropped_when_usdt_depegs() {
    let http = Recorded::without(&["deribit.com"])
        .with("products/USDT-USD", flat_candles(0.90))
        .with("pair=USDTUSD", r#"{"result":{}}"#.into());
    let f = fix(&btc(EXPIRY), AFTER, &http);
    assert_eq!(f.usdt_usd, None);
    assert_eq!(
        f.venues.keys().copied().collect::<Vec<_>>(),
        ["bitfinex", "bitstamp", "coinbase", "kraken"]
    );
}

#[test]
fn usdt_venues_dropped_without_a_usdt_rate() {
    let f = fix(
        &btc(EXPIRY),
        AFTER,
        &Recorded::without(&["products/USDT-USD", "pair=USDTUSD"]),
    );
    assert!(
        !f.venues.contains_key("binance") && !f.venues.contains_key("okx") && !f.venues.contains_key("bybit")
    );
    assert_eq!(
        f.cex_median,
        Some((81_590.356_666_666_67 + 81_593.524_333_333_33) / 2.0)
    );
}

#[test]
fn one_manipulated_venue_cannot_move_the_median() {
    let http = Recorded::without(&["deribit.com"]).with("binance.vision", flat_candles(1_000_000.0));
    let f = fix(&btc(EXPIRY), AFTER, &http);
    let shift = (f.cex_median.unwrap() - MEDIAN_OF_SEVEN).abs();
    assert!(shift < 5.0, "median moved {shift}");
}

#[test]
fn duplicated_candles_do_not_count_as_a_full_window() {
    let rows = json!((0..30)
        .map(|_| json!([EXPIRY - 60, 1.0, 1.0, 1.0, 81_000.0, 1.0]))
        .collect::<Vec<_>>());
    let coinbase = &Market::for_index("btc_usd").unwrap().venues(START, EXPIRY)[0];
    let http = Recorded::only(&[]).with("products/BTC-USD", rows.to_string());
    assert_eq!(coinbase.twap(&http, START, EXPIRY), None);
}

#[test]
fn twap_window_is_start_inclusive_end_exclusive() {
    let mut rows: Vec<_> = (0..30)
        .map(|i| json!([START + i * 60, 0, 0, 0, 100.0, 1]))
        .collect();
    rows.extend([
        json!([START - 60, 0, 0, 0, 1e9, 1]),
        json!([EXPIRY, 0, 0, 0, 1e9, 1]),
        json!([START + 1, 0, 0, 0, 1e9, 1]),
    ]);
    let coinbase = &Market::for_index("btc_usd").unwrap().venues(START, EXPIRY)[0];
    let http = Recorded::only(&[]).with("products/BTC-USD", json!(rows).to_string());
    assert_eq!(coinbase.twap(&http, START, EXPIRY), Some(100.0));
}

#[test]
fn junk_api_bodies_are_ignored_without_panicking() {
    let nan = json!({"data": {"ohlc": (0..30).map(|i| json!({"timestamp": (START + i * 60).to_string(), "close": "NaN"})).collect::<Vec<_>>()}});
    let http = Recorded::only(&[])
        .with("bitstamp.net", nan.to_string())
        .with(
            "pair=XBTUSD",
            r#"{"error":["EGeneral:Too many requests"]}"#.into(),
        )
        .with("products/BTC-USD", "<html>451 Unavailable</html>".into())
        .with("okx.com", r#"{"code":"50011","data":[]}"#.into())
        .with(
            "binance.vision",
            r#"{"code":0,"msg":"Service unavailable from a restricted location"}"#.into(),
        );
    let f = fix(&btc(EXPIRY), AFTER, &http);
    assert_eq!((f.ok, f.venues.len()), (false, 0));
}

#[test]
fn refuses_to_run_until_a_minute_after_expiry() {
    assert_eq!(
        fix(&btc(EXPIRY), Some(EXPIRY + 59), &Recorded::without(&[])).source,
        "too early"
    );
    assert!(fix(&btc(EXPIRY), Some(EXPIRY + 60), &Recorded::without(&[])).ok);
}

#[test]
fn rejects_unknown_index_and_decimals_floats_cannot_represent() {
    let doge = Request {
        index: "doge_usd".into(),
        ..btc(EXPIRY)
    };
    let ten_decimals = Request {
        quote_decimals: 10,
        ..btc(EXPIRY)
    };
    let http = Recorded::without(&[]);
    assert_eq!(fix(&doge, AFTER, &http).source, "unknown index");
    assert_eq!(fix(&ten_decimals, AFTER, &http).source, "unsupported decimals");
}

#[test]
fn median_and_deviation_edges() {
    assert_eq!(median(vec![]), None);
    assert_eq!(median(vec![3.0, 1.0, 2.0, 10.0]), Some(2.5));
    assert!(within_bps(10_000.0, 10_050.0, 50));
    assert!(!within_bps(10_000.0, 10_051.0, 50));
}

#[test]
fn ymd_handles_leap_day() {
    assert_eq!(ymd(1_835_424_000), "2028-02-29");
}
