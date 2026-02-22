/// XOR decoding for Bitcoin Core blk*.dat and rev*.dat files.
///
/// Bitcoin Core (since v22) obfuscates block data files with an 8-byte XOR key
/// stored in xor.dat. This module reads the key and applies it.

use crate::error::ChainLensError;

/// Read the 8-byte XOR key from xor.dat.
pub fn read_xor_key(xor_dat: &[u8]) -> [u8; 8] {
    let mut key = [0u8; 8];
    let len = xor_dat.len().min(8);
    key[..len].copy_from_slice(&xor_dat[..len]);
    key
}

/// XOR-decode a data buffer using the cycling 8-byte key.
/// If the key is all zeros, returns the data unchanged.
pub fn xor_decode(data: &mut Vec<u8>, key: &[u8; 8]) {
    if key.iter().all(|b| *b == 0) {
        return; // no-op for zero key
    }
    for (i, byte) in data.iter_mut().enumerate() {
        *byte ^= key[i % 8];
    }
}

/// Convenience: read file, decode, return bytes.
pub fn decode_file(raw: &[u8], key: &[u8; 8]) -> Vec<u8> {
    let mut data = raw.to_vec();
    xor_decode(&mut data, key);
    data
}

/// Read XOR key from xor.dat path.
pub fn load_xor_key(path: &str) -> Result<[u8; 8], ChainLensError> {
    let bytes = std::fs::read(path)
        .map_err(|e| ChainLensError::ParseError(format!("cannot read xor.dat: {}", e)))?;
    Ok(read_xor_key(&bytes))
}
