use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken, PromiseResult, RuntimeFeesConfig};

use crate::math::Terms;
use crate::series::{self, OptionKind};
use crate::{Contract, OracleWasm, Timing, Underlying};

const VECTORS: &str = include_str!("../../../testdata/vectors.json");
const EXPIRY: u64 = 1_795_766_400;
const DAY: u64 = 86_400;
const ORACLE_DELAY: u64 = DAY;
const T0: u64 = EXPIRY - 10 * DAY;
const MANUAL_AT: u64 = EXPIRY + 6 * 3_600;
const BTC: u128 = 100_000_000;
const USD: u128 = 1_000_000;
const W: u128 = 10_000;
const BTC_ASSET: &str = "nep141:btc.omft.near";
const USDC_ASSET: &str = "nep141:usdc.near";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("owner.near")
}
fn intents() -> AccountId {
    acc("intents.near")
}
fn oracle() -> AccountId {
    acc("oracle.near")
}
fn alice() -> AccountId {
    acc("alice.near")
}
fn me() -> AccountId {
    acc("opt.near")
}

fn context(predecessor: AccountId, now: u64, deposit: u128) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(predecessor)
        .block_timestamp(now * 1_000_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .build()
}

fn ctx(predecessor: AccountId, now: u64, deposit: u128) {
    testing_env!(context(predecessor, now, deposit));
}

fn callback_ctx(now: u64, result: PromiseResult) {
    testing_env!(
        context(me(), now, 0),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn panics_with(expected: &str, f: impl FnOnce()) {
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_err();
    let message = err.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(
        message.contains(expected),
        "expected `{expected}`, got `{message}`"
    );
}

fn setup() -> Contract {
    setup_with_timing(None)
}

fn setup_with_timing(grid: Option<Timing>) -> Contract {
    ctx(owner(), T0, 1);
    let mut c = Contract::new(
        owner(),
        intents(),
        USDC_ASSET.into(),
        6,
        3_600,
        ORACLE_DELAY,
        grid,
    );
    c.add_underlying(
        "BTC".into(),
        Underlying {
            index: "btc_usd".into(),
            decimals: 8,
            min_write: U128(BTC / 1_000),
        },
    );
    c.add_oracle(oracle());
    c
}

fn create(c: &mut Contract, strike_usd: u128, width_usd: u128, kind: OptionKind) -> String {
    ctx(alice(), T0, 10u128.pow(24));
    c.create_series(
        "BTC".into(),
        U128(strike_usd * USD),
        U128(width_usd * USD),
        EXPIRY,
        kind,
    )
}

fn via_intents(c: &mut Contract, now: u64, token_ids: &[String], amounts: &[u128], msg: Value) -> Vec<u128> {
    ctx(intents(), now, 0);
    let n = token_ids.len();
    c.mt_on_transfer(
        alice(),
        vec![alice(); n],
        token_ids.to_vec(),
        amounts.iter().copied().map(U128).collect(),
        msg.to_string(),
    )
    .into_iter()
    .map(|a| a.0)
    .collect()
}

fn write(c: &mut Contract, asset: &str, amount: u128, series_id: &str) -> u128 {
    via_intents(
        c,
        T0,
        &[asset.into()],
        &[amount],
        json!({"action": "write", "series_id": series_id}),
    )[0]
}

fn wrapped(token_id: &str) -> String {
    format!("nep245:opt.near:{token_id}")
}

fn short(series_id: &str) -> String {
    format!("{series_id}-SHORT")
}

fn settle(c: &mut Contract, price_usd: u128) -> u64 {
    ctx(oracle(), MANUAL_AT, 1);
    c.propose_settlement("BTC".into(), EXPIRY, U128(price_usd * USD));
    MANUAL_AT + 3_600
}

fn bal(c: &Contract, who: AccountId, token: &str) -> u128 {
    c.mt_balance_of(who, token.into()).0
}

fn locked(c: &Contract, series_id: &str) -> u128 {
    c.get_series(series_id.into()).unwrap().collateral_locked.0
}

fn calls(method: &str) -> Vec<(AccountId, Value)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.clone();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight {
                    method_name, args, ..
                } if method_name == method.as_bytes() => {
                    Some((receiver.clone(), serde_json::from_slice(&args).unwrap()))
                }
                _ => None,
            })
        })
        .collect()
}

fn u(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

fn kind_of(v: &Value) -> OptionKind {
    serde_json::from_value(v.clone()).unwrap()
}

#[test]
fn series_id_vectors() {
    let v: Value = serde_json::from_str(VECTORS).unwrap();
    for case in v["series_ids"].as_array().unwrap() {
        let id = series::series_id(
            case["underlying"].as_str().unwrap(),
            case["expiry"].as_u64().unwrap(),
            u(&case["strike"]),
            u(&case["width"]),
            case["quote_decimals"].as_u64().unwrap() as u8,
            kind_of(&case["kind"]),
        );
        assert_eq!(id, case["id"].as_str().unwrap());
    }
}

#[test]
fn math_vectors() {
    let v: Value = serde_json::from_str(VECTORS).unwrap();
    for case in v["math"].as_array().unwrap() {
        let t = Terms {
            kind: kind_of(&case["kind"]),
            strike: u(&case["strike"]),
            width: u(&case["width"]),
            unit: u(&case["unit"]),
        };
        let (a, s) = (u(&case["amount"]), u(&case["settlement"]));
        assert_eq!(t.collateral_for(a), u(&case["collateral"]), "{case}");
        assert_eq!(
            t.options_for_collateral(u(&case["collateral"])),
            u(&case["options_for_collateral"]),
            "{case}"
        );
        assert_eq!(t.pair_refund(a), u(&case["pair_refund"]), "{case}");
        assert_eq!(t.long_payout(a, s), u(&case["long_payout"]), "{case}");
        assert_eq!(t.short_payout(a, s), u(&case["short_payout"]), "{case}");
    }
}

#[test]
fn payouts_never_exceed_collateral() {
    let mut seed: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut next = |m: u128| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed as u128 % m) + 1
    };
    for _ in 0..20_000 {
        let kind = if next(2) == 1 {
            OptionKind::Call
        } else {
            OptionKind::Put
        };
        let unit = [10u128.pow(6), 10u128.pow(8), 10u128.pow(18), 10u128.pow(24)][next(4) as usize - 1];
        let strike = 19_999 + next(10u128.pow(12));
        let (width, cap) = match kind {
            OptionKind::Call => {
                let width = 9_999 + next(10u128.pow(12));
                (width, strike + width)
            }
            OptionKind::Put => {
                let width = 9_999 + next(strike - 10_000);
                (width, strike - width)
            }
        };
        let t = Terms {
            kind,
            strike,
            width,
            unit,
        };
        let collateral = next(10u128.pow(16));
        let amount = t.options_for_collateral(collateral);
        assert!(t.collateral_for(amount) <= collateral);
        assert!(t.collateral_for(amount) - t.pair_refund(amount) <= 1);
        let s = next(3 * 10u128.pow(12));
        let paid = t.long_payout(amount, s) + t.short_payout(amount, s);
        assert!(paid <= t.pair_refund(amount) && t.pair_refund(amount) - paid <= 1);
        let past_cap = match kind {
            OptionKind::Call => cap + next(10u128.pow(12)),
            OptionKind::Put => next(cap) - 1,
        };
        assert_eq!(t.long_payout(amount, past_cap), t.long_payout(amount, cap));
        let split = amount / 3;
        assert!(t.long_payout(split, s) + t.long_payout(amount - split, s) <= t.long_payout(amount, s));
    }
}

