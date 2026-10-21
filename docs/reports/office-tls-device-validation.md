# 사내 허브 TLS와 기기 키 검증

2026-10-21 기준 구현과 검증 결과다. LAN 허브는 자체서명 인증서로 HTTPS와 WSS를 함께 제공하고, Rust는 승인된 인증서의 SHA-256 지문을 확인한 연결에서만 허브 정보 확인과 pairing challenge 서명을 허용한다. 별명은 서명 대상 표시 정보이며 인증 주체는 안정된 device ID와 Ed25519 공개키다.

## 허브 신원과 TLS 수명

첫 실행은 제품 전용 `app_local_data_dir/office-host/tls-identity.json`에 서버 ID, 단조 증가 host generation, 인증서와 개인키를 함께 생성한다. 디렉터리는 0700, fsync 후 원자 교체하는 파일은 0600이다(POSIX에서는 부모 디렉터리도 fsync). POSIX 권한은 macOS에서 검증했으며 Windows ACL은 실기기 확인이 필요하다. 기존 인증서와 개인키가 불일치하거나 신원 파일이 손상된 경우 새 신원으로 조용히 대체하지 않는다. 재시작은 서버 ID와 인증서를 유지하고 generation만 증가시켜 이전 초대·challenge의 재사용을 차단한다.

인증서는 RSA 2048 / SHA-256, serverAuth 용도로 365일 유효하다. `ready` 이벤트는 인증서 DER의 SHA-256 지문, serverId, hostGeneration, certificateExpiresAt을 보고한다. 개인키는 이벤트, 로그, 명령행 인자와 환경값에 넣지 않는다. 서버 child는 파일 경로만 받고, `OFFICE_SERVER_ID`, `OFFICE_HOST_GENERATION`, `OFFICE_HUB_FINGERPRINT`와 실제 공개 HTTPS origin인 `BETTER_AUTH_URL`을 받는다. LAN에서 TLS 없는 office 리스너 시작은 거부한다. Postgres와 기존 별도 Hocuspocus 포트는 loopback에만 바인딩한다.

만료된 인증서는 `tls-renewal-required`로 시작을 거부한다. 자동 인증서 갱신이나 pin 덮어쓰기는 하지 않는다. 운영상 만료 30일 전 관리자가 갱신을 준비하고, 현재 서버 ID와 자료를 유지한 상태에서 새 키·인증서를 발급한 뒤 별도 전달한 새 초대로 각 기기에서 신뢰를 재승인하는 흐름이 필요하다. 현재 릴리스에는 갱신 안내·pin 교체 UI와 관리 명령이 없다. 따라서 파일을 삭제해 신원을 초기화하는 방법을 갱신 절차로 안내해서는 안 된다. 정식 장기 운영 전, 이전 키 폐기·새 초대 단회성·각 기기의 명시적 pin 교체와 복구를 감사하는 관리 흐름을 구현해야 한다.

## Rust 기기 자격과 pin

기기 자격은 최초 `officeDeviceIdentity()` 호출에 생성한다. OS keychain service는 `{app identifier}.office-device.v1`이며 기존 일반 keychain IPC service와 분리돼 WebView의 일반 `keychain_get`으로 개인키를 읽을 수 없다. 저장된 키가 손상됐을 때도 자동으로 새 기기와 바꾸지 않는다.

새 커맨드는 모두 main WebView만 호출할 수 있다.

| Typed IPC | 동작 |
| --- | --- |
| `officeDeviceIdentity()` | 안정된 deviceId, Ed25519 SPKI 공개키와 SHA-256 지문 반환 |
| `officeHubApprove(origin, serverId, fingerprint)` | 별도 전달된 초대를 사용자가 승인한 뒤 최초 pin 저장. 실제 TLS 연결과 서버 신원을 먼저 확인. 기존 pin 변경 거부 |
| `officeHubVerify(origin, serverId)` | keychain의 pin으로 TLS 연결과 `/api/office` identity 확인 |
| `officeDeviceSignChallenge(origin, challenge)` | 실제 TLS pin, device ID, 공개키 지문, audience, host generation 확인 후 서버와 동일한 길이 구분 canonical SHA-256 digest에 Ed25519 서명. 서명만 반환 |

