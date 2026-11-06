use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, AccountId};

fn emit(standard: &str, version: &str, event: &str, data: Value) {
    let log = json!({ "standard": standard, "version": version, "event": event, "data": data });
    env::log_str(&format!("EVENT_JSON:{}", log));
}

fn amounts(values: &[u128]) -> Vec<U128> {
    values.iter().copied().map(U128).collect()
}

pub fn mt_mint_or_burn(event: &str, owner_id: &AccountId, token_ids: &[String], values: &[u128]) {
    emit(
        "nep245",
        "1.0.0",
        event,
        json!([{ "owner_id": owner_id, "token_ids": token_ids, "amounts": amounts(values) }]),
    );
}

pub fn mt_transfer(
    old_owner_id: &AccountId,
    new_owner_id: &AccountId,
    token_ids: &[String],
    values: &[u128],
    memo: Option<&str>,
) {
    let mut data = json!({
        "old_owner_id": old_owner_id,
        "new_owner_id": new_owner_id,
        "token_ids": token_ids,
        "amounts": amounts(values),
    });
    if let Some(memo) = memo {
        data["memo"] = json!(memo);
    }
    emit("nep245", "1.0.0", "mt_transfer", json!([data]));
}

pub fn options<T: Serialize>(event: &str, data: &T) {
    emit(
        "endline",
        "1.0.0",
        event,
        serde_json::to_value(data).expect("event serialization"),
    );
}
