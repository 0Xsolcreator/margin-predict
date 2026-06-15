/// Shared test fixture that wires up a minimal but functional DeepBook
/// Predict deployment: a `Predict` vault quoted in `TEST_QUOTE`, an
/// `OracleSVI` with a flat SVI surface over a single strike, and a
/// `PredictManager` owned by `keeper`.
#[test_only]
module margin_predict::predict_fixture;

use std::unit_test::destroy;
use sui::clock::{Self, Clock};
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self, Scenario};
use deepbook_predict::i64;
use deepbook_predict::market_key::{Self, MarketKey};
use deepbook_predict::oracle::{Self, OracleSVI, OracleSVICap};
use deepbook_predict::plp::{Self, PLP};
use deepbook_predict::predict::{Self, Predict};
use deepbook_predict::predict_manager::{Self, PredictManager};
use deepbook_predict::registry::{Self, Registry, AdminCap};
use margin_predict::margin_position::{Self, MarginPosition};
use margin_predict::test_quote::{Self, TEST_QUOTE};
use margin_predict::types;

// Strike grid: ticks of 10_000 starting at 10_000.
const MIN_STRIKE: u64 = 10_000;
const TICK_SIZE: u64 = 10_000;
/// Deep OTM strike relative to `FORWARD`, used by all test positions.
const STRIKE: u64 = 740_000;
const FORWARD: u64 = 100_000;
/// Far-future expiry; tests that need settlement fast-forward the clock past it.
const EXPIRY_MS: u64 = 10_000_000_000_000;
const START_TS: u64 = 1_000_000;
/// SVI `a` parameter (total variance = 1.0); all other SVI params are zero so
/// total variance is constant across strikes.
const SVI_A: u64 = 1_000_000_000;

public fun strike(): u64 { STRIKE }

public fun forward(): u64 { FORWARD }

public fun expiry_ms(): u64 { EXPIRY_MS }

public fun start_ts(): u64 { START_TS }

/// Sets up a `Predict`/`OracleSVI`/`PredictManager` trio and returns the live
/// objects plus a ready-to-use UP `MarketKey` at `STRIKE`. `keeper` becomes
/// the `PredictManager` owner. `lp_amount` (in `TEST_QUOTE` micro-units) is
/// supplied to the vault as LP liquidity before returning, if non-zero.
public fun setup(scenario: &mut Scenario, keeper: address, lp_amount: u64): (
    Predict,
    OracleSVI,
    OracleSVICap,
    PredictManager,
    Clock,
    MarketKey,
) {
    registry::init_for_testing(scenario.ctx());
    plp::init_for_testing(scenario.ctx());

    scenario.next_tx(keeper);

    let mut registry_obj = scenario.take_shared<Registry>();
    let admin_cap = scenario.take_from_sender<AdminCap>();
    let plp_treasury_cap = scenario.take_from_sender<coin::TreasuryCap<PLP>>();

    let currency = test_quote::create_currency(scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    clock.set_for_testing(START_TS);

    registry::create_predict<TEST_QUOTE>(
        &mut registry_obj,
        &admin_cap,
        &currency,
        plp_treasury_cap,
        &clock,
        scenario.ctx(),
    );
    destroy(currency);

    scenario.next_tx(keeper);

    let mut predict = scenario.take_shared<Predict>();
    let cap = registry::create_oracle_cap(&admin_cap, scenario.ctx());
    let oracle_id = registry::create_oracle(
        &mut registry_obj,
        &mut predict,
        &admin_cap,
        &cap,
        b"TEST".to_string(),
        EXPIRY_MS,
        MIN_STRIKE,
        TICK_SIZE,
        scenario.ctx(),
    );
    test_scenario::return_shared(registry_obj);
    predict::create_manager(scenario.ctx());

    scenario.next_tx(keeper);

    let mut oracle = scenario.take_shared<OracleSVI>();
    let manager = scenario.take_shared<PredictManager>();

    registry::register_oracle_cap(&mut oracle, &admin_cap, &cap);
    oracle::activate(&mut oracle, &cap, &clock);
    oracle::update_prices(&mut oracle, &cap, oracle::new_price_data(FORWARD, FORWARD), &clock);
    oracle::update_svi(
        &mut oracle,
        &cap,
        oracle::new_svi_params(SVI_A, 0, i64::zero(), i64::zero(), 0),
        &clock,
    );
    destroy(admin_cap);

    if (lp_amount > 0) {
        let lp_coin = coin::mint_for_testing<TEST_QUOTE>(lp_amount, scenario.ctx());
        let plp_coin = predict::supply<TEST_QUOTE>(&mut predict, lp_coin, &clock, scenario.ctx());
        destroy(plp_coin);
    };

    let market_key = market_key::up(oracle_id, EXPIRY_MS, STRIKE);

    (predict, oracle, cap, manager, clock, market_key)
}

/// Fast-forwards the clock past `expiry_ms()` and freezes the oracle's
/// settlement price at `settlement_spot`.
public fun settle(oracle: &mut OracleSVI, cap: &OracleSVICap, clock: &mut Clock, settlement_spot: u64) {
    clock.set_for_testing(EXPIRY_MS + 1);
    oracle::update_prices(oracle, cap, oracle::new_price_data(settlement_spot, settlement_spot), clock);
}

/// Deposits `collateral` into `manager`, mints `quantity` of `market_key`,
/// and returns an already-OPEN `MarginPosition<TEST_QUOTE>` with the given
/// `margin_debt`. Must be called while `scenario`'s sender is the
/// `PredictManager` owner (the `keeper` passed to `setup`).
public fun open_position(
    scenario: &mut Scenario,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    clock: &Clock,
    market_key: MarketKey,
    owner: address,
    quantity: u64,
    collateral: u64,
    margin_debt: u64,
): MarginPosition<TEST_QUOTE> {
    let collateral_coin = coin::mint_for_testing<TEST_QUOTE>(collateral, scenario.ctx());
    predict_manager::deposit<TEST_QUOTE>(manager, collateral_coin, scenario.ctx());
    predict::mint<TEST_QUOTE>(predict, manager, oracle, market_key, quantity, clock, scenario.ctx());

    let escrow = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
    let mut pos = margin_position::new<TEST_QUOTE>(
        owner,
        object::id(manager),
        12_000,
        market_key,
        escrow,
        clock,
        scenario.ctx(),
    );
    destroy(margin_position::take_escrow(&mut pos));
    let snapshot = types::new_snapshot(market_key, quantity, 12_000, clock.timestamp_ms());
    margin_position::confirm_open(&mut pos, snapshot, object::id(manager), margin_debt);
    pos
}

public fun teardown(
    predict: Predict,
    oracle: OracleSVI,
    cap: OracleSVICap,
    manager: PredictManager,
    clock: Clock,
    scenario: Scenario,
) {
    test_scenario::return_shared(predict);
    test_scenario::return_shared(oracle);
    test_scenario::return_shared(manager);
    destroy(cap);
    clock.destroy_for_testing();
    scenario.end();
}
