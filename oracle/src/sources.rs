use std::collections::BTreeMap;

use serde_json::Value;

use crate::{ymd, Http, MIN_CANDLES};

#[derive(Clone, Copy)]
pub enum Quote {
    Usd,
    Usdt,
}

pub struct Market {
    deribit_index: &'static str,
    coinbase: &'static str,
    kraken: (&'static str, &'static str),
    bitstamp: &'static str,
    bitfinex: &'static str,
    binance: &'static str,
    okx: &'static str,
    bybit: &'static str,
}

const MARKETS: [Market; 2] = [
    Market {
        deribit_index: "btc_usd",
        coinbase: "BTC-USD",
        kraken: ("XBTUSD", "XXBTZUSD"),
        bitstamp: "btcusd",
        bitfinex: "tBTCUSD",
        binance: "BTCUSDT",
        okx: "BTC-USDT",
        bybit: "BTCUSDT",
    },
    Market {
        deribit_index: "eth_usd",
        coinbase: "ETH-USD",
        kraken: ("ETHUSD", "XETHZUSD"),
        bitstamp: "ethusd",
        bitfinex: "tETHUSD",
        binance: "ETHUSDT",
        okx: "ETH-USDT",
        bybit: "ETHUSDT",
    },
];

enum Rows {
    Array {
        pointer: String,
        time_ms: bool,
        close: usize,
    },
    Bitstamp,
}

pub struct Venue {
    pub name: &'static str,
    pub quote: Quote,
    url: String,
    rows: Rows,
}

impl Market {
    pub fn for_index(index: &str) -> Option<&'static Market> {
        MARKETS.iter().find(|m| m.deribit_index == index)
    }

    pub fn deribit_delivery(&self, http: &impl Http, expiry: u64) -> Option<f64> {
        let url = format!(
            "https://www.deribit.com/api/v2/public/get_delivery_prices?index_name={}&offset=0&count=30",
            self.deribit_index
        );
        let body = get_json(http, &url)?;
        let day = ymd(expiry);
        body["result"]["data"]
            .as_array()?
            .iter()
            .find(|row| row["date"].as_str() == Some(day.as_str()))?["delivery_price"]
            .as_f64()
    }

    pub fn venues(&self, start: u64, end: u64) -> Vec<Venue> {
        let (start_ms, last_ms) = (start * 1_000, (end - 60) * 1_000);
        vec![
            coinbase(self.coinbase, start, end),
            kraken(self.kraken, start),
            Venue {
                name: "bitstamp",
                quote: Quote::Usd,
                url: format!(
                    "https://www.bitstamp.net/api/v2/ohlc/{}/?step=60&start={start}&end={}&limit=30",
                    self.bitstamp,
                    end - 60
                ),
                rows: Rows::Bitstamp,
            },
            Venue {
                name: "bitfinex",
                quote: Quote::Usd,
                url: format!(
                    "https://api-pub.bitfinex.com/v2/candles/trade:1m:{}/hist?start={start_ms}&end={last_ms}&limit=30&sort=1",
                    self.bitfinex
                ),
                rows: Rows::Array { pointer: String::new(), time_ms: true, close: 2 },
            },
            Venue {
                name: "binance",
                quote: Quote::Usdt,
                url: format!(
                    "https://data-api.binance.vision/api/v3/klines?symbol={}&interval=1m&startTime={start_ms}&endTime={last_ms}&limit=30",
                    self.binance
                ),
                rows: Rows::Array { pointer: String::new(), time_ms: true, close: 4 },
            },
            Venue {
                name: "okx",
                quote: Quote::Usdt,
                url: format!(
                    "https://www.okx.com/api/v5/market/history-candles?instId={}&bar=1m&after={}&limit=30",
                    self.okx,
                    end * 1_000
                ),
                rows: Rows::Array { pointer: "/data".into(), time_ms: true, close: 4 },
            },
            Venue {
                name: "bybit",
                quote: Quote::Usdt,
                url: format!(
                    "https://api.bybit.com/v5/market/kline?category=spot&symbol={}&interval=1&start={start_ms}&end={last_ms}&limit=30",
                    self.bybit
                ),
                rows: Rows::Array { pointer: "/result/list".into(), time_ms: true, close: 4 },
            },
        ]
    }
}

pub fn usdt_usd_venues(start: u64, end: u64) -> Vec<Venue> {
    vec![
        coinbase("USDT-USD", start, end),
        kraken(("USDTUSD", "USDTZUSD"), start),
    ]
}

fn coinbase(product: &str, start: u64, end: u64) -> Venue {
    Venue {
        name: "coinbase",
        quote: Quote::Usd,
        url: format!(
            "https://api.exchange.coinbase.com/products/{product}/candles?granularity=60&start={start}&end={}",
            end - 60
        ),
        rows: Rows::Array { pointer: String::new(), time_ms: false, close: 4 },
    }
}

fn kraken((pair, key): (&str, &str), start: u64) -> Venue {
    Venue {
        name: "kraken",
        quote: Quote::Usd,
        url: format!(
            "https://api.kraken.com/0/public/OHLC?pair={pair}&interval=1&since={}",
            start - 60
        ),
        rows: Rows::Array {
            pointer: format!("/result/{key}"),
            time_ms: false,
            close: 4,
        },
    }
}

impl Venue {
    pub fn twap(&self, http: &impl Http, start: u64, end: u64) -> Option<f64> {
        let body = get_json(http, &self.url)?;
        let candles: Vec<(u64, f64)> = match &self.rows {
            Rows::Array {
                pointer,
                time_ms,
                close,
            } => body
                .pointer(pointer)?
                .as_array()?
                .iter()
                .filter_map(|r| {
                    let t = number(&r[0])? as u64;
                    Some((if *time_ms { t / 1_000 } else { t }, number(&r[*close])?))
                })
                .collect(),
            Rows::Bitstamp => body["data"]["ohlc"]
                .as_array()?
                .iter()
                .filter_map(|r| Some((number(&r["timestamp"])? as u64, number(&r["close"])?)))
                .collect(),
        };
        twap(candles, start, end)
    }
}

fn number(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str()?.parse().ok())
}

fn get_json(http: &impl Http, url: &str) -> Option<Value> {
    serde_json::from_str(&http.get(url).ok()?).ok()
}

fn twap(candles: Vec<(u64, f64)>, start: u64, end: u64) -> Option<f64> {
    let closes: BTreeMap<u64, f64> = candles
        .into_iter()
        .filter(|(t, c)| (start..end).contains(t) && t % 60 == 0 && c.is_finite() && *c > 0.0)
        .collect();
    (closes.len() >= MIN_CANDLES).then(|| closes.values().sum::<f64>() / closes.len() as f64)
}
