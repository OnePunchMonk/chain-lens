/// Bitcoin Core undo file (rev*.dat) parser.
///
/// The undo file contains the prevout data for every non-coinbase input spent
/// in a block, using Bitcoin Core's script compression scheme.
///
/// IMPORTANT: Bitcoin Core uses TWO different varint formats:
///   1. CompactSize — for vector lengths / element counts (read_varint / read_compact_size)
///   2. Bitcoin Core VarInt — MSB continuation-bit encoding, used for height, amount, nSize
///      (read_btc_varint below)
///
/// These are NOT interchangeable. Mixing them up causes wildly wrong values.
use crate::error::ChainLensError;
use crate::parser::read_varint; // CompactSize — only for vector element counts

/// A prevout recovered from the undo file.
#[derive(Debug, Clone)]
pub struct UndoPrevout {
    pub value_sats: u64,
    pub script_pubkey: Vec<u8>,
}

/// Read a Bitcoin Core internal VarInt (MSB continuation-bit encoding).
///
/// This is the format used by the VARINT() macro in Bitcoin Core's serialize.h.
/// Each byte stores 7 data bits in bits 0–6. Bit 7 (0x80) is a continuation flag:
///   - If set: more bytes follow, and the accumulated value is incremented by 1
///     (to ensure canonical encoding — no leading-zero ambiguity).
///   - If clear: this is the last byte.
///
/// Decode algorithm from Bitcoin Core:
///   n = 0;
///   loop {
///       byte = read();
///       n = (n << 7) | (byte & 0x7F);
///       if byte & 0x80 { n += 1; continue; }
///       else { return n; }
///   }
fn read_btc_varint(data: &[u8], offset: &mut usize) -> Result<u64, ChainLensError> {
    let mut n: u64 = 0;
    loop {
        if *offset >= data.len() {
            return Err(ChainLensError::ParseError(format!(
                "undo data truncated reading btc varint at offset {}",
                offset
            )));
        }
        let ch = data[*offset];
        *offset += 1;
        n = (n << 7) | (ch & 0x7F) as u64;
        if ch & 0x80 != 0 {
            n += 1;
        } else {
            return Ok(n);
        }
    }
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
/// nSize encoding (read via Bitcoin Core VarInt, NOT CompactSize):
///   0 → P2PKH (20-byte hash follows)
///   1 → P2SH (20-byte hash follows)  
///   2 → P2PK compressed pubkey (even, 32 bytes follow)
///   3 → P2PK compressed pubkey (odd,  32 bytes follow)
///   4 → P2PK uncompressed pubkey, even prefix (32 bytes follow)
///   5 → P2PK uncompressed pubkey, odd prefix  (32 bytes follow)
///   n≥6 → raw script, length = n - 6
pub fn parse_undo_script(data: &[u8], offset: &mut usize) -> Result<Vec<u8>, ChainLensError> {
    let n_size = read_btc_varint(data, offset)?;
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

/// Parse one Coin from the undo data (modern Bitcoin Core format, post-0.15).
///
/// Format (from coins.h Coin::Serialize):
///   BTC-VarInt(code)  where code = nHeight * 2 + fCoinBase
///   TxOutCompression:
///     BTC-VarInt(CompressAmount(value))
///     CompressScript → BTC-VarInt(nSize) + script_data
///
/// NOTE: Modern Bitcoin Core does NOT write a version field.
/// The old format (pre-0.15) encoded code = 4*height + 2*coinbase + has_version
/// and conditionally wrote a version varint. The new Coin format removed this.
fn read_one_txin_undo(data: &[u8], offset: &mut usize) -> Result<UndoPrevout, ChainLensError> {
    // code = height * 2 + coinbase_flag (Bitcoin Core VarInt)
    let _code = read_btc_varint(data, offset)?;
    // No version field in modern Coin format

    // Compressed amount (Bitcoin Core VarInt)
    let compressed_value = read_btc_varint(data, offset)?;
    let value_sats = decompress_amount(compressed_value);

    // Compressed script (nSize via Bitcoin Core VarInt, then script bytes)
    let script_pubkey = parse_undo_script(data, offset)?;
    Ok(UndoPrevout {
        value_sats,
        script_pubkey,
    })
}

/// Parse the undo file for one block: returns prevouts per non-coinbase tx,
/// ordered as they appear (block-tx order, then input order).
///
/// CBlockUndo layout:
///   CompactSize(n_txs - 1)   ← number of CTxUndo entries (excludes coinbase)
///   For each CTxUndo:
///     CompactSize(n_inputs)  ← number of Coin entries
///     For each Coin:
///       BTC-VarInt(code)     ← height * 2 + coinbase
///       BTC-VarInt(amount)   ← compressed amount
///       BTC-VarInt(nSize)    ← script compression type
///       [script bytes]       ← depends on nSize
///
/// Vector counts use CompactSize; internal fields use Bitcoin Core VarInt.
pub fn parse_block_undo(
    data: &[u8],
    offset: &mut usize,
    _n_txs: usize,
) -> Result<Vec<Vec<UndoPrevout>>, ChainLensError> {
    let mut all_txs: Vec<Vec<UndoPrevout>> = Vec::new();

    // CompactSize for vector length (how many CTxUndo entries = n_tx - 1)
    let vec_len = read_varint(data, offset)? as usize;

    for _ in 0..vec_len {
        // CompactSize for per-tx input count (vector<Coin> length)
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
