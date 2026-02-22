/// Bitcoin block parser for blk*.dat files.
///
/// Handles multiple blocks per file (Bitcoin Core's block file format),
/// XOR decoding, undo file integration, merkle root verification, 
/// coinbase detection, and BIP34 height decoding.

use sha2::{Digest, Sha256};
use serde::Serialize;
use std::collections::HashMap;

use crate::error::ChainLensError;
use crate::merkle::compute_merkle_root;
use crate::parser::{parse_transaction_inner, read_varint, Prevout};


const BLOCK_MAGIC: u32 = 0xD9B4BEF9; // mainnet magic bytes

fn sha256d(data: &[u8]) -> [u8; 32] {
    let h1 = Sha256::digest(data);
    let h2 = Sha256::digest(&h1);
    h2.into()
}

fn read_u32_le(bytes: &[u8], offset: &mut usize) -> Result<u32, ChainLensError> {
    if *offset + 4 > bytes.len() {
        return Err(ChainLensError::InvalidTx("block data truncated (u32)".into()));
    }
    let val = u32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
    *offset += 4;
    Ok(val)
}

fn read_bytes_n(bytes: &[u8], offset: &mut usize, n: usize) -> Result<Vec<u8>, ChainLensError> {
    if *offset + n > bytes.len() {
        return Err(ChainLensError::InvalidTx(format!(
            "block data truncated: need {} at offset {}",
            n, offset
        )));
    }
    let v = bytes[*offset..*offset + n].to_vec();
    *offset += n;
    Ok(v)
}

#[derive(Debug, Serialize)]
pub struct BlockHeader {
    pub version: i32,
    pub prev_block_hash: String,
    pub merkle_root: String,
    pub merkle_root_valid: bool,
    pub timestamp: u32,
    pub bits: String,
    pub nonce: u32,
    pub block_hash: String,
}

#[derive(Debug, Serialize)]
pub struct CoinbaseInfo {
    pub bip34_height: Option<u64>,
    pub coinbase_script_hex: String,
    pub total_output_sats: u64,
}

#[derive(Debug, Serialize)]
pub struct ScriptTypeSummary {
    pub p2wpkh: u64,
    pub p2tr: u64,
    pub p2sh: u64,
    pub p2pkh: u64,
    pub p2wsh: u64,
    pub op_return: u64,
    pub unknown: u64,
}

#[derive(Debug, Serialize)]
pub struct BlockStats {
    pub total_fees_sats: i64,
    pub total_weight: u64,
    pub avg_fee_rate_sat_vb: f64,
    pub script_type_summary: ScriptTypeSummary,
}

#[derive(Debug, Serialize)]
pub struct BlockReport {
    pub ok: bool,
    pub mode: String,
    pub block_header: BlockHeader,
    pub tx_count: usize,
    pub coinbase: CoinbaseInfo,
    pub transactions: Vec<serde_json::Value>,
    pub block_stats: BlockStats,
}

/// Parse all blocks from a blk*.dat byte buffer along with undo data.
pub fn parse_blocks_from_file(
    blk_data: &[u8],
    undo_data: &[u8],
) -> Result<Vec<BlockReport>, ChainLensError> {
    let mut blk_offset = 0usize;
    let mut undo_offset = 0usize;
    let mut reports = Vec::new();

    while blk_offset < blk_data.len() {
        // Skip any trailing zero padding
        if blk_offset + 4 > blk_data.len() {
            break;
        }
        // Check for magic bytes (mainnet: 0xF9BEB4D9, little-endian)
        let magic_candidate = u32::from_le_bytes(
            blk_data[blk_offset..blk_offset + 4].try_into().unwrap()
        );
        if magic_candidate == 0 {
            blk_offset += 1;
            continue;
        }
        if magic_candidate != BLOCK_MAGIC {
            blk_offset += 1;
            continue;
        }
        blk_offset += 4;

        // Block size
        if blk_offset + 4 > blk_data.len() { break; }
        let block_size = u32::from_le_bytes(
            blk_data[blk_offset..blk_offset + 4].try_into().unwrap()
        ) as usize;
        blk_offset += 4;

        if blk_offset + block_size > blk_data.len() {
            return Err(ChainLensError::ParseError(format!(
                "block data truncated at offset {} (need {} bytes)",
                blk_offset, block_size
            )));
        }

        let block_bytes = &blk_data[blk_offset..blk_offset + block_size];
        blk_offset += block_size;

        let report = parse_single_block(block_bytes, undo_data, &mut undo_offset)?;
        reports.push(report);
    }

    Ok(reports)
}

