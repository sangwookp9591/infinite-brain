//! A single error type shared by all commands. It serializes to a plain string
//! so the React layer receives a readable message from `invoke(...)` rejections.

use serde::{Serialize, Serializer};
use std::path::Path;

#[derive(Debug)]
pub struct AppError(pub String);

impl AppError {
    pub fn new(msg: impl Into<String>) -> Self {
        AppError(msg.into())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

macro_rules! from_err {
    ($t:ty) => {
        impl From<$t> for AppError {
            fn from(e: $t) -> Self {
                AppError(e.to_string())
            }
        }
    };
}

from_err!(std::io::Error);
from_err!(rusqlite::Error);
from_err!(serde_json::Error);
from_err!(notify::Error);
from_err!(tauri::Error);

/// Turn an `std::io::Error` into an [`AppError`] that names the operation AND
/// the path, and log it on the way out.
///
/// The blanket `From<std::io::Error>` above keeps only the OS message, which is
/// how a Windows join reached the UI as a bare "The system cannot find the file
/// specified. (os error 2)" on both folder-setup buttons (#128): three different
/// `create_dir_all`/`write` calls on that one path can produce it — the vault
/// folder, `<vault>/.context`, and the app config dir — and the message said
/// which of them nothing at all. Every I/O call on the vault-open path goes
/// through this instead; the blanket impl stays for the long tail.
///
/// `op` is a user-facing verb phrase that has to read *before* the path, because
/// this string is what the UI displays verbatim (the vault-setup prompt shows
/// the Rust error). `io_ctx("create the folder", p)` renders:
///
/// ```text
/// Couldn't create the folder C:\Users\a\Documents\Baalda Vaults\Team: The system cannot find the file specified. (os error 2)
/// ```
///
/// It also writes the same line to the log at `error` level, so the rotating
/// release log file (see `lib.rs`) carries every one of these without the user
/// having to screenshot the dialog.
pub fn io_ctx(
    op: impl Into<String>,
    path: impl AsRef<Path>,
) -> impl FnOnce(std::io::Error) -> AppError {
    let op = op.into();
    let path = path.as_ref().display().to_string();
    move |e| {
        let err = AppError(format!("Couldn't {op} {path}: {e}"));
        log::error!("[io] {err}");
        err
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    fn not_found() -> std::io::Error {
        // Same shape as the Windows failure in #128: ENOENT /
        // ERROR_FILE_NOT_FOUND formats as "... (os error 2)" on every platform.
        std::io::Error::from_raw_os_error(2)
    }

    #[test]
    fn io_ctx_names_the_operation_the_path_and_the_os_error() {
        let path = Path::new("/tmp/some vault/.context");
        let err = io_ctx("create the folder", path)(not_found());
        let msg = err.to_string();
        assert!(msg.starts_with("Couldn't create the folder "), "{msg}");
        assert!(msg.contains("/tmp/some vault/.context"), "{msg}");
        assert!(msg.contains("os error 2"), "{msg}");
    }

    #[test]
    fn io_ctx_message_survives_serialization() {
        // The UI receives this string and nothing else, so the context has to be
        // inside the message rather than beside it.
        let err = io_ctx("write the settings file", "/nope/config.json")(not_found());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("write the settings file"), "{json}");
        assert!(json.contains("/nope/config.json"), "{json}");
    }

    #[test]
    fn blanket_from_io_error_still_drops_context() {
        // Documents the contract the hot path opts out of: the plain `?`
        // conversion carries no path, which is exactly why `io_ctx` exists.
        let err: AppError = not_found().into();
        assert!(!err.to_string().contains("Couldn't"));
    }
}
