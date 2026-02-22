/// Script disassembly for Bitcoin scripts.
///
/// Converts raw script bytes into human-readable opcodes.
/// Format follows Bitcoin Core conventions.

pub fn disassemble(script: &[u8]) -> String {
    if script.is_empty() {
        return String::new();
    }
    let mut tokens: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < script.len() {
        let op = script[i];
        i += 1;
        match op {
            0x00 => tokens.push("OP_0".to_string()),
            // Direct data push: 0x01–0x4b
            n @ 0x01..=0x4b => {
                let len = n as usize;
                if i + len > script.len() {
                    tokens.push(format!("[truncated push {}]", n));
                    break;
                }
                let data = hex::encode(&script[i..i + len]);
                tokens.push(format!("OP_PUSHBYTES_{} {}", len, data));
                i += len;
            }
            0x4c => {
                // OP_PUSHDATA1: 1-byte length follows
                if i >= script.len() {
                    tokens.push("[truncated OP_PUSHDATA1]".to_string());
                    break;
                }
                let len = script[i] as usize;
                i += 1;
                if i + len > script.len() {
                    tokens.push("[truncated OP_PUSHDATA1 data]".to_string());
                    break;
                }
                let data = hex::encode(&script[i..i + len]);
                tokens.push(format!("OP_PUSHDATA1 {}", data));
                i += len;
            }
            0x4d => {
                // OP_PUSHDATA2: 2-byte LE length follows
                if i + 1 >= script.len() {
                    tokens.push("[truncated OP_PUSHDATA2]".to_string());
                    break;
                }
                let len = u16::from_le_bytes([script[i], script[i + 1]]) as usize;
                i += 2;
                if i + len > script.len() {
                    tokens.push("[truncated OP_PUSHDATA2 data]".to_string());
                    break;
                }
                let data = hex::encode(&script[i..i + len]);
                tokens.push(format!("OP_PUSHDATA2 {}", data));
                i += len;
            }
            0x4e => {
                // OP_PUSHDATA4: 4-byte LE length follows
                if i + 3 >= script.len() {
                    tokens.push("[truncated OP_PUSHDATA4]".to_string());
                    break;
                }
                let len = u32::from_le_bytes([script[i], script[i + 1], script[i + 2], script[i + 3]]) as usize;
                i += 4;
                if i + len > script.len() {
                    tokens.push("[truncated OP_PUSHDATA4 data]".to_string());
                    break;
                }
                let data = hex::encode(&script[i..i + len]);
                tokens.push(format!("OP_PUSHDATA4 {}", data));
                i += len;
            }
            0x4f => tokens.push("OP_1NEGATE".to_string()),
            0x50 => tokens.push("OP_RESERVED".to_string()),
            0x51 => tokens.push("OP_1".to_string()),
            0x52 => tokens.push("OP_2".to_string()),
            0x53 => tokens.push("OP_3".to_string()),
            0x54 => tokens.push("OP_4".to_string()),
            0x55 => tokens.push("OP_5".to_string()),
            0x56 => tokens.push("OP_6".to_string()),
            0x57 => tokens.push("OP_7".to_string()),
            0x58 => tokens.push("OP_8".to_string()),
            0x59 => tokens.push("OP_9".to_string()),
            0x5a => tokens.push("OP_10".to_string()),
            0x5b => tokens.push("OP_11".to_string()),
            0x5c => tokens.push("OP_12".to_string()),
            0x5d => tokens.push("OP_13".to_string()),
            0x5e => tokens.push("OP_14".to_string()),
            0x5f => tokens.push("OP_15".to_string()),
            0x60 => tokens.push("OP_16".to_string()),
            // Flow control
            0x61 => tokens.push("OP_NOP".to_string()),
            0x62 => tokens.push("OP_VER".to_string()),
            0x63 => tokens.push("OP_IF".to_string()),
            0x64 => tokens.push("OP_NOTIF".to_string()),
            0x65 => tokens.push("OP_VERIF".to_string()),
            0x66 => tokens.push("OP_VERNOTIF".to_string()),
            0x67 => tokens.push("OP_ELSE".to_string()),
            0x68 => tokens.push("OP_ENDIF".to_string()),
            0x69 => tokens.push("OP_VERIFY".to_string()),
            0x6a => tokens.push("OP_RETURN".to_string()),
            // Stack ops
            0x6b => tokens.push("OP_TOALTSTACK".to_string()),
            0x6c => tokens.push("OP_FROMALTSTACK".to_string()),
            0x6d => tokens.push("OP_2DROP".to_string()),
            0x6e => tokens.push("OP_2DUP".to_string()),
            0x6f => tokens.push("OP_3DUP".to_string()),
            0x70 => tokens.push("OP_2OVER".to_string()),
            0x71 => tokens.push("OP_2ROT".to_string()),
            0x72 => tokens.push("OP_2SWAP".to_string()),
            0x73 => tokens.push("OP_IFDUP".to_string()),
            0x74 => tokens.push("OP_DEPTH".to_string()),
            0x75 => tokens.push("OP_DROP".to_string()),
            0x76 => tokens.push("OP_DUP".to_string()),
            0x77 => tokens.push("OP_NIP".to_string()),
            0x78 => tokens.push("OP_OVER".to_string()),
            0x79 => tokens.push("OP_PICK".to_string()),
            0x7a => tokens.push("OP_ROLL".to_string()),
            0x7b => tokens.push("OP_ROT".to_string()),
            0x7c => tokens.push("OP_SWAP".to_string()),
            0x7d => tokens.push("OP_TUCK".to_string()),
            // Splice ops
            0x7e => tokens.push("OP_CAT".to_string()),
            0x7f => tokens.push("OP_SUBSTR".to_string()),
            0x80 => tokens.push("OP_LEFT".to_string()),
            0x81 => tokens.push("OP_RIGHT".to_string()),
            0x82 => tokens.push("OP_SIZE".to_string()),
            // Bitwise ops
            0x83 => tokens.push("OP_INVERT".to_string()),
            0x84 => tokens.push("OP_AND".to_string()),
            0x85 => tokens.push("OP_OR".to_string()),
            0x86 => tokens.push("OP_XOR".to_string()),
            0x87 => tokens.push("OP_EQUAL".to_string()),
            0x88 => tokens.push("OP_EQUALVERIFY".to_string()),
            0x89 => tokens.push("OP_RESERVED1".to_string()),
            0x8a => tokens.push("OP_RESERVED2".to_string()),
            // Arithmetic
            0x8b => tokens.push("OP_1ADD".to_string()),
            0x8c => tokens.push("OP_1SUB".to_string()),
            0x8d => tokens.push("OP_2MUL".to_string()),
            0x8e => tokens.push("OP_2DIV".to_string()),
            0x8f => tokens.push("OP_NEGATE".to_string()),
            0x90 => tokens.push("OP_ABS".to_string()),
            0x91 => tokens.push("OP_NOT".to_string()),
            0x92 => tokens.push("OP_0NOTEQUAL".to_string()),
            0x93 => tokens.push("OP_ADD".to_string()),
            0x94 => tokens.push("OP_SUB".to_string()),
            0x95 => tokens.push("OP_MUL".to_string()),
            0x96 => tokens.push("OP_DIV".to_string()),
            0x97 => tokens.push("OP_MOD".to_string()),
            0x98 => tokens.push("OP_LSHIFT".to_string()),
            0x99 => tokens.push("OP_RSHIFT".to_string()),
            0x9a => tokens.push("OP_BOOLAND".to_string()),
            0x9b => tokens.push("OP_BOOLOR".to_string()),
            0x9c => tokens.push("OP_NUMEQUAL".to_string()),
            0x9d => tokens.push("OP_NUMEQUALVERIFY".to_string()),
            0x9e => tokens.push("OP_NUMNOTEQUAL".to_string()),
            0x9f => tokens.push("OP_LESSTHAN".to_string()),
            0xa0 => tokens.push("OP_GREATERTHAN".to_string()),
            0xa1 => tokens.push("OP_LESSTHANOREQUAL".to_string()),
            0xa2 => tokens.push("OP_GREATERTHANOREQUAL".to_string()),
            0xa3 => tokens.push("OP_MIN".to_string()),
            0xa4 => tokens.push("OP_MAX".to_string()),
            0xa5 => tokens.push("OP_WITHIN".to_string()),
            // Crypto
            0xa6 => tokens.push("OP_RIPEMD160".to_string()),
            0xa7 => tokens.push("OP_SHA1".to_string()),
            0xa8 => tokens.push("OP_SHA256".to_string()),
            0xa9 => tokens.push("OP_HASH160".to_string()),
            0xaa => tokens.push("OP_HASH256".to_string()),
            0xab => tokens.push("OP_CODESEPARATOR".to_string()),
            0xac => tokens.push("OP_CHECKSIG".to_string()),
            0xad => tokens.push("OP_CHECKSIGVERIFY".to_string()),
            0xae => tokens.push("OP_CHECKMULTISIG".to_string()),
            0xaf => tokens.push("OP_CHECKMULTISIGVERIFY".to_string()),
            // Locktime
            0xb1 => tokens.push("OP_CHECKLOCKTIMEVERIFY".to_string()),
            0xb2 => tokens.push("OP_CHECKSEQUENCEVERIFY".to_string()),
            // NOPs
            0xb0 => tokens.push("OP_NOP1".to_string()),
            0xb3 => tokens.push("OP_NOP4".to_string()),
            0xb4 => tokens.push("OP_NOP5".to_string()),
            0xb5 => tokens.push("OP_NOP6".to_string()),
            0xb6 => tokens.push("OP_NOP7".to_string()),
            0xb7 => tokens.push("OP_NOP8".to_string()),
            0xb8 => tokens.push("OP_NOP9".to_string()),
            0xb9 => tokens.push("OP_NOP10".to_string()),
            // Tapscript
            0xba => tokens.push("OP_CHECKSIGADD".to_string()),
            // Everything else
            other => tokens.push(format!("OP_UNKNOWN_{:#04x}", other)),
        }
    }
    tokens.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_op_return_asm() {
        // 6a08736f622d32303236 = OP_RETURN OP_PUSHBYTES_8 736f622d32303236
        let script = hex::decode("6a08736f622d32303236").unwrap();
        let asm = disassemble(&script);
        assert_eq!(asm, "OP_RETURN OP_PUSHBYTES_8 736f622d32303236");
    }

    #[test]
    fn test_p2pkh_asm() {
        // 76a914...88ac
        let script = hex::decode("76a914010101010101010101010101010101010101010188ac").unwrap();
        let asm = disassemble(&script);
        assert!(asm.starts_with("OP_DUP OP_HASH160 OP_PUSHBYTES_20"));
        assert!(asm.ends_with("OP_EQUALVERIFY OP_CHECKSIG"));
    }

    #[test]
    fn test_empty_script() {
        assert_eq!(disassemble(&[]), "");
    }
}