fn parse_single_block(
    block_bytes: &[u8],
    undo_data: &[u8],
    undo_offset: &mut usize,
) -> Result<BlockReport, ChainLensError> {
    let mut offset = 0usize;

    // ── Block header (80 bytes) ──
    if block_bytes.len() < 80 {
        return Err(ChainLensError::ParseError("block too small for header".into()));
    }
    let header_bytes = &block_bytes[0..80];

    let version = i32::from_le_bytes(header_bytes[0..4].try_into().unwrap());
    let prev_hash_raw: [u8; 32] = header_bytes[4..36].try_into().unwrap();
    let merkle_root_raw: [u8; 32] = header_bytes[36..68].try_into().unwrap();
    let timestamp = u32::from_le_bytes(header_bytes[68..72].try_into().unwrap());
    let bits_raw = u32::from_le_bytes(header_bytes[72..76].try_into().unwrap());
    let nonce = u32::from_le_bytes(header_bytes[76..80].try_into().unwrap());

    // block_hash: SHA256d(80-byte header), reversed for display
    let block_hash_raw = sha256d(header_bytes);
    let block_hash = hex::encode(block_hash_raw.iter().rev().copied().collect::<Vec<u8>>());

    // prev_block_hash: reversed for display
    let prev_block_hash = hex::encode(prev_hash_raw.iter().rev().copied().collect::<Vec<u8>>());
    // merkle_root: reversed for display
    let merkle_root_header = hex::encode(merkle_root_raw.iter().rev().copied().collect::<Vec<u8>>());

    let bits = format!("{:08x}", bits_raw);

    offset = 80;

    // ── Transaction count ──
    let tx_count = read_varint(block_bytes, &mut offset)? as usize;

    // ── Parse all raw transaction bytes ──
    let mut raw_txs: Vec<Vec<u8>> = Vec::with_capacity(tx_count);
    for _ in 0..tx_count {
        let _tx_start = offset;
        // We need to know the tx size; parse enough to skip it
        let tx_bytes = extract_raw_tx(block_bytes, &mut offset)?;
        raw_txs.push(tx_bytes);
    }

    // ── Parse undo data for this block ──
    let undo_prevouts = if !undo_data.is_empty() {
        let mut local_offset = *undo_offset;
        let result = parse_block_undo_at(undo_data, &mut local_offset, tx_count);
        *undo_offset = local_offset;
        result.unwrap_or_default()
    } else {
        vec![vec![]; tx_count.saturating_sub(1)]
    };

    // ── Build txids for merkle root ──
    let mut txid_bytes_list: Vec<[u8; 32]> = Vec::with_capacity(tx_count);
    for raw_tx_bytes in &raw_txs {
        let txid = compute_txid(raw_tx_bytes);
        txid_bytes_list.push(txid);
    }

    // ── Verify merkle root ──
    let computed_root = compute_merkle_root(&txid_bytes_list);
    let computed_root_hex = hex::encode(computed_root.iter().rev().copied().collect::<Vec<u8>>());
    let merkle_root_valid = computed_root_hex == merkle_root_header;

    if !merkle_root_valid {
        return Err(ChainLensError::ParseError(format!(
            "merkle root mismatch: header={} computed={}",
            merkle_root_header, computed_root_hex
        )));
    }

    // ── Parse coinbase (first tx) ──
    let coinbase_raw = &raw_txs[0];
    let coinbase_hex = hex::encode(coinbase_raw);
    let coinbase_info = extract_coinbase_info(&coinbase_hex)?;

    // ── Parse all transactions with prevout data ──
    let mut parsed_txs: Vec<serde_json::Value> = Vec::with_capacity(tx_count);
    let mut total_fees: i64 = 0;
    let mut total_weight: u64 = 0;
    let mut script_counts: HashMap<String, u64> = HashMap::new();

    for (i, raw_tx_bytes) in raw_txs.iter().enumerate() {
        let raw_tx_hex = hex::encode(raw_tx_bytes);
        let prevouts_for_tx: Vec<Prevout> = if i == 0 {
            // Coinbase — no prevouts
            vec![]
        } else {
            // Build prevout list from undo data (indexed at i-1)
            let tx_prevout_entries = undo_prevouts.get(i - 1).cloned().unwrap_or_default();
            // We need txids from the tx inputs to build Prevout structs
            let inputs = extract_input_outpoints(raw_tx_bytes).unwrap_or_default();
            inputs
                .into_iter()
                .zip(tx_prevout_entries.into_iter())
                .map(|((txid, vout), undo)| Prevout {
                    txid,
                    vout,
                    value_sats: undo.value_sats,
                    script_pubkey_hex: hex::encode(&undo.script_pubkey),
                })
                .collect()
        };

        let parsed = parse_transaction_inner(
            &raw_tx_hex,
            &prevouts_for_tx,
            "mainnet",
            false, // block mode: don't require all prevouts (coinbase has none)
        );

        match parsed {
            Ok(tx) => {
                if i > 0 && tx.fee_sats > 0 {
                    total_fees += tx.fee_sats;
                }
                total_weight += tx.weight;
                // Count output script types
                for v in &tx.vout {
                    *script_counts.entry(v.script_type.clone()).or_insert(0) += 1;
                }
                parsed_txs.push(serde_json::to_value(tx).unwrap());
            }
            Err(e) => {
                parsed_txs.push(serde_json::json!({
                    "ok": false,
                    "error": e.to_string()
                }));
            }
        }
    }

    let avg_fee_rate = if total_weight > 0 {
        let total_vbytes = total_weight as f64 / 4.0;
        (total_fees as f64 / total_vbytes * 100.0).round() / 100.0
    } else {
        0.0
    };

    let block_header = BlockHeader {
        version,
        prev_block_hash,
        merkle_root: merkle_root_header,
        merkle_root_valid,
        timestamp,
        bits,
        nonce,
        block_hash,
    };

    let block_stats = BlockStats {
        total_fees_sats: total_fees,
        total_weight,
        avg_fee_rate_sat_vb: avg_fee_rate,
        script_type_summary: ScriptTypeSummary {
            p2wpkh: *script_counts.get("p2wpkh").unwrap_or(&0),
            p2tr: *script_counts.get("p2tr").unwrap_or(&0),
            p2sh: *script_counts.get("p2sh").unwrap_or(&0),
            p2pkh: *script_counts.get("p2pkh").unwrap_or(&0),
            p2wsh: *script_counts.get("p2wsh").unwrap_or(&0),
            op_return: *script_counts.get("op_return").unwrap_or(&0),
            unknown: *script_counts.get("unknown").unwrap_or(&0),
        },
    };

    Ok(BlockReport {
        ok: true,
        mode: "block".to_string(),
        block_header,
        tx_count,
        coinbase: coinbase_info,
        transactions: parsed_txs,
        block_stats,
    })
}

