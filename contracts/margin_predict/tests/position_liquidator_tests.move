#[test_only]
module margin_predict::position_liquidator_tests;

use std::unit_test::destroy;
use sui::coin::Coin;
use sui::sui::SUI;
use sui::test_scenario::{Self};
use margin_predict::margin_position::{Self, MarginPosition};
use margin_predict::position_liquidator;
use margin_predict::predict_fixture;
use margin_predict::test_quote::TEST_QUOTE;
use margin_predict::types;

const OWNER: address = @0xA1;
const KEEPER: address = @0xA2;
const REPORTER: address = @0xA3;
const NOT_KEEPER: address = @0xA4;

// === flag_for_liquidation ===

#[test, expected_failure(abort_code = 0)] // ENotLiquidatable
fun flag_for_liquidation_on_healthy_position_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let mut pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 100_000,
    );

    scenario.next_tx(REPORTER);
    position_liquidator::flag_for_liquidation(&mut pos, &predict, &oracle, &clock, scenario.ctx());

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun flag_for_liquidation_sets_soft_flag() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let mut pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 115_000,
    );

    scenario.next_tx(REPORTER);
    position_liquidator::flag_for_liquidation(&mut pos, &predict, &oracle, &clock, scenario.ctx());

    let flag = margin_position::liquidation_flag(&pos).borrow();
    assert!(types::flag_mode(flag) == types::liq_soft());
    assert!(types::flag_reporter(flag) == REPORTER);

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun flag_for_liquidation_sets_hard_flag() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let mut pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 130_000,
    );

    scenario.next_tx(REPORTER);
    position_liquidator::flag_for_liquidation(&mut pos, &predict, &oracle, &clock, scenario.ctx());

    let flag = margin_position::liquidation_flag(&pos).borrow();
    assert!(types::flag_mode(flag) == types::liq_hard());
    assert!(types::flag_reporter(flag) == REPORTER);

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test, expected_failure(abort_code = 2)] // EWrongStatus (health_factor)
fun flag_for_liquidation_on_pending_open_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (predict, oracle, cap, manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let mut pos = margin_position::new<TEST_QUOTE>(
        OWNER,
        object::id(&manager),
        12_000,
        market_key,
        sui::coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );

    scenario.next_tx(REPORTER);
    position_liquidator::flag_for_liquidation(&mut pos, &predict, &oracle, &clock, scenario.ctx());

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test, expected_failure(abort_code = 6)] // EAlreadyFlagged
fun flag_for_liquidation_twice_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let mut pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 115_000,
    );

    scenario.next_tx(REPORTER);
    position_liquidator::flag_for_liquidation(&mut pos, &predict, &oracle, &clock, scenario.ctx());
    position_liquidator::flag_for_liquidation(&mut pos, &predict, &oracle, &clock, scenario.ctx());

    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

// === execute_liquidation ===

#[test, expected_failure(abort_code = 7)] // ENotKeeper
fun execute_liquidation_requires_keeper() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let mut pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 115_000,
    );

    scenario.next_tx(REPORTER);
    position_liquidator::flag_for_liquidation(&mut pos, &predict, &oracle, &clock, scenario.ctx());

    scenario.next_tx(NOT_KEEPER);
    let proceeds = position_liquidator::execute_liquidation<TEST_QUOTE>(
        &mut pos, &mut predict, &mut manager, &oracle, &clock, scenario.ctx(),
    );

    destroy(proceeds);
    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test, expected_failure(abort_code = 1)] // ENoFlag
fun execute_liquidation_without_flag_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let mut pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 100_000,
    );

    scenario.next_tx(KEEPER);
    let proceeds = position_liquidator::execute_liquidation<TEST_QUOTE>(
        &mut pos, &mut predict, &mut manager, &oracle, &clock, scenario.ctx(),
    );

    destroy(proceeds);
    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun execute_liquidation_recovered_clears_flag_returns_zero() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    // Healthy position (hf > HF_SOFT_BPS) that was flagged anyway, e.g. the
    // market recovered between the flag and the keeper's execution.
    let mut pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 100_000,
    );
    margin_position::set_liquidation_flag(&mut pos, REPORTER, types::liq_soft(), &clock);

    scenario.next_tx(KEEPER);
    let proceeds = position_liquidator::execute_liquidation<TEST_QUOTE>(
        &mut pos, &mut predict, &mut manager, &oracle, &clock, scenario.ctx(),
    );

    assert!(proceeds.value() == 0);
    assert!(margin_position::liquidation_flag(&pos).is_none());
    assert!(margin_position::status(&pos) == margin_position::status_open());
    assert!(margin_position::margin_debt(&pos) == 100_000);

    proceeds.destroy_zero();
    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun execute_liquidation_soft_reduces_position() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let mut pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 115_000,
    );

    scenario.next_tx(REPORTER);
    position_liquidator::flag_for_liquidation(&mut pos, &predict, &oracle, &clock, scenario.ctx());

    scenario.next_tx(KEEPER);
    let manager_balance_before = manager.balance<TEST_QUOTE>();
    let proceeds = position_liquidator::execute_liquidation<TEST_QUOTE>(
        &mut pos, &mut predict, &mut manager, &oracle, &clock, scenario.ctx(),
    );

    // 25% closed, debt reduced by 25%, position stays open.
    assert!(margin_position::status(&pos) == margin_position::status_open());
    assert!(margin_position::liquidation_flag(&pos).is_none());
    assert!(margin_position::margin_debt(&pos) == 86_250);
    let snap = margin_position::position(&pos).borrow();
    assert!(types::snapshot_quantity(snap) == 75_000_000);

    // Manager balance is unaffected (redeem deposit + withdraw cancel out).
    assert!(manager.balance<TEST_QUOTE>() == manager_balance_before);
    assert!(proceeds.value() > 0);

    // The reporter received their 2% cut.
    scenario.next_tx(REPORTER);
    let reporter_cut: Coin<TEST_QUOTE> = scenario.take_from_address(REPORTER);
    assert!(reporter_cut.value() > 0);

    destroy(reporter_cut);
    destroy(proceeds);
    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun execute_liquidation_hard_closes_position() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 1_000_000_000);

    let mut pos = predict_fixture::open_position(
        &mut scenario, &mut predict, &mut manager, &oracle, &clock,
        market_key, OWNER, 100_000_000, 10_000_000, 130_000,
    );

    scenario.next_tx(REPORTER);
    position_liquidator::flag_for_liquidation(&mut pos, &predict, &oracle, &clock, scenario.ctx());
    let flag = margin_position::liquidation_flag(&pos).borrow();
    assert!(types::flag_mode(flag) == types::liq_hard());

    scenario.next_tx(KEEPER);
    let proceeds = position_liquidator::execute_liquidation<TEST_QUOTE>(
        &mut pos, &mut predict, &mut manager, &oracle, &clock, scenario.ctx(),
    );

    assert!(margin_position::status(&pos) == margin_position::status_liquidated());
    assert!(margin_position::position(&pos).is_none());
    assert!(margin_position::margin_debt(&pos) == 0);
    assert!(margin_position::margin_manager_id(&pos).is_none());
    assert!(margin_position::liquidation_flag(&pos).is_none());
    assert!(proceeds.value() > 0);

    scenario.next_tx(REPORTER);
    let reporter_cut: Coin<TEST_QUOTE> = scenario.take_from_address(REPORTER);
    assert!(reporter_cut.value() > 0);

    destroy(reporter_cut);
    destroy(proceeds);
    destroy(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}