#[test]
fn create_series_validates_width() {
    let mut c = setup();
    ctx(alice(), T0, 10u128.pow(24));
    let strike = U128(95_000 * USD);
    let cases = [
        (OptionKind::Call, 0, "width must be a positive whole cent"),
        (
            OptionKind::Call,
            USD / 100 - 1,
            "width must be a positive whole cent",
        ),
        (
            OptionKind::Put,
            95_000 * USD,
            "put width must be below the strike",
        ),
    ];
    for (kind, width, expected) in cases {
        panics_with(expected, || {
            c.create_series("BTC".into(), strike, U128(width), EXPIRY, kind);
        });
    }
    let put = c.create_series(
        "BTC".into(),
        strike,
        U128(95_000 * USD - USD / 100),
        EXPIRY,
        OptionKind::Put,
    );
    let call = c.create_series(
        "BTC".into(),
        strike,
        U128(200_000 * USD),
        EXPIRY,
        OptionKind::Call,
    );
    assert_eq!(put, "BTC-27NOV26-95000_0d01-P");
    assert_eq!(call, "BTC-27NOV26-95000_295000-C");
}

#[test]
fn same_strike_with_another_width_is_another_series() {
    let mut c = setup();
    let narrow = create(&mut c, 110_000, 2_000, OptionKind::Call);
    let wide = create(&mut c, 110_000, 4_000, OptionKind::Call);
    assert_eq!(narrow, "BTC-27NOV26-110000_112000-C");
    assert_eq!(wide, "BTC-27NOV26-110000_114000-C");
    panics_with("series exists", || {
        create(&mut c, 110_000, 2_000, OptionKind::Call);
    });
}

#[test]
fn payouts_stop_at_the_cap() {
    let mut c = setup();
    let cases = [
        (OptionKind::Call, 110_000, W * USD),
        (OptionKind::Call, 10_000, W * USD),
        (OptionKind::Put, 125_000, 5_000 * USD),
        (OptionKind::Put, 130_000, W * USD),
        (OptionKind::Put, 1_000_000, W * USD),
    ];
    let ids: Vec<String> = cases
        .iter()
        .map(|(kind, strike, _)| {
            let id = create(&mut c, *strike, W, *kind);
            write(&mut c, USDC_ASSET, W * USD, &id);
            id
        })
        .collect();
    let now = settle(&mut c, 120_000);
    for (id, (_, _, long_gets)) in ids.iter().zip(cases) {
        via_intents(&mut c, now, &[wrapped(id)], &[BTC], json!({"action": "exercise"}));
        assert_eq!(u(&calls("mt_transfer")[0].1["amount"]), long_gets);
        via_intents(
            &mut c,
            now,
            &[wrapped(&short(id))],
            &[BTC],
            json!({"action": "redeem"}),
        );
        let redeemed: u128 = calls("mt_transfer").iter().map(|(_, a)| u(&a["amount"])).sum();
        assert_eq!(redeemed, W * USD - long_gets);
        assert_eq!(locked(&c, id), 0);
    }
}

#[test]
#[should_panic(expected = "expiry not on the expiry grid")]
fn create_series_rejects_off_hour_expiry() {
    let mut c = setup();
    ctx(alice(), T0, 10u128.pow(24));
    c.create_series(
        "BTC".into(),
        U128(100_000 * USD),
        U128(W * USD),
        EXPIRY + 60,
        OptionKind::Call,
    );
}

#[test]
#[should_panic(expected = "series exists")]
fn create_series_rejects_duplicate() {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    create(&mut c, 110_000, W, OptionKind::Call);
}

#[test]
#[should_panic(expected = "attach at least")]
fn create_series_requires_storage_deposit() {
    let mut c = setup();
    ctx(alice(), T0, 0);
    c.create_series(
        "BTC".into(),
        U128(100_000 * USD),
        U128(W * USD),
        EXPIRY,
        OptionKind::Call,
    );
}

#[test]
fn write_delivers_long_and_short_into_intents() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    assert_eq!(write(&mut c, USDC_ASSET, W * USD / 2, &id), 0);
    assert_eq!(bal(&c, intents(), &id), BTC / 2);
    assert_eq!(bal(&c, intents(), &short(&id)), BTC / 2);
    assert_eq!(bal(&c, me(), &id), 0);
    assert_eq!(locked(&c, &id), W * USD / 2);
    assert_eq!(c.mt_supply(id.clone()).unwrap().0, BTC / 2);

    let deposits = calls("mt_on_transfer");
    assert_eq!(deposits.len(), 1);
    assert_eq!(deposits[0].0, intents());
    assert_eq!(deposits[0].1["msg"], "alice.near");
    assert_eq!(deposits[0].1["token_ids"], json!([id, short(&id)]));
}

#[test]
fn write_put_returns_rounding_remainder() {
    let mut c = setup();
    let id = create(&mut c, 95_000, W, OptionKind::Put);
    assert_eq!(write(&mut c, USDC_ASSET, W * USD + 99, &id), 99);
    assert_eq!(bal(&c, intents(), &id), BTC);
    assert_eq!(locked(&c, &id), W * USD);
}

#[test]
#[should_panic(expected = "writes take nep141:usdc.near as collateral")]
fn write_with_the_underlying_panics() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, BTC_ASSET, BTC, &id);
}

#[test]
#[should_panic(expected = "only intents.near")]
fn only_intents_can_deliver() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    ctx(acc("usdc.near"), T0, 0);
    let msg = json!({"action": "write", "series_id": id}).to_string();
    let _ = c.mt_on_transfer(
        alice(),
        vec![alice()],
        vec![USDC_ASSET.into()],
        vec![U128(W * USD)],
        msg,
    );
}

#[test]
#[should_panic(expected = "amount below minimum")]
fn write_below_minimum_panics() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, 99, &id);
}

