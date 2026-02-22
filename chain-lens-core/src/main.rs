use std::fs;
use std::io::{self, Read};

use chain_lens_core::{parse_transaction_with_prevouts, ErrorObject, ChainLensError};
use chain_lens_core::parser::Prevout;
use chain_lens_core::block_parser::parse_blocks_from_file;
use chain_lens_core::xor::{load_xor_key, decode_file};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
struct TxFixture {
    #[serde(default = "default_network")]
    network: String,
    raw_tx: String,
    #[serde(default)]
    prevouts: Vec<Prevout>,
}

fn default_network() -> String {
    "mainnet".to_string()
}

fn main() {
    std::process::exit(match real_main() {
        Ok(()) => 0,
        Err(_) => 1,
    });
}

fn real_main() -> Result<(), ChainLensError> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() >= 2 && args[1] == "--block" {
        return block_mode(&args[2..]);
    }

    // Single-transaction mode
    if args.len() < 2 {
        let err = ErrorObject::from_error(ChainLensError::InvalidFixture(
            "Usage: chain-lens-core <fixture.json> | --block <blk.dat> <rev.dat> <xor.dat>".into(),
        ));
        eprintln!("{}", serde_json::to_string_pretty(&err).unwrap());
        return Err(ChainLensError::InvalidFixture("no args".into()));
    }

    let path = &args[1];
    let contents = if path == "-" {
        let mut buf = String::new();
        io::stdin()
            .read_to_string(&mut buf)
            .map_err(|e| ChainLensError::InvalidFixture(format!("stdin: {}", e)))?;
        buf
    } else {
        fs::read_to_string(path)
            .map_err(|e| ChainLensError::InvalidFixture(format!("read file: {}", e)))?
    };

    let fixture: TxFixture = serde_json::from_str(&contents)
        .map_err(|e| ChainLensError::InvalidFixture(format!("JSON parse: {}", e)))?;

    let result = match parse_transaction_with_prevouts(&fixture.raw_tx, &fixture.prevouts) {
        Ok(tx) => {
            let val = serde_json::to_value(&tx).unwrap();
            let txid = tx.txid.clone();
            // Write out/<txid>.json
            fs::create_dir_all("out").ok();
            let out_path = format!("out/{}.json", txid);
            fs::write(&out_path, serde_json::to_string_pretty(&val).unwrap())
                .map_err(|e| ChainLensError::ParseError(format!("write output: {}", e)))?;
            val
        }
        Err(err) => {
            let err_obj = ErrorObject::from_error(err);
            let val = serde_json::to_value(&err_obj).unwrap();
            eprintln!("{}", serde_json::to_string_pretty(&val).unwrap());
            println!("{}", serde_json::to_string_pretty(&val).unwrap());
            return Err(ChainLensError::ParseError("transaction parse failed".into()));
        }
    };

    println!("{}", serde_json::to_string_pretty(&result).unwrap());
    Ok(())
}

fn block_mode(args: &[String]) -> Result<(), ChainLensError> {
    if args.len() < 3 {
        let err = json!({
            "ok": false,
            "error": {
                "code": "INVALID_ARGS",
                "message": "Block mode requires: --block <blk.dat> <rev.dat> <xor.dat>"
            }
        });
        eprintln!("{}", serde_json::to_string_pretty(&err).unwrap());
        return Err(ChainLensError::ParseError("insufficient args".into()));
    }

    let blk_path = &args[0];
    let rev_path = &args[1];
    let xor_path = &args[2];

    // Read XOR key
    let xor_key = load_xor_key(xor_path)?;

    // Read and decode block file
    let blk_raw = fs::read(blk_path)
        .map_err(|e| ChainLensError::ParseError(format!("read blk: {}", e)))?;
    let blk_data = decode_file(&blk_raw, &xor_key);

    // Read and decode undo file
    let rev_raw = fs::read(rev_path)
        .map_err(|e| ChainLensError::ParseError(format!("read rev: {}", e)))?;
    let rev_data = decode_file(&rev_raw, &xor_key);

    // Parse all blocks
    let reports = match parse_blocks_from_file(&blk_data, &rev_data) {
        Ok(r) => r,
        Err(e) => {
            let err = json!({
                "ok": false,
                "error": {
                    "code": "PARSE_ERROR",
                    "message": e.to_string()
                }
            });
            eprintln!("{}", serde_json::to_string_pretty(&err).unwrap());
            return Err(e);
        }
    };

    fs::create_dir_all("out")
        .map_err(|e| ChainLensError::ParseError(format!("create out dir: {}", e)))?;

    for report in &reports {
        let block_hash = &report.block_header.block_hash;
        let out_path = format!("out/{}.json", block_hash);
        let json_str = serde_json::to_string_pretty(report).unwrap();
        fs::write(&out_path, &json_str)
            .map_err(|e| ChainLensError::ParseError(format!("write block output: {}", e)))?;
        eprintln!("Written: {}", out_path);
    }

    Ok(())
}
