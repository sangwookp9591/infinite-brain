// SPDX-License-Identifier: Apache-2.0
//! Smart search: on-device semantic search with EmbeddingGemma 2 (PRD §5.8 F8).
//!
//! The user turns it on; the app downloads one pinned GGUF (Q8_0, 310 MB), checks
//! its SHA-256, and runs it through llama.cpp linked into this binary. Notes never
//! leave the device. Measurements and the reasons for every constant below are in
//! `docs/reports/B0-LLAMA-SPIKE.md`; the feature as shipped is `docs/SMART-SEARCH.md`.
//!
//! - **Model** lives in `<app data>/models/`, shared by every vault. A marker file
//!   next to it says the feature is on, so "off" keeps the download and "clear"
//!   removes both.
//! - **Engine** is one thread that owns llama.cpp. The model loads on the first
//!   request and unloads on `Unload`, so turning the feature off gives the memory
//!   back without restarting the backend (llama.cpp initialises once a process).
//! - **Vectors** are a `note_vectors` table in the vault's `index.sqlite`, one row
//!   per chunk, keyed by note id and the note's content hash. A background loop
//!   embeds notes whose hash changed and drops rows whose note is gone, so it
//!   needs no hook in the watcher: whatever the index knows, this catches up to.
//! - **Ranking** blends the existing keyword results with vector hits by
//!   reciprocal rank (F8.6). Keyword search stays the answer whenever the
//!   feature is off, still downloading, or anything here fails.

use crate::error::{AppError, AppResult};
use crate::index::{Index, SearchResult};
use once_cell::sync::Lazy;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// The one artifact this build accepts (B0 §3.2, §6: Q8_0 is the default; Q4
/// changed top-3 order too often to ship without an evaluation).
const MODEL_FILE: &str = "embeddinggemma-2-Q8_0.gguf";
const MODEL_URL: &str = "https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/031f0d4b35536f69ab3509d4893c923264fcf253/embeddinggemma-2-Q8_0.gguf";
const MODEL_BYTES: u64 = 309_855_520;
const MODEL_SHA256: &str = "6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc";
const ON_MARKER: &str = "smart-search.on";

/// Everything that changes what a stored vector means (F8.4). Rows written under
/// another version are deleted, never mixed into a search.
pub const INDEX_VERSION: &str =
    "embeddinggemma-2@031f0d4/Q8_0/llama.cpp-v0.7.0/doc:title|text/ctx2048/chunk1500x16/d768";

/// Tokens per forward pass. The model's attention is not causal, so one input
/// must fit a single ubatch; inputs are cut to this, never split across passes.
const N_CTX: usize = 2048;
/// Characters per chunk and chunks per note. A note past 16 chunks (~24,000
/// characters) is searched by meaning on its first 16 only; keyword search
/// still covers all of it.
const CHUNK_CHARS: usize = 1500;
const MAX_CHUNKS: usize = 16;
/// How many vector hits join a search. More than this from a 768-d cosine
/// ranking is mostly noise: unrelated text still scores ~0.6 (B0 §4.6).
const SEMANTIC_HITS: usize = 12;
/// A vector hit must score within this of the best one. Absolute thresholds do
/// not work here (unrelated text scores 0.6-0.72, same-topic 0.85-0.93, B0
/// §4.6), so the cut is relative: without it a small vault returns every note.
/// ponytail: a starting value; tune with the B1 retrieval evaluation.
const RELATIVE_MARGIN: f32 = 0.08;
/// Notes embedded per pass of the background loop, between which the index
/// lock is free and a search can run.
const BATCH_NOTES: usize = 8;
/// Below this the model plus the app does not fit comfortably (Q8 ~0.7 GB RSS).
const MIN_MEMORY_BYTES: u64 = 6 * 1024 * 1024 * 1024;

// ---- status ----------------------------------------------------------------

/// What the settings panel, the first-run card and the search chip show.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "state")]
pub enum Status {
    /// This build has no engine (Windows and Linux for now).
    Unsupported,
    /// Off. `downloaded` says whether turning it on needs the 310 MB again.
    /// `model_bytes` everywhere is what is on disk now, a partial download included.
    Off { downloaded: bool, model_bytes: u64 },
    Downloading { received: u64, total: u64 },
    /// Loading the model and compiling the GPU shaders once.
    Preparing,
    On { model_bytes: u64, indexed: u64, total: u64 },
    /// The device cannot run it; `reason` is "memory" or "storage".
    Limited { reason: String, needed_bytes: u64, model_bytes: u64 },
    Failed { message: String, model_bytes: u64 },
}

#[derive(Default)]
enum Phase {
    #[default]
    Idle,
    Downloading { received: u64 },
    Preparing,
    Limited(&'static str),
    Failed(String),
}

static PHASE: Lazy<Mutex<Phase>> = Lazy::new(|| Mutex::new(Phase::Idle));
static CANCEL: AtomicBool = AtomicBool::new(false);
static INDEXER_STARTED: AtomicBool = AtomicBool::new(false);

fn models_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::new(format!("no app data directory: {e}")))?
        .join("models");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn model_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(models_dir(app)?.join(MODEL_FILE))
}

fn part_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(models_dir(app)?.join(format!("{MODEL_FILE}.part")))
}