#[test]
#[should_panic(expected = "paused")]
fn paused_blocks_writes() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    ctx(owner(), T0, 1);
    c.set_paused(true);
    write(&mut c, USDC_ASSET, W * USD, &id);
}

#[test]
#[should_panic(expected = "bad msg")]
fn garbage_msg_panics() {
    let mut c = setup();
    via_intents(
        &mut c,
        T0,
        &[USDC_ASSET.into()],
        &[USD],
        json!({"action": "steal"}),
    );
}

#[test]
#[should_panic(expected = "write takes one collateral token")]
fn write_rejects_batches() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    let msg = json!({"action": "write", "series_id": id});
    via_intents(
        &mut c,
        T0,
        &[BTC_ASSET.into(), USDC_ASSET.into()],
        &[BTC, USD],
        msg,
    );
}

#[test]
fn burn_pair_via_intents_before_expiry() {
    let mut c = setup();
    let id = create(&mut c, 95_000, W, OptionKind::Put);
    write(&mut c, USDC_ASSET, W * USD, &id);
    let tokens = [wrapped(&id), wrapped(&short(&id))];
    let unused = via_intents(
        &mut c,
        T0,
        &tokens,
        &[BTC / 4, BTC / 4],
        json!({"action": "burn_pair"}),
    );
    assert_eq!(unused, vec![0, 0]);
    assert_eq!(locked(&c, &id), W * USD * 3 / 4);

    let payouts = calls("mt_transfer");
    assert_eq!(payouts.len(), 1);
    assert_eq!(payouts[0].0, intents());
    assert_eq!(payouts[0].1["receiver_id"], "alice.near");
    assert_eq!(payouts[0].1["token_id"], USDC_ASSET);
    assert_eq!(u(&payouts[0].1["amount"]), W * USD / 4);
}

#[test]
#[should_panic(expected = "not settled yet")]
fn exercise_waits_for_dispute_window() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    settle(&mut c, 125_000);
    via_intents(
        &mut c,
        EXPIRY + 120,
        &[wrapped(&id)],
        &[BTC],
        json!({"action": "exercise"}),
    );
}

#[test]
fn exercise_and_redeem_via_intents_after_settlement() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    let now = settle(&mut c, 116_000);

    via_intents(
        &mut c,
        now,
        &[wrapped(&id)],
        &[BTC],
        json!({"action": "exercise"}),
    );
    assert_eq!(locked(&c, &id), 4_000 * USD);
    assert_eq!(u(&calls("mt_transfer")[0].1["amount"]), 6_000 * USD);

    via_intents(
        &mut c,
        now,
        &[wrapped(&short(&id))],
        &[BTC],
        json!({"action": "redeem"}),
    );
    assert_eq!(locked(&c, &id), 0);
    assert_eq!(u(&calls("mt_transfer")[0].1["amount"]), 4_000 * USD);
}

#[test]
fn closing_an_up_and_a_down_pays_one_usdc_total_and_debits_each_series() {
    let mut c = setup();
    let up = create(&mut c, 110_000, W, OptionKind::Call);
    let down = create(&mut c, 125_000, W, OptionKind::Put);
    write(&mut c, USDC_ASSET, W * USD, &up);
    write(&mut c, USDC_ASSET, W * USD, &down);
    let now = settle(&mut c, 116_000);
    via_intents(
        &mut c,
        now,
        &[wrapped(&up), wrapped(&down)],
        &[BTC, BTC],
        json!({"action": "exercise"}),
    );
    let payouts = calls("mt_transfer");
    assert_eq!(payouts.len(), 1);
    assert_eq!(payouts[0].1["token_id"], USDC_ASSET);
    assert_eq!(u(&payouts[0].1["amount"]), 15_000 * USD);
    assert_eq!(locked(&c, &up), 4_000 * USD);
    assert_eq!(locked(&c, &down), 1_000 * USD);
}

#[test]
fn close_events_report_one_usdc_payout_under_endline_1_0_0() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    let now = settle(&mut c, 116_000);
    via_intents(
        &mut c,
        now,
        &[wrapped(&id)],
        &[BTC],
        json!({"action": "exercise"}),
    );
    let event = get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str::<Value>(j).unwrap())
        .find(|e| e["standard"] == "endline" && e["event"] == "exercise")
        .unwrap();
    assert_eq!(event["version"], "1.0.0");
    assert_eq!(u(&event["data"]["payout"]), 6_000 * USD);
}

#[test]
fn otm_exercise_pays_nothing() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    let now = settle(&mut c, 100_000);
    via_intents(
        &mut c,
        now,
        &[wrapped(&id)],
        &[BTC],
        json!({"action": "exercise"}),
    );
    assert!(calls("mt_transfer").is_empty());
    assert_eq!(locked(&c, &id), W * USD);
}

#[test]
#[should_panic(expected = "cannot be used for Exercise")]
fn cannot_exercise_short() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    let now = settle(&mut c, 125_000);
    via_intents(
        &mut c,
        now,
        &[wrapped(&short(&id))],
        &[BTC],
        json!({"action": "exercise"}),
    );
}

#[test]
#[should_panic(expected = "is not an option token")]
fn close_rejects_foreign_tokens() {
    let mut c = setup();
    via_intents(
        &mut c,
        T0,
        &[BTC_ASSET.into()],
        &[BTC],
        json!({"action": "exercise"}),
    );
}

#[test]
fn ledger_holder_exercises_directly() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    ctx(intents(), T0, 1);
    c.mt_transfer(alice(), id.clone(), U128(BTC), None, None);

    let now = settle(&mut c, 116_000);
    ctx(alice(), now, 1);
    c.exercise(id.clone(), U128(BTC));
    assert_eq!(bal(&c, alice(), &id), 0);
    assert_eq!(c.mt_supply(id.clone()).unwrap().0, 0);
    assert_eq!(locked(&c, &id), 4_000 * USD);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn ledger_close_needs_balance() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    ctx(alice(), T0, 1);
    c.burn_pair(id, U128(BTC));
}