Rust TLS verifier는 정확한 인증서 지문, 유효기간, serverAuth 용도, 인증서 서명과 TLS handshake 서명을 검증한다. CA/호스트명 기반 신뢰 대신 승인된 인증서가 허브 identity이므로 LAN IP가 바뀌어도 같은 인증서로 연결할 수 있다. 프록시와 redirect는 사용하지 않는다. HTTP origin은 거부한다. 인증서 불일치는 `office_hub_pin_mismatch`와 쉬운 한국어 문구로 연결을 중단하며 HTTP 요청을 보내지 않는다. 발견 응답만으로 `officeHubApprove`를 호출해서는 안 된다.

현재 IPC는 허브 identity 확인과 challenge 서명 범위다. 기존 TS HTTP/Yjs provider 전체를 Rust pinned transport로 바꾸는 중계 adapter 및 실제 pairing 화면 연결은 이 변경의 구현 범위에 포함되지 않는다. 기기 승인만으로 Better Auth 세션이나 vault 권한을 추가하지 않는다.

## 검증

모든 서버 테스트와 데모는 새 임시 PostgreSQL cluster만 사용한다. 개발 `.env`나 공유 context DB를 대상으로 실행하지 않았다. `tests/office-pairing*.test.ts`는 수정하지 않았다.

| 명령 | 실제 결과 |
| --- | --- |
| `pnpm run build` (server) | 통과 |
| `pnpm exec tsc --noEmit` (desktop) | 통과 |
| `node --test office-host/runtime.test.mjs` | 15 통과, 번들 필요 3 skip |
| `node scripts/demo-office-pairing.mjs` (app) | 9/9 PASS |
| `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake cargo check` | 통과. 최종 source 재검증도 통과 |
| `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake OFFICE_TLS_TEST_IDENTITY=/tmp/ib-office-tls-cargo/tls-identity.json cargo test` | 363 통과, 9 ignored |
| `cargo test --lib office_` (같은 CMAKE 및 임시 TLS fixture 환경) | 최종 8/8 통과. camelCase ready와 서버 digest golden 포함 |
| `OFFICE_RUNTIME_ROOT=/tmp/ib-office-runtime-validation-PCEzL9 OFFICE_HOST_SYNC_REGRESSIONS=1 node --test office-host/runtime.test.mjs` | 최종 소스 기준 18/18 통과. 내부 sync와 office 24개 회귀 통과 |
| `OFFICE_RUNTIME_ROOT=../desktop/src-tauri/office-runtime/darwin-arm64 OFFICE_HOST_SYNC_REGRESSIONS=1 node --test office-host/runtime.test.mjs` | 재생성 전 실제 경로 실행: 15 통과, 3 실패. bundle에 selfsigned가 없어 MODULE_NOT_FOUND로 시작 실패. 코디네이터가 `office:prepare`로 번들을 재생성한 뒤 같은 명령을 다시 실행: 18 통과, 0 실패 (2026-10-21, darwin-arm64 한정). 데모 `scripts/demo-office-pairing.mjs`도 9/9 |

임시 runtime fixture 사전 실행은 17/18 통과했고, office 회귀의 고정 audience(`localhost`)와 runner 환경(`127.0.0.1`) 불일치로 4개 assertion이 403을 받았다. runner의 `BETTER_AUTH_URL`을 테스트 fixture와 일치시킨 뒤 해당 smoke를 재실행해 통과했다. 이 smoke 안의 sync 회귀와 office 3개 파일은 총 24개 테스트를 통과했고, LAN HTTPS/WSS와 평문 거절·지문 불일치 거절도 통과했다. 제품 번들은 수정하지 않았으며 새 dist와 기존 Node/PG를 `/tmp`에 조합한 사전 fixture 결과다.

