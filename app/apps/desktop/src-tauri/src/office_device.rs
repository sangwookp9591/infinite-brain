// SPDX-License-Identifier: Apache-2.0
//! Device secrets stay in a separate, application-identifier keychain service.
//! The generic keychain IPC cannot read this service. TLS pins authenticate the
//! peer certificate before reqwest can send any HTTP headers or body.
use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{rand::{SecureRandom, SystemRandom}, signature::{Ed25519KeyPair, KeyPair}};
use rustls::{client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime}, DigitallySignedStruct, SignatureScheme};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::{Arc, LazyLock, Mutex}, time::{Duration, Instant}};
use tauri::{AppHandle, Webview, State};
use crate::{keychain::{OsKeychain, SecretStore}, office_discovery::{self, OfficeDiscoveryState}};

static STORE_LOCK: Mutex<()> = Mutex::new(());
pub(crate) const PIN_ERROR: &str = "office_hub_pin_mismatch: 확인한 회사 작업 공간과 연결 대상이 달라요. 연결을 중단했어요. 관리자에게 새 초대를 요청해 주세요.";
pub(crate) const CONNECT_ERROR: &str = "office_hub_unavailable: 회사 작업 공간에 연결하지 못했어요. 초대를 다시 열거나 관리자에게 확인해 주세요.";
fn err(message: &str) -> AppError { AppError::new(message) }
pub(crate) fn main_only(webview: &Webview) -> AppResult<()> {
    if webview.label() != "main" { return Err(err("office_main_only: 앱의 기본 창에서 다시 시도해 주세요.")); }
    Ok(())
}
fn entry(namespace: &str, account: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(&format!("{namespace}.office-device.v1"), account)
        .map_err(|_| err("office_key_unavailable: 이 컴퓨터의 기기 자격을 열지 못했어요. 앱을 다시 열어 주세요."))
}
fn load(namespace: &str, account: &str) -> AppResult<Option<String>> {
    match entry(namespace, account)?.get_password() {
        Ok(value) => Ok(Some(value)), Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(err("office_key_unavailable: 이 컴퓨터의 기기 자격을 열지 못했어요. 앱을 다시 열어 주세요.")),
    }
}
fn save(namespace: &str, account: &str, value: &str) -> AppResult<()> {
    entry(namespace, account)?.set_password(value).map_err(|_| err("office_key_unavailable: 기기 자격을 안전하게 저장하지 못했어요. 앱을 다시 열어 주세요."))
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDevice { device_id: String, pkcs8: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity { device_id: String, public_key: String, key_fingerprint: String }
fn identity(stored: &StoredDevice) -> AppResult<(DeviceIdentity, Ed25519KeyPair)> {
    let private = URL_SAFE_NO_PAD.decode(&stored.pkcs8).map_err(|_| err("office_key_invalid: 기기 자격을 복구해야 해요. 관리자에게 새 기기 승인을 요청해 주세요."))?;
    let key = Ed25519KeyPair::from_pkcs8(&private).map_err(|_| err("office_key_invalid: 기기 자격을 복구해야 해요. 관리자에게 새 기기 승인을 요청해 주세요."))?;
    let mut spki = vec![0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
    spki.extend_from_slice(key.public_key().as_ref());
    Ok((DeviceIdentity { device_id: stored.device_id.clone(), public_key: URL_SAFE_NO_PAD.encode(&spki), key_fingerprint: hex(&Sha256::digest(&spki)) }, key))
}
fn device(namespace: &str) -> AppResult<StoredDevice> {
    let _guard = STORE_LOCK.lock().map_err(|_| err(CONNECT_ERROR))?;
    if let Some(value) = load(namespace, "device")? {
        return serde_json::from_str(&value).map_err(|_| err("office_key_invalid: 기기 자격을 복구해야 해요. 관리자에게 새 기기 승인을 요청해 주세요."));
    }
    let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).map_err(|_| err(CONNECT_ERROR))?;
    let stored = StoredDevice { device_id: uuid::Uuid::new_v4().to_string(), pkcs8: URL_SAFE_NO_PAD.encode(pkcs8.as_ref()) };
    save(namespace, "device", &serde_json::to_string(&stored)?)?;
    Ok(stored)
}
fn hex(bytes: &[u8]) -> String { bytes.iter().map(|byte| format!("{byte:02x}")).collect() }
fn valid_fingerprint(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
fn pin_account(server_id: &str) -> AppResult<String> {
    if server_id.is_empty() || server_id.len() > 128 || !server_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') { return Err(err(CONNECT_ERROR)); }
    Ok(format!("hub:{server_id}"))
}
pub(crate) fn pinned(namespace: &str, server_id: &str) -> AppResult<String> {
    let value = load(namespace, &pin_account(server_id)?)?.ok_or_else(|| err("office_hub_approval_required: 회사 작업 공간을 먼저 확인하고 참여를 승인해 주세요."))?;
    if !valid_fingerprint(&value) { return Err(err(PIN_ERROR)); }
    Ok(value)
}
#[derive(Debug)]
struct PinnedCertificate { fingerprint: String }
impl ServerCertVerifier for PinnedCertificate {
    fn verify_server_cert(&self, certificate: &CertificateDer<'_>, _: &[CertificateDer<'_>], _: &ServerName<'_>, _: &[u8], now: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
        if hex(&Sha256::digest(certificate.as_ref())) != self.fingerprint { return Err(rustls::Error::General("office_hub_pin_mismatch".into())); }
        let leaf = webpki::EndEntityCert::try_from(certificate).map_err(|_| rustls::Error::InvalidCertificate(rustls::CertificateError::BadEncoding))?;
        let anchor = webpki::anchor_from_trusted_cert(certificate).map_err(|_| rustls::Error::InvalidCertificate(rustls::CertificateError::BadEncoding))?;
        // Pin is the authority identity, independent of an IP that can change.
        // Still enforce certificate validity, key usage and cryptographic chain.
        leaf.verify_for_usage(rustls::crypto::ring::default_provider().signature_verification_algorithms.all,
            &[anchor], &[], now, webpki::KeyUsage::server_auth(), None, None)
            .map_err(|_| rustls::Error::InvalidCertificate(rustls::CertificateError::ApplicationVerificationFailure))?;
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, signature: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, signature, &rustls::crypto::ring::default_provider().signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, signature: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, signature, &rustls::crypto::ring::default_provider().signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> { rustls::crypto::ring::default_provider().signature_verification_algorithms.supported_schemes() }
}
fn client(fingerprint: &str) -> AppResult<reqwest::Client> {
    if !valid_fingerprint(fingerprint) { return Err(err(PIN_ERROR)); }
    let config = tls_config(fingerprint)?;
    reqwest::Client::builder().tls_backend_preconfigured(config).no_proxy().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10)).build().map_err(|_| err(CONNECT_ERROR))
}
pub(crate) fn tls_config(fingerprint: &str) -> AppResult<rustls::ClientConfig> {
    if !valid_fingerprint(fingerprint) { return Err(err(PIN_ERROR)); }
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions().map_err(|_| err(CONNECT_ERROR))?
        .dangerous().with_custom_certificate_verifier(Arc::new(PinnedCertificate { fingerprint: fingerprint.into() })).with_no_client_auth();
    Ok(config)
}
pub(crate) fn endpoint(value: &str) -> AppResult<reqwest::Url> {
    let url = reqwest::Url::parse(value).map_err(|_| err(CONNECT_ERROR))?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.path() != "/" || url.query().is_some() || url.fragment().is_some() { return Err(err(CONNECT_ERROR)); }
    Ok(url)
}
fn transport_error(error: reqwest::Error) -> AppError {
    use std::error::Error;
    let mut source: Option<&(dyn Error + 'static)> = Some(&error);
    while let Some(current) = source {
        if current.to_string().contains("office_hub_pin_mismatch") { return err(PIN_ERROR); }
        source = current.source();
    }
    err(CONNECT_ERROR)
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubInfo { pub server_id: String, pub generation: String, pub fingerprint: String, pub audience: String, pub protocol_version: u32 }
pub(crate) async fn hub_info(origin: &str, server_id: &str, fingerprint: &str) -> AppResult<HubInfo> {
    let origin = endpoint(origin)?;
    let mut response = client(fingerprint)?.get(origin.join("api/office").map_err(|_| err(CONNECT_ERROR))?).send().await.map_err(transport_error)?;
    if !response.status().is_success() { return Err(err(CONNECT_ERROR)); }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
        if body.len() + chunk.len() > 8192 { return Err(err(CONNECT_ERROR)); }
        body.extend_from_slice(&chunk);
    }
    let info: HubInfo = serde_json::from_slice(&body).map_err(|_| err(CONNECT_ERROR))?;
    if info.server_id != server_id || info.fingerprint != fingerprint || info.protocol_version != 1 || info.audience != format!("{}/api/office", origin.origin().ascii_serialization()) { return Err(err(PIN_ERROR)); }
    Ok(info)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingChallenge {
    server_id: String, organization_id: String, session_id: String, device_id: String,
    key_fingerprint: String, client_nonce: String, server_nonce: String, audience: String,
    host_generation: String, protocol_version: u32, expires_at: String,
    requester_user_id: Option<String>, person_id: String, display_alias: String,
}
fn challenge_digest(value: &PairingChallenge) -> AppResult<Vec<u8>> {
    let version = value.protocol_version.to_string();
    let fields = ["infinite-brain/office-pairing/v1", &value.server_id, &value.organization_id, &value.session_id,
        &value.device_id, &value.key_fingerprint, &value.client_nonce, &value.server_nonce, &value.audience,
        &value.host_generation, &version, &value.expires_at, value.requester_user_id.as_deref().unwrap_or(""), &value.person_id, &value.display_alias];
    let mut hash = Sha256::new();
    for field in fields {
        if field.len() > 4096 { return Err(err(CONNECT_ERROR)); }
        hash.update((field.len() as u32).to_be_bytes()); hash.update(field.as_bytes());
    }
    Ok(hash.finalize().to_vec())
}
#[tauri::command]
pub async fn office_device_identity(app: AppHandle, webview: Webview) -> AppResult<DeviceIdentity> {
    main_only(&webview)?;
    tauri::async_runtime::spawn_blocking(move || identity(&device(&app.config().identifier)?).map(|(identity, _)| identity))
        .await.map_err(|_| err(CONNECT_ERROR))?
}
/// Call only after the person explicitly approves independently delivered hub
/// trust information. Discovery alone must never call this command.
#[tauri::command]
pub async fn office_hub_approve(app: AppHandle, webview: Webview, origin: String, server_id: String, fingerprint: String) -> AppResult<HubInfo> {
    main_only(&webview)?;
    let namespace = app.config().identifier.clone();
    let account = pin_account(&server_id)?;
    if let Some(current) = load(&namespace, &account)? { if current != fingerprint { return Err(err(PIN_ERROR)); } }
    let info = hub_info(&origin, &server_id, &fingerprint).await?;
    let _guard = STORE_LOCK.lock().map_err(|_| err(CONNECT_ERROR))?;
    if let Some(current) = load(&namespace, &account)? { if current != fingerprint { return Err(err(PIN_ERROR)); } }
    save(&namespace, &account, &fingerprint)?;
    Ok(info)
}
#[tauri::command]
pub async fn office_hub_verify(app: AppHandle, webview: Webview, origin: String, server_id: String) -> AppResult<HubInfo> {
    main_only(&webview)?;
    hub_info(&origin, &server_id, &pinned(&app.config().identifier, &server_id)?).await
}
#[tauri::command]
pub async fn office_device_sign_challenge(app: AppHandle, webview: Webview, origin: String, challenge: PairingChallenge) -> AppResult<String> {
    main_only(&webview)?;
    let namespace = app.config().identifier.clone();
    let fingerprint = pinned(&namespace, &challenge.server_id)?;
    let info = hub_info(&origin, &challenge.server_id, &fingerprint).await?;
    let (identity, key) = identity(&device(&namespace)?)?;
    if challenge.protocol_version != 1 || challenge.device_id != identity.device_id || challenge.key_fingerprint != identity.key_fingerprint
        || challenge.audience != info.audience || challenge.host_generation != info.generation { return Err(err("office_challenge_invalid: 참여 요청이 달라졌어요. 초대 화면을 다시 열어 주세요.")); }
    Ok(URL_SAFE_NO_PAD.encode(key.sign(&challenge_digest(&challenge)?).as_ref()))
}

// SAS secrets and pending capabilities never enter WebView state or keychain diagnostics.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SasContext {
    session_id: String, server_id: String, organization_id: String, host_generation: String,
    observed_fingerprint: String, hub_fingerprint: String, client_public_key: String, hub_public_key: String,
}
impl SasContext {
    fn fields(&self) -> Vec<&str> {
        vec![&self.session_id, &self.server_id, &self.organization_id, &self.host_generation,
            &self.observed_fingerprint, &self.hub_fingerprint, &self.client_public_key, &self.hub_public_key]
    }
}
fn encoded(fields: &[&str]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for field in fields { bytes.extend_from_slice(&(field.len() as u32).to_be_bytes()); bytes.extend_from_slice(field.as_bytes()); }
    bytes
}
fn sas_commit(context: &SasContext, nonce: &str) -> Vec<u8> {
    let mut fields = vec!["infinite-brain/office-sas/commit/v1"];
    fields.extend(context.fields()); fields.push(nonce);
    Sha256::digest(encoded(&fields)).to_vec()
}
fn derive_sas(context: &SasContext, client_nonce: &str, server_nonce: &str) -> String {
    let mut fields = vec!["infinite-brain/office-sas/transcript/v1"];
    fields.extend(context.fields()); fields.extend([client_nonce, server_nonce]);
    let transcript = encoded(&fields);
    for counter in 0..=u32::MAX {
        let mut hash = Sha256::new(); hash.update(&transcript); hash.update(counter.to_be_bytes());
        let value = u32::from_be_bytes(hash.finalize()[..4].try_into().unwrap());
        if value < 4_294_000_000 { return format!("{:06}", value % 1_000_000); }
    }
    unreachable!("SHA-256 rejection sampling exhausted")
}
#[derive(Clone)]
struct PendingPairing { origin: reqwest::Url, fingerprint: String, token: String, auth_token: Option<String>, deadline: Instant, requested: bool, server_id: String, namespace: String }
static PENDING_PAIRINGS: LazyLock<Mutex<HashMap<String, PendingPairing>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingProfile { person_id: String, display_alias: String, device_label: String, platform: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingSas { session_id: String, sas: String, expires_at: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingStatus { state: String, expires_at: String }
const INVITE_ERROR: &str = "office_invite_invalid: 초대가 올바르지 않거나 이미 사용됐어요. 관리자에게 새 초대를 요청해 주세요.";
const INVITE_EXPIRED: &str = "office_invite_expired: 초대가 만료됐어요. 관리자에게 새 초대를 요청해 주세요.";
const ACCOUNT_REQUIRED: &str = "office_identity_link_required: 기존 회사 계정으로 먼저 로그인한 뒤 초대를 다시 열어 주세요.";
// Not Serialize/Debug: decoded address, pin and invitation capability stay native.
struct Invitation { server_id: String, secret: String, fingerprint: String, generation: String, origin: String, link_account: bool }
fn parse_invitation(input: &str, now: u64) -> AppResult<Invitation> {
    let code = input.trim().strip_prefix("infinitebrain://office/join#").unwrap_or(input.trim());
    if code.len() > 720 { return Err(err(INVITE_ERROR)); }
    let parts: Vec<_> = code.split('.').collect();
    if parts.len() != 3 || parts[0] != "IB1" { return Err(err(INVITE_ERROR)); }
    let bytes = URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| err(INVITE_ERROR))?;
    let mut digest = Sha256::new(); digest.update(b"infinite-brain/office-invitation/v1\0"); digest.update(&bytes);
    if bytes.len() < 86 || bytes[0] != 1 || bytes[1] > 1 || URL_SAFE_NO_PAD.encode(&bytes) != parts[1] || hex(&digest.finalize()[..4]) != parts[2] { return Err(err(INVITE_ERROR)); }
    let size = bytes[2] as usize; let offset = 3 + size;
    if size == 0 || size > 128 || bytes.len() < offset + 82 { return Err(err(INVITE_ERROR)); }
    let text = |slice: &[u8]| String::from_utf8(slice.to_vec()).map_err(|_| err(INVITE_ERROR));
    let server_id = text(&bytes[3..offset])?;
    pin_account(&server_id).map_err(|_| err(INVITE_ERROR))?;
    let generation = u64::from_be_bytes(bytes[offset+64..offset+72].try_into().unwrap());
    let expiry = u64::from_be_bytes(bytes[offset+72..offset+80].try_into().unwrap());
    let origin_size = u16::from_be_bytes(bytes[offset+80..offset+82].try_into().unwrap()) as usize;
    if generation == 0 || generation > 999_999_999_999_999 || origin_size > 256 || bytes.len() != offset + 82 + origin_size { return Err(err(INVITE_ERROR)); }
    let origin = text(&bytes[offset+82..])?;
    if !origin.is_empty() {
        let url = endpoint(&origin).map_err(|_| err(INVITE_ERROR))?;
        if url.origin().ascii_serialization() != origin { return Err(err(INVITE_ERROR)); }
    }
    if expiry <= now { return Err(err(INVITE_EXPIRED)); }
    Ok(Invitation { server_id, secret: URL_SAFE_NO_PAD.encode(&bytes[offset..offset+32]), fingerprint: hex(&bytes[offset+32..offset+64]), generation: generation.to_string(), origin, link_account: bytes[1] == 1 })
}
fn invitation_origin(invite: &Invitation, candidate: Option<(String, String)>) -> AppResult<String> {
    if let Some((origin, server_id)) = candidate {
        if server_id != invite.server_id { return Err(err(PIN_ERROR)); }
        return Ok(origin);
    }
    if invite.origin.is_empty() { return Err(err("office_host_not_found: 근처 작업 공간을 선택하거나 관리자에게 새 초대를 요청해 주세요.")); }
    Ok(invite.origin.clone())
}
fn account_session(invite: &Invitation, origin: &str, store: &impl SecretStore) -> AppResult<Option<String>> {
    if !invite.link_account { return Ok(None); }
    // A discovery candidate must never redirect an existing account credential.
    if invite.origin.is_empty() || origin != invite.origin { return Err(err(ACCOUNT_REQUIRED)); }
    store.get(&format!("session-v2:{origin}")).map_err(|_| err(ACCOUNT_REQUIRED))?
        .filter(|token| !token.is_empty()).map(Some).ok_or_else(|| err(ACCOUNT_REQUIRED))
}
async fn pairing_post(origin: &reqwest::Url, fingerprint: &str, path: &str, body: serde_json::Value, auth_token: Option<&str>) -> AppResult<serde_json::Value> {
    let mut request = client(fingerprint)?.post(origin.join(path).map_err(|_| err(CONNECT_ERROR))?).json(&body);
    if let Some(token) = auth_token { request = request.bearer_auth(token); }
    let mut response = request.send().await.map_err(transport_error)?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
        if bytes.len() + chunk.len() > 8192 { return Err(err(CONNECT_ERROR)); }
        bytes.extend_from_slice(&chunk);
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| err(CONNECT_ERROR))?;
    if !status.is_success() {
        return Err(err(match value["code"].as_str() {
            Some("sas_mismatch") => "office_sas_mismatch: 확인 숫자가 달라요. 관리자에게 새 초대를 요청해 주세요.",
            Some("too_many_attempts") => "office_too_many_attempts: 확인 요청이 여러 번 실패해 잠시 멈췄어요. 잠시 뒤 새 초대로 다시 시작해 주세요.",
            Some("expired") => "office_approval_expired: 참여 요청 시간이 지났어요. 새 초대로 다시 시작해 주세요.",
            Some("invitation_unavailable") => INVITE_ERROR,
            Some("wrong_workspace") => PIN_ERROR,
            Some("approval_rejected") => "office_approval_rejected: 이 기기의 참여가 승인되지 않았어요. 관리자에게 확인해 주세요.",
            Some("request_cancelled") => "office_request_cancelled: 참여 요청이 취소됐어요. 새 초대로 다시 시작해 주세요.",
            Some("account_required" | "account_mismatch") => ACCOUNT_REQUIRED,
            _ => CONNECT_ERROR,
        }));
    }
    Ok(value)
}
fn json_text<'a>(value: &'a serde_json::Value, key: &str) -> AppResult<&'a str> { value[key].as_str().ok_or_else(|| err(CONNECT_ERROR)) }
/// Parses the independently delivered invite natively; discovery supplies only an address.
/// Executes the full ordered protocol natively and returns only the six digits + opaque session metadata.
#[tauri::command]
pub async fn office_pairing_begin(app: AppHandle, webview: Webview, discovery: State<'_, OfficeDiscoveryState>, invitation: String, candidate_id: Option<String>, profile: PairingProfile) -> AppResult<PairingSas> {
    main_only(&webview)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| err(CONNECT_ERROR))?.as_secs();
    let invite = parse_invitation(&invitation, now)?;
    let candidate = candidate_id.map(|id| office_discovery::resolve_candidate(&discovery, &id)).transpose()?;
    let origin = invitation_origin(&invite, candidate)?;
    let server_id = invite.server_id.clone();
    {
        let mut pending = PENDING_PAIRINGS.lock().map_err(|_| err(CONNECT_ERROR))?;
        pending.retain(|_, value| value.deadline > Instant::now());
        if pending.len() >= 8 { return Err(err(CONNECT_ERROR)); }
    }
    let namespace = app.config().identifier.clone();
    let fingerprint = invite.fingerprint.clone();
    if let Some(current) = load(&namespace, &pin_account(&server_id)?)? { if current != fingerprint { return Err(err(PIN_ERROR)); } }
    let info = hub_info(&origin, &server_id, &fingerprint).await?;
    if info.generation != invite.generation { return Err(err(PIN_ERROR)); }
    let auth_token = account_session(&invite, &origin, &OsKeychain)?;
    let origin = endpoint(&origin)?;
    let (identity, key) = identity(&device(&namespace)?)?;
    let prepared = pairing_post(&origin, &fingerprint, "api/office/pairing/challenge", serde_json::json!({
        "invitationSecret": invite.secret, "hubFingerprint": fingerprint, "personId": profile.person_id,
        "deviceId": identity.device_id, "publicKey": identity.public_key, "displayAlias": profile.display_alias,
        "deviceLabel": profile.device_label, "platform": profile.platform,
    }), auth_token.as_deref()).await?;
    let context: SasContext = serde_json::from_value(prepared["context"].clone()).map_err(|_| err(CONNECT_ERROR))?;
    let session_id = json_text(&prepared, "sessionId")?.to_owned();
    let expires_at = json_text(&prepared, "expiresAt")?.to_owned();
    let token = json_text(&prepared, "pairingToken")?.to_owned();
    let hub_key = URL_SAFE_NO_PAD.decode(&context.hub_public_key).map_err(|_| err(CONNECT_ERROR))?;
    if context.session_id != session_id || uuid::Uuid::parse_str(&session_id).is_err() || context.server_id != server_id
        || context.observed_fingerprint != fingerprint || context.hub_fingerprint != fingerprint
        || context.client_public_key != identity.public_key || context.host_generation != info.generation
        || hub_key.len() != 44 || hub_key[..12] != [0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00]
        || URL_SAFE_NO_PAD.decode(&token).map_or(true, |v| v.len() != 32) { return Err(err(PIN_ERROR)); }
    let mut random = [0u8; 32]; SystemRandom::new().fill(&mut random).map_err(|_| err(CONNECT_ERROR))?;
    let nonce = URL_SAFE_NO_PAD.encode(random);
    let commitment = sas_commit(&context, &nonce);
    let committed = pairing_post(&origin, &fingerprint, &format!("api/office/pairing/{session_id}/commit"), serde_json::json!({
        "pairingToken": token, "commitment": URL_SAFE_NO_PAD.encode(&commitment), "signature": URL_SAFE_NO_PAD.encode(key.sign(&commitment).as_ref()),
    }), None).await?;
    if json_text(&committed, "sessionId")? != session_id { return Err(err(CONNECT_ERROR)); }
    let server_nonce = json_text(&committed, "serverNonce")?;
    if URL_SAFE_NO_PAD.decode(server_nonce).map_or(true, |v| v.len() != 32 || URL_SAFE_NO_PAD.encode(v) != server_nonce) { return Err(err(CONNECT_ERROR)); }
    let revealed = pairing_post(&origin, &fingerprint, &format!("api/office/pairing/{session_id}/reveal"), serde_json::json!({ "pairingToken": token, "clientNonce": nonce }), None).await?;
    let challenge: PairingChallenge = serde_json::from_value(revealed["challenge"].clone()).map_err(|_| err(CONNECT_ERROR))?;
    if challenge.session_id != session_id || challenge.server_id != server_id || challenge.organization_id != context.organization_id
        || challenge.device_id != identity.device_id || challenge.key_fingerprint != identity.key_fingerprint
        || challenge.client_nonce != nonce || challenge.server_nonce != server_nonce || challenge.audience != info.audience
        || challenge.host_generation != info.generation || challenge.protocol_version != 1 || challenge.expires_at != expires_at
        || challenge.person_id != profile.person_id || challenge.display_alias != profile.display_alias
        { return Err(err(CONNECT_ERROR)); }
    let signature = URL_SAFE_NO_PAD.encode(key.sign(&challenge_digest(&challenge)?).as_ref());
    pairing_post(&origin, &fingerprint, &format!("api/office/pairing/{session_id}/proof"), serde_json::json!({
        "pairingToken": token, "clientNonce": nonce, "serverNonce": server_nonce, "signature": signature,
    }), None).await?;
    let sas = derive_sas(&context, &nonce, server_nonce);
    PENDING_PAIRINGS.lock().map_err(|_| err(CONNECT_ERROR))?.insert(session_id.clone(), PendingPairing { origin, fingerprint, token, auth_token, deadline: Instant::now() + Duration::from_secs(300), requested: false, server_id, namespace });
    Ok(PairingSas { session_id, sas, expires_at })
}
/// Consumes the confirmation once; retains the native capability for bounded polling.
#[tauri::command]
pub async fn office_pairing_confirm(webview: Webview, session_id: String, matches: bool) -> AppResult<PairingStatus> {
    main_only(&webview)?;
    let pending = {
        let mut entries = PENDING_PAIRINGS.lock().map_err(|_| err(CONNECT_ERROR))?;
        let pending = entries.get_mut(&session_id).ok_or_else(|| err(CONNECT_ERROR))?;
        if pending.deadline <= Instant::now() || pending.requested { return Err(err(CONNECT_ERROR)); }
        pending.requested = true;
        pending.clone()
    };
    let result = pairing_post(&pending.origin, &pending.fingerprint, &format!("api/office/pairing/{session_id}/sas-confirm"), serde_json::json!({ "pairingToken": pending.token, "matches": matches }), None).await;
    if !matches {
        let _ = pairing_post(&pending.origin, &pending.fingerprint, &format!("api/office/pairing/{session_id}/cancel"), serde_json::json!({ "pairingToken": pending.token }), None).await;
        PENDING_PAIRINGS.lock().map_err(|_| err(CONNECT_ERROR))?.remove(&session_id);
        return result.and(Err(err("office_sas_mismatch: 확인 숫자가 달라요. 관리자에게 새 초대를 요청해 주세요.")));
    }
    result?;
    let value = pairing_post(&pending.origin, &pending.fingerprint, &format!("api/office/pairing/{session_id}/request"), serde_json::json!({ "pairingToken": pending.token }), pending.auth_token.as_deref()).await?;
    let status = pairing_status(&value, &session_id)?;
    if status.state != "pending_approval" { return Err(err(CONNECT_ERROR)); }
    let retained = {
        let mut entries = PENDING_PAIRINGS.lock().map_err(|_| err(CONNECT_ERROR))?;
        entries.get_mut(&session_id).map(|entry| { entry.deadline = Instant::now() + Duration::from_secs(600); }).is_some()
    };
    if !retained {
        let _ = pairing_post(&pending.origin, &pending.fingerprint, &format!("api/office/pairing/{session_id}/cancel"), serde_json::json!({ "pairingToken": pending.token }), None).await;
        return Err(err(CONNECT_ERROR));
    }
    Ok(status)
}
fn pairing_status(value: &serde_json::Value, id: &str) -> AppResult<PairingStatus> {
    let state = json_text(value, "state")?;
    if json_text(value, "sessionId")? != id || !["pending_approval", "approved"].contains(&state) { return Err(err(CONNECT_ERROR)); }
    Ok(PairingStatus { state: state.into(), expires_at: json_text(value, "expiresAt")?.into() })
}
#[tauri::command]
pub async fn office_pairing_status(webview: Webview, session_id: String) -> AppResult<PairingStatus> {
    main_only(&webview)?;
    let pending = PENDING_PAIRINGS.lock().map_err(|_| err(CONNECT_ERROR))?.get(&session_id).cloned().ok_or_else(|| err(CONNECT_ERROR))?;
    if pending.deadline <= Instant::now() || !pending.requested { return Err(err("office_approval_expired: 참여 요청 시간이 지났어요. 새 초대로 다시 시작해 주세요.")); }
    let value = pairing_post(&pending.origin, &pending.fingerprint, &format!("api/office/pairing/{session_id}/status"), serde_json::json!({ "pairingToken": pending.token }), None).await?;
    let status = pairing_status(&value, &session_id)?;
    if status.state == "approved" {
        let _guard = STORE_LOCK.lock().map_err(|_| err(CONNECT_ERROR))?;
        let account = pin_account(&pending.server_id)?;
        if let Some(current) = load(&pending.namespace, &account)? { if current != pending.fingerprint { return Err(err(PIN_ERROR)); } }
        // A close racing the response must never save trust.
        if PENDING_PAIRINGS.lock().map_err(|_| err(CONNECT_ERROR))?.remove(&session_id).is_some() {
            save(&pending.namespace, &account, &pending.fingerprint)?;
        } else { return Err(err(CONNECT_ERROR)); }
    }
    Ok(status)
}
#[tauri::command]
pub async fn office_pairing_cancel(webview: Webview, session_id: String) -> AppResult<()> {
    main_only(&webview)?;
    let pending = PENDING_PAIRINGS.lock().map_err(|_| err(CONNECT_ERROR))?.remove(&session_id);
    if let Some(pending) = pending {
        pairing_post(&pending.origin, &pending.fingerprint, &format!("api/office/pairing/{session_id}/cancel"), serde_json::json!({ "pairingToken": pending.token }), None).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const INVITE_VECTOR: &str = "IB1.AQADaHViAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgAAAAAAAAABAAAAAHDb2IAAGGh0dHBzOi8vMTkyLjE2OC4xLjU6MzAxMA.6e1ef665";
    #[test]
    fn invitation_golden_checksum_expiry_and_candidate_identity_stay_native() {
        let invite = parse_invitation(INVITE_VECTOR, 0).unwrap();
        assert_eq!(invite.server_id, "hub"); assert_eq!(invite.secret, URL_SAFE_NO_PAD.encode([1u8;32]));
        assert_eq!(invite.origin, "https://192.168.1.5:3010"); assert_eq!(invite.fingerprint, "a".repeat(64));
        assert!(!invite.link_account);
        assert_eq!(parse_invitation(&format!("infinitebrain://office/join#{INVITE_VECTOR}"), 0).unwrap().server_id, "hub");
        assert!(parse_invitation(INVITE_VECTOR, 1_893_456_000).err().unwrap().to_string().starts_with("office_invite_expired:"));
        let bad = format!("{}0", &INVITE_VECTOR[..INVITE_VECTOR.len()-1]);
        let error = parse_invitation(&bad, 0).err().unwrap().to_string();
        assert!(error.starts_with("office_invite_invalid:")); assert!(!error.contains(&bad));
        assert!(parse_invitation(&INVITE_VECTOR.replace("IB1", "IB2"), 0).is_err());
        let error = invitation_origin(&invite, Some(("https://192.168.1.8:3010".into(), "other-server".into()))).unwrap_err();
        assert!(error.to_string().starts_with("office_hub_pin_mismatch:"));
        assert!(!error.to_string().contains("192.168"));
        assert_eq!(invitation_origin(&invite, None).unwrap(), invite.origin);
    }
    struct AccountStore { reads: std::cell::RefCell<Vec<String>>, token: Option<String> }
    impl SecretStore for AccountStore {
        fn set(&self, _: &str, _: &str) -> AppResult<()> { panic!("must not write session") }
        fn delete(&self, _: &str) -> AppResult<()> { panic!("must not delete session") }
        fn get(&self, key: &str) -> AppResult<Option<String>> { self.reads.borrow_mut().push(key.into()); Ok(self.token.clone()) }
    }
    #[test]
    fn accounts_require_explicit_invite_intent_and_exact_verified_origin_without_js_tokens() {
        let mut invite = parse_invitation(INVITE_VECTOR, 0).unwrap();
        let store = AccountStore { reads: Default::default(), token: Some("native-account-secret".into()) };
        assert!(account_session(&invite, &invite.origin, &store).unwrap().is_none());
        assert!(store.reads.borrow().is_empty());
        invite.link_account = true;
        assert!(account_session(&invite, "https://192.168.1.8:3010", &store).is_err());
        assert!(store.reads.borrow().is_empty());
        assert_eq!(account_session(&invite, &invite.origin, &store).unwrap().as_deref(), Some("native-account-secret"));
        assert_eq!(*store.reads.borrow(), vec!["session-v2:https://192.168.1.5:3010"]);
        let missing = AccountStore { reads: Default::default(), token: None };
        assert!(account_session(&invite, &invite.origin, &missing).unwrap_err().to_string().starts_with("office_identity_link_required:"));
        let visible = serde_json::to_value(PairingStatus { state: "pending_approval".into(), expires_at: "expiry".into() }).unwrap();
        assert_eq!(visible.as_object().unwrap().len(), 2);
        for material in ["native-account-secret", &invite.origin, &invite.secret, &invite.fingerprint] { assert!(!visible.to_string().contains(material)); }
    }
    #[test]
    fn sas_matches_server_golden_and_binds_both_tls_views_and_session() {
        let context = SasContext {
            session_id: "00000000-0000-4000-8000-000000000001".into(), server_id: "hub".into(), organization_id: "org".into(), host_generation: "1".into(),
            observed_fingerprint: "a".repeat(64), hub_fingerprint: "a".repeat(64), client_public_key: "client-key".into(), hub_public_key: "hub-key".into(),
        };
        let client = URL_SAFE_NO_PAD.encode([1u8; 32]);
        let server = URL_SAFE_NO_PAD.encode([2u8; 32]);
        assert_eq!(derive_sas(&context, &client, &server), "041415");
        assert_eq!(hex(&sas_commit(&context, &client)), "7ef25d5b95cd49cabd948cf2a2dff0b3611628b002ddeb234d6e24f61efa27af");
        let mut rejected_tail = [0u8; 32]; rejected_tail[..4].copy_from_slice(&1794u32.to_be_bytes());
        assert_eq!(derive_sas(&context, &URL_SAFE_NO_PAD.encode(rejected_tail), &server), "178258");
        let mut changed = context.clone(); changed.observed_fingerprint = "b".repeat(64);
        assert_ne!(derive_sas(&changed, &client, &server), "041415");
        assert_ne!(sas_commit(&changed, &client), sas_commit(&context, &client));
        changed = context.clone(); changed.hub_fingerprint = "b".repeat(64);
        assert_ne!(derive_sas(&changed, &client, &server), "041415");
        changed = context.clone(); changed.session_id = "00000000-0000-4000-8000-000000000002".into();
        assert_ne!(sas_commit(&changed, &client), sas_commit(&context, &client));
        assert_ne!(sas_commit(&context, &server), sas_commit(&context, &client));
        assert_ne!(encoded(&["a", "bc"]), encoded(&["ab", "c"]));
        let visible = serde_json::to_string(&PairingSas { session_id: context.session_id, sas: "041415".into(), expires_at: "expiry".into() }).unwrap();
        assert!(!visible.contains("fingerprint")); assert!(!visible.contains(&client)); assert!(!visible.contains(&server));
    }
    #[test]
    fn ed25519_identity_signs_server_compatible_digest_without_exporting_secret() {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let stored = StoredDevice { device_id: uuid::Uuid::new_v4().to_string(), pkcs8: URL_SAFE_NO_PAD.encode(pkcs8.as_ref()) };
        let (public, key) = identity(&stored).unwrap();
        assert_eq!(URL_SAFE_NO_PAD.decode(&public.public_key).unwrap().len(), 44);
        let challenge: PairingChallenge = serde_json::from_value(serde_json::json!({
            "serverId":"hub", "organizationId":"org", "sessionId":"session", "deviceId":"device",
            "keyFingerprint":"fingerprint", "clientNonce":"client", "serverNonce":"server", "audience":"https://hub/api/office",
            "hostGeneration":"1", "protocolVersion":1, "expiresAt":"2026-10-21T00:00:00Z", "requesterUserId":null, "personId":"person", "displayAlias":"민수"
        })).unwrap();
        let digest = challenge_digest(&challenge).unwrap();
        // Golden value produced by server protocol.ts challengeDigest.
        assert_eq!(hex(&digest), "bcaf9b937b736f52d7b2ad735a9d467c2b053d626289e21dcf02275a80d4632a");
        ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, key.public_key().as_ref()).verify(&digest, key.sign(&digest).as_ref()).unwrap();
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("pkcs8"));
        assert!(!json.contains(&stored.pkcs8));
    }
    #[test]
    fn pins_require_exact_certificate_and_plaintext_origins_are_refused() {
        let cert = CertificateDer::from(vec![1, 2, 3]);
        let pin = PinnedCertificate { fingerprint: hex(&Sha256::digest(cert.as_ref())) };
        let server = ServerName::try_from("hub.local").unwrap();
        // Even matching bytes must parse as a valid certificate.
        assert!(pin.verify_server_cert(&cert, &[], &server, &[], UnixTime::since_unix_epoch(Duration::ZERO)).is_err());
        assert!(pin.verify_server_cert(&CertificateDer::from(vec![1, 2, 4]), &[], &server, &[], UnixTime::since_unix_epoch(Duration::ZERO)).is_err());
        assert!(endpoint("http://192.168.1.1:3010").is_err());
        assert!(endpoint("https://user:secret@hub.local/").is_err());
        assert!(endpoint("https://hub.local/").is_ok());
    }
    #[test]
    fn native_tls_transport_refuses_mismatching_pin_before_http() {
        // Supplied by the disposable test runner; contains freshly generated
        // fixture keys only. No OS keychain or developer server is accessed.
        let Ok(path) = std::env::var("OFFICE_TLS_TEST_IDENTITY") else { return };
        let fixture: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        fn pem(value: &str) -> Vec<u8> {
            base64::engine::general_purpose::STANDARD.decode(value.lines().filter(|line| !line.starts_with("---")).collect::<String>()).unwrap()
        }
        let certificate = CertificateDer::from(pem(fixture["certificate"].as_str().unwrap()));
        let private = rustls::pki_types::PrivateKeyDer::Pkcs8(rustls::pki_types::PrivatePkcs8KeyDer::from(pem(fixture["privateKey"].as_str().unwrap())));
        let fingerprint = hex(&Sha256::digest(certificate.as_ref()));
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions().unwrap().with_no_client_auth().with_single_cert(vec![certificate.clone()], private).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("https://{}", listener.local_addr().unwrap());
        let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = requests.clone();
        let server = std::thread::spawn(move || {
            use std::io::{Read, Write};
            for _ in 0..2 {
                let (socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut stream = rustls::StreamOwned::new(rustls::ServerConnection::new(Arc::new(config.clone())).unwrap(), socket);
                let mut bytes = [0; 4096];
                if let Ok(length) = stream.read(&mut bytes) {
                    if length > 0 {
                        seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
                    }
                }
            }
        });
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            assert!(client(&fingerprint).unwrap().get(&origin).send().await.unwrap().status().is_success());
            let error = client(&"0".repeat(64)).unwrap().get(&origin).send().await.unwrap_err();
            assert!(transport_error(error).to_string().starts_with("office_hub_pin_mismatch:"));
        });
        server.join().unwrap();
        assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 1, "mismatched TLS pin must not transmit an HTTP request");
        let pin = PinnedCertificate { fingerprint };
        assert!(pin.verify_server_cert(&certificate, &[], &ServerName::try_from("hub.local").unwrap(), &[], UnixTime::since_unix_epoch(Duration::ZERO)).is_err(), "not-yet-valid certificate must be refused");
        assert!(pin.verify_server_cert(&certificate, &[], &ServerName::try_from("hub.local").unwrap(), &[], UnixTime::since_unix_epoch(Duration::from_secs(4_102_444_800))).is_err(), "expired certificate must be refused even with an exact pin");
    }

}