/// Bytes the feature holds on disk: the model and any partial download.
fn disk_bytes(app: &AppHandle) -> u64 {
    [model_path(app), part_path(app)]
        .into_iter()
        .filter_map(|p| p.ok().and_then(|p| std::fs::metadata(p).ok()))
        .map(|m| m.len())
        .sum()
}

fn downloaded(app: &AppHandle) -> bool {
    model_path(app).map(|p| p.is_file()).unwrap_or(false)
}

fn enabled(app: &AppHandle) -> bool {
    models_dir(app).map(|d| d.join(ON_MARKER).is_file()).unwrap_or(false) && downloaded(app)
}

/// On and ready to answer searches.
pub fn ready(app: &AppHandle) -> bool {
    engine::SUPPORTED && enabled(app) && matches!(*PHASE.lock().unwrap(), Phase::Idle)
}

pub fn status(app: &AppHandle) -> Status {
    if !engine::SUPPORTED {
        return Status::Unsupported;
    }
    let model_bytes = disk_bytes(app);
    match &*PHASE.lock().unwrap() {
        Phase::Downloading { received } => {
            return Status::Downloading { received: *received, total: MODEL_BYTES }
        }
        Phase::Preparing => return Status::Preparing,
        Phase::Limited(reason) => {
            return Status::Limited {
                reason: (*reason).into(),
                needed_bytes: if *reason == "memory" { MIN_MEMORY_BYTES } else { MODEL_BYTES },
                model_bytes,
            }
        }
        Phase::Failed(message) => return Status::Failed { message: message.clone(), model_bytes },
        Phase::Idle => {}
    }
    if !enabled(app) {
        return Status::Off { downloaded: downloaded(app), model_bytes };
    }
    let (indexed, total) = with_index(app, |ix| progress(ix)).unwrap_or((0, 0));
    Status::On { model_bytes, indexed, total }
}

fn set_phase(app: &AppHandle, phase: Phase) {
    *PHASE.lock().unwrap() = phase;
    let _ = app.emit("smart-search", status(app));
}

// ---- turning it on and off -------------------------------------------------

/// Turn smart search on: check the device, download if needed, warm the engine,
/// start indexing. Returns once it is on, failed, cancelled or limited — the UI
/// follows the `smart-search` events in the meantime.
pub async fn enable(app: AppHandle) -> Status {
    if !engine::SUPPORTED {
        return Status::Unsupported;
    }
    {
        // Check and claim in one lock: a card click and the Settings toggle at
        // once must not start two downloads into the same `.part`.
        let mut phase = PHASE.lock().unwrap();
        if matches!(*phase, Phase::Downloading { .. } | Phase::Preparing) {
            drop(phase);
            return status(&app);
        }
        *phase = Phase::Preparing;
    }
    engine::accept(true);
    if physical_memory().is_some_and(|m| m < MIN_MEMORY_BYTES) {
        set_phase(&app, Phase::Limited("memory"));
        return status(&app);
    }
    if !downloaded(&app) {
        if let Err(e) = download(&app).await {
            let phase = match e {
                DownloadError::Cancelled => Phase::Idle,
                DownloadError::NoSpace => Phase::Limited("storage"),
                DownloadError::Other(m) => Phase::Failed(m),
            };
            set_phase(&app, phase);
            return status(&app);
        }
    }
    set_phase(&app, Phase::Preparing);
    let app2 = app.clone();
    let warmed = tauri::async_runtime::spawn_blocking(move || {
        let path = model_path(&app2)?;
        engine::embed(&path, vec![query_text("warm up")]).map(|_| ())
    })
    .await
    .map_err(|e| AppError::new(e.to_string()))
    .and_then(|r| r);
    match warmed.and_then(|()| Ok(std::fs::write(models_dir(&app)?.join(ON_MARKER), b"")?)) {
        Ok(()) => {
            set_phase(&app, Phase::Idle);
            start_indexer(&app);
        }
        Err(e) => set_phase(&app, Phase::Failed(e.to_string())),
    }
    status(&app)
}

/// Before the process exits (see `engine::unload_and_wait`).
pub fn shutdown() {
    CANCEL.store(true, Ordering::SeqCst);
    engine::unload_and_wait();
}

pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Off: keep the download, free the memory, stop indexing and searching by meaning.
pub fn disable(app: &AppHandle) -> AppResult<Status> {
    let marker = models_dir(app)?.join(ON_MARKER);
    if marker.exists() {
        std::fs::remove_file(marker)?;
    }
    // Refuse work before unloading, so an indexing pass already under way cannot
    // load the model again behind the user's "off".
    engine::accept(false);
    engine::unload();
    set_phase(app, Phase::Idle);
    Ok(status(app))
}

/// Clear: off, the model and any partial download gone, and this vault's
/// vectors gone (F8.3a, F8.8). Other vaults drop theirs when the indexer next
/// sees them open with no model on disk (`reconcile`).
pub fn clear(app: &AppHandle) -> AppResult<Status> {
    disable(app)?;
    for path in [model_path(app)?, part_path(app)?] {
        if path.exists() {
            std::fs::remove_file(path)?;
        }
    }
    let _ = with_index(app, |ix| {
        ix.conn().execute("DELETE FROM note_vectors", [])?;
        Ok(())
    });
    invalidate_cache();
    Ok(status(app))
}