Node TLS 테스트는 일치 pin에서 health 요청 1건 성공 후 불일치 pin의 요청이 `hub-pin-mismatch`로 거부되고 서버 요청 수가 계속 1인지 검사한다. Rust native TLS 테스트도 실제 loopback TCP/TLS 서버에서 성공 요청 1건과 불일치 pin 거부 후 요청 수 1을 확인했다. 즉 단순 문자열 비교 테스트가 아니라 HTTP 요청 전 연결 차단을 검증했다. Rust에서 유효 시작일보다 이른 시각과 만료 뒤 시각으로 인증서 검증을 실행해, 정확한 pin이 있어도 유효기간을 벗어나면 거절됨을 확인했다.

추가 수정은 취소·거절된 pairing status capability의 즉시 409 거절과 만료 시 410 거절이다. 공개 `/api/office`에는 protocol과 허브 identity만 반환하며 계정·디렉터리·문서 내용을 포함하지 않는다.

Windows, macOS Intel, 패키지 설치본의 keychain 권한·방화벽·절전/재개, 실제 동료 PC와 네트워크에서의 동작은 확인하지 않았다. 키체인 API의 실제 저장/읽기는 OS 권한 프롬프트를 피하는 테스트 범위 밖이며 정식 운영 전 native 확인이 필요하다.

## 의존성

`selfsigned`는 [공식 저장소](https://github.com/jfromaniello/selfsigned)의 X509 생성 라이브러리다. 정확 버전 `5.5.0`을 production dependency로 고정했다. npm metadata의 게시일은 2026-01-12로 2주 이상 경과했다. `pnpm deploy --prod`에 포함되며 자체 ASN.1/인증서 서명 구현이나 시스템 openssl 실행을 추가하지 않는다. lock diff는 신규 dependency 그래프 추가만 포함하고 기존 버전은 갱신하지 않았다.

아래는 설치된 production 전이 그래프의 패키지 manifest 기준 버전과 라이선스다.

```text
@noble/hashes@1.8.0 | MIT
@peculiar/asn1-cms@2.11.0 | MIT
@peculiar/asn1-csr@2.11.0 | MIT
@peculiar/asn1-ecc@2.11.0 | MIT
@peculiar/asn1-pfx@2.11.0 | MIT
@peculiar/asn1-pkcs8@2.11.0 | MIT
@peculiar/asn1-pkcs9@2.11.0 | MIT
@peculiar/asn1-rsa@2.11.0 | MIT
@peculiar/asn1-schema@2.11.0 | MIT
@peculiar/asn1-x509@2.11.0 | MIT
@peculiar/asn1-x509-attr@2.11.0 | MIT
@peculiar/utils@2.0.3 | MIT
@peculiar/x509@1.14.3 | MIT
asn1js@3.1.0 | BSD-3-Clause
bytestreamjs@2.0.1 | BSD-3-Clause
pkijs@3.4.2 | BSD-3-Clause
pvtsutils@1.3.6 | MIT
pvutils@1.2.0 | MIT
reflect-metadata@0.2.2 | Apache-2.0
selfsigned@5.5.0 | MIT
tslib@2.8.1 | 0BSD
tslib@1.14.1 | 0BSD
tsyringe@4.10.0 | MIT
```

Rust는 기존 lock에 이미 있던 `ring = "=0.17.14"`, `base64 = "=0.22.1"`, `rustls-webpki = "=0.103.15"`를 직접 의존성으로 고정했다. 각각 native Ed25519 생성/서명, canonical base64url 인코딩, pin을 확인한 인증서의 유효기간·용도·서명 검증을 위한 것이다. 새 Rust package/version은 lock에 추가하지 않았다. ring은 `Apache-2.0 AND ISC`, base64는 `MIT OR Apache-2.0`, rustls-webpki는 `ISC` 라이선스다.
