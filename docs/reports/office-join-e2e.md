<!-- SPDX-License-Identifier: Apache-2.0 -->
# 사내 협업 합류 종단간 검증

준비된 darwin-arm64 제품 런타임을 상대로 같은 Mac 안에서 호스트·관리자·합류자 역할을 분리해 실행했다. 최종 E2E **19/19 PASS**, 서버 pairing **34/34**, desktop Vitest **3,717 통과**, TypeScript 검사, Rust check/test, 기존 데모 **11/11 PASS**다. 실제 두 대의 컴퓨터, native Windows, 서명된 설치본은 검증하지 않았다.

## 변경 파일과 실행 방법

- `app/scripts/e2e-office-join.mjs`: 실행 방법을 파일 상단 README 주석에 포함했다. 번들 supervisor, Node, PostgreSQL, migration, HTTPS 서버를 그대로 사용한다. 매 실행마다 임시 cluster와 계정·조직을 만들며 공유 개발 DB를 사용하지 않는다. 한국어 PASS/FAIL 표를 출력하고 하나라도 실패하면 exit 1이다.
- `app/apps/desktop/src-tauri/src/office_device.rs`: 기존 IPC의 begin/confirm/status 본문을 창·Tauri State 없이 호출할 수 있는 얇은 내부 함수로 분리했다. main WebView 검사는 IPC에 유지했다. `#[cfg(test)]` 아래 ignored JSON-lines 드라이버를 추가해 실제 native 프로토콜을 실행한다.
- `app/apps/desktop/src-tauri/src/office_discovery.rs`: 테스트 전용 광고·발견 helper를 추가했다. 실제 mDNS 소켓, 제품과 같은 NIC 필터·TXT 형식, production parser·후보 충돌 검사·capability 해석을 사용한다. 발견 레코드를 주입하지 않는다.
- 이 보고서. 서버/office-host 제품 구현은 변경하지 않았다.

저장소의 `app/`에서 실행한다. 별도 `OFFICE_RUNTIME_ROOT`를 생략하면 아래 경로가 기본값이다.

```sh
CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake \
OFFICE_RUNTIME_ROOT="$PWD/apps/desktop/src-tauri/office-runtime/darwin-arm64" \
node scripts/e2e-office-join.mjs
```

Cargo는 드라이버를 `cargo test --lib --no-run --message-format=json`으로 빌드한 뒤 직접 실행한다. Cargo를 중복 실행하지 않았다. 번들은 읽기 전용으로 사용했고 `office:prepare`는 실행하지 않았다. 임시 허브는 `scope=lan`으로 시작하며 ready 이벤트의 지문·serverId·generation·port를 확보한다.

## 실제 흐름과 결과

| 결과 | 단계 | 확인한 동작 |
| --- | --- | --- |
| PASS | Rust 드라이버 빌드 | 실제 앱 crate의 ignored test 실행 파일 확보 |
| PASS | 번들 LAN HTTPS ready | 지문·serverId·generation 확보 |
| PASS | 관리자·합류자 분리 | 서로 다른 임시 계정 및 조직 생성, 기존 membership 준비 |
| PASS | mDNS 광고·발견 | 서버 ID가 일치하는 untrusted 후보를 실제 multicast로 발견·해석 |
| PASS | 초대 API | 관리자 세션의 `POST /api/office/invitations`에서 IB1 코드 획득 |
| PASS | Rust begin | 초대 해석, 후보 serverId 대조, TLS pin, commit/reveal, Ed25519 proof, 여섯 자리 SAS |
| PASS | Rust confirm | 숫자 일치 확인 후 참여 요청, `pending_approval` |
| PASS | 승인함 비교 | 관리자 `GET requests`의 같은 sessionId에 있는 SAS와 Rust SAS 일치 |
| PASS | 관리자 승인 | 관리자 `sas-confirm(matches:true)` 뒤 decision approved |
| PASS | Rust status | approved 수신과 실제 OS 키체인의 신뢰 pin 저장·읽기 |
| PASS | 초대 재사용 | 이미 소비된 초대의 Rust begin 거절, `office_invite_invalid` |
| PASS | SAS 불일치 3회 | 실제 1.1초/2.1초 backoff 대기, 각 403 sas_mismatch; DB state cancelled, failed_attempts=3, SAS·commit·server nonce NULL; Rust status 및 후속 승인 거절(409) |
| PASS | 다른 serverId | 다른 serverId를 넣어 재인코딩한 IB1과 실제 발견 후보의 결합을 `office_hub_pin_mismatch`로 거절 |
| PASS | 서버 초대 만료 | 임시 DB의 초대 만료 시각만 과거로 바꾼 뒤 원래 코드를 Rust begin으로 보내 거절 |
| PASS | 코드 만료 | 만료 시각을 과거로 재인코딩한 IB1을 Rust parser가 `office_invite_expired`로 거절 |
| PASS | 인증서 변경 | 이미 승인된 기기의 namespace와 기존 pin으로 다른 인증서의 임시 TLS endpoint에 연결, pin mismatch 거절 및 HTTP 요청 0건 |
| PASS | 키체인 정리 | native 삭제·재조회, 각 테스트 전용 service/account의 `security find-generic-password` 결과 항목 없음 |
| PASS | 프로세스 정리 | runtime 정상 stop, 소유 child 0개, PostgreSQL postmaster.pid 없음 |
| PASS | 임시 자료 정리 | 임시 데이터 디렉터리 삭제 확인 |