#[test]
fn only_failed_payout_becomes_claimable() {
    let mut c = setup();
    callback_ctx(T0, PromiseResult::Successful(vec![]));
    c.on_payout(alice(), USDC_ASSET.into(), U128(500));
    assert_eq!(c.get_claimable(alice(), USDC_ASSET.into()).0, 0);

    callback_ctx(T0, PromiseResult::Failed);
    c.on_payout(alice(), USDC_ASSET.into(), U128(500));
    assert_eq!(c.get_claimable(alice(), USDC_ASSET.into()).0, 500);
    let event: Value = serde_json::from_str(get_logs()[0].strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(event["event"], "payout_failed");
    assert_eq!(
        event["data"],
        json!({"owner_id": "alice.near", "asset": USDC_ASSET, "amount": "500"})
    );

    ctx(acc("bob.near"), T0, 1);
    c.withdraw_claimable(alice(), USDC_ASSET.into());
    assert_eq!(c.get_claimable(alice(), USDC_ASSET.into()).0, 0);
    let (receiver, args) = &calls("mt_transfer")[0];
    assert_eq!(
        (receiver, &args["receiver_id"], u(&args["amount"])),
        (&intents(), &json!("alice.near"), 500)
    );
    assert_eq!(args["memo"], "endline payout");
    panics_with("nothing claimable", || {
        c.withdraw_claimable(alice(), USDC_ASSET.into())
    });
}

#[test]
fn rejected_delivery_returns_options_to_owner_on_ledger() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    callback_ctx(T0, PromiseResult::Failed);
    c.on_options_delivered(alice(), vec![id.clone(), short(&id)], vec![U128(BTC), U128(BTC)]);
    assert_eq!(bal(&c, intents(), &id), 0);
    assert_eq!(bal(&c, alice(), &id), BTC);
    assert_eq!(bal(&c, alice(), &short(&id)), BTC);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn proposals_need_one_yocto() {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    ctx(oracle(), MANUAL_AT, 0);
    c.propose_settlement("BTC".into(), EXPIRY, U128(1));
}

#[test]
#[should_panic(expected = "only oracle")]
fn only_oracle_can_propose() {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    ctx(alice(), MANUAL_AT, 1);
    c.propose_settlement("BTC".into(), EXPIRY, U128(1));
}

#[test]
#[should_panic(expected = "no series at this expiry")]
fn cannot_settle_an_expiry_without_series() {
    let mut c = setup();
    ctx(oracle(), MANUAL_AT + DAY, 1);
    c.propose_settlement("BTC".into(), EXPIRY + DAY, U128(1));
}

#[test]
#[should_panic(expected = "already proposed")]
fn cannot_propose_twice() {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    ctx(oracle(), MANUAL_AT, 1);
    c.propose_settlement("BTC".into(), EXPIRY, U128(1));
    c.propose_settlement("BTC".into(), EXPIRY, U128(2));
}

#[test]
fn override_cannot_extend_the_window() {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    ctx(oracle(), MANUAL_AT, 1);
    c.propose_settlement("BTC".into(), EXPIRY, U128(1));
    ctx(owner(), MANUAL_AT + 100, 1);
    c.override_settlement("BTC".into(), EXPIRY, U128(120_000 * USD));
    let s = c.get_settlement("BTC".into(), EXPIRY).unwrap();
    assert_eq!(s.price.0, 120_000 * USD);
    assert_eq!(s.final_at, MANUAL_AT + 3_600);
}

#[test]
#[should_panic(expected = "settlement already final")]
fn override_after_final_rejected() {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    ctx(oracle(), MANUAL_AT, 1);
    c.propose_settlement("BTC".into(), EXPIRY, U128(1));
    ctx(owner(), MANUAL_AT + 3_600, 1);
    c.override_settlement("BTC".into(), EXPIRY, U128(2));
}

#[test]
fn successful_delivery_never_refunds_even_with_odd_result() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    callback_ctx(T0, PromiseResult::Successful(b"\"not a vec\"".to_vec()));
    c.on_options_delivered(alice(), vec![id.clone(), short(&id)], vec![U128(BTC), U128(BTC)]);
    assert_eq!(bal(&c, alice(), &id), 0);
    assert_eq!(bal(&c, intents(), &id), BTC);
}

#[test]
fn burn_pair_via_intents_accepts_any_order() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    let tokens = [wrapped(&short(&id)), wrapped(&id)];
    via_intents(&mut c, T0, &tokens, &[BTC, BTC], json!({"action": "burn_pair"}));
    assert_eq!(locked(&c, &id), 0);
}

#[test]
fn burn_pair_rejects_mismatched_tokens() {
    let mut c = setup();
    let a = create(&mut c, 110_000, W, OptionKind::Call);
    let b = create(&mut c, 120_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &a);
    write(&mut c, USDC_ASSET, W * USD, &b);
    let cases = [
        ([wrapped(&a), wrapped(&short(&b))], [BTC, BTC]),
        ([wrapped(&a), wrapped(&short(&a))], [BTC, 1]),
    ];
    for (tokens, amounts) in cases {
        panics_with("one long and one short of the same series", || {
            via_intents(&mut c, T0, &tokens, &amounts, json!({"action": "burn_pair"}));
        });
    }
    assert_eq!(locked(&c, &a), W * USD);
}

#[test]
fn dispute_window_is_bounded_at_deploy() {
    for window in [0, 59, 86_401] {
        ctx(owner(), T0, 1);
        panics_with("dispute window out of range", || {
            Contract::new(
                owner(),
                intents(),
                USDC_ASSET.into(),
                6,
                window,
                ORACLE_DELAY,
                None,
            );
        });
    }
    for window in [60, 86_400] {
        Contract::new(
            owner(),
            intents(),
            USDC_ASSET.into(),
            6,
            window,
            ORACLE_DELAY,
            None,
        );
    }
}

#[test]
#[should_panic(expected = "use mt_transfer_call")]
fn plain_transfer_to_intents_rejected() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    ctx(intents(), T0, 1);
    c.mt_transfer(alice(), id.clone(), U128(BTC), None, None);
    ctx(alice(), T0, 1);
    c.mt_transfer(intents(), id, U128(BTC), None, None);
}

#[test]
#[should_panic(expected = "attach at least")]
fn ledger_transfer_to_new_account_pays_storage() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    ctx(intents(), T0, 1);
    c.mt_transfer(alice(), id.clone(), U128(BTC), None, None);
    ctx(alice(), T0, 1);
    c.mt_transfer(acc("bob.near"), id, U128(1), None, None);
}

#[test]
fn ledger_transfer_with_storage_deposit_succeeds() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    ctx(intents(), T0, 1);
    c.mt_transfer(alice(), id.clone(), U128(BTC), None, None);
    ctx(alice(), T0, 10u128.pow(22));
    c.mt_transfer(acc("bob.near"), id.clone(), U128(1), None, None);
    assert_eq!(bal(&c, acc("bob.near"), &id), 1);
}

#[test]
#[should_panic(expected = "batch size")]
fn ledger_batches_are_capped() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    ctx(intents(), T0, 1);
    c.mt_batch_transfer(alice(), vec![id; 11], vec![U128(1); 11], None, None);
}

#[test]
fn the_first_write_adds_no_storage_the_contract_pays_for() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Put);
    ctx(intents(), T0, 0);
    let before = near_sdk::env::storage_usage();
    c.mt_on_transfer(
        alice(),
        vec![alice()],
        vec![USDC_ASSET.into()],
        vec![U128(W * USD)],
        json!({"action": "write", "series_id": id}).to_string(),
    );
    c.balances.flush();
    c.supply.flush();
    c.series.flush();
    assert_eq!(near_sdk::env::storage_usage(), before);
    assert_eq!(bal(&c, intents(), &short(&id)), BTC);
}