/// Extract raw transaction bytes from block_bytes starting at offset.
fn extract_raw_tx(block_bytes: &[u8], offset: &mut usize) -> Result<Vec<u8>, ChainLensError> {
    let start = *offset;
    // Parse enough to find end of tx
    if *offset + 4 > block_bytes.len() {
        return Err(ChainLensError::ParseError("tx: truncated version".into()));
    }
    *offset += 4; // version

    // Check segwit
    let segwit = if *offset + 2 <= block_bytes.len()
        && block_bytes[*offset] == 0x00
        && block_bytes[*offset + 1] == 0x01
    {
        *offset += 2;
        true
    } else {
        false
    };

    let in_count = read_varint(block_bytes, offset)? as usize;
    for _ in 0..in_count {
        *offset += 32 + 4; // txid + vout
        let script_len = read_varint(block_bytes, offset)? as usize;
        *offset += script_len + 4; // script + sequence
    }

    let out_count = read_varint(block_bytes, offset)? as usize;
    for _ in 0..out_count {
        *offset += 8; // value
        let script_len = read_varint(block_bytes, offset)? as usize;
        *offset += script_len;
    }

    if segwit {
        for _ in 0..in_count {
            let n_items = read_varint(block_bytes, offset)? as usize;
            for _ in 0..n_items {
                let item_len = read_varint(block_bytes, offset)? as usize;
                *offset += item_len;
            }
        }
    }

    *offset += 4; // locktime

    if *offset > block_bytes.len() {
        return Err(ChainLensError::ParseError("tx ran past block boundary".into()));
    }
    Ok(block_bytes[start..*offset].to_vec())
}

/// Compute txid from raw tx bytes (SHA256d of non-witness bytes, reversed).
fn compute_txid(raw_tx: &[u8]) -> [u8; 32] {
    // Build non-witness bytes just like the parser does
    let _tx_hex = hex::encode(raw_tx);
    // We use parse_transaction_inner to get the correct txid, but that's heavy.
    // Instead, do a quick pass to build base bytes.
    if let Ok(base) = build_base_bytes(raw_tx) {
        let h = sha256d(&base);
        h
    } else {
        sha256d(raw_tx)
    }
}

