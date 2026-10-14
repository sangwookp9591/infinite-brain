# FIX-V2 독립 리뷰 수정 결과

- 작업 위치: `/Users/iron/Project/psw/ib-wt/fixes-v2`, 브랜치 `feat/fixes-v2`.
- 시작 HEAD: `3637dbb` (integration에 galaxy 변경이 이미 포함됨). galaxy와 다른 worktree는 수정하지 않았다.
- 기준: 제공된 `V2-review.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, 사용자 지정 처리 순서.
- 구현은 실제 코드·SQL·원본 SVG를 변경했다. 주석이나 보고서만으로 완료 처리하지 않았다. push/배포/외부 메시지 전송 없음.

## 지적별 처리

| ID | 처리 | 변경 또는 보류 이유 |
| --- | --- | --- |
| H1 | 수정 | 서버 기본값·예제·오류 안내를 `infinitebrain`으로 변경. Railway 설명·배포 문서 정합성, 데스크톱 APP_SCHEME과 실제 import 기반 lockstep 테스트. rebrand의 nullish 기본값 패턴 보강. |
| M6 | 수정 | 057 CREATE TABLE/INDEX와 058 ADD COLUMN을 IF NOT EXISTS로 변경. 현재 스키마와 `_migrations` 이력을 구 056 파일명으로 바꾸고 현재 실행기를 통과시키는 회귀 테스트. 구 이름 행은 보존하고 새 이름을 추가하므로 이력 재작성은 불필요. |
| M1 | 수정 | API와 내부 mint 기본값은 read+write. 059로 SQL 기본값도 변경. 생략/명시 모두 회원 역할 검사; manage 승인은 owner/admin만. 호출 시에도 역할 강등 후 manage를 제거. |
| M2 | 수정 | 토큰/프로토콜은 알려진 scope만 허용. OAuth NULL 또는 비어 있지 않은 OIDC-only 문자열만 read/write/delete 레거시 호환. 빈 문자열·오타·알 수 없는 값은 권한 없음; 레거시에 manage 없음. 명시 manage도 현재 역할 검증. |
| M3 | 수정 | AI create 되돌리기에서 canDeleteItem을 재사용. 타인 생성 노트는 403 delete_not_creator이며 soft-delete되지 않음을 DB/API 검증. |
| M4 | 수정 | connection 필터에는 현재 actor_user_id를 함께 요구. 동일 OAuth client를 두 사용자가 공유하는 목록/일괄 undo 회귀 테스트. 필터 없는 vault 활동은 기존 ACL 기반 공유 조회 유지. |
| M10 | 수정 | main/staging bundle와 keychain SERVICE를 com.infinitebrain.desktop(.staging)으로 변경. dev 설정은 main identifier 상속. mapping과 keychain lockstep 테스트. |
| M9 | 수정 | 직접 그린 무한 궤도/별 SVG에서 Tauri 아이콘 생성. PNG favicon 새 이름, desktop light/dark SVG 워드마크, callback icon+Infinite Brain 텍스트, 서버 내장 자산 교체. 원 Baalda 이미지와 data URI 파일 제거(최종 검사에서 남은 미참조 glyph JPG도 제거). 원 자산 SHA-256 재유입 검증 및 재생성 문서. |
| M8 | 수정 | 단일 note 및 폴더 subtree rename의 같은 SQLite 트랜잭션에서 trigram path 변경. 내용 재색인 없이 새 한글 경로로 검색되고 옛 경로는 사라지며 doc_id가 보존됨을 검증. |
| M5 | 수정 | 기본 90일 원장 행 삭제, AI_CHANGES_RETENTION_DAYS 설정. startup/hourly 정리, 한 배치 5000행 및 회당 20배치. 볼트 평문 기본 64 MiB, AI_CHANGES_MAX_BYTES 설정; 초과 새 행은 본문 대신 해시/메타데이터. 볼트 xact advisory lock과 실제 동시 쓰기 회귀. 정책은 docs/AI-CHANGES.md. 역 diff 저장 및 연결 해제 본문 삭제 옵션은 요청된 최소 수정 범위를 넘어 보류. |
| M7 | 수정 | session pg_try_advisory_lock으로 backfill 인스턴스 단일화. note/blob 20행 keyset 배치와 event-loop yield. 버전만 오래된 note는 index의 title/content로 벡터만 계산; links/blob refs/Yjs 재생성 없음. 정확한 DB timestamp 문자열로 경쟁 갱신을 거부하고 일반 index upsert에도 read 시각 guard. 경쟁 인스턴스/실시간 vector 덮어쓰기 회귀. |
| L1 | 보류 | 토큰 교환/해제/재연결 사이의 generation 경계는 Better Auth 토큰 발급까지 걸친 변경이 필요. |
| L2 | 수정 | scope 검증 이후 binding을 consent API 전에 커밋. API 실패 시 해당 updated_at generation에 한해 이전 binding 복구/신규 binding 삭제; 더 최신 consent는 덮어쓰지 않음. 실패 주입 회귀. |
| L3 | 보류 | proxy 공개 URL/resource 정규화 정책과 allowlist 계약을 함께 결정해야 함. |
| L4 | 보류 | ACL metadata용 scope 분류는 기존 AI 연결의 도구 접근 계약 변경이므로 별도 결정. |
| L5 | 수정 | 동의 화면에 writing이 노트 본문 전체 교체·비우기를 포함한다는 문구 추가. |
| L6 | 수정 | write-only 요청 전용 선택을 제공하며 실제 발급 scope를 늘리지 않음. 지원되지 않는 note scope 조합은 설명된 400. WWW-Authenticate는 전체 지원 scope를 안내. |
| L7 | 수정(완화) | 되돌리기를 문서 ID 잠금과 분리된 프로세스 전용 promise queue로 DB 연결 획득 전에 직렬화. 임의 TEXT 문서 ID와 큐 잠금 이름의 충돌 회귀도 추가. 기본 풀보다 많은 33회 동시 undo를 검증. PG_POOL_MAX<2는 대기 대신 명시적 409. 트랜잭션 연결은 여전히 Yjs 작업 동안 유지되므로 idle-in-transaction 제거와 durable claim/lease는 보류; 단일 프로세스 undo 처리량은 직렬. |
| L8 | 보류 | 다중 서버 writer 전체의 문서 쓰기 잠금은 CRDT/Redis 운용 계약에 영향을 줌. |
| L9 | 보류 | live broadcast 후 DB 실패의 역연산/복구 설계는 공유 writer 변경이 필요. |
| L10 | 보류 | 검색 cosine 임계값 및 provider-version 계약은 품질 데이터와 검색 회귀 기준 필요. galaxy/검색 점수 정책 미변경. |
| L11 | 보류 | normalized search column은 새 schema/backfill과 검색 SQL 변경 필요. |
| L12 | 보류 | external-content FTS 전환, 1회 backfill, 짧은 질의 정책은 이번 rename 경로 수정과 독립. |
| L13 | 보류 | query token 일몰은 실제 client 호환성과 proxy 로그 정책 결정 필요. |
| L14 | 보류 | 초대 기본 접근 정책 UX와 만료 정책은 별도 제품 결정. |
| L15 | 보류 | 내부 배포/스토리지 식별자는 호환성을 위해 유지. 오래된 HTML dashboard SDK alias는 별도 호환 정책 필요. |
| L16 | 보류 | 저장소 밖 updater 개인키·CI 비밀값 회전 및 백업은 이 작업의 저장소 범위 밖. |

## 검증

검증 대상 DB는 `docker exec context-pg createdb -U context ib_fix`로 새로 만든 전용 DB이며 모든 서버 vitest에 `DATABASE_URL=postgres://context:context@localhost:5439/ib_fix`를 명시했다. billing migration suite의 임시 DB도 base 이름에 종속된 `context_test_ib_fix_mig`로 격리했다. 기본 context DB 및 3010/3020 서비스는 변경하지 않았다.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| node --test scripts/rebrand.test.mjs | 통과: 5 tests | /tmp/ib-fix-rebrand-test.log |
| node scripts/rebrand.mjs --dry-run | 통과: Would update 0 file(s) | /tmp/ib-fix-rebrand-dry-run.log, 원본 브랜드 이미지 해시 검사 포함 |
| server H1 + migration 회귀 | 통과: 2 files / 3 tests | 실제 전용 Postgres |
| server scope/ledger/access/delete 회귀 | 4 files, 53 passed/1 outdated assertion 후 access 3 tests 재검증 통과 | 더 앞선 scope gate의 오류 기대값 변경 |
| server ledger retention/quota | 통과: 19 tests | /tmp/ib-fix-ledger.log |
| server index backfill | 통과: 18 tests | /tmp/ib-fix-index-retest.log; 처음 PoolClient를 pool처럼 재연결한 구현 오류를 수정 후 통과 |
| 기존 server 호출 경로 회귀 | 통과: 7 files / 135 tests | /tmp/ib-fix-server-callers.log |
| 전체 server 실패 파일 단독 재검증 | 모두 통과: versions 18 / permissions 18 / mcp-files 13 tests | /tmp/ib-fix-{versions,permissions,mcp-files}-isolated.log, 소스·timeout 변경 없음 |
| 최종 undo queue 회귀 | 통과: 21 tests, 동시 33 undo 및 임의 TEXT doc_id 충돌 포함 | /tmp/ib-fix-ai-changes-isolated.log |
| 최종 server 관련 회귀 | 통과: 4 files / 57 tests | /tmp/ib-fix-final-focused.log (232.75s, 높은 머신 부하) |
| 전체 server vitest | 157 files / 1503 tests 통과, 3 files / 6 tests 초기화 TRUNCATE statement timeout, 1 file / 9 tests skipped | /tmp/ib-fix-server-full-final.log, 2503.59s; 실패 파일 단독 재실행으로 판정 |
| 전체 desktop vitest, NODE_OPTIONS=--no-experimental-webstorage, maxWorkers=2 | 313 files/3469 tests 통과, 7 files ENOSPC, graph 3 tests timeout | /tmp/ib-fix-desktop-full.log |
| 위 desktop 실패 8 files 단독, maxWorkers=1 | 통과: 8 files / 59 tests | /tmp/ib-fix-desktop-retest.log |
| 전체 desktop 재실행, maxWorkers=1 | 통과: 321 files / 3522 tests, 2 files / 12 tests skipped | /tmp/ib-fix-desktop-full-retest.log |
| cargo test | 통과: 346 passed, 4 ignored | /tmp/ib-fix-rust-full.log; provider/live-keychain 등 기존 opt-in ignored |
| cargo focused trigram rename | 통과: 1 test | /tmp/ib-fix-rust-focused.log |
| server tsc --noEmit | 통과(exit 0), 최종 수정 이후 및 전용 undo queue 변경 후 재실행도 통과 | /tmp/ib-fix-server-final-tsc.log, /tmp/ib-fix-server-queue-tsc.log |
| desktop tsc --noEmit | 통과(exit 0) | /tmp/ib-fix-desktop-tsc.log |
| git diff --check | 통과 | whitespace 오류 없음 |

