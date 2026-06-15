/// Test-only quote currency (6 decimals) used to stand in for DBUSDC when
/// wiring up a `Predict` instance in integration tests.
#[test_only]
module margin_predict::test_quote;

use std::unit_test::destroy;
use sui::coin_registry;

public struct TEST_QUOTE has drop {}

/// Builds a `Currency<TEST_QUOTE>` with 6 decimals, discarding the
/// `TreasuryCap`/`MetadataCap` since the fixture only needs the `Currency`
/// reference to enable it as a quote asset on `Predict`.
public fun create_currency(ctx: &mut TxContext): coin_registry::Currency<TEST_QUOTE> {
    let (builder, treasury_cap) = coin_registry::new_currency_with_otw(
        TEST_QUOTE {},
        6,
        b"TQ".to_string(),
        b"Test Quote".to_string(),
        b"Test quote asset for margin_predict integration tests".to_string(),
        b"".to_string(),
        ctx,
    );
    let (currency, metadata_cap) = builder.finalize_unwrap_for_testing(ctx);
    destroy(treasury_cap);
    destroy(metadata_cap);
    currency
}