fn build_base_bytes(tx: &[u8]) -> Result<Vec<u8>, ()> {
    let mut offset = 0usize;
    let mut base = Vec::new();

    if tx.len() < 4 { return Err(()); }
    base.extend_from_slice(&tx[0..4]);
    offset = 4;

    let segwit = if offset + 2 <= tx.len() && tx[offset] == 0x00 && tx[offset + 1] == 0x01 {
        offset += 2;
        true
    } else {
        false
    };

    let in_count = read_varint_simple(tx, &mut offset).ok_or(())?;
    base.extend_from_slice(&encode_varint_simple(in_count));

    for _ in 0..in_count {
        if offset + 36 > tx.len() { return Err(()); }
        base.extend_from_slice(&tx[offset..offset + 36]);
        offset += 36;
        let sl = read_varint_simple(tx, &mut offset).ok_or(())?;
        base.extend_from_slice(&encode_varint_simple(sl));
        if offset + sl as usize > tx.len() { return Err(()); }
        base.extend_from_slice(&tx[offset..offset + sl as usize]);
        offset += sl as usize;
        if offset + 4 > tx.len() { return Err(()); }
        base.extend_from_slice(&tx[offset..offset + 4]);
        offset += 4;
    }

    let out_count = read_varint_simple(tx, &mut offset).ok_or(())?;
    base.extend_from_slice(&encode_varint_simple(out_count));
    for _ in 0..out_count {
        if offset + 8 > tx.len() { return Err(()); }
        base.extend_from_slice(&tx[offset..offset + 8]);
        offset += 8;
        let sl = read_varint_simple(tx, &mut offset).ok_or(())?;
        base.extend_from_slice(&encode_varint_simple(sl));
        if offset + sl as usize > tx.len() { return Err(()); }
        base.extend_from_slice(&tx[offset..offset + sl as usize]);
        offset += sl as usize;
    }

    // Skip witness
    if segwit {
        for _ in 0..in_count {
            let n_items = read_varint_simple(tx, &mut offset).ok_or(())?;
            for _ in 0..n_items {
                let il = read_varint_simple(tx, &mut offset).ok_or(())?;
                offset += il as usize;
            }
        }
    }

    if offset + 4 > tx.len() { return Err(()); }
    base.extend_from_slice(&tx[offset..offset + 4]);

    Ok(base)
}

fn read_varint_simple(data: &[u8], offset: &mut usize) -> Option<u64> {
    if *offset >= data.len() { return None; }
    let b = data[*offset];
    *offset += 1;
    Some(match b {
        0x00..=0xfc => b as u64,
        0xfd => {
            if *offset + 2 > data.len() { return None; }
            let v = u16::from_le_bytes([data[*offset], data[*offset + 1]]);
            *offset += 2;
            v as u64
        }
        0xfe => {
            if *offset + 4 > data.len() { return None; }
            let v = u32::from_le_bytes([data[*offset], data[*offset+1], data[*offset+2], data[*offset+3]]);
            *offset += 4;
            v as u64
        }
        _ => {
            if *offset + 8 > data.len() { return None; }
            let v = u64::from_le_bytes(data[*offset..*offset+8].try_into().ok()?);
            *offset += 8;
            v
        }
    })
}

fn encode_varint_simple(n: u64) -> Vec<u8> {
    if n <= 0xfc { vec![n as u8] }
    else if n <= 0xffff { let mut v = vec![0xfd]; v.extend_from_slice(&(n as u16).to_le_bytes()); v }
    else if n <= 0xffffffff { let mut v = vec![0xfe]; v.extend_from_slice(&(n as u32).to_le_bytes()); v }
    else { let mut v = vec![0xff]; v.extend_from_slice(&n.to_le_bytes()); v }
}