처음 전체 desktop 검증 중 ENOSPC가 발생했다. 이후 Docker 소켓이 사라져 server DB 검증이 중단된 사실을 coordinator에 escalation했다. coordinator가 디스크를 확보하고 context-pg를 복구한 뒤 health 및 전용 DB를 확인하고 전체 server를 처음부터 재실행했다. 이 worktree에서 생성된 Cargo target만 cargo clean으로 정리했으며 다른 worktree/전역 캐시/서비스는 건드리지 않았다. 데스크톱 타이밍 실패는 소스 수정 없이 단독 재실행으로 판정했다. 전체 server의 6개 실패도 모두 테스트 beforeEach resetDb의 TRUNCATE가 15초 statement timeout에 걸린 것으로, 요청 handler나 내용/권한 assertion 실패가 아니었다. 전체 실행은 41분 43.59초가 걸렸고 테스트 DB에서 I/O 대기가 관찰됐다. 실패 파일은 각각 단독 실행한 결과 모두 통과하여 사용자 지정 기준으로 부하성 실패로 판정했다. 전체 실행의 exit 1 자체를 exit 0으로 표기하지 않는다. 마지막 큐 분리 변경도 최종 코드의 AI 원장 21개 테스트 및 tsc로 추가 검증했다. 복구 뒤 server 전체 첫 파일에서 기존 test helper의 explicit MCP_SCOPES import 누락을 발견해 보완했으며 전체를 다시 검증했다.

