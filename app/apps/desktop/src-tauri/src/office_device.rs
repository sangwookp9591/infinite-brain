// SPDX-License-Identifier: Apache-2.0
//! Device secrets stay in a separate, application-identifier keychain service.
//! The generic keychain IPC cannot read this service. TLS pins authenticate the
//! peer certificate before reqwest can send any HTTP headers or body.
use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{rand::SystemRandom, signature::{Ed25519KeyPair, KeyPair}};
use rustls::{client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime}, DigitallySignedStruct, SignatureScheme};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{sync::{Arc, Mutex}, time::Duration};
use tauri::{AppHandle, Webview};

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

#[cfg(test)]
mod tests {
    use super::*;
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