#[test]
fn deposits_to_intents_take_only_a_plain_msg() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    ctx(intents(), T0, 1);
    c.mt_transfer(alice(), id.clone(), U128(BTC), None, None);
    ctx(alice(), T0, DEPOSIT);
    let execute =
        json!({"receiver_id": "alice.near", "execute_intents": [], "refund_if_fails": true}).to_string();
    panics_with("deposits to intents take an empty msg or an account id", || {
        let _ = c.mt_transfer_call(intents(), id.clone(), U128(BTC), None, None, execute);
    });
    assert_eq!(bal(&c, alice(), &id), BTC);
    for msg in ["", "bob.near"] {
        let _ = c.mt_transfer_call(intents(), id.clone(), U128(1), None, None, msg.into());
    }
    let msgs: Vec<Value> = calls("mt_on_transfer")
        .into_iter()
        .map(|(_, args)| args["msg"].clone())
        .collect();
    assert_eq!(msgs, [json!(""), json!("bob.near")]);
}

#[test]
fn resolve_refunds_what_the_receiver_leaves_unused_up_to_its_balance() {
    let mut c = setup();
    let id = create(&mut c, 110_000, W, OptionKind::Call);
    write(&mut c, USDC_ASSET, W * USD, &id);
    ctx(intents(), T0, 1);
    c.mt_transfer(acc("bob.near"), id.clone(), U128(1_000), None, None);
    let mut resolve = |receiver: AccountId, result: PromiseResult, amount: u128| {
        callback_ctx(T0, result);
        c.mt_resolve_transfer(vec![alice()], receiver, vec![id.clone()], vec![U128(amount)])[0].0
    };
    let unused = |amount: &str| PromiseResult::Successful(format!("[\"{amount}\"]").into_bytes());
    let unreadable = || PromiseResult::Successful(b"\"not a vec\"".to_vec());
    assert_eq!(resolve(intents(), unused("0"), 100), 100);
    assert_eq!(resolve(intents(), unused("40"), 100), 60);
    assert_eq!(resolve(intents(), unused("500"), 100), 0);
    assert_eq!(resolve(intents(), unreadable(), 100), 100);
    assert_eq!(
        resolve(intents(), PromiseResult::Successful(vec![b' '; 5_000]), 100),
        100
    );
    assert_eq!(resolve(acc("bob.near"), unreadable(), 100), 0);
    assert_eq!(resolve(intents(), PromiseResult::Failed, 100), 0);
    assert_eq!(resolve(intents(), PromiseResult::Failed, 2 * BTC), BTC + 1_240);
    assert_eq!(bal(&c, intents(), &id), 0);
    assert_eq!(bal(&c, acc("bob.near"), &id), 900);
    assert_eq!(bal(&c, alice(), &id), BTC - 900);
}

const WASM_HASH: &str = "657824b723cd9d039226b4c8e67a238c337cbccf6bdbb3af9e18f6d12c0b9ad0";
const SETTLE_AT: u64 = EXPIRY + 300;
const DEPOSIT: u128 = 10u128.pow(22);

fn with_oracle_wasm() -> Contract {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    ctx(owner(), T0, 1);
    c.set_oracle_wasm(OracleWasm {
        outlayer_id: acc("outlayer.near"),
        url: "https://main.fastfs.io/oracle.wasm".into(),
        sha256: WASM_HASH.into(),
    });
    c
}

fn request(c: &mut Contract, now: u64, deposit: u128) {
    ctx(alice(), now, deposit);
    let _ = c.request_settlement("BTC".into(), EXPIRY);
}

fn fixing(index: &str, expiry: u64, price: &str) -> PromiseResult {
    let body =
        json!({"ok": true, "index": index, "expiry": expiry, "price": price, "source": "deribit_delivery"});
    PromiseResult::Successful(body.to_string().into_bytes())
}

fn deliver_fixing(c: &mut Contract, requested_at: u64, result: PromiseResult) -> bool {
    callback_ctx(requested_at + 30, result);
    c.on_settlement_result("BTC".into(), EXPIRY, acc("outlayer.near"), requested_at)
}

#[test]
fn request_matches_outlayer_contract_shape() {
    let mut c = with_oracle_wasm();
    request(&mut c, SETTLE_AT, DEPOSIT);
    let requests = calls("request_execution");
    assert_eq!(requests.len(), 1);
    let (receiver, args) = &requests[0];
    assert_eq!(receiver, &acc("outlayer.near"));
    assert_eq!(
        args["source"],
        json!({"WasmUrl": {"url": "https://main.fastfs.io/oracle.wasm", "hash": WASM_HASH, "build_target": "wasm32-wasip2"}})
    );
    let limits = &args["resource_limits"];
    assert!(limits["max_instructions"].as_u64().unwrap() <= 500_000_000_000);
    assert!(limits["max_memory_mb"].as_u64().unwrap() <= 4_096);
    assert!(limits["max_execution_seconds"].as_u64().unwrap() <= 180);
    assert_eq!(args["response_format"], "Json");
    assert_eq!(args["payer_account_id"], "alice.near");
    let input: Value = serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
    assert_eq!(
        input,
        json!({"index": "btc_usd", "expiry": EXPIRY, "quote_decimals": 6, "max_dev_bps": 20})
    );
    let callback = calls("on_settlement_result");
    assert_eq!(callback[0].1["requested_at"], SETTLE_AT);
}

#[test]
fn requests_need_the_full_gas_so_outlayer_cannot_fail_cheaply() {
    let mut c = with_oracle_wasm();
    let send_with = |tgas: u64| {
        let mut context = context(alice(), SETTLE_AT, DEPOSIT);
        context.prepaid_gas = near_sdk::Gas::from_tgas(tgas);
        testing_env!(context);
    };
    send_with(299);
    panics_with("send with at least 300 TGas", || {
        let _ = c.request_settlement("BTC".into(), EXPIRY);
    });
    send_with(300);
    let _ = c.request_settlement("BTC".into(), EXPIRY);
    assert_eq!(calls("request_execution").len(), 1);
}

#[test]
#[should_panic(expected = "too early to settle")]
fn request_one_second_too_early() {
    let mut c = with_oracle_wasm();
    request(&mut c, SETTLE_AT - 1, DEPOSIT);
}

#[test]
#[should_panic(expected = "oracle window closed")]
fn request_after_oracle_window() {
    let mut c = with_oracle_wasm();
    request(&mut c, MANUAL_AT, DEPOSIT);
}