## UI 확인과 남은 운영 검증

Windows/macOS 합성 IPC/API simulator에서 환영 화면을 각각 1600×1000과 720×600으로 확인했다. wordmark의 정렬·문자 잘림·좁은 화면 가로 overflow 없음; Windows caption controls 및 dark wordmark도 확인했다. 합성 signed-out 상태로 welcome을 열었고 SVG/PNG는 네트워크 backend 없이 로드했다. 검증 후 이 worktree에서 시작한 1425 simulator만 종료했다. screenshot은 tracked 파일 밖에 있다:

- /tmp/ib-fix-brand-windows.png
- /tmp/ib-fix-brand-windows-narrow.png
- /tmp/ib-fix-brand-windows-narrow-dark.png
- /tmp/ib-fix-brand-macos.png
- /tmp/ib-fix-brand-macos-narrow.png

브라우저 검증은 native WebView2/WKWebView·installer·OS 딥링크 등록·실제 Google OAuth를 증명하지 않는다. 새 bundle/keychain identifier 때문에 이전 `.app` 개발 설치의 자격 증명/앱 데이터는 자동 이전하지 않으며 재로그인이 필요할 수 있다. 보존 상한은 새 평문 snapshot 저장에 적용되고 메타데이터 및 DB index 총 용량까지 제한하지 않는다; 서버 정지/정리 backlog 동안 만료 데이터가 잠시 남을 수 있다. 다중 인스턴스 writer, 장애 주입, provider와 운영 배포 검증은 수행하지 않았다.

## 커밋과 인계

구현 커밋은 `dbd93fb` → `c69ac09` → `090e240` → `f80cebb` → `3bbfa23` → `d6b4164` → `e7b44d4` → `26ead59` → `8a03e4f` → `8e863d2` → `a76e52b` → `c76084f` → `22f7853` 순서이며, 모두 사용자 지정 Claude-Session trailer를 포함한다. 이 보고서도 별도 커밋한다. 구현과 필수 검증은 완료했으며, 단독 재실행 판정과 명시된 opt-in/native 검증 보류는 위 표를 따른다. pnpm은 기존 frozen lockfile을 설치했으며 dependency manifest/lockfile 변경은 없다. Endor의 읽기 전용 package-risk 조회는 credentials 없음으로 UNKNOWN이고 보안 스캔 통과를 주장하지 않는다.
