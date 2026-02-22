/// Bitcoin Core undo file (rev*.dat) parser.
///
/// The undo file contains the prevout data for every non-coinbase input spent
/// in a block, using Bitcoin Core's script compression scheme.

use crate::error::ChainLensError;
use crate::parser::read_varint;

/// A prevout recovered from the undo file.
#[derive(Debug, Clone)]
pub struct UndoPrevout {
    pub value_sats: u64,
    pub script_pubkey: Vec<u8>,
}

/// Parse a single compressed value (CTxOut.nValue) from undo data.
/// Bitcoin Core uses a custom varint compression for amounts.
fn decompress_amount(x: u64) -> u64 {
    if x == 0 {
        return 0;
    }
    let x = x - 1;
    let e = (x % 10) as u32;
    let mut n = x / 10;
    if e < 9 {
        let lastdigit = (n % 9) + 1;
        n /= 9;
        n = n * 10 + lastdigit;
    } else {
        n += 1;
    }
    let mut result = n;
    for _ in 0..e {
        result *= 10;
    }
    result
}

/// Reconstruct a scriptPubKey from the undo file's compressed nSize + script bytes.
/// 
/// nSize encoding:
///   0 → P2PKH (20-byte hash follows)
///   1 → P2SH (20-byte hash follows)  
///   2 → P2PK compressed pubkey (even, 32 bytes follow)
///   3 → P2PK compressed pubkey (odd,  32 bytes follow)
///   4 → P2PK uncompressed pubkey, even prefix (32 bytes follow, reconstruct 65-byte)
///   5 → P2PK uncompressed pubkey, odd prefix  (32 bytes follow)
///   n≥6 → raw script, length = n - 6
pub fn parse_undo_script(data: &[u8], offset: &mut usize) -> Result<Vec<u8>, ChainLensError> {
    let n_size = read_varint(data, offset)?;
    match n_size {
        0 => {
            // P2PKH: read 20-byte hash
            let hash = read_n(data, offset, 20)?;
            let mut script = vec![0x76, 0xa9, 0x14];
            script.extend_from_slice(&hash);
            script.extend_from_slice(&[0x88, 0xac]);
            Ok(script)
        }
        1 => {
            // P2SH: read 20-byte hash
            let hash = read_n(data, offset, 20)?;
            let mut script = vec![0xa9, 0x14];
            script.extend_from_slice(&hash);
            script.push(0x87);
            Ok(script)
        }
        2 | 3 => {
            // Compressed P2PK: 32-byte x-coord
            let x_bytes = read_n(data, offset, 32)?;
            let prefix = if n_size == 2 { 0x02u8 } else { 0x03u8 };
            let mut pubkey = Vec::with_capacity(33);
            pubkey.push(prefix);
            pubkey.extend_from_slice(&x_bytes);
            let mut script = vec![0x21]; // OP_PUSHBYTES_33
            script.extend_from_slice(&pubkey);
            script.push(0xac); // OP_CHECKSIG
            Ok(script)
        }
        4 | 5 => {
            // Uncompressed P2PK stored as compressed (32 x-coord bytes)
            // We reconstruct as a 33-byte compressed pubkey since we can't recover Y without EC
            let x_bytes = read_n(data, offset, 32)?;
            let prefix = if n_size == 4 { 0x02u8 } else { 0x03u8 };
            let mut pubkey = Vec::with_capacity(33);
            pubkey.push(prefix);
            pubkey.extend_from_slice(&x_bytes);
            let mut script = vec![0x21];
            script.extend_from_slice(&pubkey);
            script.push(0xac);
            Ok(script)
        }
        n => {
            // Raw script: length = n - 6
            let script_len = (n - 6) as usize;
            let script = read_n(data, offset, script_len)?;
            Ok(script)
        }
    }
}

fn read_n(data: &[u8], offset: &mut usize, n: usize) -> Result<Vec<u8>, ChainLensError> {
    if *offset + n > data.len() {
        return Err(ChainLensError::ParseError(format!(
            "undo data truncated: need {} bytes at offset {}",
            n, offset
        )));
    }
    let bytes = data[*offset..*offset + n].to_vec();
    *offset += n;
    Ok(bytes)
}

/// CTxInUndo order (Bitcoin Core undo.h): varint(height), [varint(version) if height>0],
/// then TxOutCompression = AmountCompression + ScriptCompression (AMOUNT before SCRIPT).
fn read_one_txin_undo(data: &[u8], offset: &mut usize) -> Result<UndoPrevout, ChainLensError> {
    let height_encoded = read_varint(data, offset)?;
    let height = height_encoded / 2;
    if height > 0 {
        let _version = read_varint(data, offset)?;
    }
    let compressed_value = read_varint(data, offset)?;
    let value_sats = decompress_amount(compressed_value);
    let script_pubkey = parse_undo_script(data, offset)?;
    Ok(UndoPrevout { value_sats, script_pubkey })
}

/// Parse the undo file for one block: returns prevouts per non-coinbase tx,
/// ordered as they appear (block-tx order, then input order).
///
/// CBlockUndo: CompactSize (n_txs-1), then for each CTxUndo: CompactSize (n_inputs), then
/// for each CTxInUndo: height, [version], CompressedScript, CompressedAmount.
///
/// `offset` is updated in place to point past this block's undo data.
pub fn parse_block_undo(data: &[u8], offset: &mut usize, n_txs: usize) -> Result<Vec<Vec<UndoPrevout>>, ChainLensError> {
    let mut all_txs: Vec<Vec<UndoPrevout>> = Vec::new();

    for _ in 0..(n_txs.saturating_sub(1)) {
        let n_inputs = read_varint(data, offset)? as usize;
        let mut tx_prevouts: Vec<UndoPrevout> = Vec::with_capacity(n_inputs);
        for _ in 0..n_inputs {
            let prevout = read_one_txin_undo(data, offset)?;
            tx_prevouts.push(prevout);
        }
        all_txs.push(tx_prevouts);
    }
    Ok(all_txs)
}

