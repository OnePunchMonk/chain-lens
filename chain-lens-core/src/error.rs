use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ChainLensError {
    #[error("Invalid fixture: {0}")]
    InvalidFixture(String),
    #[error("Invalid transaction: {0}")]
    InvalidTx(String),
    #[error("Missing prevout: {0}")]
    MissingPrevout(String),
    #[error("Duplicate prevout: {0}")]
    DuplicatePrevout(String),
    #[error("Inconsistent prevouts: {0}")]
    InconsistentPrevouts(String),
    #[error("Parse error: {0}")]
    ParseError(String),
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidFixture,
    InvalidTx,
    MissingPrevout,
    DuplicatePrevout,
    InconsistentPrevouts,
    ParseError,
}

#[derive(Debug, Serialize)]
pub struct ErrorObject {
    pub ok: bool,
    pub error: ErrorBody,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: ErrorCode,
    pub message: String,
}

impl ErrorObject {
    pub fn from_error(err: ChainLensError) -> Self {
        let (code, message) = match err {
            ChainLensError::InvalidFixture(msg) => (ErrorCode::InvalidFixture, msg),
            ChainLensError::InvalidTx(msg) => (ErrorCode::InvalidTx, msg),
            ChainLensError::MissingPrevout(msg) => (ErrorCode::MissingPrevout, msg),
            ChainLensError::DuplicatePrevout(msg) => (ErrorCode::DuplicatePrevout, msg),
            ChainLensError::InconsistentPrevouts(msg) => (ErrorCode::InconsistentPrevouts, msg),
            ChainLensError::ParseError(msg) => (ErrorCode::ParseError, msg),
        };
        Self {
            ok: false,
            error: ErrorBody { code, message },
        }
    }
}

