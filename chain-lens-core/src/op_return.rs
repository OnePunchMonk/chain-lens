/// OP_RETURN payload decoding.
///
/// Handles all valid push opcodes after OP_RETURN, including
/// OP_PUSHDATA1, OP_PUSHDATA2, OP_PUSHDATA4, and multiple pushes.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct OpReturnInfo {
    pub op_return_data_hex: String,
    pub op_return_data_utf8: Option<String>,
    pub op_return_protocol: String,
}

/// Parse OP_RETURN data from raw script bytes.
/// `script` must be the full scriptPubKey including the leading 0x6a.
pub fn parse_op_return(script: &[u8]) -> OpReturnInfo {
    assert!(!script.is_empty() && script[0] == 0x6a, "not an OP_RETURN script");

    let mut raw_data: Vec<u8> = Vec::new();
    let mut i = 1usize; // skip the 0x6a opcode itself

    while i < script.len() {
        let op = script[i];
        i += 1;
        match op {
            0x00 => {
                // OP_0 — zero-byte push; contributes nothing
            }
            n @ 0x01..=0x4b => {
                // Direct push of n bytes
                let end = i + n as usize;
                if end <= script.len() {
                    raw_data.extend_from_slice(&script[i..end]);
                    i = end;
                } else {
                    // Truncated — take what we have
                    raw_data.extend_from_slice(&script[i..]);
                    i = script.len();
                }
            }
            0x4c => {
                // OP_PUSHDATA1: 1-byte length
                if i < script.len() {
                    let len = script[i] as usize;
                    i += 1;
                    let end = (i + len).min(script.len());
                    raw_data.extend_from_slice(&script[i..end]);
                    i = end;
                }
            }
            0x4d => {
                // OP_PUSHDATA2: 2-byte LE length
                if i + 1 < script.len() {
                    let len = u16::from_le_bytes([script[i], script[i + 1]]) as usize;
                    i += 2;
                    let end = (i + len).min(script.len());
                    raw_data.extend_from_slice(&script[i..end]);
                    i = end;
                }
            }
            0x4e => {
                // OP_PUSHDATA4: 4-byte LE length
                if i + 3 < script.len() {
                    let len = u32::from_le_bytes([
                        script[i], script[i + 1], script[i + 2], script[i + 3],
                    ]) as usize;
                    i += 4;
                    let end = (i + len).min(script.len());
                    raw_data.extend_from_slice(&script[i..end]);
                    i = end;
                }
            }
            _ => {
                // Non-push opcode after OP_RETURN — unusual, skip
            }
        }
    }

    let op_return_data_hex = hex::encode(&raw_data);
    let op_return_data_utf8 = String::from_utf8(raw_data.clone()).ok();
    let op_return_protocol = detect_protocol(&raw_data);

    OpReturnInfo {
        op_return_data_hex,
        op_return_data_utf8,
        op_return_protocol,
    }
}

fn detect_protocol(data: &[u8]) -> String {
    if data.starts_with(&[0x6f, 0x6d, 0x6e, 0x69]) {
        "omni".to_string()
    } else if data.starts_with(&[0x01, 0x09, 0xf9, 0x11, 0x02]) {
        "opentimestamps".to_string()
    } else {
        "unknown".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bare_op_return() {
        let script = hex::decode("6a").unwrap();
        let info = parse_op_return(&script);
        assert_eq!(info.op_return_data_hex, "");
        assert_eq!(info.op_return_protocol, "unknown");
    }

    #[test]
    fn test_direct_push() {
        // 6a 08 736f622d32303236
        let script = hex::decode("6a08736f622d32303236").unwrap();
        let info = parse_op_return(&script);
        assert_eq!(info.op_return_data_hex, "736f622d32303236");
        assert_eq!(info.op_return_data_utf8.as_deref(), Some("sob-2026"));
        assert_eq!(info.op_return_protocol, "unknown");
    }

    #[test]
    fn test_pushdata1() {
        // 6a 4c 08 736f622d32303236
        let mut script = vec![0x6a, 0x4c, 0x08];
        script.extend_from_slice(b"sob-2026");
        let info = parse_op_return(&script);
        assert_eq!(info.op_return_data_hex, hex::encode(b"sob-2026"));
    }

    #[test]
    fn test_omni_protocol() {
        let mut script = vec![0x6a, 0x04];
        script.extend_from_slice(&[0x6f, 0x6d, 0x6e, 0x69]);
        let info = parse_op_return(&script);
        assert_eq!(info.op_return_protocol, "omni");
    }

    #[test]
    fn test_multiple_pushes() {
        // OP_RETURN OP_PUSHBYTES_2 aabb OP_PUSHBYTES_2 ccdd → aabbccdd
        let script = [0x6a, 0x02, 0xaa, 0xbb, 0x02, 0xcc, 0xdd];
        let info = parse_op_return(&script);
        assert_eq!(info.op_return_data_hex, "aabbccdd");
    }
}