현재 서버의 승인함은 `pending_approval` 요청만 반환한다. 따라서 유효한 실행 순서는 **begin → 합류자 confirm/request → 관리자 승인함 SAS 비교 → 관리자 confirm/decision → 합류자 status**다. 관리자 승인 전에 합류자 confirm을 수행한 것은 현재 프로토콜의 상태 전이 조건이며 보안 검사를 우회한 것이 아니다. 승인 전에는 pin을 영구 저장하지 않는다.

기존 계정 연결을 검증하므로 임시 합류자에게 기존 조직 member 행을 준비했다. Pairing 자체가 membership이나 vault 권한을 만드는 것으로 취급하지 않는다. 초대의 `linkAccount=true`를 유지하며 Rust는 실제 OS 키체인에서 production과 같은 `session-v2:<origin>` 키의 토큰을 읽는다. 계정 토큰과 기기 키·pin은 실행별 `com.infinitebrain.e2e-office-<UUID>-<device>` 아래의 별도 테스트 service에만 저장했다. 제품 namespace는 읽거나 쓰지 않았고 토큰·개인키·초대 코드는 로그나 명령행 인자에 남기지 않았다.

## 발견 사항과 수정

제품의 프로토콜 불일치, 후보 해석, 세션 키 형식, TLS pin 처리 결함은 이번 경로에서 재현되지 않았다. 제품 동작을 바꾸는 결함 수정은 없으며, 변경은 실제 코어를 직접 호출하기 위한 얇은 분리와 테스트 전용 helper다.

첫 E2E 시도는 **14/15 PASS, exit 1**이었다. 정상 승인까지 통과한 뒤 부정 시나리오에서 같은 계정에 매번 새 personId를 부여한 fixture 때문에 참여 요청이 거절됐다. 계정에 연결한 personId를 유지하고 device namespace만 바꾸도록 스크립트를 수정했다. 실제 모델의 ‘한 사람·여러 기기’를 따르는 테스트 데이터 수정이며 서버 linking 제약을 완화하지 않았다. 이후 실행과 최종 정리 보강 뒤 재실행은 모두 **19/19 PASS, exit 0**이었다.

불일치 시도는 DB 시계를 조작하지 않고 서버 backoff를 실제 기다렸다. 초대 만료에만 throwaway DB의 해당 초대 행을 변경했다. 다른 serverId와 만료 코드 검사는 checksum이 유효한 IB1 fixture이며 두 번째 회사 허브를 추가 실행한 시험은 아니다. 인증서 변경 검사는 별도 임시 HTTPS fixture로 실시했으며 원래 허브 identity 파일은 수정하지 않았다.

## 실행 명령과 실제 결과

| 디렉터리 | 명령 | 결과 |
| --- | --- | --- |
| `app/` | `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake node scripts/e2e-office-join.mjs` (기본 번들 경로) | 최종 19/19 PASS, exit 0 |
| `app/` | `node scripts/demo-office-pairing.mjs --test-pairing` | 새 disposable cluster, migration 001~069; 6 파일·34 tests PASS, exit 0 |
| `app/apps/desktop/src-tauri/` | `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake cargo check` | PASS, exit 0 |
| `app/apps/desktop/src-tauri/` | `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake OFFICE_TLS_TEST_IDENTITY=<새 임시 TLS fixture>/tls-identity.json cargo test` | 378 통과(366 unit + 8 bootstrap_batch + 4 index), 12 ignored, 0 실패; exit 0 |
| `app/apps/desktop/` | `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run` | 361 파일·3,717 tests 통과; 2 파일·12 tests skipped; exit 0 |
| `app/apps/desktop/` | `pnpm exec tsc --noEmit` | PASS, exit 0 |
| `app/` | `node scripts/demo-office-pairing.mjs` | 별도 disposable cluster, 11/11 PASS, exit 0 |
| 저장소 | `git diff --check` | PASS |

Rust 전체 시험에는 freshly generated TLS fixture를 전달하여 `native_tls_transport_refuses_mismatching_pin_before_http`도 실제 실행했다. 해당 fixture는 종료 후 삭제했다. ignored E2E 드라이버는 전체 Cargo 기본 실행에서는 제외되고 E2E 스크립트가 명시적으로 실행한다. Cargo의 기존 `semantic_hits` dead_code warning은 남아 있다. 테스트 중 생성한 허브/PG는 모두 종료했고 임시 자료와 키체인 항목을 지웠다. 기존 uncommitted 자료는 보존했으며 커밋·푸시는 하지 않았다.

## 검증 경계

이 결과는 macOS Apple Silicon 한 대에서 실제 번들 허브와 Rust native 합류 코어를 연결한 검증이다. Tauri WebView 이벤트/화면 클릭, 별도 동료 PC, 실제 사내망의 multicast 차단·방화벽·OS 권한 거절·절전/재개, native Windows/WebView2, macOS Intel, 서명·공증된 설치본은 미검증이다. 이 작업은 UI를 변경하지 않았다. 실제 vault 동기화, 그룹 ACL, 기기 세션으로 문서 접근, relay 데이터 전송의 종단간 성공까지 입증하는 시험도 아니다. 해당 범위를 출시 완료로 해석하지 않는다.
