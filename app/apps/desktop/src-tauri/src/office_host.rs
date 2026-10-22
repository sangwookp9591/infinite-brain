// SPDX-License-Identifier: Apache-2.0
//! Owns the isolated office-host runtime. LAN is only enabled through an explicit
//! caller scope; LAN requires TLS with a runtime-owned certificate fingerprint.
use crate::error::AppError;
use crate::keychain::{OsKeychain, SecretStore};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::net::IpAddr;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{oneshot, watch};

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub available: bool,
    pub phase: String,
    pub endpoint: Option<String>,
    pub scope: Option<String>,
    pub port: Option<u16>,
    pub lan_exposed: bool,
    pub server_id: Option<String>,
    pub host_generation: Option<String>,
    pub certificate_fingerprint: Option<String>,
    pub error: Option<String>,
    pub run_id: Option<String>,
}

type SharedStatus = Arc<Mutex<HostStatus>>;

struct ActiveRun {
    cancel: Option<oneshot::Sender<()>>,
    finished: watch::Receiver<bool>,
}

type SharedActive = Arc<tokio::sync::Mutex<Option<ActiveRun>>>;

pub struct OfficeHostState {
    status: SharedStatus,
    active: SharedActive,
}

async fn stop_active(active: &SharedActive) -> Result<(), AppError> {
    let mut finished = {
        let mut active = active.lock().await;
        let Some(run) = active.as_mut() else { return Ok(()) };
        if let Some(cancel) = run.cancel.take() { let _ = cancel.send(()); }
        run.finished.clone()
    };
    // Sending cancellation does not release ownership. Concurrent start and stop
    // callers must wait for positive child-exit confirmation from the monitor.
    while !*finished.borrow_and_update() {
        finished.changed().await.map_err(|_| AppError::new("office host exit could not be confirmed"))?;
    }
    Ok(())
}

impl OfficeHostState {
    pub(crate) fn discovery_status(&self) -> Option<(String, String, u16)> {
        let status = self.status.lock().ok()?;
        if status.phase != "ready" || status.scope.as_deref() != Some("lan") || !status.lan_exposed { return None; }
        Some((status.server_id.clone()?, status.host_generation.clone()?, status.port.filter(|port| *port != 0)?))
    }
}

impl Default for OfficeHostState {
    fn default() -> Self {
        Self {
            status: Arc::new(Mutex::new(HostStatus { phase: "stopped".into(), ..Default::default() })),
            active: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }
}

fn main_only(webview: &Webview) -> Result<(), AppError> {
    if webview.label() != "main" { return Err(AppError::new("office host is available only to the main app")); }
    Ok(())
}

// ARCH describes the running binary slice, including a universal macOS app.
// Both slices share resources; never select by the physical host CPU.
fn target() -> String {
    runtime_target(std::env::consts::OS, std::env::consts::ARCH)
}

fn runtime_target(os: &str, arch: &str) -> String {
    let os = match os { "macos" => "darwin", "windows" => "win32", other => other };
    let arch = match arch { "aarch64" => "arm64", "x86_64" => "x64", other => other };
    format!("{os}-{arch}")
}

fn runtime_root(app: &AppHandle) -> Result<PathBuf, AppError> {
    #[cfg(debug_assertions)]
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("office-runtime").join(target());
    #[cfg(not(debug_assertions))]
    let root = app.path().resource_dir()?.join("office-runtime").join(target());
    let _ = app;
    Ok(root)
}

fn secret(key: &str) -> Result<String, AppError> {
    if let Some(value) = OsKeychain.get(key)? { return Ok(value); }
    let value = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    OsKeychain.set(key, &value)?;
    Ok(value)
}

fn publish(app: &AppHandle, status: &SharedStatus, run_id: &str, change: impl FnOnce(&mut HostStatus)) {
    let Ok(mut current) = status.lock() else { return };
    if current.run_id.as_deref() != Some(run_id) { return; }
    change(&mut current);
    let _ = app.emit("office-host-status", current.clone());
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEvent {
    protocol: u32,
    phase: String,
    endpoint: Option<String>,
    scope: Option<String>,
    port: Option<u16>,
    lan_exposed: Option<bool>,
    server_id: Option<String>,
    host_generation: Option<String>,
    certificate_fingerprint: Option<String>,
    code: Option<String>,
}

fn apply_event(status: &mut HostStatus, event: RuntimeEvent) {
    const PHASES: &[&str] = &["checking", "initializing", "starting-database", "migrating", "starting-server", "ready", "failed", "stopping", "stopped"];
    if event.protocol != 1 || !PHASES.contains(&event.phase.as_str()) { return; }
    // A compromised/mispackaged child must not turn this local-host control
    // endpoint into a connection to an arbitrary URL supplied by its output.
    let scope = event.scope.as_deref();
    let endpoint = event.endpoint.filter(|url| valid_endpoint(url, scope));
    if event.phase == "ready" && (endpoint.is_none()
        || !matches!(scope, Some("loopback" | "lan"))
        || event.lan_exposed != Some(scope == Some("lan"))
        || (scope == Some("lan") && !event.certificate_fingerprint.as_deref().is_some_and(|value| value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))))
        || event.port.is_none_or(|port| port == 0)) { return; }
    // A stopped protocol record precedes OS process exit; retain stopping until
    // the child monitor confirms exit and releases the active run.
    status.phase = if event.phase == "stopped" { "stopping".into() } else { event.phase };
    status.endpoint = endpoint;
    status.scope = event.scope.filter(|scope| scope == "loopback" || scope == "lan");
    status.port = event.port;
    status.server_id = event.server_id;
    status.host_generation = event.host_generation;
    status.lan_exposed = event.lan_exposed.unwrap_or(false);
    status.certificate_fingerprint = event.certificate_fingerprint;
    if status.phase == "failed" { status.error = event.code.filter(|code| matches!(code.as_str(), "child-exited" | "startup-failed" | "database-orphaned" | "database-recovery-required" | "runtime-lock-recovery-required" | "already-running" | "tls-renewal-required")); }
}

