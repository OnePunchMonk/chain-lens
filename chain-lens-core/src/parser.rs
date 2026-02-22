/// Full Bitcoin transaction parser.
///
/// Parses raw SegWit and legacy transactions, classifies scripts,
/// derives addresses, disassembles scripts, and computes all output fields.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::classify::{
    classify_input, classify_output_script, derive_address,
    InputScriptType, ScriptType,
};
use crate::disasm::disassemble;
use crate::error::ChainLensError;
use crate::op_return::parse_op_return;
use crate::segwit::compute_segwit_savings;
use crate::timelock::{parse_relative_timelock, LocktimeInfo, RelativeTimelock};

// ─── Public data types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prevout {
    pub txid: String,
    pub vout: u32,
    pub value_sats: u64,
    pub script_pubkey_hex: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrevoutInfo {
    pub value_sats: u64,
    pub script_pubkey_hex: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Vin {
    pub txid: String,
    pub vout: u32,
    pub sequence: u32,
    pub script_sig_hex: String,
    pub script_asm: String,
    pub witness: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub witness_script_asm: Option<String>,
    pub script_type: String,
    pub address: Option<String>,
    pub prevout: Option<PrevoutInfo>,
    pub relative_timelock: RelativeTimelock,
}

#[derive(Debug, Clone, Serialize)]
pub struct Vout {
    pub n: u32,
    pub value_sats: u64,
    pub script_pubkey_hex: String,
    pub script_asm: String,
    pub script_type: String,
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op_return_data_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op_return_data_utf8: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op_return_protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Warning {
    pub code: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedTransaction {
    pub ok: bool,
    pub network: String,
    pub segwit: bool,
    pub txid: String,
    pub wtxid: Option<String>,
    pub version: i32,
    pub locktime: u32,
    pub size_bytes: u64,
    pub weight: u64,
    pub vbytes: f64,
    pub total_input_sats: u64,
    pub total_output_sats: u64,
    pub fee_sats: i64,
    pub fee_rate_sat_vb: f64,
    pub rbf_signaling: bool,
    pub locktime_type: String,
    pub locktime_value: u32,
    pub segwit_savings: Option<serde_json::Value>,
    pub vin: Vec<Vin>,
    pub vout: Vec<Vout>,
    pub warnings: Vec<Warning>,
}

// ─── Internal helpers ───────────────────────────────────────────────────────

fn sha256d(data: &[u8]) -> [u8; 32] {
    let h1 = Sha256::digest(data);
    let h2 = Sha256::digest(&h1);
    h2.into()
}

fn read_u32_le(bytes: &[u8], offset: &mut usize) -> Result<u32, ChainLensError> {
    if *offset + 4 > bytes.len() {
        return Err(ChainLensError::InvalidTx("unexpected end of buffer (u32)".into()));
    }
    let val = u32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
    *offset += 4;
    Ok(val)
}

fn read_i32_le(bytes: &[u8], offset: &mut usize) -> Result<i32, ChainLensError> {
    Ok(read_u32_le(bytes, offset)? as i32)
}

fn read_u64_le(bytes: &[u8], offset: &mut usize) -> Result<u64, ChainLensError> {
    if *offset + 8 > bytes.len() {
        return Err(ChainLensError::InvalidTx("unexpected end of buffer (u64)".into()));
    }
    let val = u64::from_le_bytes(bytes[*offset..*offset + 8].try_into().unwrap());
    *offset += 8;
    Ok(val)
}

fn read_bytes_owned(bytes: &[u8], offset: &mut usize, len: usize) -> Result<Vec<u8>, ChainLensError> {
    if *offset + len > bytes.len() {
        return Err(ChainLensError::InvalidTx(
            format!("unexpected end of buffer (need {} bytes at offset {})", len, offset),
        ));
    }
    let slice = bytes[*offset..*offset + len].to_vec();
    *offset += len;
    Ok(slice)
}

pub fn read_varint(bytes: &[u8], offset: &mut usize) -> Result<u64, ChainLensError> {
    if *offset >= bytes.len() {
        return Err(ChainLensError::InvalidTx("unexpected end of buffer (varint)".into()));
    }
    let first = bytes[*offset];
    *offset += 1;
    Ok(match first {
        n @ 0x00..=0xfc => n as u64,
        0xfd => {
            if *offset + 2 > bytes.len() {
                return Err(ChainLensError::InvalidTx("varint truncated (fd)".into()));
            }
            let v = u16::from_le_bytes([bytes[*offset], bytes[*offset + 1]]);
            *offset += 2;
            v as u64
        }
        0xfe => {
            if *offset + 4 > bytes.len() {
                return Err(ChainLensError::InvalidTx("varint truncated (fe)".into()));
            }
            let v = u32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
            *offset += 4;
            v as u64
        }
        0xff => {
            if *offset + 8 > bytes.len() {
                return Err(ChainLensError::InvalidTx("varint truncated (ff)".into()));
            }
            let v = u64::from_le_bytes(bytes[*offset..*offset + 8].try_into().unwrap());
            *offset += 8;
            v
        }
    })
}

/// Encode varint to bytes (for base_bytes reconstruction).
fn encode_varint(n: u64) -> Vec<u8> {
    if n <= 0xfc {
        vec![n as u8]
    } else if n <= 0xffff {
        let mut v = vec![0xfd];
        v.extend_from_slice(&(n as u16).to_le_bytes());
        v
    } else if n <= 0xffffffff {
        let mut v = vec![0xfe];
        v.extend_from_slice(&(n as u32).to_le_bytes());
        v
    } else {
        let mut v = vec![0xff];
        v.extend_from_slice(&n.to_le_bytes());
        v
    }
}

// ─── Main entry point ───────────────────────────────────────────────────────

pub fn parse_transaction_with_prevouts(
    raw_tx_hex: &str,
    prevouts: &[Prevout],
) -> Result<ParsedTransaction, ChainLensError> {
    parse_transaction_inner(raw_tx_hex, prevouts, "mainnet", true)
}

/// Parse a transaction. If `require_all_prevouts` is true, missing prevouts → error.
pub fn parse_transaction_inner(
    raw_tx_hex: &str,
    prevouts: &[Prevout],
    network: &str,
    require_all_prevouts: bool,
) -> Result<ParsedTransaction, ChainLensError> {
    let tx_bytes = hex::decode(raw_tx_hex)
        .map_err(|e| ChainLensError::InvalidTx(format!("hex decode: {}", e)))?;

    if tx_bytes.len() < 10 {
        return Err(ChainLensError::InvalidTx("transaction too short".into()));
    }

    let size_bytes = tx_bytes.len() as u64;
    let mut offset = 0usize;

    // ── Version ──
    let version = read_i32_le(&tx_bytes, &mut offset)?;

    // ── Detect SegWit marker (0x00 0x01) ──
    let segwit = if offset + 2 <= tx_bytes.len()
        && tx_bytes[offset] == 0x00
        && tx_bytes[offset + 1] == 0x01
    {
        offset += 2;
        true
    } else {
        false
    };

    // ── Parse inputs ──
    let in_count = read_varint(&tx_bytes, &mut offset)? as usize;

    // We'll collect raw (txid bytes, vout, script_sig bytes, sequence) per input
    struct RawInput {
        txid_bytes: Vec<u8>,   // 32 bytes, as read (little-endian)
        vout: u32,
        script_sig: Vec<u8>,
        sequence: u32,
    }

    let mut raw_inputs: Vec<RawInput> = Vec::with_capacity(in_count);
    for _ in 0..in_count {
        let txid_bytes = read_bytes_owned(&tx_bytes, &mut offset, 32)?;
        let vout = read_u32_le(&tx_bytes, &mut offset)?;
        let script_len = read_varint(&tx_bytes, &mut offset)? as usize;
        let script_sig = read_bytes_owned(&tx_bytes, &mut offset, script_len)?;
        let sequence = read_u32_le(&tx_bytes, &mut offset)?;
        raw_inputs.push(RawInput { txid_bytes, vout, script_sig, sequence });
    }

    // ── Parse outputs ──
    let out_count = read_varint(&tx_bytes, &mut offset)? as usize;
    struct RawOutput {
        value_sats: u64,
        script_pubkey: Vec<u8>,
    }
    let mut raw_outputs: Vec<RawOutput> = Vec::with_capacity(out_count);
    for _ in 0..out_count {
        let value_sats = read_u64_le(&tx_bytes, &mut offset)?;
        let script_len = read_varint(&tx_bytes, &mut offset)? as usize;
        let script_pubkey = read_bytes_owned(&tx_bytes, &mut offset, script_len)?;
        raw_outputs.push(RawOutput { value_sats, script_pubkey });
    }

    // ── Parse witness data (one stack per input) ──
    let mut witnesses: Vec<Vec<Vec<u8>>> = vec![vec![]; in_count];
    let mut total_witness_bytes: u64 = 0;
    if segwit {
        for i in 0..in_count {
            let n_items = read_varint(&tx_bytes, &mut offset)? as usize;
            total_witness_bytes += encode_varint(n_items as u64).len() as u64;
            for _ in 0..n_items {
                let item_len = read_varint(&tx_bytes, &mut offset)? as usize;
                let item = read_bytes_owned(&tx_bytes, &mut offset, item_len)?;
                total_witness_bytes += encode_varint(item_len as u64).len() as u64;
                total_witness_bytes += item_len as u64;
                witnesses[i].push(item);
            }
        }
    }

    // ── Locktime ──
    let locktime = read_u32_le(&tx_bytes, &mut offset)?;

    if offset != tx_bytes.len() {
        // Extra bytes at end — not fatal for parsing but noteworthy
    }

    // ── Build non-witness base bytes (for txid) ──
    // Version (4) | in_count varint | inputs | out_count varint | outputs | locktime (4)
    let mut base_bytes: Vec<u8> = Vec::new();
    base_bytes.extend_from_slice(&version.to_le_bytes());
    base_bytes.extend_from_slice(&encode_varint(in_count as u64));
    for inp in &raw_inputs {
        base_bytes.extend_from_slice(&inp.txid_bytes);
        base_bytes.extend_from_slice(&inp.vout.to_le_bytes());
        base_bytes.extend_from_slice(&encode_varint(inp.script_sig.len() as u64));
        base_bytes.extend_from_slice(&inp.script_sig);
        base_bytes.extend_from_slice(&inp.sequence.to_le_bytes());
    }
    base_bytes.extend_from_slice(&encode_varint(out_count as u64));
    for out in &raw_outputs {
        base_bytes.extend_from_slice(&out.value_sats.to_le_bytes());
        base_bytes.extend_from_slice(&encode_varint(out.script_pubkey.len() as u64));
        base_bytes.extend_from_slice(&out.script_pubkey);
    }
    base_bytes.extend_from_slice(&locktime.to_le_bytes());

    // ── TXID = SHA256d(base_bytes), reversed ──
    let txid_raw = sha256d(&base_bytes);
    let txid = hex::encode(txid_raw.iter().rev().copied().collect::<Vec<u8>>());

    // ── WTXID = SHA256d(all_bytes), reversed (null for legacy) ──
    let wtxid = if segwit {
        let wtxid_raw = sha256d(&tx_bytes);
        Some(hex::encode(wtxid_raw.iter().rev().copied().collect::<Vec<u8>>()))
    } else {
        None
    };

    // ── Weight (BIP141) ──
    // weight = base_size * 3 + total_size
    // where base_size = size without marker+flag and witness data
    let base_size = base_bytes.len() as u64;
    let weight = if segwit {
        base_size * 3 + size_bytes
    } else {
        size_bytes * 4
    };
    let vbytes = ((weight as f64) / 4.0).ceil();

    // ── Build prevout lookup: (txid, vout) → Prevout ──
    use std::collections::HashMap;
    let mut prevout_map: HashMap<(String, u32), &Prevout> = HashMap::new();
    for p in prevouts {
        let key = (p.txid.clone(), p.vout);
        if prevout_map.insert(key.clone(), p).is_some() {
            return Err(ChainLensError::DuplicatePrevout(format!(
                "duplicate prevout {}:{}",
                key.0, key.1
            )));
        }
    }

    // ── Build Vin list ──
    let mut total_input_sats: u64 = 0;
    let mut vins: Vec<Vin> = Vec::with_capacity(in_count);

    for (idx, inp) in raw_inputs.iter().enumerate() {
        // txid: reverse bytes for display
        let txid_display = hex::encode(inp.txid_bytes.iter().rev().copied().collect::<Vec<u8>>());
        let key = (txid_display.clone(), inp.vout);

        let prevout_entry = prevout_map.get(&key);
        if prevout_entry.is_none() && require_all_prevouts {
            // Check if this is a coinbase input (txid all-zero, vout 0xffffffff)
            let is_coinbase = inp.txid_bytes.iter().all(|b| *b == 0) && inp.vout == 0xffffffff;
            if !is_coinbase {
                return Err(ChainLensError::MissingPrevout(format!(
                    "no prevout for input {}:{}",
                    key.0, key.1
                )));
            }
        }

        let prevout_info = prevout_entry.map(|p| {
            total_input_sats = total_input_sats.saturating_add(p.value_sats);
            PrevoutInfo {
                value_sats: p.value_sats,
                script_pubkey_hex: p.script_pubkey_hex.clone(),
            }
        });

        let witness_items = &witnesses[idx];
        let witness_hex: Vec<String> = witness_items.iter().map(|w| hex::encode(w)).collect();

        // Script sig disassembly
        let script_asm = disassemble(&inp.script_sig);

        // Classify input: need prevout script bytes
        let prevout_script_bytes = prevout_entry
            .and_then(|p| hex::decode(&p.script_pubkey_hex).ok())
            .unwrap_or_default();

        let input_type = classify_input(&inp.script_sig, witness_items, &prevout_script_bytes);

        // Address from prevout
        let address = if !prevout_script_bytes.is_empty() {
            derive_address(&prevout_script_bytes)
        } else {
            None
        };

        // witness_script_asm for p2wsh / p2sh-p2wsh
        let witness_script_asm = match &input_type {
            InputScriptType::P2WSH | InputScriptType::P2SHP2WSH => {
                witness_items.last().map(|w| disassemble(w))
            }
            _ => None,
        };

        // Relative timelock
        let relative_timelock = parse_relative_timelock(inp.sequence);

        vins.push(Vin {
            txid: txid_display,
            vout: inp.vout,
            sequence: inp.sequence,
            script_sig_hex: hex::encode(&inp.script_sig),
            script_asm,
            witness: witness_hex,
            witness_script_asm,
            script_type: input_type.as_str().to_string(),
            address,
            prevout: prevout_info,
            relative_timelock,
        });
    }

    // ── Verify no extra prevouts (each prevout must correspond to an input) ──
    if require_all_prevouts && !prevouts.is_empty() {
        let input_keys: std::collections::HashSet<_> = raw_inputs
            .iter()
            .filter(|inp| {
                let is_coinbase =
                    inp.txid_bytes.iter().all(|b| *b == 0) && inp.vout == 0xffffffff;
                !is_coinbase
            })
            .map(|inp| {
                let txid_display =
                    hex::encode(inp.txid_bytes.iter().rev().copied().collect::<Vec<u8>>());
                (txid_display, inp.vout)
            })
            .collect();
        for p in prevouts {
            let key = (p.txid.clone(), p.vout);
            if !input_keys.contains(&key) {
                return Err(ChainLensError::InconsistentPrevouts(format!(
                    "prevout {}:{} does not correspond to any input",
                    key.0, key.1
                )));
            }
        }
    }

    // ── Build Vout list ──
    let mut total_output_sats: u64 = 0;
    let mut vouts: Vec<Vout> = Vec::with_capacity(out_count);
    let mut has_unknown_output = false;

    for (n, out) in raw_outputs.iter().enumerate() {
        total_output_sats = total_output_sats.saturating_add(out.value_sats);
        let script_type = classify_output_script(&out.script_pubkey);
        let script_asm = disassemble(&out.script_pubkey);
        let address = derive_address(&out.script_pubkey);

        let (op_return_data_hex, op_return_data_utf8, op_return_protocol) =
            if script_type == ScriptType::OpReturn {
                let info = parse_op_return(&out.script_pubkey);
                let utf8_val: serde_json::Value = match info.op_return_data_utf8 {
                    Some(s) => serde_json::Value::String(s),
                    None => serde_json::Value::Null,
                };
                (
                    Some(info.op_return_data_hex),
                    Some(utf8_val),
                    Some(info.op_return_protocol),
                )
            } else {
                (None, None, None)
            };

        if script_type == ScriptType::Unknown {
            has_unknown_output = true;
        }

        vouts.push(Vout {
            n: n as u32,
            value_sats: out.value_sats,
            script_pubkey_hex: hex::encode(&out.script_pubkey),
            script_asm,
            script_type: script_type.as_str().to_string(),
            address,
            op_return_data_hex,
            op_return_data_utf8,
            op_return_protocol,
        });
    }

    // ── Fee calculation ──
    let fee_sats = total_input_sats as i64 - total_output_sats as i64;
    let fee_rate_sat_vb = if vbytes > 0.0 && fee_sats >= 0 {
        (fee_sats as f64 / vbytes * 100.0).round() / 100.0
    } else {
        0.0
    };

    // ── RBF: any input with sequence < 0xfffffffe (BIP125) ──
    let rbf_signaling = raw_inputs.iter().any(|i| i.sequence < 0xffff_fffe);

    // ── Locktime ──
    let lock_info = LocktimeInfo::from_locktime(locktime);

    // ── SegWit savings ──
    let segwit_savings_val = if segwit {
        let savings = compute_segwit_savings(size_bytes, total_witness_bytes);
        savings.map(|s| serde_json::to_value(s).unwrap())
    } else {
        None
    };

    // ── Warnings ──
    let mut warnings: Vec<Warning> = Vec::new();
    if fee_sats > 1_000_000 || fee_rate_sat_vb > 200.0 {
        warnings.push(Warning { code: "HIGH_FEE".to_string() });
    }
    for v in &vouts {
        if v.script_type != "op_return" && v.value_sats < 546 {
            warnings.push(Warning { code: "DUST_OUTPUT".to_string() });
            break;
        }
    }
    if has_unknown_output {
        warnings.push(Warning { code: "UNKNOWN_OUTPUT_SCRIPT".to_string() });
    }
    if rbf_signaling {
        warnings.push(Warning { code: "RBF_SIGNALING".to_string() });
    }

    Ok(ParsedTransaction {
        ok: true,
        network: network.to_string(),
        segwit,
        txid,
        wtxid,
        version,
        locktime,
        size_bytes,
        weight,
        vbytes,
        total_input_sats,
        total_output_sats,
        fee_sats,
        fee_rate_sat_vb,
        rbf_signaling,
        locktime_type: lock_info.locktime_type,
        locktime_value: lock_info.locktime_value,
        segwit_savings: segwit_savings_val,
        vin: vins,
        vout: vouts,
        warnings,
    })
}