#[test]
#[should_panic(expected = "no series at this expiry")]
fn request_for_unlisted_expiry() {
    let mut c = with_oracle_wasm();
    ctx(alice(), SETTLE_AT + DAY, DEPOSIT);
    let _ = c.request_settlement("BTC".into(), EXPIRY + DAY);
}

#[test]
#[should_panic(expected = "attach at least")]
fn request_one_yocto_short_of_deposit() {
    let mut c = with_oracle_wasm();
    request(&mut c, SETTLE_AT, DEPOSIT - 1);
}

#[test]
#[should_panic(expected = "settlement already requested")]
fn second_request_inside_timeout() {
    let mut c = with_oracle_wasm();
    request(&mut c, SETTLE_AT, DEPOSIT);
    request(&mut c, SETTLE_AT + 599, DEPOSIT);
}

#[test]
fn stale_request_can_be_retried_at_timeout() {
    let mut c = with_oracle_wasm();
    request(&mut c, SETTLE_AT, DEPOSIT);
    request(&mut c, SETTLE_AT + 600, DEPOSIT);
    assert_eq!(calls("request_execution").len(), 1);
}

#[test]
fn failed_result_releases_lock_for_retry() {
    let mut c = with_oracle_wasm();
    request(&mut c, SETTLE_AT, DEPOSIT);
    assert!(!deliver_fixing(&mut c, SETTLE_AT, PromiseResult::Failed));
    request(&mut c, SETTLE_AT + 31, DEPOSIT);
    assert_eq!(calls("request_execution").len(), 1);
}

#[test]
#[should_panic(expected = "settlement already requested")]
fn stale_callback_does_not_release_newer_lock() {
    let mut c = with_oracle_wasm();
    request(&mut c, SETTLE_AT, DEPOSIT);
    request(&mut c, SETTLE_AT + 600, DEPOSIT);
    assert!(!deliver_fixing(&mut c, SETTLE_AT, PromiseResult::Failed));
    request(&mut c, SETTLE_AT + 700, DEPOSIT);
}

#[test]
fn outlayer_fixing_becomes_proposal() {
    let mut c = with_oracle_wasm();
    assert!(deliver_fixing(
        &mut c,
        SETTLE_AT,
        fixing("btc_usd", EXPIRY, "81594540000")
    ));
    let s = c.get_settlement("BTC".into(), EXPIRY).unwrap();
    assert_eq!(s.price.0, 81_594_540_000);
    assert_eq!(s.source, "deribit_delivery");
    assert_eq!(s.proposed_by, acc("outlayer.near"));
    assert_eq!(s.final_at, SETTLE_AT + 30 + 3_600);
}

#[test]
fn unusable_fixings_are_rejected() {
    let huge = PromiseResult::Successful(vec![b' '; 4_096]);
    let not_ok = json!({"ok": false, "index": "btc_usd", "expiry": EXPIRY, "price": null, "source": "sources disagree"});
    let cases = [
        fixing("eth_usd", EXPIRY, "1"),
        fixing("btc_usd", EXPIRY + DAY, "1"),
        fixing("btc_usd", EXPIRY, "0"),
        fixing("btc_usd", EXPIRY, "-5"),
        fixing("btc_usd", EXPIRY, "1e9"),
        PromiseResult::Successful(b"null".to_vec()),
        PromiseResult::Successful(not_ok.to_string().into_bytes()),
        huge,
        PromiseResult::Failed,
    ];
    let mut c = with_oracle_wasm();
    for result in cases {
        assert!(!deliver_fixing(&mut c, SETTLE_AT, result));
        assert!(c.get_settlement("BTC".into(), EXPIRY).is_none());
    }
}

#[test]
fn late_fixing_never_replaces_existing_proposal() {
    let mut c = with_oracle_wasm();
    assert!(deliver_fixing(&mut c, SETTLE_AT, fixing("btc_usd", EXPIRY, "5")));
    assert!(!deliver_fixing(
        &mut c,
        SETTLE_AT + 700,
        fixing("btc_usd", EXPIRY, "81594540000")
    ));
    assert_eq!(c.get_settlement("BTC".into(), EXPIRY).unwrap().price.0, 5);
}

#[test]
fn oracle_wasm_config_is_validated() {
    let bad = [
        (
            WASM_HASH.to_uppercase(),
            "https://x.io/a.wasm",
            "sha256 must be 64 lowercase hex chars",
        ),
        (
            "abc".to_string(),
            "https://x.io/a.wasm",
            "sha256 must be 64 lowercase hex chars",
        ),
        (WASM_HASH.to_string(), "http://x.io/a.wasm", "url must be https"),
        (
            WASM_HASH.to_string(),
            "https://x.io/a b.wasm",
            "url must be https",
        ),
    ];
    let mut c = setup();
    for (sha256, url, expected) in bad {
        ctx(owner(), T0, 1);
        let wasm = OracleWasm {
            outlayer_id: acc("outlayer.near"),
            url: url.into(),
            sha256: sha256.clone(),
        };
        panics_with(expected, || c.set_oracle_wasm(wasm));
    }
    assert!(c.get_oracle_wasm().is_none());
}

const DEMO_TIMING: Timing = Timing {
    period_sec: 60,
    offset_sec: 0,
    write_cutoff_sec: 60,
    oracle_window_sec: 600,
    max_horizon_sec: 7 * DAY,
};

#[test]
fn demo_grid_write_cutoff_boundary() {
    let mut c = setup_with_timing(Some(DEMO_TIMING));
    let expiry = T0 + 600;
    ctx(alice(), T0, 10u128.pow(24));
    let id = c.create_series(
        "BTC".into(),
        U128(110_000 * USD),
        U128(W * USD),
        expiry,
        OptionKind::Call,
    );
    let msg = json!({"action": "write", "series_id": id});
    via_intents(&mut c, expiry - 61, &[USDC_ASSET.into()], &[W * USD], msg.clone());
    panics_with("writes closed for this series", || {
        via_intents(&mut c, expiry - 60, &[USDC_ASSET.into()], &[W * USD], msg);
    });
    assert_eq!(locked(&c, &id), W * USD);
}

#[test]
fn invalid_timings_are_rejected() {
    let bad = [
        Timing {
            period_sec: 0,
            ..DEMO_TIMING
        },
        Timing {
            period_sec: 30,
            write_cutoff_sec: 0,
            ..DEMO_TIMING
        },
        Timing {
            period_sec: 7_000,
            ..DEMO_TIMING
        },
        Timing {
            offset_sec: 60,
            ..DEMO_TIMING
        },
        Timing {
            write_cutoff_sec: 61,
            ..DEMO_TIMING
        },
        Timing {
            oracle_window_sec: 300,
            ..DEMO_TIMING
        },
        Timing {
            max_horizon_sec: 59,
            ..DEMO_TIMING
        },
    ];
    for grid in bad {
        ctx(owner(), T0, 1);
        panics_with("invalid timing", || {
            Contract::new(
                owner(),
                intents(),
                USDC_ASSET.into(),
                6,
                3_600,
                ORACLE_DELAY,
                Some(grid),
            );
        });
    }
}