/// At launch. A `.part` left by a quit mid-download is dropped (nothing is
/// downloading yet). The indexer always runs: while on it embeds, and while off
/// it still deletes vectors of deleted notes, and all of them once the model is
/// gone (F8.7, F8.8). The model itself loads lazily.
pub fn resume(app: &AppHandle) {
    if !engine::SUPPORTED {
        return;
    }
    if let Ok(part) = part_path(app) {
        let _ = std::fs::remove_file(part);
    }
    engine::accept(enabled(app));
    start_indexer(app);
}

// ---- download ----------------------------------------------------------------

enum DownloadError {
    Cancelled,
    NoSpace,
    Other(String),
}

impl<E: std::fmt::Display> From<E> for DownloadError {
    fn from(e: E) -> Self {
        let text = e.to_string();
        // ENOSPC / ERROR_DISK_FULL, however the layer above worded it.
        if text.contains("No space left") || text.contains("os error 28") || text.contains("os error 112") {
            DownloadError::NoSpace
        } else {
            DownloadError::Other(text)
        }
    }
}

/// Our own client: the attachments one refuses redirects, and the Hugging Face
/// `resolve` URL redirects to its CDN. No overall timeout — 310 MB on a slow link
/// is legitimately long; a stalled one is caught by the read timeout.
static HTTP: Lazy<Result<reqwest::Client, String>> = Lazy::new(|| {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
});

async fn download(app: &AppHandle) -> Result<(), DownloadError> {
    use tokio::io::AsyncWriteExt;
    let dir = models_dir(app).map_err(|e| DownloadError::Other(e.to_string()))?;
    if free_space(&dir).is_some_and(|free| free < MODEL_BYTES + 50_000_000) {
        return Err(DownloadError::NoSpace);
    }
    CANCEL.store(false, Ordering::SeqCst);
    set_phase(app, Phase::Downloading { received: 0 });
    let part = dir.join(format!("{MODEL_FILE}.part"));
    let result: Result<(), DownloadError> = async {
        let client = HTTP.as_ref().map_err(|e| DownloadError::Other(e.clone()))?;
        let mut res = client.get(MODEL_URL).send().await?.error_for_status()?;
        let mut file = tokio::fs::File::create(&part).await?;
        let mut hasher = Sha256::new();
        let mut received = 0u64;
        let mut last_emit = 0u64;
        while let Some(chunk) = res.chunk().await? {
            if CANCEL.load(Ordering::SeqCst) {
                return Err(DownloadError::Cancelled);
            }
            received += chunk.len() as u64;
            if received > MODEL_BYTES {
                return Err(DownloadError::Other("the download is larger than expected".into()));
            }
            hasher.update(&chunk);
            file.write_all(&chunk).await?;
            if received - last_emit >= 2_000_000 {
                last_emit = received;
                set_phase(app, Phase::Downloading { received });
            }
        }
        file.flush().await?;
        file.sync_all().await?;
        drop(file);
        let digest = format!("{:x}", hasher.finalize());
        if received != MODEL_BYTES || digest != MODEL_SHA256 {
            return Err(DownloadError::Other(
                "the downloaded file did not match, so it was not used. Try again.".into(),
            ));
        }
        tokio::fs::rename(&part, dir.join(MODEL_FILE)).await?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    result
}

#[cfg(unix)]
fn free_space(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    (unsafe { libc::statvfs(c.as_ptr(), &mut s) } == 0).then(|| s.f_bavail as u64 * s.f_frsize as u64)
}
#[cfg(not(unix))]
fn free_space(_: &Path) -> Option<u64> {
    None
}

#[cfg(target_os = "macos")]
fn physical_memory() -> Option<u64> {
    let mut bytes: u64 = 0;
    let mut len = std::mem::size_of::<u64>();
    let name = c"hw.memsize";
    let ok = unsafe {
        libc::sysctlbyname(name.as_ptr(), (&mut bytes as *mut u64).cast(), &mut len, std::ptr::null_mut(), 0)
    } == 0;
    ok.then_some(bytes)
}
#[cfg(not(target_os = "macos"))]
fn physical_memory() -> Option<u64> {
    None
}

// ---- text in, vectors out --------------------------------------------------

/// The model card's prompt for a document (B0 §2).
fn doc_text(title: &str, chunk: &str) -> String {
    let title = if title.trim().is_empty() { "none" } else { title.trim() };
    format!("title: {title} | text: {chunk}")
}

/// The model card's prompt for a search query.
fn query_text(q: &str) -> String {
    format!("task: search result | query: {q}")
}

/// Split a note body into at most `MAX_CHUNKS` pieces of about `CHUNK_CHARS`,
/// on blank lines where it can and mid-paragraph only when it must.
fn chunks(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let push = |cur: &mut String, out: &mut Vec<String>| {
        let t = cur.trim();
        if !t.is_empty() {
            out.push(t.to_string());
        }
        cur.clear();
    };
    for para in body.split("\n\n") {
        let n = para.chars().count();
        if cur.chars().count() + n > CHUNK_CHARS {
            push(&mut cur, &mut out);
        }
        if n > CHUNK_CHARS {
            let chars: Vec<char> = para.chars().collect();
            for piece in chars.chunks(CHUNK_CHARS) {
                out.push(piece.iter().collect::<String>().trim().to_string());
            }
        } else {
            cur.push_str(para);
            cur.push_str("\n\n");
        }
        if out.len() >= MAX_CHUNKS {
            break;
        }
    }
    push(&mut cur, &mut out);
    out.retain(|c| !c.is_empty());
    out.truncate(MAX_CHUNKS);
    out
}

/// Unit length, so ranking is a dot product. `None` for a zero or non-finite
/// vector, which is never stored (F8.4).
fn normalize(mut v: Vec<f32>) -> Option<Vec<f32>> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if !norm.is_finite() || norm == 0.0 {
        return None;
    }
    v.iter_mut().for_each(|x| *x /= norm);
    v.iter().all(|x| x.is_finite()).then_some(v)
}

fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn from_blob(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

// ---- background indexing ----------------------------------------------------

fn current_index(app: &AppHandle) -> AppResult<Arc<Mutex<Index>>> {
    let state = app.state::<crate::state::AppState>();
    let inner = state.inner.lock().unwrap();
    inner.index.clone().ok_or_else(|| AppError::new("no vault is open"))
}

fn with_index<T>(app: &AppHandle, f: impl FnOnce(&Index) -> AppResult<T>) -> AppResult<T> {
    let index = current_index(app)?;
    let guard = index.lock().unwrap();
    f(&guard)
}

fn progress(ix: &Index) -> AppResult<(u64, u64)> {
    let total: u64 = ix.conn().query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))?;
    let indexed: u64 = ix.conn().query_row(
        "SELECT COUNT(DISTINCT v.note_id) FROM note_vectors v JOIN notes n
           ON n.id = v.note_id AND v.sha256 = COALESCE(n.sha256, '') AND v.version = ?1",
        [INDEX_VERSION],
        |r| r.get(0),
    )?;
    Ok((indexed, total))
}

fn start_indexer(app: &AppHandle) {
    if INDEXER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("smart-search-index".into()).spawn(move || {
        let mut failures = 0;
        loop {
            // ponytail: polls every 2 s instead of hooking the watcher; a hook is
            // the upgrade if the idle query ever shows up in a profile.
            let pause = match reconcile(&app) {
                Ok(more) => {
                    failures = 0;
                    if more { Duration::from_millis(50) } else { Duration::from_secs(2) }
                }
                Err(e) => {
                    log::warn!("[smart-search] indexing paused: {e}");
                    failures += 1;
                    // A model that keeps failing to load is a state the user
                    // should see, not a 310 MB retry every 10 s behind "On".
                    if failures >= 3 && enabled(&app) {
                        failures = 0;
                        set_phase(&app, Phase::Failed(e.to_string()));
                    }
                    Duration::from_secs(10)
                }
            };
            std::thread::sleep(pause);
        }
    });
}

/// One pass: drop stale rows, embed up to `BATCH_NOTES` notes. `Ok(true)` when
/// there may be more to do right away.
fn reconcile(app: &AppHandle) -> AppResult<bool> {
    // No vault open is not an error, just nothing to do.
    let Ok(index) = current_index(app) else { return Ok(false) };
    if !enabled(app) || !matches!(*PHASE.lock().unwrap(), Phase::Idle) {
        // Off still deletes: a deleted note's chunk text must not outlive it,
        // and with no model on disk no vector may stay (F8.7, F8.8).
        if prune(&index, downloaded(app))? > 0 {
            let _ = app.emit("smart-search", status(app));
        }
        return Ok(false);
    }
    let more = reconcile_with(&index, &model_path(app)?)?;
    if more {
        let _ = app.emit("smart-search", status(app));
    }
    Ok(more)
}

/// Delete rows of other model versions and of notes that are gone; every row
/// when the model is not on disk. Returns how many went.
fn prune(index: &Arc<Mutex<Index>>, model_on_disk: bool) -> AppResult<usize> {
    let ix = index.lock().unwrap();
    let removed = if model_on_disk {
        ix.conn().execute(
            "DELETE FROM note_vectors WHERE version <> ?1 OR note_id NOT IN (SELECT id FROM notes)",
            [INDEX_VERSION],
        )?
    } else {
        ix.conn().execute("DELETE FROM note_vectors", [])?
    };
    if removed > 0 {
        invalidate_cache();
    }
    Ok(removed)
}

