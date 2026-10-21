// SPDX-License-Identifier: Apache-2.0
//! DNS-SD is an untrusted address book, never a source of TLS pins or membership.
//! Only a user-opened discovery screen starts an eight-second browse. Addresses
//! stay native; candidate capabilities expire and cannot select arbitrary URLs.
use crate::{
    error::{AppError, AppResult},
    office_device, office_host, office_link,
};
use mdns_sd::{IfKind, IfPredicate, ResolvedService, ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    net::IpAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, Webview};

const SERVICE: &str = "_ib-office._tcp.local.";
const LIMIT: usize = 32;
const BROWSE_TIME: Duration = Duration::from_secs(8);
const CANDIDATE_LIFETIME: Duration = Duration::from_secs(30);
const UNAVAILABLE: &str = "office_discovery_unavailable: 근처 작업 공간을 찾지 못했어요. 같은 회사 네트워크인지 확인하고 다시 찾거나 관리자에게 초대를 요청해 주세요.";
const EXPIRED: &str = "office_discovery_expired: 선택한 작업 공간을 더 이상 확인할 수 없어요. 다시 찾거나 관리자에게 새 초대를 요청해 주세요.";
fn error(message: &str) -> AppError {
    AppError::new(message)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UntrustedCandidate {
    candidate_id: String,
    server_id: String,
    display_name: String,
    trust: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverySnapshot {
    scan_id: String,
    searching: bool,
    candidates: Vec<UntrustedCandidate>,
}
#[derive(Clone)]
struct Record {
    candidate: UntrustedCandidate,
    origin: String,
    generation: String,
    seen: Instant,
}
#[derive(Default)]
struct Scan {
    id: String,
    searching: bool,
    records: HashMap<String, Record>,
    stop: Arc<AtomicBool>,
}
impl Drop for Scan {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
struct Advertisement {
    daemon: ServiceDaemon,
    fullname: String,
    token: String,
}
impl Drop for Advertisement {
    fn drop(&mut self) {
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
    }
}
#[derive(Default)]
pub struct OfficeDiscoveryState {
    scan: Arc<Mutex<Scan>>,
    advertisement: Mutex<Option<Advertisement>>,
}

// Strict RFC1918 and ULA only: reject loopback, link-local (needs a scope ID),
// mapped IPv4, multicast, CGNAT, documentation and public ranges.
fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private(),
        IpAddr::V6(ip) => ip.is_unique_local(),
    }
}
fn allowed_interface(name: &str, ip: IpAddr) -> bool {
    let name = name.to_ascii_lowercase();
    private_ip(ip)
        && name != "lo"
        && !name
            .strip_prefix("lo")
            .is_some_and(|suffix| !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit()))
        && ![
            "utun",
            "tun",
            "tap",
            "ppp",
            "ipsec",
            "wg",
            "tailscale",
            "docker",
            "veth",
            "virbr",
            "vmnet",
            "vbox",
            "bridge",
            "awdl",
            "llw",
            "hamachi",
            "zt",
        ]
        .iter()
        .any(|prefix| name.starts_with(prefix))
        && !["vpn", "virtual", "hyper-v", "wireguard", "loopback"]
            .iter()
            .any(|part| name.contains(part))
}
fn interface_filter() -> IfKind {
    IfKind::Predicate(IfPredicate::new(|interface| {
        allowed_interface(&interface.name, interface.ip())
    }))
}
struct DaemonGuard(ServiceDaemon, bool);
impl Drop for DaemonGuard {
    fn drop(&mut self) {
        if self.1 {
            let _ = self.0.shutdown();
        }
    }
}
fn daemon() -> AppResult<DaemonGuard> {
    let guard = DaemonGuard(ServiceDaemon::new().map_err(|_| error(UNAVAILABLE))?, true);
    guard
        .0
        .disable_interface(IfKind::All)
        .map_err(|_| error(UNAVAILABLE))?;
    guard
        .0
        .enable_interface(interface_filter())
        .map_err(|_| error(UNAVAILABLE))?;
    Ok(guard)
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn display_name(value: &str) -> bool {
    !value.trim().is_empty()
        && value == value.trim()
        && value.len() <= 120
        && !value.chars().any(|c| {
            c.is_control() || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
}
fn generation(value: &str) -> bool {
    value
        .parse::<u64>()
        .ok()
        .is_some_and(|v| v > 0 && v.to_string() == value)
}
fn parse(service: &ResolvedService) -> Option<Record> {
    if service.ty_domain != SERVICE
        || !service.fullname.ends_with(&format!(".{SERVICE}"))
        || service.fullname.len() > 255
        || service.port == 0
        || !service.host.ends_with(".local.")
        || service.addresses.is_empty()
        || service.addresses.len() > 16
        || service
            .addresses
            .iter()
            .any(|ip| !private_ip(ip.to_ip_addr()))
    {
        return None;
    }
    let properties: Vec<_> = service.txt_properties.iter().collect();
    let keys: HashSet<_> = properties.iter().map(|p| p.key()).collect();
    if properties.len() != 5
        || keys
            != HashSet::from([
                "serverId",
                "displayName",
                "port",
                "hostGeneration",
                "protocolVersion",
            ])
    {
        return None;
    }
    // Read raw bytes: val_str() would turn malformed UTF-8 into an empty string.
    let value = |key| std::str::from_utf8(service.get_property_val(key)??).ok();
    let server = value("serverId")?;
    let name = value("displayName")?;
    let host_generation = value("hostGeneration")?;
    if !identifier(server)
        || !display_name(name)
        || !generation(host_generation)
        || value("protocolVersion")? != "1"
        || value("port")? != service.port.to_string()
    {
        return None;
    }
    let mut addresses: Vec<_> = service.addresses.iter().map(|ip| ip.to_ip_addr()).collect();
    addresses.sort(); // deterministic endpoint selection, no hostname resolution/rebinding
    let authority = match addresses[0] {
        IpAddr::V4(ip) => ip.to_string(),
        IpAddr::V6(ip) => format!("[{ip}]"),
    };
    Some(Record {
        candidate: UntrustedCandidate {
            candidate_id: uuid::Uuid::new_v4().to_string(),
            server_id: server.into(),
            display_name: name.into(),
            trust: "untrusted",
        },
        origin: format!("https://{authority}:{}", service.port),
        generation: host_generation.into(),
        seen: Instant::now(),
    })
}
impl Scan {
    fn expire(&mut self) {
        self.records
            .retain(|_, record| record.seen.elapsed() < CANDIDATE_LIFETIME);
    }
    fn apply(&mut self, event: ServiceEvent) {
        self.expire();
        match event {
            ServiceEvent::ServiceRemoved(_, fullname) => {
                self.records.remove(&fullname);
            }
            ServiceEvent::ServiceResolved(service) => {
                let Some(mut next) = parse(&service) else {
                    self.records.remove(&service.fullname);
                    return;
                };
                if let Some(previous) = self.records.get(&service.fullname) {
                    if previous.origin == next.origin
                        && previous.generation == next.generation
                        && previous.candidate.server_id == next.candidate.server_id
                        && previous.candidate.display_name == next.candidate.display_name
                    {
                        next.candidate.candidate_id = previous.candidate.candidate_id.clone();
                    }
                }
                if self.records.len() < LIMIT || self.records.contains_key(&service.fullname) {
                    self.records.insert(service.fullname.clone(), next);
                }
            }
            _ => {}
        }
    }
    fn candidates(&self) -> Vec<UntrustedCandidate> {
        let mut by_server: HashMap<&str, Vec<&Record>> = HashMap::new();
        for record in self.records.values() {
            by_server
                .entry(&record.candidate.server_id)
                .or_default()
                .push(record);
        }
        let mut result = Vec::new();
        for records in by_server.values_mut() {
            records.sort_by_key(|r| &r.candidate.candidate_id);
            let first = records[0];
            // Conflicting claims to one identity are ambiguous; no winner is trusted.
            if records.iter().all(|r| {
                r.origin == first.origin
                    && r.generation == first.generation
                    && r.candidate.display_name == first.candidate.display_name
            }) {
                result.push(first.candidate.clone());
            }
        }
        result.sort_by(|a, b| a.candidate_id.cmp(&b.candidate_id));
        result
    }
    fn resolve(&mut self, candidate_id: &str) -> AppResult<(String, String)> {
        self.expire();
        let candidate = self
            .candidates()
            .into_iter()
            .find(|c| c.candidate_id == candidate_id)
            .ok_or_else(|| error(EXPIRED))?;
        let record = self
            .records
            .values()
            .find(|r| r.candidate.candidate_id == candidate.candidate_id)
            .ok_or_else(|| error(EXPIRED))?;
        Ok((record.origin.clone(), candidate.server_id))
    }
}

#[tauri::command]
pub async fn office_discovery_start(
    webview: Webview,
    state: State<'_, OfficeDiscoveryState>,
) -> AppResult<String> {
    office_device::main_only(&webview)?;
    let mut scan = state.scan.lock().map_err(|_| error(UNAVAILABLE))?;
    if scan.searching {
        return Ok(scan.id.clone());
    }
    let guard = daemon()?;
    let events = guard.0.browse(SERVICE).map_err(|_| error(UNAVAILABLE))?;
    let id = uuid::Uuid::new_v4().to_string();
    let stop = Arc::new(AtomicBool::new(false));
    *scan = Scan {
        id: id.clone(),
        searching: true,
        stop: stop.clone(),
        records: HashMap::new(),
    };
    let shared = state.scan.clone();
    let scan_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + BROWSE_TIME;
        while Instant::now() < deadline && !stop.load(Ordering::Relaxed) {
            if let Ok(event) = events.recv_timeout(Duration::from_millis(100)) {
                let Ok(mut scan) = shared.lock() else { break };
                if scan.id != scan_id {
                    break;
                }
                scan.apply(event);
            }
        }
        let _ = guard.0.stop_browse(SERVICE);
        drop(guard); // closes sockets and query cache after every bounded browse
        if let Ok(mut scan) = shared.lock() {
            if scan.id == scan_id {
                scan.searching = false;
                scan.expire();
            }
        }
    });
    Ok(id)
}
#[tauri::command]
pub fn office_discovery_snapshot(
    webview: Webview,
    state: State<'_, OfficeDiscoveryState>,
    scan_id: String,
) -> AppResult<DiscoverySnapshot> {
    office_device::main_only(&webview)?;
    let mut scan = state.scan.lock().map_err(|_| error(UNAVAILABLE))?;
    if scan.id != scan_id {
        return Err(error(EXPIRED));
    }
    scan.expire();
    Ok(DiscoverySnapshot {
        scan_id: scan.id.clone(),
        searching: scan.searching,
        candidates: scan.candidates(),
    })
}
#[tauri::command]
pub fn office_discovery_stop(
    webview: Webview,
    state: State<'_, OfficeDiscoveryState>,
    scan_id: String,
) -> AppResult<()> {
    office_device::main_only(&webview)?;
    let mut scan = state.scan.lock().map_err(|_| error(UNAVAILABLE))?;
    if scan.id == scan_id {
        *scan = Scan::default();
    }
    Ok(())
}
/// Native handoff for invite/SAS flows: callers must authenticate independently.
/// This function returns no fingerprint and never reads/writes the trust store.
pub(crate) fn resolve_candidate(
    state: &OfficeDiscoveryState,
    candidate_id: &str,
) -> AppResult<(String, String)> {
    state
        .scan
        .lock()
        .map_err(|_| error(UNAVAILABLE))?
        .resolve(candidate_id)
}
/// Reconnect only with an EXISTING approved pin. Discovery cannot approve trust.
#[tauri::command]
pub async fn office_discovery_open(
    app: AppHandle,
    webview: Webview,
    state: State<'_, OfficeDiscoveryState>,
    links: State<'_, office_link::OfficeLinkState>,
    candidate_id: String,
) -> AppResult<office_link::OfficeLinkEndpoint> {
    office_device::main_only(&webview)?;
    let (origin, server_id) = resolve_candidate(&state, &candidate_id)?;
    office_link::office_link_open(app, webview, links, origin, server_id).await
}
#[tauri::command]
pub async fn office_discovery_advertise(
    app: AppHandle,
    webview: Webview,
    state: State<'_, OfficeDiscoveryState>,
    display_name: Option<String>,
) -> AppResult<()> {
    office_device::main_only(&webview)?;
    let mut advertisement = state.advertisement.lock().map_err(|_| error(UNAVAILABLE))?;
    // None explicitly disables advertising. Never persist opt-in across launches.
    let Some(name) = display_name else {
        advertisement.take();
        return Ok(());
    };
    if !self::display_name(&name) {
        return Err(error("office_discovery_name: 공유할 이름이 비어 있거나 너무 길어요. 짧은 작업 공간 이름으로 다시 입력해 주세요."));
    }
    let identity = app.state::<office_host::OfficeHostState>().discovery_status()
        .ok_or_else(|| error("office_discovery_host: 사내 공유가 아직 준비되지 않았어요. 사내 공유를 켠 뒤 다시 시도해 주세요."))?;
    if !identifier(&identity.0) || !generation(&identity.1) {
        return Err(error(UNAVAILABLE));
    }
    let mut daemon = daemon()?;
    let instance = uuid::Uuid::new_v4().simple().to_string();
    let port = identity.2.to_string();
    let properties = [
        ("serverId", identity.0.as_str()),
        ("displayName", name.as_str()),
        ("port", port.as_str()),
        ("hostGeneration", identity.1.as_str()),
        ("protocolVersion", "1"),
    ];
    let mut service = ServiceInfo::new(
        SERVICE,
        &instance,
        &format!("ib-{instance}.local."),
        "",
        identity.2,
        &properties[..],
    )
    .map_err(|_| error(UNAVAILABLE))?
    .enable_addr_auto();
    service.set_interfaces(vec![interface_filter()]);
    let fullname = service.get_fullname().to_owned();
    daemon.0.register(service).map_err(|_| error(UNAVAILABLE))?;
    let token = uuid::Uuid::new_v4().to_string();
    *advertisement = Some(Advertisement {
        daemon: daemon.0.clone(),
        fullname,
        token: token.clone(),
    });
    // Transfer daemon lifetime to Advertisement rather than guard shutdown.
    daemon.1 = false;
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let current = app.state::<OfficeDiscoveryState>();
            let Ok(mut advertisement) = current.advertisement.lock() else {
                break;
            };
            if advertisement.as_ref().is_none_or(|a| a.token != token) {
                break;
            }
            if app
                .state::<office_host::OfficeHostState>()
                .discovery_status()
                .as_ref()
                != Some(&identity)
            {
                advertisement.take(); // withdraw when host stops, fails or changes generation
                break;
            }
        }
    });
    Ok(())
}
pub(crate) fn shutdown(app: &AppHandle) {
    let state = app.state::<OfficeDiscoveryState>();
    if let Ok(mut scan) = state.scan.lock() {
        *scan = Scan::default();
    }
    if let Ok(mut advertisement) = state.advertisement.lock() {
        advertisement.take();
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use mdns_sd::IntoTxtProperties;
    fn service(server: &str, instance: &str) -> ResolvedService {
        let properties = [
            ("serverId", server),
            ("displayName", "공유 작업 공간"),
            ("port", "4321"),
            ("hostGeneration", "1"),
            ("protocolVersion", "1"),
        ];
        ServiceInfo::new(
            SERVICE,
            instance,
            "random.local.",
            "192.168.1.12",
            4321,
            &properties[..],
        )
        .unwrap()
        .as_resolved_service()
    }
    #[test]
    fn validates_txt_and_refuses_extra_or_malformed_claims() {
        assert!(parse(&service("hub", "a")).is_some());
        for (key, value) in [
            ("protocolVersion", "2"),
            ("hostGeneration", "0"),
            ("hostGeneration", "01"),
            ("port", "4322"),
            ("serverId", "https://evil"),
            ("displayName", "\u{202e}spoof"),
            ("displayName", "  "),
        ] {
            let mut s = service("hub", "a");
            let mut txt: HashMap<String, String> = s
                .txt_properties
                .iter()
                .map(|p| (p.key().into(), p.val_str().into()))
                .collect();
            txt.insert(key.into(), value.into());
            s.txt_properties = txt.into_txt_properties();
            assert!(parse(&s).is_none(), "{key}");
        }
        let mut s = service("hub", "a");
        s.txt_properties = [
            ("serverId", "hub"),
            ("displayName", "name"),
            ("port", "4321"),
            ("hostGeneration", "1"),
            ("protocolVersion", "1"),
            ("fingerprint", "forged"),
        ]
        .as_slice()
        .into_txt_properties();
        assert!(parse(&s).is_none());
        s.txt_properties = [("serverId", "hub")].as_slice().into_txt_properties();
        assert!(parse(&s).is_none());
    }
    #[test]
    fn private_addresses_and_interfaces_only() {
        for address in ["10.0.0.1", "172.16.0.1", "192.168.1.1", "fd12::1"] {
            assert!(private_ip(address.parse().unwrap()));
        }
        for address in [
            "8.8.8.8",
            "127.0.0.1",
            "169.254.1.1",
            "100.64.1.1",
            "0.0.0.0",
            "224.0.0.251",
            "::1",
            "fe80::1",
            "::ffff:192.168.1.1",
            "2001:db8::1",
        ] {
            assert!(!private_ip(address.parse().unwrap()), "{address}");
        }
        for name in [
            "utun3",
            "wg0",
            "vEthernet (Default Switch)",
            "VirtualBox",
            "VPN adapter",
            "docker0",
            "lo0",
        ] {
            assert!(!allowed_interface(name, "10.0.0.1".parse().unwrap()));
        }
        assert!(allowed_interface("en0", "192.168.1.1".parse().unwrap()));
        assert!(allowed_interface(
            "Local Area Connection",
            "192.168.1.1".parse().unwrap()
        ));
        let mut s = service("hub", "a");
        s.addresses
            .insert("8.8.8.8".parse::<IpAddr>().unwrap().into());
        assert!(
            parse(&s).is_none(),
            "mixed public and private claims fail closed"
        );
    }
    #[test]
    fn bounds_deduplicates_removes_and_expires_candidates() {
        let mut scan = Scan::default();
        for n in 0..LIMIT + 10 {
            scan.apply(ServiceEvent::ServiceResolved(Box::new(service(
                &format!("hub{n}"),
                &format!("i{n}"),
            ))));
        }
        assert_eq!(scan.records.len(), LIMIT);
        let id = scan.candidates()[0].candidate_id.clone();
        assert!(scan.resolve(&id).is_ok());
        assert!(scan.resolve("https://attacker:1234").is_err());
        for r in scan.records.values_mut() {
            r.seen = Instant::now() - CANDIDATE_LIFETIME;
        }
        assert!(scan.resolve(&id).is_err());
        assert!(scan.records.is_empty());
        scan.apply(ServiceEvent::ServiceResolved(Box::new(service("hub", "a"))));
        scan.apply(ServiceEvent::ServiceResolved(Box::new(service("hub", "b"))));
        assert_eq!(scan.candidates().len(), 1);
        scan.apply(ServiceEvent::ServiceRemoved(
            SERVICE.into(),
            format!("a.{SERVICE}"),
        ));
        assert_eq!(scan.candidates().len(), 1);
        scan.apply(ServiceEvent::ServiceRemoved(
            SERVICE.into(),
            format!("b.{SERVICE}"),
        ));
        assert!(scan.candidates().is_empty());
    }
    #[test]
    fn forged_identity_conflicts_and_changed_candidates_cannot_be_selected() {
        let mut scan = Scan::default();
        scan.apply(ServiceEvent::ServiceResolved(Box::new(service("hub", "a"))));
        let id = scan.candidates()[0].candidate_id.clone();
        let mut forged = service("hub", "b");
        forged.port = 4444;
        // Valid syntactic forgery with a different address is still not trusted.
        forged.addresses = HashSet::from(["10.0.0.5".parse::<IpAddr>().unwrap().into()]);
        forged.port = 4321;
        scan.apply(ServiceEvent::ServiceResolved(Box::new(forged)));
        assert!(scan.candidates().is_empty());
        assert!(scan.resolve(&id).is_err());
        scan.apply(ServiceEvent::ServiceRemoved(
            SERVICE.into(),
            format!("b.{SERVICE}"),
        ));
        let mut changed = service("hub", "a");
        changed.addresses = HashSet::from(["10.0.0.6".parse::<IpAddr>().unwrap().into()]);
        scan.apply(ServiceEvent::ServiceResolved(Box::new(changed)));
        assert!(scan.resolve(&id).is_err());
        let json = serde_json::to_string(&scan.candidates()).unwrap();
        assert!(
            !json.contains("10.0.0.6") && !json.contains("4321") && !json.contains("fingerprint")
        );
        assert!(json.contains("untrusted"));
    }
    #[test]
    #[ignore = "explicit same-Mac multicast smoke; no real host or credentials"]
    fn same_mac_advertise_browse_smoke() {
        let advertiser = daemon().unwrap();
        let browser = daemon().unwrap();
        let instance = uuid::Uuid::new_v4().simple().to_string();
        let props = [
            ("serverId", instance.as_str()),
            ("displayName", "Discovery smoke"),
            ("port", "4321"),
            ("hostGeneration", "1"),
            ("protocolVersion", "1"),
        ];
        let mut info = ServiceInfo::new(
            SERVICE,
            &instance,
            &format!("ib-{instance}.local."),
            "",
            4321,
            &props[..],
        )
        .unwrap()
        .enable_addr_auto();
        info.set_interfaces(vec![interface_filter()]);
        let fullname = info.get_fullname().to_owned();
        let events = browser.0.browse(SERVICE).unwrap();
        advertiser.0.register(info).unwrap();
        let deadline = Instant::now() + Duration::from_secs(12);
        let mut found = false;
        while Instant::now() < deadline {
            if let Ok(ServiceEvent::ServiceResolved(s)) =
                events.recv_timeout(Duration::from_millis(200))
            {
                if s.fullname == fullname {
                    assert!(parse(&s).is_some());
                    found = true;
                    break;
                }
            }
        }
        let _ = advertiser.0.unregister(&fullname);
        let _ = browser.0.stop_browse(SERVICE);
        assert!(found, "same-Mac multicast did not resolve before deadline");
    }
}
