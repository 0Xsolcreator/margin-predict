#[test_only]
module margin_predict::position_manager_tests;

use std::unit_test::destroy;
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self};
use deepbook_predict::market_key::{Self, MarketKey};
use margin_predict::margin_position::{Self, MarginPosition};
use margin_predict::position_manager;
use margin_predict::predict_fixture;
use margin_predict::test_quote::TEST_QUOTE;
use margin_predict::types;

const OWNER: address = @0xA1;
const KEEPER: address = @0xA2;
const HF_INFINITE: u64 = 18_446_744_073_709_551_615;

fun dummy_market_key(): MarketKey {
    market_key::up(object::id_from_address(@0xB1), 1_000_000, 50_000)
}

// === request_open ===

#[test, expected_failure(abort_code = 0)] // EZeroAmount
fun request_open_zero_amount_fails() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);

    position_manager::request_open<SUI>(
        object::id_from_address(@0xC1),
        12_000,
        dummy_market_key(),
        coin::mint_for_testing<SUI>(0, &mut ctx),
        &clock,
        &mut ctx,
    );

    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 1)] // EInvalidLeverage
fun request_open_leverage_too_low_fails() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);

    position_manager::request_open<SUI>(
        object::id_from_address(@0xC1),
        10_999,
        dummy_market_key(),
        coin::mint_for_testing<SUI>(1_000_000, &mut ctx),
        &clock,
        &mut ctx,
    );

    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 1)] // EInvalidLeverage
fun request_open_leverage_too_high_fails() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);

    position_manager::request_open<SUI>(
        object::id_from_address(@0xC1),
        14_001,
        dummy_market_key(),
        coin::mint_for_testing<SUI>(1_000_000, &mut ctx),
        &clock,
        &mut ctx,
    );

    clock.destroy_for_testing();
}

#[test]
fun request_open_creates_pending_position() {
    let mut scenario = test_scenario::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());

    position_manager::request_open<SUI>(
        object::id_from_address(@0xC1),
        12_000,
        dummy_market_key(),
        coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );

    scenario.next_tx(OWNER);
    let pos = scenario.take_shared<MarginPosition<SUI>>();

    assert!(margin_position::owner(&pos) == OWNER);
    assert!(margin_position::status(&pos) == margin_position::status_pending_open());
    assert!(margin_position::escrow_value(&pos) == 1_000_000);
    let intent = margin_position::pending_intent(&pos).borrow();
    assert!(types::intent_kind(intent) == types::intent_kind_open());
    assert!(types::intent_leverage_bps(intent) == 12_000);

    test_scenario::return_shared(pos);
    clock.destroy_for_testing();
    scenario.end();
}

// === request_close / cancel_intent ownership ===

#[test, expected_failure(abort_code = 0)] // ENotOwner
fun request_close_requires_owner() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let mut pos = margin_position::new<SUI>(
        OWNER,
        object::id_from_address(@0xC1),
        12_000,
        dummy_market_key(),
        coin::mint_for_testing<SUI>(1_000_000, &mut ctx),
        &clock,
        &mut ctx,
    );

    // ctx.sender() (dummy = @0x0) != OWNER
    position_manager::request_close(&mut pos, &clock, &ctx);

    destroy(pos);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0)] // ENotOwner
fun cancel_intent_requires_owner() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let mut pos = margin_position::new<SUI>(
        OWNER,
        object::id_from_address(@0xC1),
        12_000,
        dummy_market_key(),
        coin::mint_for_testing<SUI>(1_000_000, &mut ctx),
        &clock,
        &mut ctx,
    );

    let refund = position_manager::cancel_intent(&mut pos, &clock, &mut ctx);

    destroy(refund);
    destroy(pos);
    clock.destroy_for_testing();
}

// === health_factor ===

#[test, expected_failure(abort_code = 2)] // EWrongStatus
fun health_factor_on_pending_open_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (predict, oracle, cap, manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let pos = margin_position::new<TEST_QUOTE>(
        OWNER,
        object::id(&manager),
        12_000,
        market_key,
        coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );

    let _hf = position_manager::health_factor(&pos, &predict, &oracle, &clock);

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun health_factor_no_debt_is_infinite() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 0,
    );

    let hf = position_manager::health_factor(&pos, &predict, &oracle, &clock);
    assert!(hf == HF_INFINITE);

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun health_factor_healthy_above_soft_threshold() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    // mark_value for 100_000_000 qty is ~118_375; debt well below it.
    let pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 100_000,
    );

    let hf = position_manager::health_factor(&pos, &predict, &oracle, &clock);
    assert!(hf > 10_500);

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun health_factor_in_soft_liquidation_range() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 115_000,
    );

    let hf = position_manager::health_factor(&pos, &predict, &oracle, &clock);
    assert!(hf > 10_000 && hf <= 10_500);

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun health_factor_in_hard_liquidation_range() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 130_000,
    );

    let hf = position_manager::health_factor(&pos, &predict, &oracle, &clock);
    assert!(hf <= 10_000);

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}