/// One pass while on. `Ok(true)` when something changed and more may follow.
fn reconcile_with(index: &Arc<Mutex<Index>>, path: &Path) -> AppResult<bool> {
    let removed = prune(index, true)?;
    let todo: Vec<(String, String, String, String)> = {
        let ix = index.lock().unwrap();
        let mut stmt = ix.conn().prepare(
            "SELECT n.id, COALESCE(n.title, ''), COALESCE(n.sha256, ''), COALESCE(f.body, '')
               FROM notes n LEFT JOIN notes_fts f ON f.rowid = n.rowid
              WHERE NOT EXISTS (SELECT 1 FROM note_vectors v
                                 WHERE v.note_id = n.id AND v.version = ?1
                                   AND v.sha256 = COALESCE(n.sha256, ''))
              LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![INDEX_VERSION, BATCH_NOTES as i64], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    if todo.is_empty() {
        return Ok(removed > 0);
    }
    let mut done: Vec<(String, String, Vec<(String, Vec<f32>)>)> = Vec::new();
    for (id, title, sha, body) in todo {
        let mut parts = chunks(&body);
        if parts.is_empty() {
            parts.push(String::new());
        }
        let vectors = engine::embed(path, parts.iter().map(|c| doc_text(&title, c)).collect())?;
        let rows = parts.into_iter().zip(vectors).filter_map(|(c, v)| normalize(v).map(|v| (c, v))).collect();
        done.push((id, sha, rows));
    }
    {
        let ix = index.lock().unwrap();
        let tx = ix.conn().unchecked_transaction()?;
        for (id, sha, rows) in &done {
            // The note changed or vanished while we embedded: skip, the next pass redoes it.
            let current: Option<String> = tx
                .query_row("SELECT COALESCE(sha256, '') FROM notes WHERE id = ?1", [id], |r| r.get(0))
                .ok();
            if current.as_deref() != Some(sha.as_str()) {
                continue;
            }
            tx.execute("DELETE FROM note_vectors WHERE note_id = ?1", [id])?;
            for (i, (text, v)) in rows.iter().enumerate() {
                tx.execute(
                    "INSERT INTO note_vectors (note_id, chunk, sha256, version, text, vec)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![id, i as i64, sha, INDEX_VERSION, text, to_blob(v)],
                )?;
            }
            // A note that produced no usable vector still gets a row, so it is not retried forever.
            if rows.is_empty() {
                tx.execute(
                    "INSERT INTO note_vectors (note_id, chunk, sha256, version, text, vec)
                     VALUES (?1, 0, ?2, ?3, '', x'')",
                    rusqlite::params![id, sha, INDEX_VERSION],
                )?;
            }
        }
        tx.commit()?;
    }
    invalidate_cache();
    Ok(true)
}

// ---- search ------------------------------------------------------------------

struct Cache {
    db: PathBuf,
    rows: Vec<(String, u32, Vec<f32>)>,
}

/// Every vector of the open vault, in memory: a search is one pass of dot
/// products. ponytail: brute force, ~3 KB a chunk, fine to a few tens of
/// thousands of chunks; an ANN index is the upgrade past that.
static CACHE: Lazy<Mutex<Option<Cache>>> = Lazy::new(|| Mutex::new(None));

fn invalidate_cache() {
    *CACHE.lock().unwrap() = None;
}

/// Keyword results, blended with vector hits when smart search is on. Any
/// failure here returns the keyword results unchanged.
pub fn blend(app: &AppHandle, index: &Arc<Mutex<Index>>, query: &str, keyword: Vec<SearchResult>) -> Vec<SearchResult> {
    if query.trim().chars().count() < 2 || !ready(app) {
        return keyword;
    }
    match model_path(app).and_then(|path| semantic_hits(index, &path, query)) {
        Ok(hits) => merge(keyword, hits, query),
        Err(e) => {
            log::warn!("[smart-search] search by meaning failed, keyword only: {e}");
            keyword
        }
    }
}

fn semantic_hits(index: &Arc<Mutex<Index>>, path: &Path, query: &str) -> AppResult<Vec<SearchResult>> {
    let q = engine::embed(path, vec![query_text(query)])?
        .pop()
        .and_then(normalize)
        .ok_or_else(|| AppError::new("the query produced no vector"))?;
    let ix = index.lock().unwrap();
    let db = ix.db_path();
    let mut cache = CACHE.lock().unwrap();
    if cache.as_ref().is_none_or(|c| c.db != db) {
        let mut stmt = ix.conn().prepare(
            "SELECT note_id, chunk, vec FROM note_vectors WHERE version = ?1 AND length(vec) > 0",
        )?;
        let rows = stmt
            .query_map([INDEX_VERSION], |r| Ok((r.get(0)?, r.get(1)?, from_blob(&r.get::<_, Vec<u8>>(2)?))))?
            .collect::<Result<Vec<_>, _>>()?;
        *cache = Some(Cache { db, rows });
    }
    // Best chunk per note.
    let mut best: HashMap<&str, (f32, u32)> = HashMap::new();
    for (id, chunk, v) in &cache.as_ref().unwrap().rows {
        let s = dot(&q, v);
        let e = best.entry(id.as_str()).or_insert((f32::MIN, 0));
        if s > e.0 {
            *e = (s, *chunk);
        }
    }
    let mut ranked: Vec<(&str, f32, u32)> = best.into_iter().map(|(id, (s, c))| (id, s, c)).collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(b.0)));
    let floor = ranked.first().map_or(f32::MIN, |r| r.1 - RELATIVE_MARGIN);
    ranked.retain(|r| r.1 >= floor);
    ranked.truncate(SEMANTIC_HITS);
    let mut out = Vec::new();
    for (id, _, chunk) in ranked {
        let row = ix.conn().query_row(
            "SELECT n.path, COALESCE(n.title, ''), v.text FROM notes n
               JOIN note_vectors v ON v.note_id = n.id AND v.chunk = ?2
              WHERE n.id = ?1",
            rusqlite::params![id, chunk],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        );
        if let Ok((path, title, text)) = row {
            out.push(SearchResult {
                id: id.to_string(),
                ext: crate::index::ext_of(&path),
                path,
                title,
                snippet: crate::index::html_escape(&excerpt(&text)),
                kind: "note".into(),
            });
        }
    }
    Ok(out)
}

/// The start of the matching chunk, one line, for the result row.
fn excerpt(text: &str) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut s: String = flat.chars().take(160).collect();
    if flat.chars().count() > 160 {
        s.push('…');
    }
    s
}

