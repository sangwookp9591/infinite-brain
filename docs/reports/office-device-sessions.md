<!-- SPDX-License-Identifier: Apache-2.0 -->
# 승인 기기 세션과 vault 동기화

2026-10-22 작업. 기존 연결 Better Auth user/member로 기기 세션을 발급하고, 실제 번들 허브의 HTTP 노트 등록과 binary Yjs 수렴을 검증했다. UI 전역 store/vault 선택·provider 생명주기 연결은 coordinator 결정으로 다음 UI 작업이며 spec 09의 어댑터 계약과 코드 예시를 따른다. 실제 두 대 PC·native Windows·서명 설치본은 미검증이다.

## 확정 정책과 구현

- 별명/승인 자체는 권한이 아니다. 기존 연결 user, 실제 활성 team member, person/device/pairing, office membership을 모두 재검사한다. 기본 정책은 existing-membership-only이며 승인 조직의 실제 vaults.organization_id만 허용한다. organizationId와 vaultId를 동일시하지 않고 신규 user/member/share를 만들지 않는다.
- 이메일 없는 직원은 account_required로 거절한다. 같은 허브의 실제 이메일 가입 API가 존재하고 번들 E2E도 그 API를 사용한다. office 화면의 pinned TLS 신규 가입/로그인 bootstrap UI는 아직 연결되지 않았으므로 native 합류 전에 해당 허브의 session-v2 계정 자격이 필요하다. 이메일 없는 user는 user.email NULL 허용의 Better Auth/초대/MCP/감사/알림 영향 검토가 필요한 후속 과제다. 가짜 이메일은 만들지 않는다.
- 60초 challenge를 Ed25519 기기 키로 서명해 10분 이하 office 세션을 얻는다. domain, challenge/device/server/generation/audience/TLS pin/nonce/expiry를 SHA-256 canonical transcript에 결합한다. challenge는 row lock으로 한 번 소비하고 잘못된 서명도 소비한다. 토큰과 nonce 원문은 DB에 저장하지 않는다.
- Rust는 origin별 office-session-v1을 별도 office-device keychain 서비스에 저장한다. session-v2 계정 자격은 덮어쓰지 않고 JS에는 기기 세션 토큰을 내보내지 않는다. native relay가 계정 cookie를 제거하고 실제 bearer를 주입한다. ApiClient의 office-native 값은 자격 없는 공개 sentinel이다. 파생 sync JWT만 기존 Yjs provider에 전달한다.
- officeSessionId가 있는 새 JWT만 추가 검사를 한다. 기존 JWT는 claim/검증/권한 경로가 그대로다. 기존 resolver/readable-set/HTTP/blob/search 판정을 사용한다. MCP/OAuth·public link·초대·멤버/권한·계정/결제·presigned blob intent는 기기 인증에서 명시 거절한다.
- 회수는 migration 070의 commit-only NOTIFY와 기존 PubSub seam을 사용해 해당 세션의 문서/vault 소켓을 닫는다. 서버당 전용 LISTEN DB 연결 1개를 사용한다. 기기/person/office membership/member 회수를 반영하고 listener 고장 시 office 인증은 fail closed다. 메시지당 DB 쿼리는 없고 HTTP/연결 때만 신선하게 재조회한다. TTL timer도 소켓을 닫는다.
- Hocuspocus는 connected hook보다 먼저 queued sync를 처리하므로 마지막 인증 DB 검사 전에 회수 구독을 만들고 공유 guard로 로딩 중 회수도 막는다. bridge/디스크/삭제·회수/seed 순서는 변경하지 않았다.

## 검증 결과