/// Extract (txid_display, vout) pairs from a raw transaction's inputs.
fn extract_input_outpoints(raw_tx: &[u8]) -> Result<Vec<(String, u32)>, ChainLensError> {
    let mut offset = 0usize;
    offset += 4; // version
    if offset + 2 <= raw_tx.len() && raw_tx[offset] == 0x00 && raw_tx[offset + 1] == 0x01 {
        offset += 2; // segwit marker
    }
    let in_count = read_varint(raw_tx, &mut offset)? as usize;
    let mut result = Vec::with_capacity(in_count);
    for _ in 0..in_count {
        if offset + 32 > raw_tx.len() {
            return Err(ChainLensError::ParseError("truncated input outpoint".into()));
        }
        let txid_raw: [u8; 32] = raw_tx[offset..offset + 32].try_into().unwrap();
        offset += 32;
        let vout = u32::from_le_bytes(raw_tx[offset..offset + 4].try_into().unwrap());
        offset += 4;
        let txid_display = hex::encode(txid_raw.iter().rev().copied().collect::<Vec<u8>>());
        result.push((txid_display, vout));
        let sl = read_varint(raw_tx, &mut offset)? as usize;
        offset += sl + 4; // script_sig + sequence
    }
    Ok(result)
}

/// Extract coinbase-specific fields.
fn extract_coinbase_info(raw_tx_hex: &str) -> Result<CoinbaseInfo, ChainLensError> {
    let tx_bytes = hex::decode(raw_tx_hex)
        .map_err(|e| ChainLensError::ParseError(format!("coinbase hex: {}", e)))?;

    let mut offset = 4usize; // skip version
    if offset + 2 <= tx_bytes.len() && tx_bytes[offset] == 0x00 && tx_bytes[offset + 1] == 0x01 {
        offset += 2;
    }
    let in_count = read_varint(&tx_bytes, &mut offset)?;
    if in_count != 1 {
        return Err(ChainLensError::ParseError("coinbase must have exactly 1 input".into()));
    }

    // Verify all-zero txid + 0xffffffff vout
    if offset + 36 > tx_bytes.len() {
        return Err(ChainLensError::ParseError("coinbase input truncated".into()));
    }
    let txid_area = &tx_bytes[offset..offset + 32];
    if txid_area.iter().any(|b| *b != 0) {
        return Err(ChainLensError::ParseError("coinbase input txid not all-zero".into()));
    }
    let vout = u32::from_le_bytes(tx_bytes[offset + 32..offset + 36].try_into().unwrap());
    if vout != 0xffffffff {
        return Err(ChainLensError::ParseError("coinbase input vout not 0xffffffff".into()));
    }
    offset += 36;

    let script_len = read_varint(&tx_bytes, &mut offset)? as usize;
    let script_sig = &tx_bytes[offset..offset + script_len.min(tx_bytes.len() - offset)];
    let coinbase_script_hex = hex::encode(script_sig);

    // Decode BIP34 height: first push in scriptSig is OP_PUSHBYTES_N followed by LE height bytes
    let bip34_height = decode_bip34_height(script_sig);

    offset += script_len;
    offset += 4; // sequence

    // Parse outputs to compute total_output_sats
    let out_count = read_varint(&tx_bytes, &mut offset)? as usize;
    let mut total_output_sats = 0u64;
    for _ in 0..out_count {
        if offset + 8 > tx_bytes.len() { break; }
        let v = u64::from_le_bytes(tx_bytes[offset..offset + 8].try_into().unwrap());
        total_output_sats += v;
        offset += 8;
        let sl = read_varint(&tx_bytes, &mut offset).unwrap_or(0) as usize;
        offset += sl;
    }

    Ok(CoinbaseInfo { bip34_height, coinbase_script_hex, total_output_sats })
}

/// Decode BIP34 block height from coinbase scriptSig.
/// Format: OP_PUSHBYTES_N <height as little-endian bytes>
fn decode_bip34_height(script: &[u8]) -> Option<u64> {
    if script.is_empty() { return None; }
    let push_len = script[0] as usize;
    if push_len == 0 || push_len > 8 || push_len + 1 > script.len() {
        return None;
    }
    let height_bytes = &script[1..1 + push_len];
    let mut h = [0u8; 8];
    h[..height_bytes.len()].copy_from_slice(height_bytes);
    Some(u64::from_le_bytes(h))
}

/// Parse undo data for a specific block starting at undo_offset.
/// Returns prevouts grouped by tx (excluding coinbase).
/// The `offset` is updated in place to point past this block's undo data.
fn parse_block_undo_at(
    undo_data: &[u8],
    offset: &mut usize,
    n_txs: usize,
) -> Result<Vec<Vec<crate::undo::UndoPrevout>>, ChainLensError> {
    // Pass the full undo_data and the mutable offset so that parse_block_undo
    // advances *offset correctly across multiple blocks in the same file.
    crate::undo::parse_block_undo(undo_data, offset, n_txs)
}
