use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{AccountId, Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const CONTRACT: u128 = 100_000_000;
const WIDTH: u128 = 100_000_000;
const DAY: u64 = 86_400;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(10);
const MAX_GAS: Gas = Gas::from_tgas(300);
const NEP413_TAG: u32 = (1 << 31) + 413;
const NONCE_MAGIC: [u8; 4] = [0x56, 0x28, 0xf6, 0xc6];
const DEADLINE: &str = "2100-01-01T00:00:00.000Z";
const DEADLINE_NS: i64 = 4_102_444_800_000_000_000;

struct Env {
    worker: Worker<Sandbox>,
    intents: Contract,
    opt: Contract,
    usdc: Contract,
    fake: Contract,
    wnear: Contract,
    alice: Account,
    series: String,
}

fn asset(token: &Contract) -> String {
    format!("nep141:{}", token.id())
}

impl Env {
    fn option_asset(&self, token_id: &str) -> String {
        format!("nep245:{}:{token_id}", self.opt.id())
    }

    async fn intents_balance(&self, owner: &AccountId, asset: &str) -> anyhow::Result<u128> {
        let v: String = self
            .intents
            .view("mt_balance_of")
            .args_json(json!({"account_id": owner, "token_id": asset}))
            .await?
            .json()?;
        Ok(v.parse()?)
    }

    async fn ledger_balance(&self, owner: &AccountId, token_id: &str) -> anyhow::Result<u128> {
        let v: String = self
            .opt
            .view("mt_balance_of")
            .args_json(json!({"account_id": owner, "token_id": token_id}))
            .await?
            .json()?;
        Ok(v.parse()?)
    }

    async fn storage_deposit(
        &self,
        payer: &Account,
        account_id: &AccountId,
        deposit: NearToken,
    ) -> anyhow::Result<()> {
        payer
            .call(self.opt.id(), "storage_deposit")
            .args_json(json!({"account_id": account_id}))
            .deposit(deposit)
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    async fn locked(&self) -> anyhow::Result<u128> {
        let series: Value = self
            .opt
            .view("get_series")
            .args_json(json!({"series_id": self.series}))
            .await?
            .json()?;
        Ok(series["collateral_locked"].as_str().unwrap().parse()?)
    }

    async fn send_to_opt(
        &self,
        assets: &[&str],
        amounts: &[u128],
        msg: Value,
    ) -> anyhow::Result<ExecutionFinalResult> {
        let amounts: Vec<String> = amounts.iter().map(u128::to_string).collect();
        Ok(self
            .alice
            .call(self.intents.id(), "mt_batch_transfer_call")
            .args_json(json!({
                "receiver_id": self.opt.id(),
                "token_ids": assets,
                "amounts": amounts,
                "approvals": null,
                "memo": null,
                "msg": msg.to_string(),
            }))
            .deposit(ONE_YOCTO)
            .gas(MAX_GAS)
            .transact()
            .await?)
    }
}

async fn deploy_ft(root: &Account, name: &str, wasm: &[u8]) -> anyhow::Result<Contract> {
    let account = root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let token = account.deploy(wasm).await?.into_result()?;
    token
        .call("new")
        .args_json(json!({
            "owner_id": root.id(),
            "total_supply": (1_000 * WIDTH).to_string(),
            "metadata": {"spec": "ft-1.0.0", "name": name, "symbol": name.to_uppercase(), "decimals": 6},
        }))
        .transact()
        .await?
        .into_result()?;
    Ok(token)
}

async fn fund_in_intents(
    root: &Account,
    token: &Contract,
    intents: &Contract,
    owner: &Account,
) -> anyhow::Result<()> {
    for account in [owner.id(), intents.id()] {
        root.call(token.id(), "storage_deposit")
            .args_json(json!({"account_id": account}))
            .deposit(NearToken::from_millinear(10))
            .transact()
            .await?
            .into_result()?;
    }
    root.call(token.id(), "ft_transfer_call")
        .args_json(
            json!({"receiver_id": intents.id(), "amount": (10 * WIDTH).to_string(), "msg": owner.id()}),
        )
        .deposit(ONE_YOCTO)
        .gas(MAX_GAS)
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

fn ed25519_id(key: &SigningKey) -> String {
    format!(
        "ed25519:{}",
        bs58::encode(key.verifying_key().as_bytes()).into_string()
    )
}

fn borsh_string(bytes: &mut Vec<u8>, s: &str) {
    bytes.extend((s.len() as u32).to_le_bytes());
    bytes.extend(s.as_bytes());
}

fn signed_transfers(
    key: &SigningKey,
    signer_id: &str,
    intents: &AccountId,
    asset: &str,
    moves: &[(&AccountId, u128)],
    nonce: [u8; 32],
) -> Value {
    let transfers: Vec<Value> = moves
        .iter()
        .map(|(receiver_id, amount)| json!({"intent": "transfer", "receiver_id": receiver_id, "tokens": {asset: amount.to_string()}}))
        .collect();
    signed_intents(key, signer_id, intents, transfers, nonce)
}

fn signed_intents(
    key: &SigningKey,
    signer_id: &str,
    intents: &AccountId,
    list: Vec<Value>,
    nonce: [u8; 32],
) -> Value {
    let message = json!({"deadline": DEADLINE, "intents": list, "signer_id": signer_id}).to_string();
    let mut nep413 = NEP413_TAG.to_le_bytes().to_vec();
    borsh_string(&mut nep413, &message);
    nep413.extend(nonce);
    borsh_string(&mut nep413, intents.as_str());
    nep413.push(0);
    let signature = key.sign(&Sha256::digest(&nep413));
    json!({
        "standard": "nep413",
        "payload": {"message": message, "nonce": BASE64.encode(nonce), "recipient": intents},
        "public_key": ed25519_id(key),
        "signature": format!("ed25519:{}", bs58::encode(signature.to_bytes()).into_string()),
    })
}

fn versioned_nonce(salt: &[u8], random: u8) -> [u8; 32] {
    let mut nonce = [random; 32];
    nonce[..4].copy_from_slice(&NONCE_MAGIC);
    nonce[4] = 0;
    nonce[5..9].copy_from_slice(salt);
    nonce[9..17].copy_from_slice(&DEADLINE_NS.to_le_bytes());
    nonce
}

fn assert_panicked_with(result: &ExecutionFinalResult, needle: &str) {
    let failures = format!("{:?}", result.receipt_failures());
    assert!(failures.contains(needle), "expected `{needle}` in {failures}");
}

fn next_expiry(now_ns: u64) -> u64 {
    let now = now_ns / 1_000_000_000;
    let today = now - now % DAY + 8 * 3_600;
    if today > now + 2 * 3_600 {
        today
    } else {
        today + DAY
    }
}

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let res = concat!(env!("CARGO_MANIFEST_DIR"), "/res");
    let ft_wasm = std::fs::read(format!("{res}/fungible-token.wasm"))?;

    let wnear = root
        .create_subaccount("wnear")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let wnear = wnear
        .deploy(&std::fs::read(format!("{res}/wnear.wasm"))?)
        .await?
        .into_result()?;
    wnear.call("new").transact().await?.into_result()?;

    let intents = root
        .create_subaccount("intents")
        .initial_balance(NearToken::from_near(100))
        .transact()
        .await?
        .into_result()?;
    let intents = intents
        .deploy(&std::fs::read(format!("{res}/intents.wasm"))?)
        .await?
        .into_result()?;
    intents
        .call("new")
        .args_json(json!({"config": {
            "wnear_id": wnear.id(),
            "fees": {"fee": 0, "fee_collector": intents.id()},
            "roles": {"super_admins": [root.id()], "admins": {}, "grantees": {}},
        }}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let usdc = deploy_ft(&root, "usdc", &ft_wasm).await?;
    let fake = deploy_ft(&root, "fake", &ft_wasm).await?;

    let opt_wasm = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/near/options/options.wasm"
    ))
    .map_err(|e| {
        anyhow::anyhow!("run `cargo near build non-reproducible-wasm` in contracts/options first: {e}")
    })?;
    let opt = root
        .create_subaccount("opt")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;
    let opt = opt.deploy(&opt_wasm).await?.into_result()?;
    opt.call("new")
        .args_json(json!({
            "owner_id": root.id(),
            "intents_id": intents.id(),
            "quote_asset": asset(&usdc),
            "quote_decimals": 6,
            "dispute_window_sec": 60,
            "oracle_delay_sec": 60,
        }))
        .transact()
        .await?
        .into_result()?;
    root.call(opt.id(), "add_underlying")
        .args_json(json!({"symbol": "BTC", "underlying": {
            "index": "btc_usd", "decimals": 8, "min_write": "1000",
        }}))
        .deposit(ONE_YOCTO)
        .transact()
        .await?
        .into_result()?;

    let alice = root
        .create_subaccount("alice")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;
    for token in [&usdc, &fake] {
        fund_in_intents(&root, token, &intents, &alice).await?;
    }

    let expiry = next_expiry(worker.view_block().await?.timestamp());
    let series: String = alice
        .call(opt.id(), "create_series")
        .args_json(json!({"underlying": "BTC", "strike": "110000000000", "width": WIDTH.to_string(), "expiry": expiry, "kind": "call"}))
        .deposit(NearToken::from_near(1))
        .transact()
        .await?
        .into_result()?
        .json()?;

    Ok(Env {
        worker,
        intents,
        opt,
        usdc,
        fake,
        wnear,
        alice,
        series,
    })
}

#[tokio::test]
async fn write_and_burn_pair_round_trip_through_real_intents() -> anyhow::Result<()> {
    let env = setup().await?;
    let usdc = asset(&env.usdc);
    let long = env.option_asset(&env.series);
    let short = env.option_asset(&format!("{}-SHORT", env.series));
    let before = env.intents_balance(env.alice.id(), &usdc).await?;

    let write = env
        .send_to_opt(
            &[&usdc],
            &[WIDTH],
            json!({"action": "write", "series_id": env.series}),
        )
        .await?;
    assert!(write.is_success(), "{:?}", write.failures());
    assert_eq!(env.intents_balance(env.alice.id(), &long).await?, CONTRACT);
    assert_eq!(env.intents_balance(env.alice.id(), &short).await?, CONTRACT);
    assert_eq!(env.intents_balance(env.alice.id(), &usdc).await?, before - WIDTH);
    assert_eq!(env.intents_balance(env.opt.id(), &usdc).await?, WIDTH);

    let burn = env
        .send_to_opt(
            &[&short, &long],
            &[CONTRACT / 4, CONTRACT / 4],
            json!({"action": "burn_pair"}),
        )
        .await?;
    assert!(burn.is_success(), "{:?}", burn.failures());
    assert_eq!(
        env.intents_balance(env.alice.id(), &usdc).await?,
        before - WIDTH + WIDTH / 4
    );
    assert_eq!(
        env.intents_balance(env.alice.id(), &long).await?,
        CONTRACT * 3 / 4
    );
    assert_eq!(env.locked().await?, WIDTH * 3 / 4);
    Ok(())
}

#[tokio::test]
async fn unlisted_asset_is_refunded_by_intents() -> anyhow::Result<()> {
    let env = setup().await?;
    let fake = asset(&env.fake);
    let before = env.intents_balance(env.alice.id(), &fake).await?;
    let res = env
        .send_to_opt(
            &[&fake],
            &[WIDTH],
            json!({"action": "write", "series_id": env.series}),
        )
        .await?;
    assert_panicked_with(&res, "writes take nep141:usdc.test.near as collateral");
    assert_eq!(env.intents_balance(env.alice.id(), &fake).await?, before);
    assert_eq!(
        env.intents_balance(env.alice.id(), &env.option_asset(&env.series))
            .await?,
        0
    );
    assert_eq!(env.locked().await?, 0);
    Ok(())
}

#[tokio::test]
async fn exercise_before_settlement_refunds_options() -> anyhow::Result<()> {
    let env = setup().await?;
    let usdc = asset(&env.usdc);
    let long = env.option_asset(&env.series);
    env.send_to_opt(
        &[&usdc],
        &[WIDTH],
        json!({"action": "write", "series_id": env.series}),
    )
    .await?
    .into_result()?;
    let res = env
        .send_to_opt(&[&long], &[CONTRACT], json!({"action": "exercise"}))
        .await?;
    assert_panicked_with(&res, "not settled yet");
    assert_eq!(env.intents_balance(env.alice.id(), &long).await?, CONTRACT);
    assert_eq!(env.locked().await?, WIDTH);
    Ok(())
}

#[tokio::test]
async fn forged_deposit_notification_is_rejected() -> anyhow::Result<()> {
    let env = setup().await?;
    let forged = env
        .alice
        .call(env.opt.id(), "mt_on_transfer")
        .args_json(json!({
            "sender_id": env.alice.id(),
            "previous_owner_ids": [env.alice.id()],
            "token_ids": [asset(&env.usdc)],
            "amounts": [WIDTH.to_string()],
            "msg": json!({"action": "write", "series_id": env.series}).to_string(),
        }))
        .gas(MAX_GAS)
        .transact()
        .await?;
    assert_panicked_with(&forged, "only intents.near");
    assert_eq!(env.locked().await?, 0);
    let supply: Option<String> = env
        .opt
        .view("mt_supply")
        .args_json(json!({"token_id": env.series}))
        .await?
        .json()?;
    assert_eq!(supply.as_deref(), Some("0"));
    Ok(())
}

#[tokio::test]
async fn withdraw_with_msg_never_loses_options_at_tight_gas() -> anyhow::Result<()> {
    let env = setup().await?;
    let series: Value = env
        .opt
        .view("get_series")
        .args_json(json!({"series_id": env.series}))
        .await?
        .json()?;
    let mut tokens = vec![];
    for strike in 1..=5 {
        let id: String = env
            .alice
            .call(env.opt.id(), "create_series")
            .args_json(json!({"underlying": "BTC", "strike": format!("1100000{strike}0000"), "width": WIDTH.to_string(), "expiry": series["expiry"], "kind": "call"}))
            .deposit(NearToken::from_near(1))
            .transact()
            .await?
            .into_result()?
            .json()?;
        env.send_to_opt(
            &[&asset(&env.usdc)],
            &[WIDTH],
            json!({"action": "write", "series_id": id}),
        )
        .await?
        .into_result()?;
        tokens.push(format!("{id}-SHORT"));
        tokens.push(id);
    }
    let held = || async {
        let mut total = 0;
        for token in &tokens {
            total += env
                .intents_balance(env.alice.id(), &env.option_asset(token))
                .await?;
            total += env.ledger_balance(env.alice.id(), token).await?;
        }
        anyhow::Ok(total)
    };
    let before = held().await?;
    let mut reached_opt = false;
    for tx_gas in (100..=200).step_by(4) {
        let outcome = env
            .alice
            .call(env.intents.id(), "mt_withdraw")
            .args_json(json!({"token": env.opt.id(), "receiver_id": env.alice.id(), "token_ids": tokens, "amounts": vec!["1000"; tokens.len()], "msg": "x"}))
            .deposit(ONE_YOCTO)
            .gas(Gas::from_tgas(tx_gas))
            .transact()
            .await?;
        reached_opt |= outcome
            .receipt_outcomes()
            .iter()
            .any(|r| r.executor_id == *env.opt.id());
        assert_eq!(held().await?, before, "options lost at {tx_gas} TGas");
    }
    assert!(reached_opt, "intents never called the options contract");
    Ok(())
}

#[tokio::test]
async fn ledger_options_reach_intents_only_as_plain_deposits() -> anyhow::Result<()> {
    let env = setup().await?;
    let long = env.option_asset(&env.series);
    env.send_to_opt(
        &[&asset(&env.usdc)],
        &[WIDTH],
        json!({"action": "write", "series_id": env.series}),
    )
    .await?
    .into_result()?;
    env.storage_deposit(&env.alice, env.alice.id(), STORAGE_DEPOSIT)
        .await?;
    env.alice
        .call(env.intents.id(), "mt_withdraw")
        .args_json(json!({"token": env.opt.id(), "receiver_id": env.alice.id(), "token_ids": [env.series], "amounts": [CONTRACT.to_string()]}))
        .deposit(ONE_YOCTO)
        .gas(MAX_GAS)
        .transact()
        .await?
        .into_result()?;
    let deposit = |msg: String| {
        env.alice
            .call(env.opt.id(), "mt_transfer_call")
            .args_json(json!({"receiver_id": env.intents.id(), "token_id": env.series, "amount": (CONTRACT / 4).to_string(), "approval": null, "memo": null, "msg": msg}))
            .deposit(NearToken::from_millinear(10))
            .gas(MAX_GAS)
            .transact()
    };
    let execute = json!({"receiver_id": env.alice.id(), "execute_intents": [], "refund_if_fails": true});
    assert_panicked_with(
        &deposit(execute.to_string()).await?,
        "deposits to intents take an empty msg or an account id",
    );
    let bob = env.worker.root_account()?;
    deposit(String::new()).await?.into_result()?;
    deposit(bob.id().to_string()).await?.into_result()?;

    assert_eq!(env.intents_balance(env.alice.id(), &long).await?, CONTRACT / 4);
    assert_eq!(env.intents_balance(bob.id(), &long).await?, CONTRACT / 4);
    assert_eq!(
        env.ledger_balance(env.alice.id(), &env.series).await?,
        CONTRACT / 2
    );
    Ok(())
}

#[tokio::test]
async fn owner_moves_in_two_steps_and_oracle_changes_wait_out_the_delay() -> anyhow::Result<()> {
    let env = setup().await?;
    let root = env.worker.root_account()?;
    let multisig = &env.alice;
    let owner_call = |caller: &Account, method: &str, args: Value| {
        caller
            .call(env.opt.id(), method)
            .args_json(args)
            .deposit(ONE_YOCTO)
            .transact()
    };

    owner_call(&root, "propose_owner", json!({"owner_id": multisig.id()}))
        .await?
        .into_result()?;
    let early = owner_call(multisig, "add_oracle", json!({"account_id": multisig.id()})).await?;
    assert_panicked_with(&early, "only owner");
    owner_call(multisig, "accept_owner", json!({}))
        .await?
        .into_result()?;
    let old = owner_call(&root, "add_oracle", json!({"account_id": root.id()})).await?;
    assert_panicked_with(&old, "only owner");

    let wasm = json!({"outlayer_id": "outlayer.test.near", "url": "https://x.io/oracle.wasm", "sha256": "a".repeat(64)});
    owner_call(multisig, "add_oracle", json!({"account_id": multisig.id()}))
        .await?
        .into_result()?;
    owner_call(multisig, "set_oracle_wasm", json!({"oracle_wasm": wasm}))
        .await?
        .into_result()?;

    let expiry = env
        .opt
        .view("get_series")
        .args_json(json!({"series_id": env.series}))
        .await?
        .json::<Value>()?["expiry"]
        .as_u64()
        .unwrap();
    let propose = || {
        multisig
            .call(env.opt.id(), "propose_settlement")
            .args_json(json!({"underlying": "BTC", "expiry": expiry, "price": "1"}))
            .deposit(ONE_YOCTO)
            .transact()
    };
    assert_panicked_with(&propose().await?, "only oracle");
    assert_eq!(
        env.opt.view("get_oracle_wasm").await?.json::<Value>()?,
        Value::Null
    );
    let pending: Value = env.opt.view("get_pending_oracle_changes").await?.json()?;
    assert_eq!(pending["oracle_wasm"]["oracle_wasm"], wasm);
    let active_at = pending["oracles"][0][1].as_u64().unwrap();
    assert_eq!(pending["oracles"][0][0], multisig.id().as_str());

    while env.worker.view_block().await?.timestamp() / 1_000_000_000 < active_at {
        env.worker.fast_forward(20).await?;
    }
    assert_panicked_with(&propose().await?, "manual settlement not open yet");
    assert_eq!(env.opt.view("get_oracle_wasm").await?.json::<Value>()?, wasm);
    let oracles: Vec<String> = env.opt.view("get_oracles").await?.json()?;
    assert_eq!(oracles, vec![multisig.id().to_string()]);
    Ok(())
}

#[tokio::test]
async fn open_series_page_by_expiry_in_the_real_wasm() -> anyhow::Result<()> {
    let env = setup().await?;
    let expiry = env
        .opt
        .view("get_series")
        .args_json(json!({"series_id": env.series}))
        .await?
        .json::<Value>()?["expiry"]
        .as_u64()
        .unwrap();
    let mut listed = vec![(expiry, env.series.clone())];
    for (at, strike) in [(expiry + DAY, "90000000000"), (expiry, "100000000000")] {
        let id: String = env
            .alice
            .call(env.opt.id(), "create_series")
            .args_json(json!({"underlying": "BTC", "strike": strike, "width": WIDTH.to_string(), "expiry": at, "kind": "put"}))
            .deposit(NearToken::from_near(1))
            .transact()
            .await?
            .into_result()?
            .json()?;
        listed.push((at, id));
    }
    listed.sort();

    let page = |from_expiry: u64, after_id: Option<String>| {
        env.opt
            .view("list_series_by_expiry")
            .args_json(json!({"from_expiry": from_expiry, "after_id": after_id, "limit": 1}))
    };
    let mut seen = vec![];
    let mut cursor = (expiry, None);
    loop {
        let series: Vec<Value> = page(cursor.0, cursor.1.clone()).await?.json()?;
        let Some(s) = series.first() else { break };
        let key = (
            s["expiry"].as_u64().unwrap(),
            s["id"].as_str().unwrap().to_string(),
        );
        cursor = (key.0, Some(key.1.clone()));
        seen.push(key);
    }
    assert_eq!(seen, listed);
    let later: Vec<Value> = page(expiry + 1, None).await?.json()?;
    assert_eq!(later.len(), 1);
    assert_eq!(later[0]["id"], listed[2].1.as_str());
    Ok(())
}

#[tokio::test]
async fn derived_key_pays_from_its_implicit_account_without_registration() -> anyhow::Result<()> {
    let env = setup().await?;
    let root = env.worker.root_account()?;
    let usdc = asset(&env.usdc);
    let key = SigningKey::from_bytes(&Sha256::digest(b"tap balance").into());
    let tap: AccountId = hex::encode(key.verifying_key().as_bytes()).parse()?;
    for (account, registered) in [(&tap, true), (env.alice.id(), false)] {
        let has: bool = env
            .intents
            .view("has_public_key")
            .args_json(json!({"account_id": account, "public_key": ed25519_id(&key)}))
            .await?
            .json()?;
        assert_eq!(has, registered, "{account}");
    }

    env.alice
        .call(env.intents.id(), "mt_transfer")
        .args_json(json!({"receiver_id": tap, "token_id": usdc, "amount": WIDTH.to_string()}))
        .deposit(ONE_YOCTO)
        .transact()
        .await?
        .into_result()?;
    let alice_before = env.intents_balance(env.alice.id(), &usdc).await?;
    let relayer = root
        .create_subaccount("relayer")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let execute = |signed: &Value| {
        relayer
            .call(env.intents.id(), "execute_intents")
            .args_json(json!({"signed": [signed]}))
            .gas(MAX_GAS)
            .transact()
    };
    let salt = hex::decode(env.intents.view("current_salt").await?.json::<String>()?)?;

    let fee = WIDTH / 10_000;
    let back = signed_transfers(
        &key,
        tap.as_str(),
        env.intents.id(),
        &usdc,
        &[(env.alice.id(), WIDTH / 4), (relayer.id(), fee)],
        versioned_nonce(&salt, 1),
    );
    let near_before = relayer.view_account().await?.balance;
    execute(&back).await?.into_result()?;
    // unused prepaid gas is refunded in a later block than the outcome
    env.worker.fast_forward(5).await?;
    let spent = near_before.saturating_sub(relayer.view_account().await?.balance);
    assert!(
        spent > NearToken::from_micronear(100) && spent < NearToken::from_millinear(1),
        "the $0.01 relay fee must cover the relayer's gas while NEAR is under $10: {spent}"
    );
    let expected = (WIDTH - WIDTH / 4 - fee, alice_before + WIDTH / 4, fee);
    let balances = || async {
        anyhow::Ok((
            env.intents_balance(&tap, &usdc).await?,
            env.intents_balance(env.alice.id(), &usdc).await?,
            env.intents_balance(relayer.id(), &usdc).await?,
        ))
    };
    assert_eq!(balances().await?, expected);

    assert_panicked_with(&execute(&back).await?, "nonce was already used");
    let forged = signed_transfers(
        &key,
        env.alice.id().as_str(),
        env.intents.id(),
        &usdc,
        &[(&tap, WIDTH)],
        versioned_nonce(&salt, 2),
    );
    assert_panicked_with(&execute(&forged).await?, "doesn't exist for account");
    assert_eq!(balances().await?, expected);
    Ok(())
}

async fn write_and_add_bob(env: &Env) -> anyhow::Result<(Account, Vec<String>)> {
    env.send_to_opt(
        &[&asset(&env.usdc)],
        &[WIDTH],
        json!({"action": "write", "series_id": env.series}),
    )
    .await?
    .into_result()?;
    let bob = env
        .worker
        .root_account()?
        .create_subaccount("bob")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()?;
    Ok((bob, vec![env.series.clone(), format!("{}-SHORT", env.series)]))
}

#[tokio::test]
async fn options_leave_intents_for_a_new_ledger_account_only_with_its_storage_paid() -> anyhow::Result<()> {
    let env = setup().await?;
    let (bob, tokens) = write_and_add_bob(&env).await?;
    let long = env.option_asset(&env.series);
    let amounts = vec![(CONTRACT / 2).to_string(); 2];
    let storage = || async { anyhow::Ok(env.opt.view_account().await?.storage_usage) };

    let before = storage().await?;
    let unpaid = env
        .alice
        .call(env.intents.id(), "mt_withdraw")
        .args_json(
            json!({"token": env.opt.id(), "receiver_id": bob.id(), "token_ids": tokens, "amounts": amounts}),
        )
        .deposit(ONE_YOCTO)
        .gas(MAX_GAS)
        .transact()
        .await?;
    assert_panicked_with(&unpaid, &format!("{} needs", bob.id()));
    assert_eq!(env.intents_balance(env.alice.id(), &long).await?, CONTRACT);
    assert_eq!(env.ledger_balance(bob.id(), &env.series).await?, 0);
    assert_eq!(storage().await?, before);

    let root = env.worker.root_account()?;
    for account in [root.id(), env.intents.id()] {
        root.call(env.wnear.id(), "storage_deposit")
            .args_json(json!({"account_id": account}))
            .deposit(NearToken::from_millinear(10))
            .transact()
            .await?
            .into_result()?;
    }
    root.call(env.wnear.id(), "near_deposit")
        .deposit(NearToken::from_near(1))
        .transact()
        .await?
        .into_result()?;
    root.call(env.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": env.intents.id(), "amount": STORAGE_DEPOSIT.as_yoctonear().to_string(), "msg": env.alice.id()}))
        .deposit(ONE_YOCTO)
        .gas(MAX_GAS)
        .transact()
        .await?
        .into_result()?;
    let key = SigningKey::from_bytes(&Sha256::digest(b"alice intents key").into());
    env.alice
        .call(env.intents.id(), "add_public_key")
        .args_json(json!({"public_key": ed25519_id(&key)}))
        .deposit(ONE_YOCTO)
        .transact()
        .await?
        .into_result()?;
    let salt = hex::decode(env.intents.view("current_salt").await?.json::<String>()?)?;
    let withdraw = json!({
        "intent": "mt_withdraw",
        "token": env.opt.id(),
        "receiver_id": bob.id(),
        "token_ids": tokens,
        "amounts": amounts,
        "storage_deposit": STORAGE_DEPOSIT.as_yoctonear().to_string(),
    });
    let signed = signed_intents(
        &key,
        env.alice.id().as_str(),
        env.intents.id(),
        vec![withdraw],
        versioned_nonce(&salt, 3),
    );
    env.alice
        .call(env.intents.id(), "execute_intents")
        .args_json(json!({"signed": [signed]}))
        .gas(MAX_GAS)
        .transact()
        .await?
        .into_result()?;

    assert_eq!(env.intents_balance(env.alice.id(), &long).await?, CONTRACT / 2);
    assert_eq!(env.ledger_balance(bob.id(), &env.series).await?, CONTRACT / 2);
    let added = storage().await? - before;
    let credit: Value = env
        .opt
        .view("storage_balance_of")
        .args_json(json!({"account_id": bob.id()}))
        .await?
        .json()?;
    assert_eq!(
        credit["available"].as_str().unwrap().parse::<u128>()?,
        STORAGE_DEPOSIT.as_yoctonear() - added as u128 * 10u128.pow(19)
    );
    Ok(())
}

#[tokio::test]
async fn payout_to_an_account_new_to_intents_arrives_and_nothing_goes_claimable() -> anyhow::Result<()> {
    let env = setup().await?;
    let (bob, tokens) = write_and_add_bob(&env).await?;
    let usdc = asset(&env.usdc);
    env.storage_deposit(&bob, bob.id(), STORAGE_DEPOSIT).await?;
    env.alice
        .call(env.intents.id(), "mt_withdraw")
        .args_json(json!({"token": env.opt.id(), "receiver_id": bob.id(), "token_ids": tokens, "amounts": vec![CONTRACT.to_string(); 2]}))
        .deposit(ONE_YOCTO)
        .gas(MAX_GAS)
        .transact()
        .await?
        .into_result()?;
    assert_eq!(env.intents_balance(bob.id(), &usdc).await?, 0);

    let close = bob
        .call(env.opt.id(), "burn_pair")
        .args_json(json!({"series_id": env.series, "amount": CONTRACT.to_string()}))
        .deposit(ONE_YOCTO)
        .gas(MAX_GAS)
        .transact()
        .await?;
    assert!(close.is_success(), "{:?}", close.failures());
    let payout = close
        .receipt_outcomes()
        .iter()
        .find(|r| r.executor_id == *env.intents.id())
        .unwrap()
        .gas_burnt;
    assert!(
        payout.as_gas() * 2 <= Gas::from_tgas(20).as_gas(),
        "intents mt_transfer to a new account burnt {payout}"
    );
    assert_eq!(env.intents_balance(bob.id(), &usdc).await?, WIDTH);
    let claimable: String = env
        .opt
        .view("get_claimable")
        .args_json(json!({"account_id": bob.id(), "asset": usdc}))
        .await?
        .json()?;
    assert_eq!(claimable, "0");
    Ok(())
}
