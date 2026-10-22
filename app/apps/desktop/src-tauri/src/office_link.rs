// SPDX-License-Identifier: Apache-2.0
//! A short-lived, capability-protected loopback endpoint for the WebView's
//! existing fetch and WebSocket clients. Never log a request, URL or TLS error:
//! paths carry capabilities and HTTP/WS payloads carry user credentials/data.
use crate::{error::{AppError, AppResult}, office_device};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use bytes::Bytes;
use http_body_util::{combinators::UnsyncBoxBody, BodyExt, Full};
use hyper::{body::Incoming, header, service::service_fn, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use std::{collections::HashMap, convert::Infallible, sync::Arc, time::Duration};
use tauri::{AppHandle, State, Webview};
use tokio::{net::{TcpListener, TcpStream}, sync::Mutex, task::{JoinHandle, JoinSet}};
use tokio_util::sync::CancellationToken;

type Body = UnsyncBoxBody<Bytes, hyper::Error>;
const DENIED: &str = "office_link_denied: 앱에서 회사 작업 공간을 다시 열어 주세요.";
#[derive(Default)]
pub struct OfficeLinkState(Mutex<HashMap<String, Link>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeLinkEndpoint { pub(crate) link_id: String, pub(crate) http_base_url: String }
pub(crate) struct Link { pub(crate) endpoint: OfficeLinkEndpoint, stop: CancellationToken, task: JoinHandle<()> }
impl Drop for Link {
    fn drop(&mut self) { self.stop.cancel(); self.task.abort(); }
}
struct Target {
    bearer: Option<String>,
    origin: reqwest::Url,
    fingerprint: String,
    webview_origin: String,
    authority: String,
    prefix: String,
    stop: CancellationToken,
}
fn error(message: &str) -> AppError { AppError::new(message) }
fn body(value: impl Into<Bytes>) -> Body {
    Full::new(value.into()).map_err(|never| match never {}).boxed_unsync()
}
fn reply(status: StatusCode, text: &str) -> Response<Body> {
    let mut response = Response::new(body(text.to_owned()));
    *response.status_mut() = status;
    response.headers_mut().insert(header::CONTENT_TYPE, header::HeaderValue::from_static("text/plain; charset=utf-8"));
    response
}
fn cors(response: &mut Response<Body>, origin: &str) {
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.parse().unwrap());
    headers.insert(header::ACCESS_CONTROL_ALLOW_CREDENTIALS, header::HeaderValue::from_static("true"));
    headers.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, header::HeaderValue::from_static("set-auth-token, content-disposition, content-length, retry-after, x-request-id"));
    headers.insert(header::VARY, header::HeaderValue::from_static("Origin"));
    headers.insert(header::CACHE_CONTROL, header::HeaderValue::from_static("no-store"));
    headers.insert(header::REFERRER_POLICY, header::HeaderValue::from_static("no-referrer"));
}
/// Strip hop-by-hop headers, including extension headers named by Connection.
/// WebSocket upgrades retain only the two required upgrade headers.
fn strip_hop(headers: &mut hyper::HeaderMap, websocket: bool) {
    let named: Vec<_> = headers.get_all(header::CONNECTION).iter().filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(',')).map(|v| v.trim().to_ascii_lowercase()).collect();
    for name in named {
        if !websocket || name != "upgrade" { headers.remove(name); }
    }
    for name in ["connection", "upgrade", "proxy-authenticate", "proxy-authorization", "proxy-connection", "keep-alive", "te", "trailer", "transfer-encoding"] {
        if !websocket || (name != "connection" && name != "upgrade") { headers.remove(name); }
    }
}
async fn forward(mut request: Request<Incoming>, target: Arc<Target>) -> AppResult<Response<Body>> {
    // The capability is checked before DNS/TCP/TLS. Absolute-form requests and
    // alternate Host headers are refused to prevent DNS rebinding/proxy abuse.
    let allowed = request.uri().scheme().is_none() && request.uri().authority().is_none()
        && request.headers().get(header::HOST).and_then(|v| v.to_str().ok()) == Some(&target.authority)
        && request.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) == Some(&target.webview_origin);
    let path = request.uri().path_and_query().map(|v| v.as_str()).unwrap_or("");
    let Some(upstream_path) = path.strip_prefix(&target.prefix).filter(|v| v.starts_with('/')) else {
        return Ok(reply(StatusCode::FORBIDDEN, DENIED));
    };
    if !allowed { return Ok(reply(StatusCode::FORBIDDEN, DENIED)); }
    if request.method() == hyper::Method::OPTIONS {
        let mut response = reply(StatusCode::NO_CONTENT, "");
        response.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_METHODS, header::HeaderValue::from_static("GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"));
        if let Some(headers) = request.headers().get(header::ACCESS_CONTROL_REQUEST_HEADERS) {
            response.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_HEADERS, headers.clone());
        }
        // Chromium's local-network preflight is authorized only after the
        // normal capability + exact application Origin checks above.
        response.headers_mut().insert("access-control-allow-private-network", header::HeaderValue::from_static("true"));
        cors(&mut response, &target.webview_origin);
        return Ok(response);
    }
    let websocket = request.headers().get(header::UPGRADE).is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"websocket"));
    if request.method() == hyper::Method::CONNECT || (request.headers().contains_key(header::UPGRADE) && !websocket) {
        return Ok(reply(StatusCode::FORBIDDEN, DENIED));
    }
    let upstream_uri = upstream_path.parse().map_err(|_| error(DENIED))?;
    let host = target.origin.host_str().ok_or_else(|| error(DENIED))?.to_owned();
    let port = target.origin.port_or_known_default().ok_or_else(|| error(DENIED))?;
    let tls = office_device::tls_config(&target.fingerprint)?;
    let name = rustls::pki_types::ServerName::try_from(host.clone()).map_err(|_| error(DENIED))?;
    let stream = tokio::time::timeout(Duration::from_secs(10), async {
        let socket = TcpStream::connect((host.as_str(), port)).await?;
        tokio_rustls::TlsConnector::from(Arc::new(tls)).connect(name, socket).await
    }).await.map_err(|_| error(office_device::CONNECT_ERROR))?
        .map_err(|e| error(if e.to_string().contains("office_hub_pin_mismatch") { office_device::PIN_ERROR } else { office_device::CONNECT_ERROR }))?;
    // No HTTP byte (including credentials/body) is sent until the pinned TLS
    // handshake above succeeds. The same path protects both HTTP and WSS.
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.map_err(|_| error(office_device::CONNECT_ERROR))?;
    let stop = target.stop.clone();
    tokio::spawn(async move { stop.run_until_cancelled(connection.with_upgrades()).await; });
    let downstream_upgrade = if websocket { Some(hyper::upgrade::on(&mut request)) } else { None };
    *request.uri_mut() = upstream_uri;
    strip_hop(request.headers_mut(), websocket);
    // Preserve Authorization, Cookie and application headers verbatim. Origin
    // is the public hub origin for Better Auth CSRF checks, never the secret URL.
    request.headers_mut().insert(header::HOST, target.origin.as_str().trim_start_matches("https://").trim_end_matches('/').parse().map_err(|_| error(DENIED))?);
    request.headers_mut().insert(header::ORIGIN, target.origin.origin().ascii_serialization().parse().map_err(|_| error(DENIED))?);
    if let Some(token) = &target.bearer {
        request.headers_mut().insert(header::AUTHORIZATION, format!("Bearer {token}").parse().map_err(|_| error(DENIED))?);
        request.headers_mut().remove(header::COOKIE);
    }
    request.headers_mut().remove(header::REFERER);
    for header in ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"] { request.headers_mut().remove(header); }
    let mut response = tokio::time::timeout(Duration::from_secs(30), sender.send_request(request)).await
        .map_err(|_| error(office_device::CONNECT_ERROR))?.map_err(|_| error(office_device::CONNECT_ERROR))?;
    if response.status() == StatusCode::SWITCHING_PROTOCOLS {
        if let Some(downstream) = downstream_upgrade {
            let upstream = hyper::upgrade::on(&mut response);
            let stop = target.stop.clone();
            tokio::spawn(async move {
                stop.run_until_cancelled(async move {
                    if let (Ok(downstream), Ok(upstream)) = (downstream.await, upstream.await) {
                        let _ = tokio::io::copy_bidirectional(&mut TokioIo::new(downstream), &mut TokioIo::new(upstream)).await;
                    }
                }).await;
            });
        } else { return Err(error(DENIED)); }
    }
    // Fetch redirects must stay inside the pinned transport. Never expose the
    // capability as a Referer or redirect the browser to an unverified peer.
    if let Some(location) = response.headers().get(header::LOCATION) {
        let next = location.to_str().ok().and_then(|v| target.origin.join(v).ok()).ok_or_else(|| error(DENIED))?;
        if next.origin() != target.origin.origin() || !next.username().is_empty() || next.password().is_some() { return Err(error(DENIED)); }
        let next = format!("http://{}{}{}", target.authority, target.prefix, format!("{}{}{}", next.path(), next.query().map(|v| format!("?{v}")).unwrap_or_default(), next.fragment().map(|v| format!("#{v}")).unwrap_or_default()));
        response.headers_mut().insert(header::LOCATION, next.parse().map_err(|_| error(DENIED))?);
    }
    if target.bearer.is_some() {
        response.headers_mut().remove("set-auth-token");
        response.headers_mut().remove(header::SET_COOKIE);
    }
    let upgraded = response.status() == StatusCode::SWITCHING_PROTOCOLS;
    strip_hop(response.headers_mut(), upgraded);
    let mut response = response.map(BodyExt::boxed_unsync);
    cors(&mut response, &target.webview_origin);
    Ok(response)
}