/// Reciprocal-rank fusion of the two lists (F8.6), one row per note. A note whose
/// file name is exactly the query stays first, as it would without this feature.
fn merge(keyword: Vec<SearchResult>, semantic: Vec<SearchResult>, query: &str) -> Vec<SearchResult> {
    const K: f32 = 60.0;
    // While words matched something, a note found only by meaning counts half,
    // so it cannot push a keyword match down the list (F8.6: keyword search is
    // the regression baseline). With no keyword hit, meaning is all there is.
    let semantic_weight = if keyword.is_empty() { 1.0 } else { 0.5 };
    // First-seen order (keyword rank, then vector rank) breaks ties, so the same
    // query always lists the same way.
    let mut rows: Vec<SearchResult> = Vec::new();
    let mut score: Vec<f32> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    for (list, weight) in [(keyword, 1.0f32), (semantic, semantic_weight)] {
        for (rank, r) in list.into_iter().enumerate() {
            let s = weight / (K + rank as f32 + 1.0);
            match at.get(&r.id) {
                Some(&i) => score[i] += s,
                // The keyword row wins the slot: its snippet highlights the match.
                None => {
                    at.insert(r.id.clone(), rows.len());
                    rows.push(r);
                    score.push(s);
                }
            }
        }
    }
    let q = query.trim().to_lowercase();
    let exact = |r: &SearchResult| {
        let name = r.path.rsplit('/').next().unwrap_or(&r.path);
        let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);
        stem.to_lowercase() == q
    };
    let mut order: Vec<usize> = (0..rows.len()).collect();
    order.sort_by(|&a, &b| {
        exact(&rows[b]).cmp(&exact(&rows[a])).then(score[b].total_cmp(&score[a])).then(a.cmp(&b))
    });
    let mut slots: Vec<Option<SearchResult>> = rows.into_iter().map(Some).collect();
    order.into_iter().filter_map(|i| slots[i].take()).collect()
}

// ---- the engine ------------------------------------------------------------

#[cfg(target_os = "macos")]
mod engine {
    use super::*;
    use llama_cpp_2::context::params::{LlamaContextParams, LlamaPoolingType};
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::LlamaModel;
    use std::num::NonZeroU32;

    pub const SUPPORTED: bool = true;

    type Reply = mpsc::Sender<Result<Vec<Vec<f32>>, String>>;
    enum Msg {
        Embed(PathBuf, Vec<String>, Reply),
        /// Drop the model; the sender, if any, hears once it is gone.
        Unload(Option<mpsc::Sender<()>>),
    }

    static TX: Lazy<Mutex<Option<mpsc::Sender<Msg>>>> = Lazy::new(|| Mutex::new(None));
    /// False while smart search is off or the app is quitting: requests are
    /// refused instead of loading the model again.
    static ACCEPTING: AtomicBool = AtomicBool::new(false);

    pub fn accept(on: bool) {
        ACCEPTING.store(on, Ordering::SeqCst);
    }

    fn sender() -> Result<mpsc::Sender<Msg>, String> {
        let mut tx = TX.lock().unwrap();
        if let Some(tx) = tx.as_ref() {
            return Ok(tx.clone());
        }
        let (send, recv) = mpsc::channel::<Msg>();
        std::thread::Builder::new()
            .name("smart-search-engine".into())
            .spawn(move || run(recv))
            .map_err(|e| e.to_string())?;
        *tx = Some(send.clone());
        Ok(send)
    }

    /// Embed `texts` (already prompted) with the model at `path`. Blocks.
    pub fn embed(path: &Path, texts: Vec<String>) -> AppResult<Vec<Vec<f32>>> {
        let (reply, answer) = mpsc::channel();
        sender()
            .and_then(|tx| tx.send(Msg::Embed(path.to_path_buf(), texts, reply)).map_err(|e| e.to_string()))
            .map_err(AppError::new)?;
        answer
            .recv()
            .map_err(|_| AppError::new("the smart search engine stopped"))?
            .map_err(AppError::new)
    }

    pub fn unload() {
        if let Some(tx) = TX.lock().unwrap().as_ref() {
            let _ = tx.send(Msg::Unload(None));
        }
    }

    /// Drop the model and wait (briefly) until it is gone. Called on exit: a
    /// model still loaded when the process exits trips ggml-metal's
    /// `GGML_ASSERT([rsets->data count] == 0)` in a static destructor, which
    /// turns every quit into a crash report.
    pub fn unload_and_wait() {
        ACCEPTING.store(false, Ordering::SeqCst);
        let Some(tx) = TX.lock().unwrap().clone() else { return };
        let (ack, done) = mpsc::channel();
        if tx.send(Msg::Unload(Some(ack))).is_ok() {
            let _ = done.recv_timeout(Duration::from_secs(5));
        }
    }

