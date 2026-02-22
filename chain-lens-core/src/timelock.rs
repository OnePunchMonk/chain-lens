/// Timelock parsing: absolute locktime + per-input BIP68 relative timelocks.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LocktimeInfo {
    pub locktime_type: String,
    pub locktime_value: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelativeTimelock {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<u64>,
}

impl LocktimeInfo {
    pub fn from_locktime(locktime: u32) -> Self {
        let (locktime_type, locktime_value) = if locktime == 0 {
            ("none".to_string(), 0)
        } else if locktime < 500_000_000 {
            ("block_height".to_string(), locktime)
        } else {
            ("unix_timestamp".to_string(), locktime)
        };
        LocktimeInfo { locktime_type, locktime_value }
    }
}

/// Parse per-input relative timelock from the sequence field (BIP68).
///
/// Bit 31 set → timelock disabled (`enabled: false`)
/// If bit 22 (0x00400000) set → time-based (value in units of 512 seconds)
/// Otherwise → block-based
pub fn parse_relative_timelock(sequence: u32) -> RelativeTimelock {
    // If bit 31 is set, relative timelock is disabled for this input.
    if sequence & 0x8000_0000 != 0 {
        return RelativeTimelock { enabled: false, r#type: None, value: None };
    }
    // 0xffffffff and 0xfffffffe also disable relative timelocks (final-ness)
    if sequence >= 0xffff_fffe {
        return RelativeTimelock { enabled: false, r#type: None, value: None };
    }

    let low16 = (sequence & 0x0000_ffff) as u64;

    if sequence & 0x0040_0000 != 0 {
        // Time-based: value is low16 * 512 seconds
        RelativeTimelock {
            enabled: true,
            r#type: Some("time".to_string()),
            value: Some(low16 * 512),
        }
    } else {
        // Block-based
        RelativeTimelock {
            enabled: true,
            r#type: Some("blocks".to_string()),
            value: Some(low16),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bit31_disabled() {
        let rt = parse_relative_timelock(0x80000000);
        assert!(!rt.enabled);
    }

    #[test]
    fn test_final_sequence_disabled() {
        let rt = parse_relative_timelock(0xffffffff);
        assert!(!rt.enabled);
    }

    #[test]
    fn test_block_based() {
        let rt = parse_relative_timelock(7);
        assert!(rt.enabled);
        assert_eq!(rt.r#type.as_deref(), Some("blocks"));
        assert_eq!(rt.value, Some(7));
    }

    #[test]
    fn test_time_based() {
        // bit 22 set, low16 = 10 → 10 * 512 = 5120 seconds
        let seq = 0x00400000u32 | 10u32;
        let rt = parse_relative_timelock(seq);
        assert!(rt.enabled);
        assert_eq!(rt.r#type.as_deref(), Some("time"));
        assert_eq!(rt.value, Some(5120));
    }

    #[test]
    fn test_locktime_none() {
        let info = LocktimeInfo::from_locktime(0);
        assert_eq!(info.locktime_type, "none");
    }

    #[test]
    fn test_locktime_block() {
        let info = LocktimeInfo::from_locktime(800_000);
        assert_eq!(info.locktime_type, "block_height");
    }

    #[test]
    fn test_locktime_timestamp() {
        let info = LocktimeInfo::from_locktime(1_700_000_000);
        assert_eq!(info.locktime_type, "unix_timestamp");
    }
}