impl Link {
    #[cfg(test)]
    async fn start(origin: &str, fingerprint: String, webview_origin: String, bind: &str) -> AppResult<Self> {
        Self::start_authenticated(origin, fingerprint, webview_origin, bind, None).await
    }
    async fn start_authenticated(origin: &str, fingerprint: String, webview_origin: String, bind: &str, bearer: Option<String>) -> AppResult<Self> {
        let origin = office_device::endpoint(origin)?;
        let listener = TcpListener::bind(bind).await.map_err(|_| error(office_device::CONNECT_ERROR))?;
        let authority = listener.local_addr().map_err(|_| error(office_device::CONNECT_ERROR))?.to_string();
        let mut secret = [0; 32];
        SystemRandom::new().fill(&mut secret).map_err(|_| error(office_device::CONNECT_ERROR))?;
        let prefix = format!("/{}", URL_SAFE_NO_PAD.encode(secret));
        let endpoint = OfficeLinkEndpoint { link_id: uuid::Uuid::new_v4().to_string(), http_base_url: format!("http://{authority}{prefix}") };
        let stop = CancellationToken::new();
        let target = Arc::new(Target { bearer, origin, fingerprint, webview_origin, authority, prefix, stop: stop.clone() });
        let task = tokio::spawn(async move {
            let mut requests = JoinSet::new();
            loop {
                let Ok((socket, _)) = listener.accept().await else { break };
                // Bound idle local sockets; completed tasks do not accumulate.
                while requests.try_join_next().is_some() {}
                if requests.len() >= 64 { continue; }
                let target = target.clone();
                requests.spawn(async move {
                    target.stop.run_until_cancelled(async {
                        let service = service_fn(|request| {
                            let target = target.clone();
                            async move {
                                let mut response = match forward(request, target.clone()).await {
                                    Ok(response) => response,
                                    Err(e) => {
                                        let mut response = reply(StatusCode::BAD_GATEWAY, &e.to_string());
                                        cors(&mut response, &target.webview_origin);
                                        response
                                    }
                                };
                                response.headers_mut().insert("x-content-type-options", header::HeaderValue::from_static("nosniff"));
                                Ok::<_, Infallible>(response)
                            }
                        });
                        let _ = hyper::server::conn::http1::Builder::new().max_buf_size(32 * 1024)
                            .serve_connection(TokioIo::new(socket), service).with_upgrades().await;
                    }).await;
                });
            }
        });
        Ok(Self { endpoint, stop, task })
    }
    pub(crate) async fn close(mut self) {
        self.stop.cancel();
        self.task.abort();
        // Await cancellation so the bound port is released before IPC returns.
        let _ = (&mut self.task).await;
    }
}
fn webview_origin(app: &AppHandle, webview: &Webview) -> AppResult<String> {
    office_device::main_only(webview)?;
    let current = webview.url().map_err(|_| error(DENIED))?;
    // url::Origin treats custom schemes as opaque ("null"), but WKWebView
    // sends the concrete tauri://localhost Origin. Never allow arbitrary null.
    let origin = if current.scheme() == "tauri" && current.host_str() == Some("localhost")
        && current.port().is_none() && current.username().is_empty() && current.password().is_none() {
        "tauri://localhost".to_owned()
    } else { current.origin().ascii_serialization() };
    let packaged = matches!(origin.as_str(), "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost");
    let development = cfg!(debug_assertions) && app.config().build.dev_url.as_ref().is_some_and(|v| v.origin() == current.origin());
    if !packaged && !development { return Err(error(DENIED)); }
    Ok(origin)
}
#[tauri::command]
pub async fn office_link_open(app: AppHandle, webview: Webview, state: State<'_, OfficeLinkState>, origin: String, server_id: String) -> AppResult<OfficeLinkEndpoint> {
    let webview_origin = webview_origin(&app, &webview)?;
    let fingerprint = office_device::pinned(&app.config().identifier, &server_id)?;
    office_device::hub_info(&origin, &server_id, &fingerprint).await?;
    let bearer = office_device::session_for_link(&app.config().identifier, &origin, &server_id, &fingerprint).await?;
    let mut links = state.0.lock().await;
    if links.len() >= 8 { return Err(error("office_link_limit: 열린 회사 연결을 닫고 다시 시도해 주세요.")); }
    let link = Link::start_authenticated(&origin, fingerprint, webview_origin, "127.0.0.1:0", Some(bearer)).await?;
    let result = OfficeLinkEndpoint { link_id: link.endpoint.link_id.clone(), http_base_url: link.endpoint.http_base_url.clone() };
    links.insert(result.link_id.clone(), link);
    Ok(result)
}
#[tauri::command]
pub async fn office_link_close(app: AppHandle, webview: Webview, state: State<'_, OfficeLinkState>, link_id: String) -> AppResult<()> {
    webview_origin(&app, &webview)?;
    let link = state.0.lock().await.remove(&link_id);
    if let Some(link) = link { link.close().await; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{future::Future, sync::{atomic::{AtomicUsize, Ordering}, Mutex as StdMutex}};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    const APP_ORIGIN: &str = "http://tauri.localhost";
    struct Hub {
        origin: String,
        fingerprint: String,
        attempts: Arc<AtomicUsize>,
        received: Arc<StdMutex<Vec<(String, String, String, Bytes)>>>,
        task: JoinHandle<()>,
    }
    impl Drop for Hub { fn drop(&mut self) { self.task.abort(); } }
    fn run(test: impl Future<Output = ()>) {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            tokio::time::timeout(Duration::from_secs(15), test).await.expect("relay test timed out");
        });
    }
    async fn hub() -> Hub {
        let identity = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let cert = identity.cert.der().clone();
        let fingerprint = Sha256::digest(cert.as_ref()).iter().map(|v| format!("{v:02x}")).collect();
        let key = rustls::pki_types::PrivatePkcs8KeyDer::from(identity.signing_key.serialize_der());
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions().unwrap().with_no_client_auth().with_single_cert(vec![cert], key.into()).unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("https://{}", listener.local_addr().unwrap());
        let attempts = Arc::new(AtomicUsize::new(0));
        let received = Arc::new(StdMutex::new(Vec::new()));
        let seen = received.clone();
        let connected = attempts.clone();
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                let (socket, _) = listener.accept().await.unwrap();
                connected.fetch_add(1, Ordering::SeqCst);
                let acceptor = acceptor.clone();
                let seen = seen.clone();
                while connections.try_join_next().is_some() {}
                connections.spawn(async move {
                    let Ok(stream) = acceptor.accept(socket).await else { return };
                    let service = service_fn(move |mut request: Request<Incoming>| {
                        let seen = seen.clone();
                        async move {
                            let path = request.uri().to_string();
                            let auth = request.headers().get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).unwrap_or("").to_owned();
                            let cookie = request.headers().get(header::COOKIE).and_then(|v| v.to_str().ok()).unwrap_or("").to_owned();
                            let websocket = request.headers().contains_key(header::UPGRADE);
                            let upgrade = if websocket { Some(hyper::upgrade::on(&mut request)) } else { None };
                            let bytes = request.into_body().collect().await.unwrap().to_bytes();
                            seen.lock().unwrap().push((path.clone(), auth, cookie, bytes.clone()));
                            let mut response = Response::new(body(bytes));
                            response.headers_mut().insert(header::SET_COOKIE, header::HeaderValue::from_static("session=opaque; Secure; HttpOnly; Path=/"));
                            response.headers_mut().insert("set-auth-token", header::HeaderValue::from_static("response-bearer"));
                            if let Some(upgrade) = upgrade {
                                *response.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
                                response.headers_mut().insert(header::CONNECTION, header::HeaderValue::from_static("Upgrade"));
                                response.headers_mut().insert(header::UPGRADE, header::HeaderValue::from_static("websocket"));
                                response.headers_mut().insert("sec-websocket-accept", header::HeaderValue::from_static("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
                                tokio::spawn(async move {
                                    let mut stream = TokioIo::new(upgrade.await.unwrap());
                                    loop {
                                        let mut head = [0; 2];
                                        if stream.read_exact(&mut head).await.is_err() { break; }
                                        assert_eq!(head[1] & 0x80, 0x80, "browser-to-hub frame retains its mask");
                                        let length = usize::from(head[1] & 0x7f);
                                        let mut mask = [0; 4];
                                        stream.read_exact(&mut mask).await.unwrap();
                                        let mut payload = vec![0; length];
                                        stream.read_exact(&mut payload).await.unwrap();
                                        for (i, byte) in payload.iter_mut().enumerate() { *byte ^= mask[i % 4]; }
                                        let opcode = if head[0] == 0x89 { 0x8a } else { head[0] };
                                        stream.write_all(&[opcode, length as u8]).await.unwrap();
                                        stream.write_all(&payload).await.unwrap();
                                        if opcode == 0x88 { break; }
                                    }
                                });
                            } else if path == "/redirect" {
                                *response.status_mut() = StatusCode::FOUND;
                                response.headers_mut().insert(header::LOCATION, header::HeaderValue::from_static("/echo?redirected=1"));
                            } else if path == "/escape" {
                                *response.status_mut() = StatusCode::FOUND;
                                response.headers_mut().insert(header::LOCATION, header::HeaderValue::from_static("https://unapproved.example/private"));
                            }
                            Ok::<_, Infallible>(response)
                        }
                    });
                    let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(stream), service).with_upgrades().await;
                });
            }
        });
        Hub { origin, fingerprint, attempts, received, task }
    }
    fn client() -> reqwest::Client {
        // Focused tests must not depend on another test installing the provider.
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(3)).build().unwrap()
    }
    async fn link(hub: &Hub) -> Link {
        Link::start(&hub.origin, hub.fingerprint.clone(), APP_ORIGIN.into(), "127.0.0.1:0").await.unwrap()
    }
    #[test]
    fn matching_pin_http_roundtrip_preserves_auth_cookie_and_streamed_bytes() { run(async {
        let hub = hub().await;
        let link = link(&hub).await;
        let payload = vec![0xaf; 256 * 1024];
        let response = client().post(format!("{}/echo?a=1", link.endpoint.http_base_url))
            .header(header::ORIGIN, APP_ORIGIN).bearer_auth("unchanged-token").header(header::COOKIE, "session=opaque")
            .body(payload.clone()).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], APP_ORIGIN);
        assert_eq!(response.headers()["set-auth-token"], "response-bearer");
        assert_eq!(response.headers()[header::SET_COOKIE], "session=opaque; Secure; HttpOnly; Path=/");
        assert_eq!(response.bytes().await.unwrap().as_ref(), payload);
        let requests = hub.received.lock().unwrap();
        assert_eq!(requests[0].0, "/echo?a=1", "local capability never reaches hub");
        assert_eq!(requests[0].1, "Bearer unchanged-token");
        assert_eq!(requests[0].2, "session=opaque");
        drop(requests);
        link.close().await;
    }); }
    #[test]
    fn mismatching_pin_sends_zero_http_bytes_including_auth_or_upgrade() { run(async {
        let hub = hub().await;
        let link = Link::start(&hub.origin, "0".repeat(64), APP_ORIGIN.into(), "127.0.0.1:0").await.unwrap();
        for websocket in [false, true] {
            let mut request = client().post(format!("{}/sync", link.endpoint.http_base_url))
                .header(header::ORIGIN, APP_ORIGIN).bearer_auth("must-not-leak").body("private");
            if websocket { request = request.header(header::UPGRADE, "websocket").header(header::CONNECTION, "Upgrade"); }
            let response = request.send().await.unwrap();
            assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
            assert!(response.text().await.unwrap().starts_with("office_hub_pin_mismatch:"));
        }
        assert_eq!(hub.attempts.load(Ordering::SeqCst), 2, "real TLS connections attempted");
        assert_eq!(hub.received.lock().unwrap().len(), 0, "no HTTP request can precede pin verification");
        link.close().await;
    }); }
    #[test]
    fn missing_capability_wrong_origin_and_rebinding_never_contact_hub() { run(async {
        let hub = hub().await;
        let link = link(&hub).await;
        let base = &link.endpoint.http_base_url;
        let authority = reqwest::Url::parse(base).unwrap().origin().ascii_serialization();
        for request in [
            client().get(format!("{authority}/api/private")).header(header::ORIGIN, APP_ORIGIN),
            client().get(format!("{base}/api/private")),
            client().get(format!("{base}/api/private")).header(header::ORIGIN, "https://evil.example"),
            client().get(format!("{base}/api/private")).header(header::ORIGIN, APP_ORIGIN).header(header::HOST, "rebinding.example"),
        ] { assert_eq!(request.send().await.unwrap().status(), StatusCode::FORBIDDEN); }
        let response = client().request(reqwest::Method::OPTIONS, format!("{base}/api/private"))
            .header(header::ORIGIN, APP_ORIGIN).header(header::ACCESS_CONTROL_REQUEST_HEADERS, "authorization,content-type")
            .send().await.unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_HEADERS], "authorization,content-type");
        assert_eq!(hub.attempts.load(Ordering::SeqCst), 0);
        link.close().await;
    }); }
    async fn websocket(link: &Link) -> TcpStream {
        let url = reqwest::Url::parse(&link.endpoint.http_base_url).unwrap();
        let authority = format!("127.0.0.1:{}", url.port().unwrap());
        let mut socket = TcpStream::connect(&authority).await.unwrap();
        socket.write_all(format!("GET {}/sync HTTP/1.1\r\nHost: {authority}\r\nOrigin: {APP_ORIGIN}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", url.path()).as_bytes()).await.unwrap();
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            headers.push(socket.read_u8().await.unwrap());
            assert!(headers.len() < 8192);
        }
        assert!(headers.starts_with(b"HTTP/1.1 101"), "{}", String::from_utf8_lossy(&headers));
        socket
    }
    #[test]
    fn wss_upgrade_binary_ping_and_close_frames_roundtrip() { run(async {
        let hub = hub().await;
        let link = link(&hub).await;
        let mut socket = websocket(&link).await;
        socket.write_all(&[0x82, 0x84, 1, 2, 3, 4, 0xfe, 2, 0x83, 0x7b]).await.unwrap();
        let mut echo = [0; 6];
        socket.read_exact(&mut echo).await.unwrap();
        assert_eq!(echo, [0x82, 4, 0xff, 0, 0x80, 0x7f]);
        socket.write_all(&[0x89, 0x81, 1, 2, 3, 4, b'x' ^ 1]).await.unwrap();
        let mut pong = [0; 3];
        socket.read_exact(&mut pong).await.unwrap();
        assert_eq!(pong, [0x8a, 1, b'x']);
        socket.write_all(&[0x88, 0x82, 1, 2, 3, 4, 3 ^ 1, 0xe8 ^ 2]).await.unwrap();
        let mut close = [0; 4];
        socket.read_exact(&mut close).await.unwrap();
        assert_eq!(close, [0x88, 2, 3, 0xe8]);
        assert_eq!(hub.received.lock().unwrap()[0].0, "/sync");
        link.close().await;
    }); }
    #[test]
    fn shutdown_closes_active_tunnel_and_reused_port_rejects_stale_capability() { run(async {
        let hub = hub().await;
        let first = link(&hub).await;
        let old_url = first.endpoint.http_base_url.clone();
        let authority = reqwest::Url::parse(&old_url).unwrap().origin().ascii_serialization();
        let mut socket = websocket(&first).await;
        first.close().await;
        let mut byte = [0];
        assert_eq!(socket.read(&mut byte).await.unwrap(), 0, "shutdown terminates active WS tunnel");
        let second = Link::start(&hub.origin, hub.fingerprint.clone(), APP_ORIGIN.into(), authority.trim_start_matches("http://")).await.unwrap();
        assert_ne!(old_url, second.endpoint.http_base_url);
        assert_eq!(client().get(format!("{old_url}/echo")).header(header::ORIGIN, APP_ORIGIN).send().await.unwrap().status(), StatusCode::FORBIDDEN);
        assert_eq!(client().get(format!("{}/echo", second.endpoint.http_base_url)).header(header::ORIGIN, APP_ORIGIN).send().await.unwrap().status(), StatusCode::OK);
        second.close().await;
    }); }
    /// Opt-in: uses only a brand-new temporary cluster and the real packaged
    /// Node/Postgres/server. No .env, developer database, or OS keychain.
    #[test]
    #[ignore = "requires OFFICE_RUNTIME_ROOT pointing to a prepared bundle"]
    fn bundled_runtime_https_and_wss_through_native_relay() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            use std::process::Stdio;
            use tokio::io::{AsyncBufReadExt, BufReader};
            let root = std::fs::canonicalize(std::env::var("OFFICE_RUNTIME_ROOT").expect("set OFFICE_RUNTIME_ROOT")).unwrap();
            let directory = tempfile::tempdir().unwrap();
            let extension = if cfg!(windows) { ".exe" } else { "" };
            let mut command = tokio::process::Command::new(root.join(format!("node{extension}")));
            command.arg(root.join("control/runtime.mjs")).current_dir(&root).env_clear();
            for name in ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "LANG", "LC_ALL", "TZ"] {
                if let Some(value) = std::env::var_os(name) { command.env(name, value); }
            }
            let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
            let mut input = child.stdin.take().unwrap();
            let mut output = BufReader::new(child.stdout.take().unwrap()).lines();
            let profile = serde_json::json!({
                "protocol": 1, "dataDirectory": directory.path(), "scope": "lan",
                "tls": { "certificateFingerprint": null },
                "databasePassword": format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple()),
                "authSecret": format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4()),
            });
            input.write_all(format!("{profile}\n").as_bytes()).await.unwrap();
            let result = tokio::time::timeout(Duration::from_secs(90), async {
                let ready = loop {
                    let line = output.next_line().await?.ok_or("bundle exited before ready")?;
                    let event: serde_json::Value = serde_json::from_str(&line)?;
                    if event["phase"] == "failed" { return Err::<(), Box<dyn std::error::Error>>("bundled runtime failed to start".into()); }
                    if event["phase"] == "ready" { break event; }
                };
                let origin = ready["endpoint"].as_str().ok_or("missing endpoint")?;
                let pin = ready["certificateFingerprint"].as_str().ok_or("missing pin")?;
                let server_id = ready["serverId"].as_str().ok_or("missing server id")?;
                // Same live identity verification as office_link_open, using
                // this test's freshly generated pin instead of OS keychain.
                office_device::hub_info(origin, server_id, pin).await?;
                let link = Link::start(origin, pin.into(), APP_ORIGIN.into(), "127.0.0.1:0").await?;
                let response = client().get(format!("{}/health", link.endpoint.http_base_url)).header(header::ORIGIN, APP_ORIGIN).send().await?;
                if !response.status().is_success() { return Err("health request through relay failed".into()); }
                let health: serde_json::Value = serde_json::from_slice(&response.bytes().await?)?;
                if health["ok"] != true { return Err("health body through relay was invalid".into()); }
                let mut socket = websocket(&link).await;
                // RFC6455 ping/pong proves the real /sync upgraded socket is
                // bidirectional. Binary payload integrity has a separate test.
                socket.write_all(&[0x89, 0x81, 1, 2, 3, 4, b'x' ^ 1]).await?;
                let mut pong = [0; 3];
                socket.read_exact(&mut pong).await?;
                if pong != [0x8a, 1, b'x'] { return Err("bundled WSS pong mismatch".into()); }
                link.close().await;
                Ok(())
            }).await;
            // Close the parent's control pipe and positively confirm supervisor
            // exit before removing its disposable PostgreSQL directory.
            let _ = input.write_all(b"stop\n").await;
            drop(input);
            let drain = tokio::spawn(async move { while output.next_line().await.ok().flatten().is_some() {} });
            let exit = tokio::time::timeout(Duration::from_secs(45), child.wait()).await.expect("bundle shutdown timed out").unwrap();
            drain.await.unwrap();
            assert!(exit.success(), "bundled supervisor did not stop cleanly");
            assert!(!directory.path().join("postgres/postmaster.pid").exists(), "disposable PG process must be stopped");
            result.expect("bundle relay smoke timed out").expect("bundle relay smoke failed");
        });
    }
    #[test]
    fn redirects_remain_pinned_and_external_destinations_fail_closed() { run(async {
        let hub = hub().await;
        let link = link(&hub).await;
        let base = &link.endpoint.http_base_url;
        let response = client().get(format!("{base}/redirect")).header(header::ORIGIN, APP_ORIGIN).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(response.headers()[header::LOCATION], format!("{base}/echo?redirected=1"));
        let response = client().get(format!("{base}/escape")).header(header::ORIGIN, APP_ORIGIN).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert!(!response.headers().contains_key(header::LOCATION));
        link.close().await;
    }); }
}

#[cfg(test)]
pub(crate) async fn e2e_open(namespace: &str, origin: &str, server_id: &str) -> AppResult<Link> {
    let fingerprint = office_device::pinned(namespace, server_id)?;
    let bearer = office_device::session_for_link(namespace, origin, server_id, &fingerprint).await?;
    Link::start_authenticated(origin, fingerprint, "http://tauri.localhost".into(), "127.0.0.1:0", Some(bearer)).await
}
