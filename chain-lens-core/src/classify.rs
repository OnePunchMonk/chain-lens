/// Script classification and address derivation for Bitcoin outputs and inputs.
///
/// Supports: p2pkh, p2sh, p2wpkh, p2wsh, p2tr, op_return, unknown (outputs)
/// and all standard input spend types (inputs).

use sha2::{Digest, Sha256};

// ─── Output script classification ──────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum ScriptType {
    P2PKH,
    P2SH,
    P2WPKH,
    P2WSH,
    P2TR,
    OpReturn,
    Unknown,
}

impl ScriptType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ScriptType::P2PKH => "p2pkh",
            ScriptType::P2SH => "p2sh",
            ScriptType::P2WPKH => "p2wpkh",
            ScriptType::P2WSH => "p2wsh",
            ScriptType::P2TR => "p2tr",
            ScriptType::OpReturn => "op_return",
            ScriptType::Unknown => "unknown",
        }
    }
}

/// Classify a scriptPubKey (output script) from its raw bytes.
pub fn classify_output_script(script: &[u8]) -> ScriptType {
    match script {
        // P2PKH: OP_DUP OP_HASH160 <20B> OP_EQUALVERIFY OP_CHECKSIG
        [0x76, 0xa9, 0x14, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 0x88, 0xac]
            if script.len() == 25 =>
        {
            ScriptType::P2PKH
        }
        // P2SH: OP_HASH160 <20B> OP_EQUAL
        [0xa9, 0x14, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 0x87]
            if script.len() == 23 =>
        {
            ScriptType::P2SH
        }
        // P2WPKH: OP_0 <20B>
        [0x00, 0x14, ..] if script.len() == 22 => ScriptType::P2WPKH,
        // P2WSH: OP_0 <32B>
        [0x00, 0x20, ..] if script.len() == 34 => ScriptType::P2WSH,
        // P2TR: OP_1 <32B>
        [0x51, 0x20, ..] if script.len() == 34 => ScriptType::P2TR,
        // OP_RETURN: starts with 0x6a
        [0x6a, ..] => ScriptType::OpReturn,
        _ => ScriptType::Unknown,
    }
}

// ─── Input spend type classification ───────────────────────────────────────

#[derive(Debug, Clone)]
pub enum InputScriptType {
    P2PKH,
    P2SHP2WPKH,
    P2SHP2WSH,
    P2WPKH,
    P2WSH,
    P2TRKeypath,
    P2TRScriptpath,
    Unknown,
}

impl InputScriptType {
    pub fn as_str(&self) -> &'static str {
        match self {
            InputScriptType::P2PKH => "p2pkh",
            InputScriptType::P2SHP2WPKH => "p2sh-p2wpkh",
            InputScriptType::P2SHP2WSH => "p2sh-p2wsh",
            InputScriptType::P2WPKH => "p2wpkh",
            InputScriptType::P2WSH => "p2wsh",
            InputScriptType::P2TRKeypath => "p2tr_keypath",
            InputScriptType::P2TRScriptpath => "p2tr_scriptpath",
            InputScriptType::Unknown => "unknown",
        }
    }
}

/// Classify how an input spends its prevout, given:
/// - script_sig bytes
/// - witness items (empty Vec for legacy)
/// - prevout script bytes (from the prevout scriptPubKey)
pub fn classify_input(
    script_sig: &[u8],
    witness: &[Vec<u8>],
    prevout_script: &[u8],
) -> InputScriptType {
    let has_witness = !witness.is_empty();
    let sig_empty = script_sig.is_empty();

    // Classify from prevout script type first
    match classify_output_script(prevout_script) {
        ScriptType::P2WPKH => {
            // Native P2WPKH: scriptSig empty, witness = [sig, pubkey]
            if sig_empty && witness.len() == 2 {
                return InputScriptType::P2WPKH;
            }
        }
        ScriptType::P2WSH => {
            // Native P2WSH: scriptSig empty, witness = [..., witnessScript]
            if sig_empty && has_witness {
                return InputScriptType::P2WSH;
            }
        }
        ScriptType::P2TR => {
            if sig_empty {
                if witness.len() == 1 {
                    // Key path: single 64-byte (or 65-byte) signature
                    return InputScriptType::P2TRKeypath;
                } else if witness.len() >= 2 {
                    // Script path: last element is control block (starts 0xc0/0xc1),
                    // second to last is script. Annex may be present (starts 0x50).
                    let last = &witness[witness.len() - 1];
                    let check = if last.first() == Some(&0x50) && witness.len() >= 3 {
                        // annex present, control block is second to last
                        &witness[witness.len() - 2]
                    } else {
                        last
                    };
                    if check.first().map_or(false, |b| b & 0xfe == 0xc0) {
                        return InputScriptType::P2TRScriptpath;
                    }
                    return InputScriptType::P2TRKeypath;
                }
            }
        }
        ScriptType::P2PKH => {
            if !has_witness {
                return InputScriptType::P2PKH;
            }
        }
        ScriptType::P2SH => {
            // Nested SegWit: scriptSig pushes a redeem script
            if !script_sig.is_empty() && has_witness {
                // Peek at the last push in scriptSig to see if it's a P2WPKH or P2WSH program
                if let Some(redeem) = extract_last_push(script_sig) {
                    match redeem.as_slice() {
                        [0x00, 0x14, ..] if redeem.len() == 22 => {
                            return InputScriptType::P2SHP2WPKH;
                        }
                        [0x00, 0x20, ..] if redeem.len() == 34 => {
                            return InputScriptType::P2SHP2WSH;
                        }
                        _ => {}
                    }
                }
            }
        }
        _ => {}
    }

    // Fallback heuristics (no prevout info or unrecognized)
    if sig_empty && !has_witness {
        return InputScriptType::Unknown;
    }
    if sig_empty && witness.len() == 2 {
        return InputScriptType::P2WPKH;
    }
    if sig_empty && has_witness {
        return InputScriptType::P2WSH;
    }
    if !has_witness && !sig_empty {
        return InputScriptType::P2PKH;
    }

    InputScriptType::Unknown
}