| 실행 | 실제 결과 |
|---|---|
| server `pnpm run build` | 통과 |
| 새 disposable cluster의 `vitest run office sync session vault-token vault-channel` 및 `vitest run tests/auth.test.ts` | 최종 queued-message guard 포함 23 files / 143 tests 통과; 별도 기존 auth 4 tests 통과 |
| `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake cargo check` | 최종 통과, 기존 semantic_hits dead_code 경고 |
| 같은 CMAKE의 `cargo test` | 최종 unit 367 passed / 11 ignored, integration 8+4 passed / data-volume 1 ignored; 실패 0 |
| desktop `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --maxWorkers=2` | 361 files / 3718 passed, 2 files / 12 tests skipped |
| desktop `pnpm exec tsc --noEmit` | 통과 |
| 실제 번들 `node scripts/e2e-office-join.mjs` | 1차 완료 28/28 PASS; 최종 scope hardening/queued guard가 포함된 새 번들에서 **30/30 PASS, exit 0** |
| `node scripts/demo-office-pairing.mjs` | 11/11 PASS, 독립 disposable cluster |
| `git diff --check` | 통과 |

서버 테스트 runner는 기존 demo runner를 /tmp로 복사해 테스트 필터만 넓혔다. 실행마다 번들 PostgreSQL로 새 SCRAM cluster와 무작위 포트를 만들고 001~070을 적용했으며 공유 DB/기존 .env는 사용하지 않았다. 모든 bundle root는 읽기 전용으로 사용했고 coordinator가 재생성했다. 이 worker는 prepare/verify/config 소유 파일을 편집하거나 커밋·푸시하지 않았다.

## 발견·수정한 결함과 실패 기록

1. 기존 sync-token 테스트의 TRUNCATE 교착을 수정 전 **4회 실행 모두** 재현했다. 직전 fire-and-forget last-seen UPDATE는 vaults lock을 보유하고 audit_log를 기다리고, resetDb는 audit_log lock을 보유하고 vaults를 기다렸다. pg_class OID 매핑과 Postgres deadlock detail로 확인했다. 진행 중 Promise를 추적하고 테스트 TRUNCATE 직전에 drain하는 수정 뒤 같은 독립 cluster 시험 **4회 연속 9/9 PASS**였다. 기존 assertion과 요청 지연/실패 처리 의미는 바꾸지 않았다.
2. 최초 cargo test는 PairingStatus의 신규 선택 필드가 기존 테스트 fixture에서 빠져 컴파일 실패했다. fixture를 수정한 뒤 전체 cargo test가 통과했다.
3. desktop 기본 병렬 전체 시험에서 미편집 CodeMirror 렌더링 시험이 간헐 실패했다. 첫 재실행은 전체 3717 PASS였고, 신규 연결 시험 추가 뒤 기본 병렬 실행에서 다른 렌더링 3개가 실패했다. 최종 maxWorkers=2 전체 실행은 **3718 PASS**였다. 제품 editor 코드는 변경하지 않았다.
4. 최초 E2E는 relay 요청 대기로 수동 종료했고, timeout을 넣은 재시도는 **15/16 PASS, exit 1**이었다. 원인은 JSON-lines Rust 테스트 드라이버의 current-thread runtime이 stdin 대기 때 relay task도 멈추는 것이었다. 테스트 드라이버를 multi-thread runtime으로 바꾼 다음 **28/28 PASS**였다. TLS/HTTP 제품 구현을 우회하지 않았다.
5. 최종 검토에서 과도한 HTTP prefix allowlist와 query/body 우선순위가 공개 링크 같은 중첩 경로 또는 다른 조직 body.vaultId를 통과시킬 수 있음을 발견했다. 수정 전 버전으로 회귀 시험을 실제 재실행했고 `POST /notes?vaultId=<승인 vault>` + `body.vaultId=<다른 조직 vault>`가 **201**을 반환해 기대 403 assertion이 실패했다. 전체 경로 allowlist, 중복 query를 포함한 모든 scope 일치 검사, item/blob 실제 vault 일치 검사와 위임/관리 경로 거절 시험을 추가했다. 수정 후 같은 부정 시험은 거절된다.

## 수정 core 파일의 추가 지점