    fn run(recv: mpsc::Receiver<Msg>) {
        let mut backend = match LlamaBackend::init() {
            Ok(b) => b,
            Err(e) => {
                // Answer every request with the reason rather than hanging callers.
                for msg in recv {
                    if let Msg::Embed(_, _, reply) = msg {
                        let _ = reply.send(Err(format!("llama.cpp did not start: {e}")));
                    }
                }
                return;
            }
        };
        backend.void_logs();
        // ponytail: in-process, so a llama.cpp abort ends the app (B0 §5-13).
        // Inputs are capped to one ubatch, the known assert; a sidecar process
        // is the upgrade if crashes ever show up.
        let threads = std::thread::available_parallelism().map_or(2, |n| (n.get() / 2).clamp(1, 4)) as i32;
        // Wait for work, load, serve until Unload, drop the model, repeat.
        while let Ok(first) = recv.recv() {
            let (path, texts, reply) = match first {
                Msg::Embed(_, _, reply) if !ACCEPTING.load(Ordering::SeqCst) => {
                    let _ = reply.send(Err("smart search is off".into()));
                    continue;
                }
                Msg::Embed(path, texts, reply) => (path, texts, reply),
                Msg::Unload(ack) => {
                    ack.map(|a| a.send(()));
                    continue;
                }
            };
            let model = match LlamaModel::load_from_file(&backend, &path, &LlamaModelParams::default().with_n_gpu_layers(999)) {
                Ok(m) => m,
                Err(e) => {
                    let _ = reply.send(Err(format!("could not load the model: {e}")));
                    continue;
                }
            };
            let params = LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(N_CTX as u32))
                .with_n_batch(N_CTX as u32)
                .with_n_ubatch(N_CTX as u32)
                .with_embeddings(true)
                .with_pooling_type(LlamaPoolingType::Mean)
                .with_n_threads(threads)
                .with_n_threads_batch(threads);
            let mut ctx = match model.new_context(&backend, params) {
                Ok(c) => c,
                Err(e) => {
                    let _ = reply.send(Err(format!("could not start the model: {e}")));
                    continue;
                }
            };
            let dim = model.n_embd_out() as usize;
            let mut one = |text: &str| -> Result<Vec<f32>, String> {
                let mut toks = model.vocab().tokenize(text.as_bytes(), true, false);
                toks.truncate(N_CTX);
                let mut batch = LlamaBatch::new(toks.len().max(1), 1);
                batch.add_sequence(&toks, 0, false).map_err(|e| e.to_string())?;
                ctx.clear_kv_cache();
                ctx.decode(&mut batch).map_err(|e| e.to_string())?;
                let v = ctx.embeddings_seq_ith(0).map_err(|e| e.to_string())?;
                Ok(v[..dim.min(v.len())].to_vec())
            };
            let _ = reply.send(texts.iter().map(|t| one(t)).collect());
            let ack = loop {
                match recv.recv() {
                    Ok(Msg::Embed(_, texts, reply)) => {
                        let _ = reply.send(texts.iter().map(|t| one(t)).collect());
                    }
                    Ok(Msg::Unload(ack)) => break ack,
                    Err(_) => return,
                }
            };
            drop(one);
            drop(ctx);
            drop(model);
            ack.map(|a| a.send(()));
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod engine {
    use super::*;
    pub const SUPPORTED: bool = false;
    pub fn embed(_: &Path, _: Vec<String>) -> AppResult<Vec<Vec<f32>>> {
        Err(AppError::new("smart search is not available on this platform yet"))
    }
    pub fn accept(_: bool) {}
    pub fn unload() {}
    pub fn unload_and_wait() {}
}

// ---- commands ----------------------------------------------------------------

// async: it may wait on the index lock, which a vault open holds for the whole
// rebuild; a plain command would wait on the main thread and freeze the window.
#[tauri::command(async)]
pub fn smart_search_status(app: AppHandle) -> Status {
    status(&app)
}

#[tauri::command]
pub async fn smart_search_enable(app: AppHandle) -> Status {
    enable(app).await
}

#[tauri::command]
pub fn smart_search_cancel() {
    cancel();
}

// async: it may wait on the index lock, which a vault open holds for the whole
// rebuild; a plain command would wait on the main thread and freeze the window.
#[tauri::command(async)]
pub fn smart_search_disable(app: AppHandle) -> AppResult<Status> {
    disable(&app)
}

// async: it may wait on the index lock, which a vault open holds for the whole
// rebuild; a plain command would wait on the main thread and freeze the window.
#[tauri::command(async)]
pub fn smart_search_clear(app: AppHandle) -> AppResult<Status> {
    clear(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(id: &str, path: &str) -> SearchResult {
        SearchResult {
            id: id.into(),
            path: path.into(),
            title: String::new(),
            snippet: String::new(),
            kind: "note".into(),
            ext: Some("md".into()),
        }
    }

    #[test]
    fn chunks_respect_size_and_count() {
        assert!(chunks("").is_empty());
        assert_eq!(chunks("one\n\ntwo"), vec!["one\n\ntwo"]);
        let long = "가".repeat(CHUNK_CHARS * 3 + 10);
        let c = chunks(&long);
        assert_eq!(c.len(), 4);
        assert!(c.iter().all(|c| c.chars().count() <= CHUNK_CHARS));
        let many = vec!["p".repeat(CHUNK_CHARS); 40].join("\n\n");
        assert_eq!(chunks(&many).len(), MAX_CHUNKS);
    }

    #[test]
    fn normalize_refuses_zero_and_nan() {
        assert!(normalize(vec![0.0, 0.0]).is_none());
        assert!(normalize(vec![f32::NAN, 1.0]).is_none());
        let v = normalize(vec![3.0, 4.0]).unwrap();
        assert!((dot(&v, &v) - 1.0).abs() < 1e-6);
        assert_eq!(from_blob(&to_blob(&v)), v);
    }

    #[test]
    fn merge_dedupes_and_keeps_the_exact_name_first() {
        let keyword = vec![hit("a", "notes/alpha.md"), hit("b", "beta.md")];
        let semantic = vec![hit("c", "gamma.md"), hit("b", "beta.md"), hit("d", "Meeting.md")];
        let out = merge(keyword, semantic, "meeting");
        let ids: Vec<&str> = out.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids[0], "d", "exact file name first");
        assert_eq!(ids[1], "b", "in both lists beats either alone");
        assert_eq!(ids.len(), 4);
    }

    #[test]
    fn merge_keeps_keyword_order_and_is_deterministic() {
        let keyword = || vec![hit("a", "a.md"), hit("b", "b.md")];
        let semantic = || vec![hit("x", "x.md"), hit("y", "y.md"), hit("a", "a.md")];
        let first: Vec<String> = merge(keyword(), semantic(), "q").into_iter().map(|r| r.id).collect();
        assert_eq!(first, ["a", "b", "x", "y"], "a vector-only note must not outrank a keyword match");
        for _ in 0..50 {
            let again: Vec<String> = merge(keyword(), semantic(), "q").into_iter().map(|r| r.id).collect();
            assert_eq!(again, first);
        }
        // Nothing matched by words: meaning alone ranks.
        let only: Vec<String> = merge(vec![], semantic(), "q").into_iter().map(|r| r.id).collect();
        assert_eq!(only, ["x", "y", "a"]);
    }

    #[test]
    fn prompts_follow_the_model_card() {
        assert_eq!(doc_text(" ", "x"), "title: none | text: x");
        assert_eq!(doc_text("Plan", "x"), "title: Plan | text: x");
        assert_eq!(query_text("q"), "task: search result | query: q");
    }

    /// The two real-model tests share one engine and each unloads it at the end,
    /// so run them with `--test-threads=1`.
    ///
    /// Runs the real model when it is on disk (`IB_SMART_SEARCH_MODEL=<gguf>`):
    /// a Korean query finds the Korean and the English note on its topic first.
    #[test]
    #[ignore]
    fn real_model_ranks_by_meaning() {
        let Ok(path) = std::env::var("IB_SMART_SEARCH_MODEL") else { return };
        let path = PathBuf::from(path);
        engine::accept(true);
        let docs = [
            doc_text("회의", "다음 주 분기 계획 회의 일정을 정리했다. 참석자와 안건을 확인한다."),
            doc_text("Recipe", "Simmer the tomatoes with garlic and basil for twenty minutes."),
            doc_text("Planning", "Agenda and attendees for next quarter's planning meeting."),
        ];
        let d: Vec<Vec<f32>> = engine::embed(&path, docs.to_vec()).unwrap().into_iter().map(|v| normalize(v).unwrap()).collect();
        assert_eq!(d[0].len(), 768);
        let q = normalize(engine::embed(&path, vec![query_text("미팅 안건")]).unwrap().remove(0)).unwrap();
        let s: Vec<f32> = d.iter().map(|v| dot(&q, v)).collect();
        assert!(s[0] > s[1] && s[2] > s[1], "scores {s:?}");
        // Exiting with the model loaded aborts in ggml-metal; this must not.
        engine::unload_and_wait();
    }

    /// The whole path on a real vault: notes on disk → index → vectors → a
    /// blended search that finds a note sharing no word with the query.
    #[test]
    #[ignore]
    fn real_model_end_to_end() {
        let Ok(model) = std::env::var("IB_SMART_SEARCH_MODEL") else { return };
        let model = PathBuf::from(model);
        engine::accept(true);
        let dir = tempfile::tempdir().unwrap();
        let notes = [
            ("회의록.md", "# 회의록\n\n다음 분기 계획을 논의했다. 참석자와 안건, 결정 사항을 정리한다."),
            ("pasta.md", "# Pasta\n\nSimmer tomatoes with garlic and basil for twenty minutes."),
            ("travel.md", "# Travel\n\nBook the train to Busan and pack a raincoat."),
        ];
        let mut paths = Vec::new();
        for (name, body) in notes {
            let p = dir.path().join(name);
            std::fs::write(&p, body).unwrap();
            paths.push(p);
        }
        let index = Arc::new(Mutex::new(Index::open(dir.path()).unwrap()));
        index.lock().unwrap().index_notes(dir.path(), &paths).unwrap();
        while reconcile_with(&index, &model).unwrap() {}
        let (indexed, total) = progress(&index.lock().unwrap()).unwrap();
        assert_eq!((indexed, total), (3, 3));

        // "meeting agenda" in English: no word in common with the Korean note.
        let keyword = index.lock().unwrap().search_all("meeting agenda").unwrap();
        assert!(keyword.is_empty(), "keyword search alone finds nothing: {keyword:?}");
        let hits = semantic_hits(&index, &model, "meeting agenda").unwrap();
        assert_eq!(hits[0].path, "회의록.md", "{hits:?}");
        assert!(!hits[0].snippet.is_empty());

        // An edit re-embeds just that note; a delete drops its vectors.
        std::fs::write(&paths[1], "# Pasta\n\nNow a note about the quarterly planning meeting.").unwrap();
        index.lock().unwrap().index_notes(dir.path(), &paths[1..2]).unwrap();
        assert!(reconcile_with(&index, &model).unwrap());
        index.lock().unwrap().remove_note(dir.path(), &paths[2]).unwrap();
        std::fs::remove_file(&paths[2]).unwrap();
        reconcile_with(&index, &model).unwrap();
        let ids: u64 = index.lock().unwrap().conn()
            .query_row("SELECT COUNT(DISTINCT note_id) FROM note_vectors", [], |r| r.get(0)).unwrap();
        assert_eq!(ids, 2);
        engine::unload_and_wait();
    }
}