#[test]
fn demo_timing_opens_manual_settlement_at_its_oracle_window() {
    let mut c = setup_with_timing(Some(DEMO_TIMING));
    let expiry = T0 + ORACLE_DELAY;
    ctx(alice(), T0, 10u128.pow(24));
    c.create_series(
        "BTC".into(),
        U128(110_000 * USD),
        U128(W * USD),
        expiry,
        OptionKind::Call,
    );
    ctx(oracle(), expiry + 599, 1);
    panics_with("manual settlement not open yet", || {
        c.propose_settlement("BTC".into(), expiry, U128(1))
    });
    ctx(oracle(), expiry + 600, 1);
    c.propose_settlement("BTC".into(), expiry, U128(1));
    assert_eq!(
        c.get_settlement("BTC".into(), expiry).unwrap().final_at,
        expiry + 600 + 3_600
    );
}

fn evil_wasm() -> OracleWasm {
    OracleWasm {
        outlayer_id: acc("evil.near"),
        url: "https://evil.io/oracle.wasm".into(),
        sha256: "f".repeat(64),
    }
}

fn wasm_at(c: &Contract, now: u64) -> Option<AccountId> {
    ctx(alice(), now, 0);
    c.get_oracle_wasm().map(|w| w.outlayer_id)
}

#[test]
fn oracle_delay_is_bounded_at_deploy() {
    for delay in [0, 59, 7 * DAY + 1] {
        ctx(owner(), T0, 1);
        panics_with("oracle delay out of range", || {
            Contract::new(owner(), intents(), USDC_ASSET.into(), 6, 3_600, delay, None);
        });
    }
    for delay in [60, 7 * DAY] {
        Contract::new(owner(), intents(), USDC_ASSET.into(), 6, 3_600, delay, None);
    }
}

#[test]
fn new_oracle_can_propose_only_after_the_delay() {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    ctx(owner(), MANUAL_AT - ORACLE_DELAY + 1, 1);
    c.add_oracle(alice());
    ctx(alice(), MANUAL_AT, 1);
    panics_with("only oracle", || {
        c.propose_settlement("BTC".into(), EXPIRY, U128(1))
    });
    assert_eq!(c.get_oracles(), vec![oracle()]);
    assert_eq!(
        c.get_pending_oracle_changes().oracles,
        vec![(alice(), MANUAL_AT + 1)]
    );
    ctx(alice(), MANUAL_AT + 1, 1);
    assert!(c.get_pending_oracle_changes().oracles.is_empty());
    c.propose_settlement("BTC".into(), EXPIRY, U128(1));
    assert_eq!(c.get_oracles(), vec![oracle(), alice()]);
}

#[test]
fn re_adding_an_active_oracle_does_not_restart_its_delay() {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    ctx(owner(), MANUAL_AT - 1, 1);
    c.add_oracle(oracle());
    settle(&mut c, 80_000);
}

#[test]
fn removing_an_oracle_is_immediate_and_cancels_a_pending_one() {
    let mut c = setup();
    create(&mut c, 110_000, W, OptionKind::Call);
    ctx(owner(), MANUAL_AT - 10, 1);
    c.add_oracle(alice());
    ctx(owner(), MANUAL_AT - 5, 1);
    c.remove_oracle(alice());
    c.add_oracle(alice());
    ctx(owner(), MANUAL_AT, 1);
    c.remove_oracle(oracle());
    for (who, now) in [(oracle(), MANUAL_AT), (alice(), MANUAL_AT - 10 + ORACLE_DELAY)] {
        ctx(who, now, 1);
        panics_with("only oracle", || {
            c.propose_settlement("BTC".into(), EXPIRY, U128(1))
        });
    }
    ctx(alice(), MANUAL_AT - 5 + ORACLE_DELAY, 1);
    c.propose_settlement("BTC".into(), EXPIRY, U128(1));
}

#[test]
fn new_oracle_wasm_is_used_only_after_the_delay() {
    let mut c = with_oracle_wasm();
    ctx(owner(), SETTLE_AT - ORACLE_DELAY + 1, 1);
    c.set_oracle_wasm(evil_wasm());
    request(&mut c, SETTLE_AT, DEPOSIT);
    assert_eq!(calls("request_execution")[0].0, acc("outlayer.near"));
    let pending = c.get_pending_oracle_changes().oracle_wasm.unwrap();
    assert_eq!(
        (pending.oracle_wasm.outlayer_id, pending.active_at),
        (acc("evil.near"), SETTLE_AT + 1)
    );
    request(&mut c, SETTLE_AT + 600, DEPOSIT);
    assert_eq!(calls("request_execution")[0].0, acc("evil.near"));
    assert!(c.get_pending_oracle_changes().oracle_wasm.is_none());
}

#[test]
fn replacing_a_pending_wasm_restarts_the_delay() {
    let mut c = with_oracle_wasm();
    assert_eq!(wasm_at(&c, T0 + ORACLE_DELAY - 1), None);
    ctx(owner(), T0 + ORACLE_DELAY - 1, 1);
    c.set_oracle_wasm(evil_wasm());
    assert_eq!(wasm_at(&c, T0 + ORACLE_DELAY), None);
    assert_eq!(wasm_at(&c, T0 + 2 * ORACLE_DELAY - 1), Some(acc("evil.near")));
}

#[test]
fn the_active_wasm_stays_in_force_until_its_replacement_matures() {
    let mut c = with_oracle_wasm();
    ctx(owner(), T0 + ORACLE_DELAY, 1);
    c.set_oracle_wasm(evil_wasm());
    assert_eq!(wasm_at(&c, T0 + 2 * ORACLE_DELAY - 1), Some(acc("outlayer.near")));
    assert_eq!(wasm_at(&c, T0 + 2 * ORACLE_DELAY), Some(acc("evil.near")));
}

#[test]
fn ownership_moves_only_when_the_proposed_owner_accepts() {
    let mut c = setup();
    let dao = acc("ops.sputnik-dao.near");
    ctx(alice(), T0, 1);
    panics_with("only owner", || c.propose_owner(Some(alice())));
    ctx(owner(), T0, 1);
    c.propose_owner(Some(acc("typo.near")));
    c.propose_owner(None);
    assert_eq!(c.get_config().pending_owner_id, None);
    c.propose_owner(Some(dao.clone()));
    assert_eq!(c.get_config().pending_owner_id, Some(dao.clone()));
    for who in [acc("typo.near"), alice(), owner()] {
        ctx(who, T0, 1);
        panics_with("only the proposed owner", || c.accept_owner());
    }
    ctx(owner(), T0, 1);
    c.set_paused(true);
    ctx(dao.clone(), T0, 0);
    panics_with("1 yoctoNEAR", || c.accept_owner());
    ctx(dao.clone(), T0, 1);
    c.accept_owner();
    let config = c.get_config();
    assert_eq!((config.owner_id, config.pending_owner_id), (dao.clone(), None));
    ctx(owner(), T0, 1);
    panics_with("only owner", || c.set_paused(false));
    ctx(dao.clone(), T0, 1);
    panics_with("only the proposed owner", || c.accept_owner());
    c.set_paused(false);
}

