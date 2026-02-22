use serde::Serialize;
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

/// A node in the merkle tree for visualization.
#[derive(Debug, Serialize, Clone)]
pub struct MerkleNode {
    pub hash: String,
    pub duplicated: bool,
}

/// One level (layer) in the merkle tree.
#[derive(Debug, Serialize, Clone)]
pub struct MerkleLayer {
    pub nodes: Vec<MerkleNode>,
}

/// Full merkle tree with all intermediate layers (leaf → root).
#[derive(Debug, Serialize, Clone)]
pub struct MerkleTree {
    pub layers: Vec<MerkleLayer>,
    pub root: String,
}

/// Build the full merkle tree with all intermediate layers.
/// Returns layers from leaves (layer 0) up to root (last layer).
pub fn build_merkle_tree(txids: &[[u8; 32]]) -> MerkleTree {
    if txids.is_empty() {
        return MerkleTree {
            layers: vec![],
            root: hex::encode([0u8; 32].iter().rev().copied().collect::<Vec<u8>>()),
        };
    }

    let to_display_hex =
        |h: &[u8; 32]| -> String { hex::encode(h.iter().rev().copied().collect::<Vec<u8>>()) };

    let mut layers: Vec<MerkleLayer> = Vec::new();

    // Layer 0: leaves (txids)
    let layer0: Vec<MerkleNode> = txids
        .iter()
        .map(|t| MerkleNode {
            hash: to_display_hex(t),
            duplicated: false,
        })
        .collect();
    layers.push(MerkleLayer { nodes: layer0 });

    if txids.len() == 1 {
        let root = to_display_hex(&txids[0]);
        return MerkleTree { layers, root };
    }

    let mut current: Vec<[u8; 32]> = txids.to_vec();
    while current.len() > 1 {
        let mut next: Vec<[u8; 32]> = Vec::new();
        let mut next_nodes: Vec<MerkleNode> = Vec::new();
        let mut i = 0;
        while i < current.len() {
            let left = current[i];
            let (right, dup) = if i + 1 < current.len() {
                (current[i + 1], false)
            } else {
                (current[i], true) // duplicate last element
            };
            let mut combined = [0u8; 64];
            combined[..32].copy_from_slice(&left);
            combined[32..].copy_from_slice(&right);
            let parent = sha256d(&combined);
            next_nodes.push(MerkleNode {
                hash: to_display_hex(&parent),
                duplicated: dup,
            });
            next.push(parent);
            i += 2;
        }
        layers.push(MerkleLayer { nodes: next_nodes });
        current = next;
    }

    let root = to_display_hex(&current[0]);
    MerkleTree { layers, root }
}