/// Extract the bytes of the last push from a scriptSig.
fn extract_last_push(script: &[u8]) -> Option<Vec<u8>> {
    let mut i = 0;
    let mut last: Option<Vec<u8>> = None;
    while i < script.len() {
        let op = script[i];
        i += 1;
        match op {
            0x00 => {
                last = Some(vec![]);
            }
            n @ 0x01..=0x4b => {
                let end = i + n as usize;
                if end > script.len() {
                    return None;
                }
                last = Some(script[i..end].to_vec());
                i = end;
            }
            0x4c => {
                // OP_PUSHDATA1
                if i >= script.len() {
                    return None;
                }
                let len = script[i] as usize;
                i += 1;
                let end = i + len;
                if end > script.len() {
                    return None;
                }
                last = Some(script[i..end].to_vec());
                i = end;
            }
            0x4d => {
                // OP_PUSHDATA2
                if i + 1 >= script.len() {
                    return None;
                }
                let len = u16::from_le_bytes([script[i], script[i + 1]]) as usize;
                i += 2;
                let end = i + len;
                if end > script.len() {
                    return None;
                }
                last = Some(script[i..end].to_vec());
                i = end;
            }
            0x4e => {
                // OP_PUSHDATA4
                if i + 3 >= script.len() {
                    return None;
                }
                let len = u32::from_le_bytes([script[i], script[i + 1], script[i + 2], script[i + 3]]) as usize;
                i += 4;
                let end = i + len;
                if end > script.len() {
                    return None;
                }
                last = Some(script[i..end].to_vec());
                i = end;
            }
            _ => { /* non-push opcode, skip */ }
        }
    }
    last
}

// ─── Address Derivation ─────────────────────────────────────────────────────

/// Derive a Bitcoin mainnet address from an output scriptPubKey.
/// Returns None for op_return and unknown types.
pub fn derive_address(script: &[u8]) -> Option<String> {
    match classify_output_script(script) {
        ScriptType::P2PKH => {
            // hash160 is bytes 3..23
            let hash = &script[3..23];
            Some(base58check_encode(0x00, hash))
        }
        ScriptType::P2SH => {
            // hash160 is bytes 2..22
            let hash = &script[2..22];
            Some(base58check_encode(0x05, hash))
        }
        ScriptType::P2WPKH => {
            // witness program is bytes 2..22
            let program = &script[2..22];
            bech32_encode("bc", 0, program).ok()
        }
        ScriptType::P2WSH => {
            // witness program is bytes 2..34
            let program = &script[2..34];
            bech32_encode("bc", 0, program).ok()
        }
        ScriptType::P2TR => {
            // witness program is bytes 2..34
            let program = &script[2..34];
            bech32_encode("bc", 1, program).ok()
        }
        _ => None,
    }
}

/// Derive an address from the prevout scriptPubKey for an input vin display.
pub fn derive_address_from_prevout(prevout_script_hex: &str) -> Option<String> {
    let bytes = hex::decode(prevout_script_hex).ok()?;
    derive_address(&bytes)
}

// ─── Base58Check encoding ───────────────────────────────────────────────────

fn base58check_encode(version: u8, payload: &[u8]) -> String {
    let mut data = Vec::with_capacity(1 + payload.len() + 4);
    data.push(version);
    data.extend_from_slice(payload);
    let checksum = sha256d(&data);
    data.extend_from_slice(&checksum[..4]);
    bs58::encode(data).into_string()
}

fn sha256d(data: &[u8]) -> [u8; 32] {
    let h1 = Sha256::digest(data);
    let h2 = Sha256::digest(&h1);
    let mut out = [0u8; 32];
    out.copy_from_slice(&h2);
    out
}

// ─── Bech32 encoding ────────────────────────────────────────────────────────
// Uses the bech32 crate (v0.9.x API).

fn bech32_encode(hrp: &str, witness_ver: u8, program: &[u8]) -> Result<String, String> {
    use bech32::{ToBase32, Variant};
    let mut data = vec![bech32::u5::try_from_u8(witness_ver).map_err(|e| e.to_string())?];
    data.extend_from_slice(&program.to_base32());
    let variant = if witness_ver == 0 {
        Variant::Bech32
    } else {
        Variant::Bech32m
    };
    bech32::encode(hrp, data, variant).map_err(|e| e.to_string())
}