fn list_at(c: &mut Contract, expiry: u64, strike_usd: u128, kind: OptionKind) -> (u64, String) {
    ctx(alice(), T0, 10u128.pow(24));
    (
        expiry,
        c.create_series("BTC".into(), U128(strike_usd * USD), U128(USD), expiry, kind),
    )
}

fn by_expiry(c: &Contract, from_expiry: u64, after_id: Option<&str>, limit: u32) -> Vec<(u64, String)> {
    c.list_series_by_expiry(from_expiry, after_id.map(String::from), Some(limit))
        .into_iter()
        .map(|s| (s.expiry, s.id))
        .collect()
}

fn walk(
    c: &mut Contract,
    from_expiry: u64,
    limit: u32,
    mut between_pages: impl FnMut(&mut Contract),
) -> Vec<(u64, String)> {
    let mut all: Vec<(u64, String)> = vec![];
    loop {
        let page = match all.last() {
            Some((expiry, id)) => by_expiry(c, *expiry, Some(id), limit),
            None => by_expiry(c, from_expiry, None, limit),
        };
        all.extend_from_slice(&page);
        if page.len() < limit as usize {
            return all;
        }
        between_pages(c);
    }
}

#[test]
fn series_by_expiry_orders_by_expiry_then_id_from_an_inclusive_bound() {
    let mut c = setup();
    let mut listed = vec![
        list_at(&mut c, EXPIRY + 2 * DAY, 100_000, OptionKind::Call),
        list_at(&mut c, EXPIRY, 120_000, OptionKind::Put),
        list_at(&mut c, EXPIRY + DAY, 90_000, OptionKind::Call),
        list_at(&mut c, EXPIRY, 90_000, OptionKind::Call),
        list_at(&mut c, EXPIRY, 100_000, OptionKind::Call),
    ];
    listed.sort();
    assert_eq!(by_expiry(&c, 0, None, 200), listed);
    assert_eq!(by_expiry(&c, EXPIRY, None, 200), listed);
    assert_eq!(by_expiry(&c, EXPIRY + 1, None, 200), listed[3..]);
    assert_eq!(by_expiry(&c, EXPIRY + DAY, None, 200), listed[3..]);
    assert_eq!(by_expiry(&c, EXPIRY + 2 * DAY, None, 200), listed[4..]);
    assert_eq!(by_expiry(&c, EXPIRY + 2 * DAY + 1, None, 200), []);
    assert_eq!(by_expiry(&c, EXPIRY, Some(&listed[2].1), 200), listed[3..]);
    assert_eq!(by_expiry(&c, EXPIRY + DAY, Some(&listed[3].1), 200), listed[4..]);
    assert_eq!(by_expiry(&c, EXPIRY + 2 * DAY, Some(&listed[4].1), 200), []);
    assert_eq!(by_expiry(&c, EXPIRY, Some("BTC-"), 200), listed);
    assert_eq!(by_expiry(&c, EXPIRY, Some("~"), 200), listed[3..]);
    assert_eq!(by_expiry(&c, EXPIRY, None, 0), []);
}

#[test]
fn series_by_expiry_pages_through_many_series_without_gaps_or_repeats() {
    let mut c = setup();
    let mut listed = vec![];
    for strike in 1..=90 {
        for expiry in [EXPIRY + DAY, EXPIRY, EXPIRY + 3 * DAY] {
            listed.push(list_at(&mut c, expiry, 1_000 * strike, OptionKind::Call));
        }
    }
    listed.sort();
    assert_eq!(c.list_series_by_expiry(0, None, None).len(), 50);
    assert_eq!(by_expiry(&c, 0, None, 1_000), listed[..200]);
    assert_eq!(walk(&mut c, 0, 200, |_| ()), listed);
    assert_eq!(walk(&mut c, 0, 7, |_| ()), listed);
    assert_eq!(walk(&mut c, EXPIRY + 1, 7, |_| ()), listed[90..]);
}

#[test]
fn series_listed_while_paging_never_repeat_or_hide_others() {
    let mut c = setup();
    let mut listed: Vec<_> = (1..=10)
        .map(|strike| list_at(&mut c, EXPIRY + DAY, 1_000 * strike, OptionKind::Call))
        .collect();
    listed.sort();
    let mut ahead = None;
    let seen = walk(&mut c, 0, 3, |c| {
        if ahead.is_none() {
            list_at(c, EXPIRY, 1_000, OptionKind::Put);
            ahead = Some(list_at(c, EXPIRY + 2 * DAY, 1_000, OptionKind::Put));
        }
    });
    listed.extend(ahead);
    assert_eq!(seen, listed);
}

#[test]
fn create_series_charges_for_its_expiry_index_entry() {
    let mut c = setup();
    let attached = 10u128.pow(24);
    ctx(alice(), T0, attached);
    let before = near_sdk::env::storage_usage();
    c.create_series(
        "BTC".into(),
        U128(100_000 * USD),
        U128(W * USD),
        EXPIRY,
        OptionKind::Call,
    );
    let refund = get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .find_map(|a| match a {
            MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        })
        .unwrap();
    c.series_by_expiry.flush();
    let used = (near_sdk::env::storage_usage() - before) as u128;
    assert_eq!(
        attached - refund,
        near_sdk::env::storage_byte_cost().as_yoctonear() * used
    );
}

#[test]
fn a_full_page_of_open_series_does_not_scan_expired_ones() {
    let mut c = setup();
    for strike in 1..=600 {
        list_at(&mut c, EXPIRY, 1_000 * strike, OptionKind::Put);
    }
    for strike in 1..=200 {
        list_at(&mut c, EXPIRY + DAY, 1_000 * strike, OptionKind::Call);
    }
    near_sdk::env::state_write(&c);
    ctx(alice(), T0, 0);
    let fresh: Contract = near_sdk::env::state_read().unwrap();
    assert_eq!(
        fresh.list_series_by_expiry(EXPIRY + 1, None, Some(200)).len(),
        200
    );
    let gas = near_sdk::env::used_gas().as_gas();
    assert!(gas < 80_000_000_000_000, "{gas}");
}
