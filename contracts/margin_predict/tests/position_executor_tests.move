#[test_only]
module margin_predict::position_executor_tests;

use std::unit_test::destroy;
use sui::clock::Clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self, Scenario};
use deepbook_predict::market_key::MarketKey;
use deepbook_predict::oracle::OracleSVI;
use deepbook_predict::predict::Predict;
use deepbook_predict::predict_manager::PredictManager;
use margin_predict::margin_position::{Self, MarginPosition};
use margin_predict::position_executor;
use margin_predict::position_manager;
use margin_predict::predict_fixture;
use margin_predict::test_quote::TEST_QUOTE;
use margin_predict::types;

const OWNER: address = @0xA1;
const KEEPER: address = @0xA2;
const NOT_KEEPER: address = @0xA3;

/// Runs `request_open` -> `take_escrow` -> `deploy_position`, leaving the
/// scenario's sender as `KEEPER` and returning the now-OPEN shared position.
fun deploy(
    scenario: &mut Scenario,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    clock: &Clock,
    market_key: MarketKey,
): MarginPosition<TEST_QUOTE> {
    scenario.next_tx(OWNER);
    position_manager::request_open<TEST_QUOTE>(
        object::id(manager),
        12_000,
        market_key,
        coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        clock,
        scenario.ctx(),
    );

    scenario.next_tx(KEEPER);
    let mut pos = scenario.take_shared<MarginPosition<TEST_QUOTE>>();

    let escrow_coin = position_executor::take_escrow(&mut pos, manager, scenario.ctx());
    destroy(escrow_coin);

    let collateral = coin::mint_for_testing<TEST_QUOTE>(10_000_000, scenario.ctx());
    position_executor::deploy_position<TEST_QUOTE>(
        &mut pos,
        predict,
        manager,
        oracle,
        collateral,
        object::id_from_address(@0xCAFE),
        10_000_000,
        clock,
        scenario.ctx(),
    );

    pos
}

// === take_escrow ===

#[test]
fun take_escrow_returns_escrow_and_clears_it() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (predict, oracle, cap, manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    scenario.next_tx(OWNER);
    position_manager::request_open<TEST_QUOTE>(
        object::id(&manager),
        12_000,
        market_key,
        coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );

    scenario.next_tx(KEEPER);
    let mut pos = scenario.take_shared<MarginPosition<TEST_QUOTE>>();

    let escrow_coin = position_executor::take_escrow(&mut pos, &manager, scenario.ctx());
    assert!(escrow_coin.value() == 1_000_000);
    assert!(margin_position::escrow_value(&pos) == 0);
    assert!(margin_position::collateral_sui(&pos) == 1_000_000);

    destroy(escrow_coin);
    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test, expected_failure(abort_code = 7)] // ENotKeeper
fun take_escrow_not_keeper_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (predict, oracle, cap, manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    scenario.next_tx(OWNER);
    position_manager::request_open<TEST_QUOTE>(
        object::id(&manager),
        12_000,
        market_key,
        coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );

    scenario.next_tx(NOT_KEEPER);
    let mut pos = scenario.take_shared<MarginPosition<TEST_QUOTE>>();

    let escrow_coin = position_executor::take_escrow(&mut pos, &manager, scenario.ctx());

    destroy(escrow_coin);
    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test, expected_failure(abort_code = 3)] // ENoPendingIntent
fun take_escrow_after_deploy_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    let mut pos = deploy(&mut scenario, &mut predict, &mut manager, &oracle, &clock, market_key);

    // confirm_open already cleared the pending intent.
    let escrow_coin = position_executor::take_escrow(&mut pos, &manager, scenario.ctx());

    destroy(escrow_coin);
    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

// === deploy_position ===

#[test]
fun deploy_position_opens_position() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    let pos = deploy(&mut scenario, &mut predict, &mut manager, &oracle, &clock, market_key);

    assert!(margin_position::status(&pos) == margin_position::status_open());
    assert!(margin_position::margin_debt(&pos) == 10_000_000);
    assert!(margin_position::collateral_sui(&pos) == 1_000_000);
    assert!(margin_position::margin_manager_id(&pos) == option::some(object::id_from_address(@0xCAFE)));
    assert!(margin_position::pending_intent(&pos).is_none());

    let snap = margin_position::position(&pos).borrow();
    assert!(types::snapshot_quantity(snap) > 0);
    assert!(types::snapshot_market_key(snap) == market_key);
    assert!(types::snapshot_leverage_bps(snap) == 12_000);

    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test, expected_failure(abort_code = 7)] // ENotKeeper
fun deploy_position_not_keeper_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    scenario.next_tx(OWNER);
    position_manager::request_open<TEST_QUOTE>(
        object::id(&manager),
        12_000,
        market_key,
        coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );

    scenario.next_tx(NOT_KEEPER);
    let mut pos = scenario.take_shared<MarginPosition<TEST_QUOTE>>();

    let collateral = coin::mint_for_testing<TEST_QUOTE>(10_000_000, scenario.ctx());
    position_executor::deploy_position<TEST_QUOTE>(
        &mut pos,
        &mut predict,
        &mut manager,
        &oracle,
        collateral,
        object::id_from_address(@0xCAFE),
        100_000,
        &clock,
        scenario.ctx(),
    );

    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test, expected_failure(abort_code = 3)] // EInvalidMarginDebt