| 파일 | 추가 지점/동작 |
|---|---|
| src/http/session.ts (추가 L8 / 21) | office_ bearer 전용 분기, officeSessionId, 기존 user/audit identity 반환 |
| src/http/app.ts (추가 L11 / 238) | officeHttp import와 guestHttp 앞의 middleware 등록 |
| src/http/routes/office-pairing.ts (추가 L8 / 103 / 110) | 세션 challenge/exchange, 승인 기기 회수 commit 뒤 PubSub, 쉬운 계정 안내 |
| src/http/routes/sync-token.ts (추가 L114) | 기존 resolver 뒤 JWT에 officeSessionId만 추가 |
| src/http/routes/vault-token.ts (추가 L36) | 기존 member gate 뒤 JWT에 officeSessionId만 추가 |
| src/tokens/sync-token.ts (추가 L12 / 36 / 62) | 선택 claim 발급/검증, 세션-user-vault binding 재검사; legacy 그대로 |
| src/tokens/vault-token.ts (추가 L15 / 28 / 45) | 동일 선택 claim/binding 검사; legacy 그대로 |
| src/sync/hocuspocus.ts (추가 L66 / 221 / 228 / 364) | 공유 officeGuard, 인증 마지막 단계 구독/재검사, connected close 연결, queued-message 차단과 disconnect 정리 |
| src/sync/vault-channel.ts (추가 L506 / 640 / 1553) | 세션 구독 후 재검사·TTL timer, cleanup 구독 해제; 기존 readable-set 그대로 |
| src/index.ts (추가 L96 / 441) | office revocation listener 시작/종료 |
| src/members/last-seen.ts (추가 L18 / 81 / 94) | pending Promise Set와 테스트 전용 drain export; fire-and-forget 유지 |
| tests/helpers/db.ts (추가 L3 / 64) | TRUNCATE 직전 last-seen drain await |
| src/office/http.ts (추가 L9 / 21) / sessions.ts (추가 L39 / 53 / 74 / 96) | 새 제한된 HTTP 경계, 서명 세션·audit·조회·회수 서비스 |
| migrations/070_office_device_sessions.sql | challenge/hashed session 테이블과 commit-only 회수 trigger |

이외 CLAUDE.md의 기존 office foundation 항목 한 문장, Rust office_device.rs/office_link.rs, TS ipc.ts/officeJoin.ts/officeLink.ts/officeClient.ts와 관련 시험, e2e script, specs 08·09, STATUS를 변경했다. 정확한 UI 호출 순서·시그니처·응답·실패 정리 책임은 spec 09 `어댑터 계약: 승인 세션에서 동기화 시작`의 코드 예시를 따른다.

## 남은 범위

전역 UI session/vault 선택과 SyncManager enable, 앱 재시작 뒤 허브 복원 및 세션 갱신 UI는 coordinator가 다음 UI 작업으로 분리했다. provider를 먼저 종료한 뒤 relay를 닫아야 하고 loopback capability를 설정에 영속 저장하면 안 된다. office 세션으로 presigned/multipart attachment 업로드를 위임하는 경로는 차단되어 있으며 후속 설계가 필요하다. 실제 두 대 PC, native Windows/WebView2, signed/notarized installer, macOS Intel, 실제 사내 방화벽/멀티캐스트/Local Network 권한은 미검증이다.


## 최종 번들 재검증

coordinator가 최종 서버 소스로 재생성한 읽기 전용 darwin-arm64 번들에서 `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake node scripts/e2e-office-join.mjs`를 실행해 **30/30 PASS, exit 0**를 확인했다. 승인 전/거절/회수 기기의 세션 차단, native keychain 세션과 bearer relay, 실제 HTTP 노트 등록, 두 Yjs 클라이언트의 같은 binary state 수렴, 다른 조직 vault 및 query/body 범위 혼동 차단, 공개 링크/MCP 자격 위임 거절, 단회 challenge 재생 거절, 살아 있던 문서 소켓 회수 종료를 포함한다. 종료 시 테스트용 keychain 항목·hub/PostgreSQL 프로세스·임시 데이터 디렉터리 정리가 모두 PASS였다.

마지막 서버 소스의 관련 시험은 23 files / 143 tests 및 별도 기존 auth 4 tests가 모두 통과했다. 마지막 Rust 시험은 unit 367 + integration 8+4 통과, desktop 전체는 maxWorkers=2에서 3718 통과, TypeScript와 server build 및 diff 검사가 통과했다. 앞선 실패·미검증·UI 후속 범위는 위 기록을 그대로 적용한다.
