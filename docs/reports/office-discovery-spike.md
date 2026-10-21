# 사내 작업 공간 자동 발견 spike

2026-10-21 · macOS Apple Silicon에서 구현 및 검증. 발견 정보는 누구나 위조할 수 있는 후보이며 기기 인증·회사 가입·접근 권한을 부여하지 않는다. 이 작업의 명시적 요구대로 공개 동의한 표시 이름만 광고하며, 이전 spec 08의 fingerprint 광고 제안은 적용하지 않는다.

## 선택

| 방식 | 장점 | 비용 / 플랫폼 경계 |
| --- | --- | --- |
| **mdns-sd 0.20.2, 선택** | Rust 내 구현, 별도 Bonjour 프로그램·서비스·동적 라이브러리 설치 없음, macOS/Windows 동일 필터·검증·종료 코드, 인터페이스 predicate 지원 | 앱이 UDP multicast socket을 직접 소유. OS 권한 거절을 DNS-SD의 PolicyDenied만큼 구체적으로 식별하기 어려워 시간 제한과 초대 대체 경로가 필요 |
| macOS `dns_sd` / Windows `DnsServiceBrowse`·`DnsServiceRegister` 래퍼 | 시스템 responder와 권한 상태 통합, 플랫폼 기본 API | macOS와 Windows 별도 FFI·callback 취소/수명 관리 필요. macOS용 dns-sd 래퍼를 Windows에 그대로 쓰면 Bonjour DLL 설치 요구가 생길 수 있음. Windows 기본 API는 Windows 10 이상 지원 |

