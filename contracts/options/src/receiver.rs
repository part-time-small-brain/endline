use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{env, near, require, AccountId};

use crate::close::CloseAction;
use crate::mt::MAX_BATCH;
use crate::{Contract, ContractExt};

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "action", rename_all = "snake_case")]
enum Msg {
    Write { series_id: String },
    Exercise,
    Redeem,
    BurnPair,
}

#[near]
impl Contract {
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> Vec<U128> {
        require!(
            env::predecessor_account_id() == self.intents_id,
            "only intents.near"
        );
        require!(
            token_ids.len() == amounts.len() && token_ids.len() == previous_owner_ids.len(),
            "length mismatch"
        );
        require!(
            !token_ids.is_empty() && token_ids.len() <= MAX_BATCH,
            "batch size"
        );
        let msg: Msg =
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|e| env::panic_str(&format!("bad msg: {e}")));
        let raw: Vec<u128> = amounts.iter().map(|a| a.0).collect();

        let action = match msg {
            Msg::Write { series_id } => {
                require!(token_ids.len() == 1, "write takes one collateral token");
                let used = self.write(&token_ids[0], raw[0], &series_id, &sender_id);
                return vec![U128(raw[0] - used)];
            }
            Msg::Exercise => CloseAction::Exercise,
            Msg::Redeem => CloseAction::Redeem,
            Msg::BurnPair => CloseAction::BurnPair,
        };
        let prefix = format!("nep245:{}:", env::current_account_id());
        let inner: Vec<String> = token_ids
            .iter()
            .map(|t| {
                t.strip_prefix(&prefix)
                    .unwrap_or_else(|| env::panic_str(&format!("{t} is not an option token")))
                    .to_string()
            })
            .collect();
        self.close(None, action, &inner, &raw, &sender_id);
        vec![U128(0); token_ids.len()]
    }
}