fun deploy_position_margin_debt_too_low_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    scenario.next_tx(OWNER);
    position_manager::request_open<TEST_QUOTE>(
        object::id(&manager),
        12_000,
        market_key,
        coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );

    scenario.next_tx(KEEPER);
    let mut pos = scenario.take_shared<MarginPosition<TEST_QUOTE>>();
    let escrow_coin = position_executor::take_escrow(&mut pos, &manager, scenario.ctx());
    destroy(escrow_coin);

    // < 90% of the 10_000_000 collateral, outside DEBT_TOLERANCE_BPS.
    let collateral = coin::mint_for_testing<TEST_QUOTE>(10_000_000, scenario.ctx());
    position_executor::deploy_position<TEST_QUOTE>(
        &mut pos,
        &mut predict,
        &mut manager,
        &oracle,
        collateral,
        object::id_from_address(@0xCAFE),
        8_000_000,
        &clock,
        scenario.ctx(),
    );

    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test, expected_failure(abort_code = 3)] // EInvalidMarginDebt
fun deploy_position_margin_debt_too_high_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    scenario.next_tx(OWNER);
    position_manager::request_open<TEST_QUOTE>(
        object::id(&manager),
        12_000,
        market_key,
        coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );

    scenario.next_tx(KEEPER);
    let mut pos = scenario.take_shared<MarginPosition<TEST_QUOTE>>();
    let escrow_coin = position_executor::take_escrow(&mut pos, &manager, scenario.ctx());
    destroy(escrow_coin);

    // > 110% of the 10_000_000 collateral, outside DEBT_TOLERANCE_BPS.
    let collateral = coin::mint_for_testing<TEST_QUOTE>(10_000_000, scenario.ctx());
    position_executor::deploy_position<TEST_QUOTE>(
        &mut pos,
        &mut predict,
        &mut manager,
        &oracle,
        collateral,
        object::id_from_address(@0xCAFE),
        12_000_000,
        &clock,
        scenario.ctx(),
    );

    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

// === execute_close ===

#[test, expected_failure(abort_code = 1)] // EWrongStatus
fun execute_close_before_open_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    scenario.next_tx(OWNER);
    position_manager::request_open<TEST_QUOTE>(
        object::id(&manager),
        12_000,
        market_key,
        coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );

    scenario.next_tx(KEEPER);
    let mut pos = scenario.take_shared<MarginPosition<TEST_QUOTE>>();

    let proceeds = position_executor::execute_close<TEST_QUOTE>(
        &mut pos, &mut predict, &mut manager, &oracle, &clock, scenario.ctx(),
    );

    destroy(proceeds);
    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun execute_close_returns_proceeds_and_closes() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    let mut pos = deploy(&mut scenario, &mut predict, &mut manager, &oracle, &clock, market_key);

    scenario.next_tx(OWNER);
    position_manager::request_close(&mut pos, &clock, scenario.ctx());

    scenario.next_tx(KEEPER);
    let proceeds = position_executor::execute_close<TEST_QUOTE>(
        &mut pos, &mut predict, &mut manager, &oracle, &clock, scenario.ctx(),
    );

    assert!(margin_position::status(&pos) == margin_position::status_closed());
    assert!(margin_position::position(&pos).is_none());
    assert!(margin_position::margin_debt(&pos) == 0);
    assert!(margin_position::margin_manager_id(&pos).is_none());
    assert!(margin_position::pending_intent(&pos).is_none());
    assert!(margin_position::collateral_sui(&pos) == 0);
    assert!(proceeds.value() > 0);

    destroy(proceeds);
    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

// === execute_settle ===

#[test, expected_failure(abort_code = 2)] // EOracleNotSettled
fun execute_settle_before_settlement_fails() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, oracle, cap, mut manager, clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    let mut pos = deploy(&mut scenario, &mut predict, &mut manager, &oracle, &clock, market_key);

    let proceeds = position_executor::execute_settle<TEST_QUOTE>(
        &mut pos, &mut predict, &mut manager, &oracle, &clock, scenario.ctx(),
    );

    destroy(proceeds);
    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}

#[test]
fun execute_settle_after_settlement_closes_position() {
    let mut scenario = test_scenario::begin(KEEPER);
    let (mut predict, mut oracle, cap, mut manager, mut clock, market_key) =
        predict_fixture::setup(&mut scenario, KEEPER, 100_000_000_000);

    let mut pos = deploy(&mut scenario, &mut predict, &mut manager, &oracle, &clock, market_key);

    // Settle far above the strike so the UP position is fully in the money.
    predict_fixture::settle(&mut oracle, &cap, &mut clock, predict_fixture::strike() + 100_000);

    let proceeds = position_executor::execute_settle<TEST_QUOTE>(
        &mut pos, &mut predict, &mut manager, &oracle, &clock, scenario.ctx(),
    );

    assert!(margin_position::status(&pos) == margin_position::status_closed());
    assert!(margin_position::position(&pos).is_none());
    assert!(margin_position::collateral_sui(&pos) == 0);
    assert!(proceeds.value() > 0);

    destroy(proceeds);
    test_scenario::return_shared(pos);
    predict_fixture::teardown(predict, oracle, cap, manager, clock, scenario);
}
