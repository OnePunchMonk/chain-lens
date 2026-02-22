use axum::{
    extract::{DefaultBodyLimit, Multipart, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chain_lens_core::block_parser::parse_blocks_from_file;
use chain_lens_core::parser::Prevout;
use chain_lens_core::xor::decode_file;
use chain_lens_core::{parse_transaction_with_prevouts, ErrorObject};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

#[derive(Clone)]
struct AppState;

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
}

#[tokio::main]
async fn main() {
    // Locate web dist relative to current working directory
    let web_dist = std::env::current_dir().unwrap().join("web").join("dist");

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/analyze", post(analyze))
        .route("/api/analyze-block-upload", post(analyze_block_upload))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024)) // 512 MB limit for block uploads
        .layer(CorsLayer::permissive())
        .with_state(AppState)
        .fallback_service(ServeDir::new(&web_dist).append_index_html_on_directories(true));

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    // Spec: Must print a single line containing the URL to stdout
    println!("http://127.0.0.1:{}", port);
    eprintln!("Serving static files from: {}", web_dist.display());
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

async fn analyze(
    State(_state): State<AppState>,
    body: axum::extract::Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    let body = body.0;

    // Check if block mode
    if body.get("mode").and_then(|v| v.as_str()) == Some("block") {
        return analyze_block(body).await;
    }

    // Transaction mode
    let raw_tx = match body.get("raw_tx").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false,
                    "error": {"code": "INVALID_FIXTURE", "message": "missing raw_tx field"}
                })),
            )
        }
    };

    let prevouts: Vec<Prevout> = body
        .get("prevouts")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let result = match parse_transaction_with_prevouts(&raw_tx, &prevouts) {
        Ok(tx) => serde_json::to_value(tx).unwrap(),
        Err(err) => {
            let err_obj = ErrorObject::from_error(err);
            serde_json::to_value(err_obj).unwrap()
        }
    };
    (StatusCode::OK, Json(result))
}

async fn analyze_block(body: serde_json::Value) -> (StatusCode, Json<serde_json::Value>) {
    let block_data_hex = match body.get("block_data_hex").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false,
                    "error": {"code": "INVALID_ARGS", "message": "missing block_data_hex"}
                })),
            )
        }
    };

    let undo_data_hex = body
        .get("undo_data_hex")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let xor_key_hex = body
        .get("xor_key_hex")
        .and_then(|v| v.as_str())
        .unwrap_or("0000000000000000")
        .to_string();

    // Decode hex inputs
    let blk_raw = match hex::decode(&block_data_hex) {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false,
                    "error": {"code": "INVALID_ARGS", "message": format!("block_data_hex decode: {}", e)}
                })),
            )
        }
    };

    let rev_raw = if undo_data_hex.is_empty() {
        vec![]
    } else {
        hex::decode(&undo_data_hex).unwrap_or_default()
    };

    let xor_key_bytes = hex::decode(&xor_key_hex).unwrap_or_default();
    let mut key = [0u8; 8];
    let copy_len = xor_key_bytes.len().min(8);
    key[..copy_len].copy_from_slice(&xor_key_bytes[..copy_len]);

    let blk_data = decode_file(&blk_raw, &key);
    let rev_data = decode_file(&rev_raw, &key);

    match parse_blocks_from_file(&blk_data, &rev_data) {
        Ok(reports) => {
            let val = serde_json::to_value(&reports).unwrap();
            (StatusCode::OK, Json(val))
        }
        Err(e) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({
                "ok": false,
                "error": {"code": "PARSE_ERROR", "message": e.to_string()}
            })),
        ),
    }
}

/// Accept block files as binary multipart/form-data uploads.
/// Fields: "blk" (required), "rev" (optional), "xor" (optional, 8-byte key).
async fn analyze_block_upload(mut multipart: Multipart) -> (StatusCode, Json<serde_json::Value>) {
    let mut blk_raw: Option<Vec<u8>> = None;
    let mut rev_raw: Vec<u8> = vec![];
    let mut xor_key: [u8; 8] = [0u8; 8];

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match field.bytes().await {
            Ok(data) => match name.as_str() {
                "blk" => {
                    blk_raw = Some(data.to_vec());
                }
                "rev" => {
                    rev_raw = data.to_vec();
                }
                "xor" => {
                    let copy_len = data.len().min(8);
                    xor_key[..copy_len].copy_from_slice(&data[..copy_len]);
                }
                _ => {}
            },
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "ok": false,
                        "error": {"code": "UPLOAD_ERROR", "message": format!("Failed to read field '{}': {}", name, e)}
                    })),
                );
            }
        }
    }

    let blk_raw = match blk_raw {
        Some(b) if !b.is_empty() => b,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false,
                    "error": {"code": "INVALID_ARGS", "message": "missing 'blk' file upload"}
                })),
            );
        }
    };

    let blk_data = decode_file(&blk_raw, &xor_key);
    let rev_data = decode_file(&rev_raw, &xor_key);

    match parse_blocks_from_file(&blk_data, &rev_data) {
        Ok(reports) => {
            let val = serde_json::to_value(&reports).unwrap();
            (StatusCode::OK, Json(val))
        }
        Err(e) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({
                "ok": false,
                "error": {"code": "PARSE_ERROR", "message": e.to_string()}
            })),
        ),
    }
}
