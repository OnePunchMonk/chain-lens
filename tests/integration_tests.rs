use chain_lens_core::parse_transaction_with_prevouts;
use chain_lens_core::parser::Prevout;

#[test]
fn invalid_hex_tx_returns_error() {
    let raw_tx = "zzzz"; // clearly invalid hex
    let prevouts: Vec<Prevout> = Vec::new();
    let result = parse_transaction_with_prevouts(raw_tx, &prevouts);
    assert!(result.is_err());
}

