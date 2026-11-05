use std::io::{Read, Write};

use oracle::{fix, Http, Request};

struct WasiHttp;

impl Http for WasiHttp {
    fn get(&self, url: &str) -> Result<String, String> {
        let response = wasi_http_client::Client::new()
            .get(url)
            .header("User-Agent", "near-options-oracle")
            .connect_timeout(std::time::Duration::from_secs(10))
            .send()
            .map_err(|e| e.to_string())?;
        if !(200..300).contains(&response.status()) {
            return Err(format!("{url} -> {}", response.status()));
        }
        String::from_utf8(response.body().map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }
}

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("read stdin");
    let request: Request = serde_json::from_str(&input).expect("invalid request");
    let now = std::env::var("NEAR_BLOCK_TIMESTAMP")
        .ok()
        .and_then(|ns| ns.parse::<u64>().ok())
        .map(|ns| ns / 1_000_000_000);
    let fixing = fix(&request, now, &WasiHttp);
    let mut stdout = std::io::stdout();
    serde_json::to_writer(&mut stdout, &fixing).expect("write stdout");
    stdout.flush().expect("flush stdout");
}
