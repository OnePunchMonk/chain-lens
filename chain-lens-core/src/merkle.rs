/// Merkle tree computation and verification for Bitcoin blocks.

use sha2::{Digest, Sha256};

fn sha256d(data: &[u8]) -> [u8; 32] {
    let h1 = Sha256::digest(data);
    let h2 = Sha256::digest(&h1);
    h2.into()
}

/// Compute the Bitcoin merkle root from a list of txid bytes (each 32 bytes, internal byte order).
/// Uses the Bitcoin duplication rule on odd-length levels.
pub fn compute_merkle_root(txids: &[[u8; 32]]) -> [u8; 32] {
    if txids.is_empty() {
        return [0u8; 32];
    }
    if txids.len() == 1 {
        return txids[0];
    }

    let mut current: Vec<[u8; 32]> = txids.to_vec();
    while current.len() > 1 {
        let mut next: Vec<[u8; 32]> = Vec::new();
        let mut i = 0;
        while i < current.len() {
            let left = current[i];
            let right = if i + 1 < current.len() {
                current[i + 1]
            } else {
                current[i] // duplicate last element
            };
            let mut combined = [0u8; 64];
            combined[..32].copy_from_slice(&left);
            combined[32..].copy_from_slice(&right);
            next.push(sha256d(&combined));
            i += 2;
        }
        current = next;
    }
    current[0]
}