fn valid_endpoint(url: &str, scope: Option<&str>) -> bool {
    let scheme = if scope == Some("lan") { "https://" } else { "http://" };
    let Some(authority) = url.strip_prefix(scheme) else { return false };
    let Some((host, port)) = authority.rsplit_once(':') else { return false };
    if port.parse::<u16>().ok().filter(|port| *port != 0).is_none() { return false; }
    match scope {
        Some("loopback") => host == "127.0.0.1" || host == "localhost",
        Some("lan") => host.parse::<IpAddr>().ok().is_some_and(is_private_ip),
        _ => false,
    }
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

#[tauri::command]
pub fn office_host_status(app: AppHandle, webview: Webview, state: State<'_, OfficeHostState>) -> Result<HostStatus, AppError> {
    main_only(&webview)?;
    let mut status = state.status.lock().map_err(|_| AppError::new("office host state is unavailable"))?;
    status.available = runtime_root(&app)?.join("manifest.json").is_file();
    Ok(status.clone())
}

#[tauri::command]
pub async fn office_host_start(app: AppHandle, webview: Webview, state: State<'_, OfficeHostState>, scope: Option<String>) -> Result<HostStatus, AppError> {
    main_only(&webview)?;
    let mut active = state.active.lock().await;
    if active.is_some() { return Err(AppError::new("office host is already starting or running")); }
    if !matches!(state.status.lock().map_err(|_| AppError::new("office host state is unavailable"))?.phase.as_str(), "stopped" | "failed") {
        return Err(AppError::new("wait for the office host to finish stopping"));
    }
    let root = runtime_root(&app)?;
    if !root.join("manifest.json").is_file() { return Err(AppError::new("this build does not include the office host runtime")); }
    let data_directory = app.path().app_local_data_dir()?.join("office-host");
    let namespace = app.config().identifier.clone();
    let profile = tauri::async_runtime::spawn_blocking(move || -> Result<_, AppError> {
        Ok(serde_json::json!({
            "protocol": 1, "dataDirectory": data_directory,
            "scope": scope.as_deref().unwrap_or("loopback"),
            "tls": { "certificateFingerprint": null },
            "databasePassword": secret(&format!("office-host-v1:{namespace}:database"))?,
            "authSecret": secret(&format!("office-host-v1:{namespace}:auth"))?,
        }))
    }).await.map_err(|_| AppError::new("office host credentials could not be loaded"))??;
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let mut command = Command::new(root.join(format!("node{extension}")));
    command.arg(root.join("control/runtime.mjs")).current_dir(&root).env_clear();
    for name in ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "LANG", "LC_ALL", "TZ"] {
        if let Some(value) = std::env::var_os(name) { command.env(name, value); }
    }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = command.spawn().map_err(|_| AppError::new("office host runtime could not be started"))?;
    let mut stdin = child.stdin.take().ok_or_else(|| AppError::new("office host control channel is unavailable"))?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::new("office host status channel is unavailable"))?;
    let mut message = serde_json::to_vec(&profile)?;
    message.push(b'\n');
    if stdin.write_all(&message).await.is_err() {
        let _ = child.kill().await;
        return Err(AppError::new("office host credentials could not be delivered"));
    }
    let run_id = uuid::Uuid::new_v4().to_string();
    let (cancel, mut cancelled) = oneshot::channel();
    let (completed, finished) = watch::channel(false);
    *active = Some(ActiveRun { cancel: Some(cancel), finished });
    let monitor_active = state.active.clone();
    let initial = HostStatus { available: true, phase: "checking".into(), run_id: Some(run_id.clone()), ..Default::default() };
    *state.status.lock().map_err(|_| AppError::new("office host state is unavailable"))? = initial.clone();
    let status = state.status.clone();
    let reader_app = app.clone();
    let reader_status = status.clone();
    let reader_run = run_id.clone();
    let reader = tauri::async_runtime::spawn(async move {
        let mut stdout = stdout;
        let mut buffer = [0; 1024];
        let mut line = Vec::new();
        while let Ok(count) = stdout.read(&mut buffer).await {
            if count == 0 { break; }
            for byte in &buffer[..count] {
                if *byte == b'\n' {
                    if let Ok(event) = serde_json::from_slice::<RuntimeEvent>(&line) {
                        publish(&reader_app, &reader_status, &reader_run, |status| apply_event(status, event));
                    }
                    line.clear();
                } else if line.len() < 4096 { line.push(*byte); }
                else { return; } // bounded protocol records, never child log streaming
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut stopping = false;
        let mut stop_started = None;
        loop {
            match child.try_wait() {
                Ok(Some(exit)) => {
                    let _ = tokio::time::timeout(Duration::from_secs(2), reader).await;
                    publish(&app, &status, &run_id, |status| {
                        status.endpoint = None;
                        if !exit.success() || !stopping && status.error.is_some() {
                            status.phase = "failed".into();
                            if status.error.is_none() { status.error = Some("runtime-exited".into()); }
                        } else { status.phase = "stopped".into(); }
                    });
                    *monitor_active.lock().await = None;
                    let _ = completed.send(true);
                    break;
                }
                Err(_) => {
                    // A wait error is not proof of exit. Retain ownership and
                    // retry after requesting termination instead of allowing a
                    // second supervisor to race an unverified process.
                    let _ = child.start_kill();
                    publish(&app, &status, &run_id, |status| {
                        status.phase = "failed".into(); status.error = Some("runtime-wait-failed".into());
                    });
                },
                Ok(None) => {},
            }
            if !stopping && !matches!(cancelled.try_recv(), Err(oneshot::error::TryRecvError::Empty)) {
                stopping = true;
                stop_started = Some(std::time::Instant::now());
                let _ = stdin.write_all(b"stop\n").await;
                let _ = stdin.shutdown().await;
                publish(&app, &status, &run_id, |status| { status.phase = "stopping".into(); status.endpoint = None; });
            }
            if stop_started.is_some_and(|when| when.elapsed() > Duration::from_secs(60)) {
                let _ = child.start_kill();
                publish(&app, &status, &run_id, |status| { status.phase = "failed".into(); status.error = Some("shutdown-timeout".into()); });
                // Only try_wait's confirmed exit path may clear active.
                stop_started = None;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });
    Ok(initial)
}

#[tauri::command]
pub async fn office_host_stop(webview: Webview, state: State<'_, OfficeHostState>) -> Result<(), AppError> {
    main_only(&webview)?;
    stop_active(&state.active).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_directory_follows_the_running_slice() {
        assert_eq!(runtime_target("macos", "aarch64"), "darwin-arm64");
        assert_eq!(runtime_target("macos", "x86_64"), "darwin-x64");
        assert_eq!(runtime_target("windows", "x86_64"), "win32-x64");
        assert_eq!(target(), runtime_target(std::env::consts::OS, std::env::consts::ARCH));
    }

    #[test]
    fn discovery_requires_live_lan_scope_and_runtime_identity() {
        let state = OfficeHostState::default();
        assert!(state.discovery_status().is_none());
        {
            let mut status = state.status.lock().unwrap();
            status.phase = "ready".into(); status.scope = Some("lan".into());
            status.lan_exposed = true; status.port = Some(4321);
            assert!(status.server_id.is_none());
        }
        assert!(state.discovery_status().is_none());
        {
            let mut status = state.status.lock().unwrap();
            status.server_id = Some("hub".into()); status.host_generation = Some("1".into());
        }
        assert_eq!(state.discovery_status(), Some(("hub".into(), "1".into(), 4321)));
        for phase in ["stopping", "stopped", "failed", "starting-server"] {
            state.status.lock().unwrap().phase = phase.into();
            assert!(state.discovery_status().is_none());
        }
        {
            let mut status = state.status.lock().unwrap();
            status.phase = "ready".into(); status.scope = Some("loopback".into());
        }
        assert!(state.discovery_status().is_none());
        {
            let mut status = state.status.lock().unwrap();
            status.scope = Some("lan".into()); status.lan_exposed = false;
        }
        assert!(state.discovery_status().is_none());
    }

    #[test]
    fn stop_retains_active_until_monitor_confirms_exit() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
        let (cancel, cancelled) = oneshot::channel();
        let (completed, finished) = watch::channel(false);
        let active = Arc::new(tokio::sync::Mutex::new(Some(ActiveRun { cancel: Some(cancel), finished })));
        let stopping_active = active.clone();
        let stopping = tokio::spawn(async move { stop_active(&stopping_active).await });
        cancelled.await.unwrap();
        assert!(active.lock().await.is_some(), "start remains excluded after cancellation");
        assert!(!stopping.is_finished(), "stop awaits confirmed process exit");
        *active.lock().await = None;
        completed.send(true).unwrap();
        stopping.await.unwrap().unwrap();
        assert!(active.lock().await.is_none());
        });
    }

    #[test]
    fn stopped_record_does_not_claim_process_exit() {
        let mut status = HostStatus::default();
        apply_event(&mut status, RuntimeEvent { server_id: None, host_generation: None, protocol: 1, phase: "stopped".into(), endpoint: None, scope: None, port: None, lan_exposed: None, certificate_fingerprint: None, code: None });
        assert_eq!(status.phase, "stopping");
    }

    #[test]
    fn runtime_ready_record_uses_camel_case() {
        let event: RuntimeEvent = serde_json::from_value(serde_json::json!({
            "protocol": 1, "phase": "ready", "endpoint": "https://192.168.1.9:4321",
            "scope": "lan", "port": 4321, "lanExposed": true, "certificateFingerprint": "a".repeat(64)
        })).unwrap();
        let mut status = HostStatus::default();
        apply_event(&mut status, event);
        assert_eq!(status.phase, "ready");
        assert_eq!(status.certificate_fingerprint, Some("a".repeat(64)));
    }

    #[test]
    fn child_cannot_advertise_a_remote_or_unpinned_endpoint() {
        let mut status = HostStatus::default();
        for endpoint in ["http://attacker.local:1234", "http://127.0.0.1:42/path", "http://127.0.0.1:0", "https://127.0.0.1:42"] {
            apply_event(&mut status, RuntimeEvent { server_id: None, host_generation: None, protocol: 1, phase: "ready".into(), endpoint: Some(endpoint.into()), scope: Some("loopback".into()), port: Some(4321), lan_exposed: Some(false), certificate_fingerprint: None, code: None });
            assert_ne!(status.phase, "ready");
        }
        apply_event(&mut status, RuntimeEvent { server_id: None, host_generation: None, protocol: 1, phase: "ready".into(), endpoint: Some("http://127.0.0.1:4321".into()), scope: Some("loopback".into()), port: Some(4321), lan_exposed: Some(false), certificate_fingerprint: None, code: None });
        assert_eq!(status.endpoint.as_deref(), Some("http://127.0.0.1:4321"));
        assert!(valid_endpoint("http://127.0.0.1:4321", Some("loopback")));
        assert!(!valid_endpoint("http://192.168.1.9:4321", Some("loopback")));
        assert!(valid_endpoint("https://192.168.1.9:4321", Some("lan")));
        assert!(valid_endpoint("https://10.1.2.3:4321", Some("lan")));
        assert!(!valid_endpoint("http://8.8.8.8:4321", Some("lan")));
        assert!(!valid_endpoint("http://localhost:4321", Some("lan")));
        assert!(!valid_endpoint("http://192.168.1.9:4321", Some("lan")));
        let mut lan_status = HostStatus::default();
        apply_event(&mut lan_status, RuntimeEvent {
            server_id: None, host_generation: None, protocol: 1, phase: "ready".into(), endpoint: Some("https://192.168.1.9:4321".into()),
            scope: Some("lan".into()), port: Some(4321), lan_exposed: Some(true),
            certificate_fingerprint: Some("a".repeat(64)), code: None,
        });
        assert_eq!(lan_status.phase, "ready");
        assert!(lan_status.lan_exposed);
        assert_eq!(lan_status.certificate_fingerprint.as_deref(), Some("a".repeat(64).as_str()));
    }
}