근거: [mdns-sd 고정 버전 API와 제약](https://docs.rs/mdns-sd/0.20.2/mdns_sd/), [인터페이스 predicate](https://docs.rs/mdns-sd/0.20.2/mdns_sd/struct.IfPredicate.html), [Microsoft DnsServiceBrowse](https://learn.microsoft.com/en-us/windows/win32/api/windns/nf-windns-dnsservicebrowse), [Apple Bonjour](https://developer.apple.com/bonjour/).

## OS 권한과 서명

- macOS 15부터 Local Network 접근 권한이 적용되며 UDP multicast 송수신과 Bonjour 등록/검색 모두 대상이다. `Info.plist`에 한국어·영어 `NSLocalNetworkUsageDescription`과 `NSBonjourServices=["_ib-office._tcp"]`를 병합한다. **multicast entitlement는 macOS에서 필요 없다**(iOS 제한을 macOS 요구로 잘못 적용하지 않음). 현재 앱은 App Sandbox를 사용하지 않으므로 sandbox network.client/server entitlement도 추가하지 않는다. 근거: [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy), 저장소 `entitlements.plist`.
- Apple은 Local Network 권한이 앱 identity를 안정적으로 추적하도록 Apple 발급 identity로 서명할 것을 권고한다. 현재 Developer ID·hardened runtime·공증 절차를 유지하며 새 privileged helper나 native dylib를 번들하지 않는다. 이 선택이 서명/공증 통과를 자동 보장하지 않으며 이번 작업에서는 새 installer를 서명·공증하지 않았다. CLI smoke는 서명된 앱의 최초 권한 UI 증거가 아니다. 근거: [Apple TN3179, macOS signing considerations](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
- Windows에서는 mDNS UDP 5353(224.0.0.251 / ff02::fb) 송수신과 별도의 허브 HTTPS listener가 방화벽/회사 정책에 의해 차단될 수 있다. OS DNS-SD wrapper를 써도 네트워크 정책을 우회하지 못한다. 방화벽을 끄거나 Public profile에 포괄 규칙을 자동 설치하지 않으며, 관리자가 회사 Domain/Private 정책에서 허용해야 한다. UDP/5353은 [RFC 6762](https://www.rfc-editor.org/rfc/rfc6762#section-5), 방화벽 원칙은 [Microsoft Windows Firewall](https://learn.microsoft.com/windows/security/operating-system-security/network-security/windows-firewall/)에 근거한다. Windows native 방화벽 prompt/서명 결과는 미검증이다.

## 데이터·수명 경계

`_ib-office._tcp.local.` 서비스의 instance와 hostname은 무작위 값이다. TXT는 `serverId`, `displayName`, `port`, `hostGeneration`, `protocolVersion=1` 다섯 필드만 허용한다. fingerprint·초대·키·사용자/회사/팀 명단·파일 정보는 포함하지 않는다. 표시 이름은 사용자가 공개하기로 입력한 label이며 OS 사용자명/hostname에서 추론하지 않는다. 이 표시 이름은 기기 인증에 사용하지 않는다.

광고는 별도 명시적 opt-in 호출과 실제 `office_host`의 `ready + scope=lan + lan_exposed` 조건을 모두 요구한다. 현재 프로세스에만 opt-in을 보관하고 호스트 중지/실패/세대 변경을 200ms 간격으로 감시해 withdraw/shutdown한다. scope와 identity/port는 WebView 인자가 아니라 native host state에서 가져온다. 종료 시 discovery state도 정리한다.

검색은 화면을 연 명시적 호출 한 번에 최대 8초, 상한 32 records이며 화면을 닫으면 취소·후보 제거한다. resolve/remove 이벤트를 반영하고 같은 serverId의 동일 endpoint claims를 하나로 합친다. 서로 다른 claims는 선택 불가능하게 숨긴다. 후보는 30초 만료하고 endpoint/세대/표시 이름 변경 시 새 무작위 candidateId를 발급한다. 후보 선택은 현재 목록의 capability만 허용하며 URL을 인자로 받지 않는다. 8초 뒤 socket은 닫히므로 이후 departure는 만료로 제거한다(실시간 상시 browse 아님).

RFC1918 IPv4와 IPv6 ULA만 허용하고 public, multicast, loopback, CGNAT, IPv4-mapped IPv6, link-local은 거부한다. link-local IPv6는 interface scope 처리의 모호성을 피하려고 지원하지 않는다. 한 응답에 공개 주소와 사설 주소가 섞여도 전체 거절한다. 알려진 loopback/가상/VPN/터널 interface 이름을 제외하고 private 주소 interface에서만 송수신·광고 주소 자동 채움을 허용한다. 이름 기반 제외는 모든 VPN을 식별하는 보안 경계가 아니며 사내 장비의 custom adapter는 native 점검이 필요하다.

WebView payload는 `{candidateId, serverId, displayName, trust:"untrusted"}`뿐이다. endpoint와 hostGeneration은 Rust 내부에만 남는다. `resolve_candidate`는 초대/SAS 흐름이 native에서 endpoint를 얻는 함수 경계이고 pin을 저장하지 않는다. `office_discovery_open(candidateId)`는 기존 `office_link_open`을 호출해 **이미 독립적으로 승인한 pin**으로만 reconnect한다. 신규 허브는 approval-required로 거절하며 별도 초대/SAS 승인이 필요하다. 이번 구현에 새 SAS/초대 발급·승인 프로토콜은 포함하지 않는다. 문법적으로 유효한 단독 위조 mDNS 서버를 식별하는 것은 불가능하므로 모든 후보에 untrusted를 유지하고 실제 trust 검증은 기존 TLS pin/초대 흐름에 맡긴다.

## 의존성 검토

직접 의존성은 `mdns-sd = "=0.20.2"`와 transitive 버전 제약용 `socket-pktinfo = "=0.4.0"`이며, mdns-sd 기본 feature를 꺼 library logging과 async runtime 의존성을 추가하지 않는다. 새 해석에서 게시 5일 된 libc 0.2.191이 선택된 것을 발견해 기존 libc를 유지하는 socket-pktinfo 0.4.0으로 lock을 제한한다. Cargo.lock의 버전·checksum이 배포 transitive 고정값이다. 게시일은 crates.io version API의 `created_at`로 확인했다.

| 신규 crate | 고정 버전 | 게시일 UTC | license |
| --- | --- | --- | --- |
| mdns-sd | 0.20.2 | 2026-07-17 | Apache-2.0 OR MIT |
| flume | 0.12.0 | 2025-12-08 | Apache-2.0 / MIT |
| if-addrs | 0.15.0 | 2026-02-08 | MIT OR BSD-3-Clause |
| socket-pktinfo | 0.4.0 | 2025-12-01 | MIT |
| spin | 0.9.9 | 2026-07-13 | MIT |

모두 기준일 2주 이상 전 게시됐다. 전이 경로: mdns-sd → flume → spin → lock_api → scopeguard; mdns-sd → if-addrs / socket-pktinfo → libc(Unix) 또는 windows-sys(Windows); mdns-sd → fastrand / mio / socket2(기존 트리 재사용). native responder 설치, OpenSSL, TLS/crypto library 또는 새로운 build script가 추가되지 않는다. 기존 재사용 의존성: fastrand 2.4.1 (Apache-2.0 OR MIT), mio 1.2.1 (MIT), socket2 0.6.4 (MIT OR Apache-2.0), libc 0.2.186 (MIT OR Apache-2.0), lock_api 0.4.14 / scopeguard 1.2.0 (MIT OR Apache-2.0), windows-sys 0.61.2 → windows-link 0.2.1 (MIT OR Apache-2.0). Unix 쪽 license는 로컬 registry manifest, Windows 쪽은 해당 crate의 공개 metadata로 확인했다. 기존 libc 버전과 checksum은 보존했다. Cargo resolver는 일부 기존 Windows dependency edge를 실제 manifest의 버전 범위에 맞게 기존 windows-sys 0.45/0.52/0.59/0.60 package로 정정했다(새 Windows package 추가 없음). socket2 0.6.4는 windows-sys 0.60.2를 재사용한다. [게시일 원본 API 예시](https://crates.io/api/v1/crates/mdns-sd/0.20.2), [소스/manifest](https://docs.rs/crate/mdns-sd/0.20.2/source/Cargo.toml), [socket-pktinfo 고정 버전](https://docs.rs/crate/socket-pktinfo/0.4.0/source/Cargo.toml).

## 검증

| 실행 명령 | 실제 결과 |
| --- | --- |
| `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake cargo check` | 최초 구현 통과. 최종 고정 lock으로 `cargo check --locked`도 **통과**(22.87초), 기존 semantic_hits dead_code 경고만 |
| 같은 CMAKE로 `cargo test` | 첫 실행은 신규 테스트 fixture가 mdns-sd의 non-exhaustive struct와 변환 API를 잘못 사용해 컴파일 실패. 공개 `ServiceInfo::as_resolved_service` / `IntoTxtProperties`로 수정 후 전체 재실행 통과: unit 363 pass / 10 ignored, integration 8+4 pass, data-volume 1 ignored |
| 같은 CMAKE로 `cargo test --locked --lib office_` | 최종 인터페이스 수정 후 **19 pass / 2 ignored**, discovery·host·기기·pinned relay 회귀 포함 |
| 같은 CMAKE로 `cargo test --lib office_discovery::tests::same_mac_advertise_browse_smoke -- --ignored --exact` | **1/1 통과**, 0.97초. 별도 두 daemon 사이 실제 multicast 광고→검색→TXT/주소 검증. 제품용 사설 IP·인터페이스 필터 그대로 사용하며 lo/127.0.0.1을 허용하는 우회는 하지 않음 |
| `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/lib/officeDiscovery.test.ts` | **5/5 통과**, 화면 open/close·늦은 start 취소·후보 제거·재시도 금지·opaque 선택·명시적 opt-in |
| `pnpm exec tsc --noEmit` | 첫 실행은 병행 작업 중 `OfficePanel.tsx:23` readonly 배열 오류로 실패. 두 번째는 `OfficeScreens.test.ts:17` `onConfirmSas` prop 누락으로 실패. 두 오류 모두 UI 담당에게 전달; 병행 변경 수정 후 최종 세 번째 실행 **통과**(exit 0), discovery 소유 TS 파일의 오류는 없었음 |
| `plutil -lint app/apps/desktop/src-tauri/Info.plist` / `git diff --check` | 통과 |

Rust 단위 검증에는 TXT 필수/추가 field·버전·세대·포트·이름 검증, private 주소 필터, 혼합 public 주소 거절, 가상/VPN/loopback 필터, Windows `Local Area Connection` 허용, 32개 상한, 중복 제거, removed/만료, 서버 신원 충돌 후보 거절, 임의 URL/낡은 candidateId 선택 거절과 공개 payload에 주소·포트·pin이 없는지가 포함된다. 호스트 getter 회귀는 LAN ready·identity·port 조건과 중지/실패/loopback 차단을 검증한다. 테스트는 실제 OS keychain이나 개발 DB에 접근하지 않으며 office:prepare는 실행하지 않았다.

smoke는 실제 HTTPS 서버를 여는 테스트가 아니라 발견 protocol 테스트다. 두 대의 실제 LAN, Windows(방화벽·네트워크 권한·WebView2 포함), Intel Mac, 설치 앱의 Local Network prompt/서명·공증은 미검증이다. 새 UI 화면은 이 변경에서 작성하지 않았고 Windows/macOS 화면 검증은 해당 UI 담당 범위다.
