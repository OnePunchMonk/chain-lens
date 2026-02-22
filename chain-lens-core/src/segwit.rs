/// SegWit savings analysis (BIP141).
///
/// For SegWit transactions, computes the weight reduction versus
/// an equivalent legacy transaction.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SegwitSavings {
    pub witness_bytes: u64,
    pub non_witness_bytes: u64,
    pub total_bytes: u64,
    pub weight_actual: u64,
    pub weight_if_legacy: u64,
    pub savings_pct: f64,
}

/// Compute SegWit savings given the total tx size and the count of pure witness bytes.
///
/// `size_bytes` - total serialized transaction size (including witness data).
/// `witness_bytes` - sum of all witness item lengths (including their length varints),
///   NOT including the 2-byte marker+flag overhead.
///
/// Returns None if the transaction is not SegWit.
pub fn compute_segwit_savings(size_bytes: u64, witness_bytes: u64) -> Option<SegwitSavings> {
    if witness_bytes == 0 {
        return None;
    }


    // The 2-byte marker+flag are also witness overhead but belong to tx overhead, not witness data
    let witness_overhead = 2u64; // marker + flag bytes
    let non_witness_bytes = size_bytes.saturating_sub(witness_bytes + witness_overhead);

    // BIP141: weight = base_size * 3 + total_size
    //   where base_size = non-witness bytes (excludes marker/flag AND witness data)
    let weight_actual = non_witness_bytes * 3 + size_bytes;

    // Hypothetical legacy weight = everything * 4 (no discount)
    let weight_if_legacy = size_bytes * 4;

    let savings_pct = if weight_if_legacy > 0 {
        let raw = 100.0 * (1.0 - weight_actual as f64 / weight_if_legacy as f64);
        (raw * 100.0).round() / 100.0
    } else {
        0.0
    };

    Some(SegwitSavings {
        witness_bytes,        // just the witness stack bytes (no marker/flag)
        non_witness_bytes,
        total_bytes: size_bytes,
        weight_actual,
        weight_if_legacy,
        savings_pct,
    })
}
