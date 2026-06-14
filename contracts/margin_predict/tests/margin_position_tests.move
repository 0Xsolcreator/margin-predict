#[test_only]
module margin_predict::margin_position_tests;

use std::unit_test::destroy;
use sui::coin;
use sui::clock;
use sui::sui::SUI;
use deepbook_predict::market_key::{Self, MarketKey};
use margin_predict::types;
use margin_predict::margin_position::{Self, MarginPosition};

const OWNER: address = @0xA1;
const TIMEOUT_MS: u64 = 120_000;

fun dummy_market_key(): MarketKey {
    market_key::up(object::id_from_address(@0xB1), 1_000_000, 50_000)
}

fun new_position(
    ctx: &mut TxContext,
    clock: &clock::Clock,
    leverage_bps: u64,
    escrow: u64,
): MarginPosition<SUI> {
    margin_position::new<SUI>(
        OWNER,
        object::id_from_address(@0xC1),
        leverage_bps,
        dummy_market_key(),
        coin::mint_for_testing<SUI>(escrow, ctx),
        clock,
        ctx,
    )
}

#[test]
fun new_position_starts_pending_open() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let pos = new_position(&mut ctx, &clock, 12_000, 1_000_000);

    assert!(margin_position::owner(&pos) == OWNER);
    assert!(margin_position::status(&pos) == margin_position::status_pending_open());
    assert!(margin_position::escrow_value(&pos) == 1_000_000);
    assert!(margin_position::margin_debt(&pos) == 0);
    assert!(margin_position::margin_manager_id(&pos).is_none());
    assert!(margin_position::position(&pos).is_none());
    assert!(margin_position::liquidation_flag(&pos).is_none());

    let intent = margin_position::pending_intent(&pos).borrow();
    assert!(types::intent_kind(intent) == types::intent_kind_open());
    assert!(types::intent_leverage_bps(intent) == 12_000);

    destroy(pos);
    clock.destroy_for_testing();
}

#[test]
fun open_then_close_lifecycle() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let mut pos = new_position(&mut ctx, &clock, 12_000, 1_000_000);

    let escrow = margin_position::take_escrow(&mut pos);
    assert!(escrow.value() == 1_000_000);
    destroy(escrow);

    let snapshot = types::new_snapshot(dummy_market_key(), 5_000_000, 12_000, clock.timestamp_ms());
    margin_position::confirm_open(&mut pos, snapshot, object::id_from_address(@0xE1), 200_000);

    assert!(margin_position::status(&pos) == margin_position::status_open());
    assert!(margin_position::margin_debt(&pos) == 200_000);
    assert!(margin_position::margin_manager_id(&pos).is_some());
    assert!(margin_position::pending_intent(&pos).is_none());
    assert!(types::snapshot_quantity(margin_position::position(&pos).borrow()) == 5_000_000);

    margin_position::request_close(&mut pos, &clock);
    assert!(margin_position::pending_intent(&pos).is_some());

    margin_position::confirm_close(&mut pos);
    assert!(margin_position::status(&pos) == margin_position::status_closed());
    assert!(margin_position::position(&pos).is_none());
    assert!(margin_position::margin_debt(&pos) == 0);
    assert!(margin_position::margin_manager_id(&pos).is_none());

    destroy(pos);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 5)]
fun cancel_open_before_timeout_fails() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let mut pos = new_position(&mut ctx, &clock, 12_000, 1_000_000);

    let refund = margin_position::cancel_intent(&mut pos, TIMEOUT_MS, &clock, &mut ctx);
    destroy(refund);
    destroy(pos);
    clock.destroy_for_testing();
}

#[test]
fun cancel_open_after_timeout_refunds_escrow() {
    let mut ctx = tx_context::dummy();
    let mut clock = clock::create_for_testing(&mut ctx);
    let mut pos = new_position(&mut ctx, &clock, 12_000, 1_000_000);

    clock.increment_for_testing(TIMEOUT_MS);
    let refund = margin_position::cancel_intent(&mut pos, TIMEOUT_MS, &clock, &mut ctx);

    assert!(refund.value() == 1_000_000);
    assert!(margin_position::status(&pos) == margin_position::status_cancelled());
    assert!(margin_position::pending_intent(&pos).is_none());
    assert!(margin_position::escrow_value(&pos) == 0);

    destroy(refund);
    destroy(pos);
    clock.destroy_for_testing();
}

#[test]
fun cancel_close_returns_zero_and_stays_open() {
    let mut ctx = tx_context::dummy();
    let mut clock = clock::create_for_testing(&mut ctx);
    let mut pos = new_position(&mut ctx, &clock, 12_000, 1_000_000);

    let escrow = margin_position::take_escrow(&mut pos);
    destroy(escrow);
    let snapshot = types::new_snapshot(dummy_market_key(), 5_000_000, 12_000, clock.timestamp_ms());
    margin_position::confirm_open(&mut pos, snapshot, object::id_from_address(@0xE1), 200_000);

    margin_position::request_close(&mut pos, &clock);
    clock.increment_for_testing(TIMEOUT_MS);

    let refund = margin_position::cancel_intent(&mut pos, TIMEOUT_MS, &clock, &mut ctx);
    assert!(refund.value() == 0);
    assert!(margin_position::status(&pos) == margin_position::status_open());
    assert!(margin_position::pending_intent(&pos).is_none());

    refund.destroy_zero();
    destroy(pos);
    clock.destroy_for_testing();
}

#[test]
fun soft_then_hard_liquidation() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let mut pos = new_position(&mut ctx, &clock, 12_000, 1_000_000);

    let escrow = margin_position::take_escrow(&mut pos);
    destroy(escrow);
    let snapshot = types::new_snapshot(dummy_market_key(), 5_000_000, 12_000, clock.timestamp_ms());
    margin_position::confirm_open(&mut pos, snapshot, object::id_from_address(@0xE1), 200_000);

    margin_position::set_liquidation_flag(&mut pos, @0xD1, types::liq_soft(), &clock);
    assert!(margin_position::liquidation_flag(&pos).is_some());

    margin_position::apply_soft_liquidation(&mut pos, 3_750_000, 150_000);
    assert!(margin_position::status(&pos) == margin_position::status_open());
    assert!(margin_position::liquidation_flag(&pos).is_none());
    assert!(margin_position::margin_debt(&pos) == 150_000);
    let snap = margin_position::position(&pos).borrow();
    assert!(types::snapshot_quantity(snap) == 3_750_000);
    assert!(types::snapshot_market_key(snap) == dummy_market_key());

    margin_position::set_liquidation_flag(&mut pos, @0xD2, types::liq_hard(), &clock);
    margin_position::apply_hard_liquidation(&mut pos);
    assert!(margin_position::status(&pos) == margin_position::status_liquidated());
    assert!(margin_position::position(&pos).is_none());
    assert!(margin_position::margin_debt(&pos) == 0);
    assert!(margin_position::margin_manager_id(&pos).is_none());
    assert!(margin_position::liquidation_flag(&pos).is_none());

    destroy(pos);
    clock.destroy_for_testing();
}
