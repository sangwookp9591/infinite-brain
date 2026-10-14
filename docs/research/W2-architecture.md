# W2 · Baalda 아키텍처 · 리소스 · 데이터 저장 분석

- 대상: Baalda 0.1.83 오픈소스 소스(`/Users/iron/Project/psw/baalda`) + 설치본 `/Applications/Baalda.app`
- 작성일: 2026-10-14 · 저장소/이용자 볼트 **무수정**(읽기 전용). 스키마 실측용 임시 DB는 세션 scratchpad에만 만들었다.
- 태그 규칙: **[확인]** = 파일:줄 / 실행 출력 근거, **[추정]** = 근거 + 신뢰도(상/중/하)
- 경로 표기: `app/` = `/Users/iron/Project/psw/baalda/app`, `D/` = `app/apps/desktop`, `S/` = `app/apps/server`

## 0. 먼저 알아둘 실측 결과 (중요)

| 항목 | 결과 | 태그 |
|---|---|---|
| 설치본 버전/식별자 | `CFBundleShortVersionString` = 0.1.83, `CFBundleIdentifier` = `com.baalda.context` | [확인](`defaults read /Applications/Baalda.app/Contents/Info …` 출력) |
| 설치본 크기 | `Baalda.app` 40 MB, 실행 파일 `Contents/MacOS/desktop` 하나(Mach-O arm64, 40,326,240 B). 프런트엔드는 이 바이너리에 내장(별도 서버 프로세스 없음) | [확인](`du -sh`, `ls -la`, `file` 출력) · 내장 여부는 [추정](상: `tauri.conf.json` `frontendDist` + Resources에 icon.icns만 존재) |
| **이 Mac에 실제 볼트가 있는가** | **없음.** `~/Documents/Baalda Vaults` 부재, `~/Documents`에는 `Codex`, `video`만 존재, 전체 디스크 `find / -name index.sqlite -path "*.context*"` 결과 0건 | [확인](`ls`, `find` 출력; 단 `find /`는 SIP/TCC 보호 영역은 못 봤을 수 있음 → 신뢰도 중상) |
| 이 Mac에 앱 데이터가 있는가 | `~/Library/Application Support`, `~/Library/Caches`, `~/Library/WebKit`, `~/Library/Containers`, `~/Library/Preferences`, `~/Library/Logs`에서 `baalda`/`com.baalda*` 항목 **0건** | [확인](`ls`, `find ~/Library -maxdepth 3 -iname "*baalda*"` → 무관한 `claude-cli-nodejs/...baalda` 캐시만 검출) |
| Keychain | `security find-generic-password -s com.baalda.context` → "item could not be found" | [확인](실행 출력) |
| 결론 | 설치본은 **한 번도 실행되지 않았거나 데이터가 정리된 상태**. 따라서 요청된 "실제 볼트 `.schema` 덤프"는 불가능. 대신 소스의 DDL(`index.rs:346-521`)을 그대로 추출해 scratchpad에 빈 DB로 적용한 뒤 `sqlite3 -readonly … .schema`로 덤프해 **DDL 유효성과 객체 목록을 실측**했다(§3.1). 내용(행) 덤프는 하지 않음 | [확인] |

> 따라서 §3의 `~/Library/...` 실제 경로는 "코드가 어디에 쓰는지"는 [확인], "이 Mac에 실제로 존재하는지"는 위 표대로 **부재 [확인]**, "macOS에서 Tauri 기본 경로가 정확히 어디인지"는 일부 [추정]으로 구분했다.

---

## 1. 사용 기술 스택 (버전은 매니페스트 선언 → 잠금 파일 해석값)

### 1.1 데스크톱 — Rust 코어 (`D/src-tauri/Cargo.toml`, `Cargo.lock`)

| 역할 | 크레이트 | 선언 | 잠금 해석값 | 근거 |
|---|---|---|---|---|
| 셸/IPC/윈도우 | `tauri` (features `protocol-asset`, `unstable`) | `2` | 2.11.5 | [확인](Cargo.toml `[dependencies]`, Cargo.lock) |
| 로컬 인덱스 | `rusqlite` (`bundled` = SQLite 내장 컴파일) | `0.32` | 0.32.1 | [확인] |
| 파일 감시 | `notify` | `8` | 8.2.0 | [확인] |
| OS 키체인 | `keyring` (apple-native / windows-native / sync-secret-service / crypto-rust) | `3` | 3.6.3 | [확인](Cargo.toml 주석: 백엔드 feature 미지정 시 mock 저장소로 폴백) |
| HTTP(첨부 전송) | `reqwest` (rustls-no-provider, stream), `rustls` 0.23 (ring) | `0.13` | 0.13.4 / 0.23.45 | [확인] |
| 비동기 I/O | `tokio` (fs, io-util, sync, process, time, rt) | `1` | 1.52.3 | [확인] |
| 자동 업데이트 | `tauri-plugin-updater` | `2` | 2.10.1 | [확인] |
| 기타 플러그인 | opener / dialog / fs / process / deep-link 2.4.9 / log / single-instance 2.4.3 | `2` 계열 | — | [확인] |
| 문서 텍스트 추출 | `zip` 2 (deflate만), `quick-xml` 0.37 | `2` / `0.37` | 2.4.2 / 0.37.5 | [확인] |
| 해시/식별자/정규식/OS휴지통/클립보드 | `sha2` 0.10, `uuid` v4, `regex`, `trash` 5, `arboard` 3 | — | trash 5.2.6, arboard 3.6.1 | [확인] |
| 설정 파서 | `serde_yaml` | `0.9` | **0.9.34+deprecated** | [확인](Cargo.lock) — 업스트림 아카이브된 크레이트(§5 D-10) |
| 릴리스 프로파일 | `opt-level=3`, `lto="thin"`, `codegen-units=1`, `strip=true`, **`panic=abort` 의도적 미사용** | — | — | [확인](Cargo.toml 말미 주석: 미처리 CRDT 업데이트 보호) |
| 에디션 | Rust 2021 | — | — | [확인] |

### 1.2 데스크톱 — 웹 UI (`D/package.json`, `app/pnpm-lock.yaml`)

| 역할 | 패키지 | 선언 | 해석값 | 근거 |
|---|---|---|---|---|
| UI | `react` / `react-dom` | `^19.1.0` | 19.2.7 | [확인] |
| 빌드 | `vite` | `^7.0.4` | 7.3.6 | [확인] |
| 언어 | `typescript` | `~5.8.3`(catalog) | 5.8.3 | [확인](pnpm-workspace.yaml catalog) |
| 테스트 | `vitest` | `^4.1.11`(catalog) | 4.1.11 | [확인] |
| 에디터 | `codemirror` 6, `@codemirror/view` / `state` | `^6.43.6` / `^6.7.1` | 6.43.6 / 6.7.1 | [확인] + 언어팩 13종(markdown, html, js, python, rust, sql, yaml …) |
| 마크다운 파서 | `@lezer/markdown` | `^1.7.1` | — | [확인] |
| CRDT | `yjs` / `y-protocols` / `y-codemirror.next` | `^13.6.31` / `^1.0.7` / `^0.3.5` | 13.6.31 / 1.0.7 / 0.3.5 | [확인] |
| 동기화 클라이언트 | `@hocuspocus/provider` | `^4.4.0`(catalog) | 4.4.0 | [확인] |
| 디스크↔CRDT 변환 | `diff-match-patch` | `^1.0.5` | 1.0.5 | [확인] |
| 상태 | `zustand` | `^5.0.14` | 5.0.14 | [확인] |
| 트리 | `react-arborist` | `^3.13.2` | 3.13.2 | [확인] |
| 다이어그램/그래프 | `mermaid` 11.17.2, `d3-force` 3.0.0(그래프는 자체 캔버스 시뮬레이션이라 d3-force 사용 위치는 별도 확인 필요) | — | — | [확인] 버전 / [추정](하) d3-force 실사용 범위 |
| 문서 변환 | `mammoth`(docx) 1.12.3, `read-excel-file` ^9.3.10, `marked` 16.4.2 | — | — | [확인] |
| 기타 | `motion` ^12.42.2, `@dicebear/*` ^9.4.3(아바타), `@fontsource/*` | — | — | [확인] |
| Tauri JS | `@tauri-apps/api` 2.11.1, plugin-updater/dialog/deep-link/log/opener/process | `^2` | 2.11.1 | [확인] |

### 1.3 서버 (`S/package.json`, `pnpm-lock.yaml`, `S/Dockerfile`, `S/docker-compose.yml`)

| 역할 | 구성요소 | 선언 | 해석값 | 근거 |
|---|---|---|---|---|
| 런타임 | Node (engines ≥22), 이미지 `node:22-alpine`, `NODE_OPTIONS=--max-old-space-size=512` | — | — | [확인](app/package.json engines; Dockerfile:19,44,59) |
| HTTP | `hono` + `@hono/node-server` | `^4.13.8` / `^2.0.10` | 4.13.8 / — | [확인] |
| 실시간 동기화 | `@hocuspocus/server` + `ws` | `^4.4.0` / `^8.21.0` | 4.4.0 | [확인] |
| 멀티 인스턴스(선택) | `@hocuspocus/extension-redis` + `ioredis` | `^4.4.0` / `^5.11.1` | ioredis 5.11.1 | [확인] |
| CRDT | `yjs` | `^13.6.31` | 13.6.31 (데스크톱과 catalog로 **동일 버전 강제**) | [확인](pnpm-workspace.yaml 주석) |
| 인증 | `better-auth` (bearer + organization 플러그인) | `^1.6.23` | 1.6.23 | [확인] |
| 비밀번호 해시 | `@node-rs/argon2` (argon2id) | `^2.0.2` | 2.0.2 | [확인] |
| 토큰 | `jose` (HS256 JWT) | `^6.2.3` | 6.2.3 | [확인] |
| DB | `pg` + `kysely` | `^8.22.0` / `^0.29.3` | 8.22.0 / 0.29.3 | [확인] · PostgreSQL **16** (`postgres:16-alpine`) |
| 객체 저장 | `@aws-sdk/client-s3` + `s3-request-presigner` | `^3.1134.0` | 3.1134.0 | [확인] (R2/MinIO 호환 엔드포인트 지원) |
| 결제 | `@polar-sh/sdk`, `standardwebhooks` | `^0.48.1` / `^1.0.0` | 0.48.1 | [확인] |
| 메일 | `nodemailer` ^10.0.13 (또는 Resend) | — | — | [확인] |
| AI | `@openrouter/sdk` (정확히 `1.3.10`) — 선택적 `housekeeper/index.mjs` 모듈 | — | — | [확인] |
| 파일 타입 판별 | `file-type` ^22.1.1 | — | — | [확인] |
| 캐시/펍서브(선택) | Redis 7 (`profiles: ["ha"]`) | — | — | [확인](docker-compose.yml) |
| 모노레포 | pnpm 10.34.5 + Turborepo ^2.10.5 | — | — | [확인](app/package.json) |
| CI/릴리스 | GitHub Actions 4개: `ci.yml`, `release.yml`, `staging-release.yml`, `notary-probe.yml` | — | — | [확인](`ls .github/workflows`) |

규모(비테스트 소스 라인): 데스크톱 TS/TSX **109,454줄**, Rust **23,139줄**, 서버 TS **41,879줄**, 테스트 파일 **478개** [확인](`cat | wc -l`, `find -name "*.test.*"` 실측).

---

## 2. 주요 모듈 지도

### 2.1 데스크톱 Rust (`D/src-tauri/src/`)

원칙: **Rust가 모든 디스크 I/O + 파생 SQLite 인덱스를 소유**, UI는 타입 있는 명령으로만 접근 [확인](CLAUDE.md "Division of labor"; `lib.rs:1-3`).

| 파일 (줄수) | 책임 1줄 |
|---|---|
| `lib.rs` (326) | 플러그인 등록, 로그(릴리스 시 회전 파일), `invoke_handler`, 창 크기/윈도우 보정 [확인] |
| `commands.rs` (3,999) | `#[tauri::command]` **80개**: 볼트 열기, 앱 `config.json`, 트리/노트 CRUD, 벌크 적용 등 UI 진입점 [확인](`grep -c`) |
| `state.rs` (47) | `AppState`: 단일 `Mutex<Inner{vault,index,watcher,vault_epoch}>` + 설정/OAuth/뷰 임대 별도 뮤텍스 [확인] |
| `index.rs` (5,127) | `<vault>/.context/index.sqlite` — 노트/FTS5/태그/링크/폴더/`yjs_*`/파일 인덱스, 마이그레이션(`CREATE IF NOT EXISTS`) [확인](`index.rs:279-525`) |
| `notefile.rs` (1,215) | 원자적 쓰기(temp+rename), `sha256_hex`, 파일 생성/이동/삭제 [확인](헤더) |
| `parse.rs` (547) | 프런트매터·제목·`#tag`·`[[wikilink]]` 파생 [확인] |
| `vault.rs` (492) | 경로 안전성(`resolve_in_vault`), 무시 규칙, `ALLOWED_EXTS`/`NOTE_EXTS` [확인](`vault.rs:27,47`) |
| `tree.rs` (337) | 사이드바용 중첩 트리 [확인] |
| `watcher.rs` (1,128) | `notify` 재귀 감시, 150 ms 디바운스(상한 1,000 ms), 배치 `files-changed` 이벤트 [확인](`watcher.rs:46,50`) |
| `note_file_identity.rs` (87) | inode/file-ID로 외부 rename 추적, 미지원 FS는 fail-closed [확인] |
| `attachments.rs` (1,109) | `attachments/` 바이너리 I/O + reqwest 스트리밍 전송 + sha256 캐시 [확인] |
| `extract.rs` / `extract_worker.rs` (709/442) | docx/xlsx/pptx 등 텍스트 추출 → `files_fts`, 볼트당 백그라운드 스레드 [확인] |
| `trash.rs` (355) | `.context/trash/<stamp>/<rel>` 로컬 복구본 [확인] |
| `keychain.rs` (213) | `keyring` 래퍼, 서비스명 `com.baalda.context` [확인](`keychain.rs:30`) |
| `oauth.rs` (392) | Google 로그인용 127.0.0.1 루프백 리스너 [확인] |
| `dashboard.rs` / `dashboard_query.rs` / `dashboard_remote.rs` | HTML 노트를 `baalda-view` 프로토콜+격리 iframe으로 렌더, 인덱스 읽기 API, 원격 Claude/ChatGPT 자식 웹뷰 [확인] |
| `agent_runner.rs` (1,777) | 설치된 CLI 에이전트(Codex/Claude) 실행 — 셸/자격증명 파일/로그 영속 금지 [확인](헤더) |
| `folder_safety.rs`, `import_export.rs`, `stats.rs`, `checks.rs`, `clipboard.rs`, `relaunch.rs`, `error.rs` | 볼트 폴더 금지 규칙, 가져오기/내보내기, 통계·무결성 점검(Vault Health), 메인스레드 클립보드, 업데이트 후 백그라운드 재실행, `AppError(String)` [확인] |

### 2.2 데스크톱 TS — bridge · sync (`D/src/lib/bridge`, `D/src/lib/sync`)

| 파일 (줄수) | 책임 1줄 |
|---|---|
| `bridge/noteBridge.ts` (1,414) | 노트당 `Y.Doc`+`Y.Text("content")`와 디스크 `.md`를 양방향 조정(ingest 150 ms / egest 300 ms, 에코 해시 가드) [확인](`bridge/types.ts:207-209`) |
| `bridge/diff.ts`, `localEdits.ts`, `readOnlyDocs.ts`, `adapter.ts` | diff-match-patch→`Y.Text` 연산 변환, 로컬 편집 추적, 읽기 전용 문서 목록, Tauri IPC/WebCrypto 주입 [확인] |
| `sync/docSession.ts` (**7,555**) | 문서 세션 코디네이터: 브리지+네트워크, 시작 순서, 외부 쓰기 라우팅, 디스크 삭제 전파 등 [확인] |
| `sync/syncManager.ts` (722) | 열린 노트당 `HocuspocusProvider`(doc 이름 `vault:<id>/note:<docId>`), 토큰 재발급 [확인] |
| `sync/vaultSyncEngine.ts` (1,130) / `vaultDocStore.ts` (748) / `vaultProtocol.ts` | 볼트당 WebSocket 1개(`/vault-sync`)의 상시 백그라운드 피드; hot/cold 티어링 저장 [확인](헤더) |
| `sync/registry.ts` (**5,842**) | 로컬 볼트↔서버 vault/folder/note 등록 대조, `.context/config.json` doc-id 맵 영속 [확인] |
| `sync/inbound.ts` (867) | 서버 구조 변경을 디스크에 반영하는 계획(`planInbound`) [확인] |
| `sync/contentUpload.ts`, `docBatchPush.ts`, `bootstrap.ts`, `seedRegister.ts` | 대량 업로드/다운로드(HTTP 배치·재개 커서), 상태 포함 일괄 등록 [확인] |
| `sync/attachments.ts` (2,890) | 바이너리 sha256 3-way 동기화(`planBinarySync`) [확인] |
| `sync/startup.ts`, `tokenRefresh.ts`, `vaultScope.ts`, `ackedSv.ts`, `closedAppEdits.ts`, `reconcileReport.ts` | split-brain 방지 결정, JWT 만료 60초 전 재발급, 볼트 전환 세대 토큰, 서버가 확인한 state vector, 앱 종료 중 편집 감지, 사용자 요약 배너 [확인] |

### 2.3 데스크톱 React (`D/src/`)

| 위치 | 책임 1줄 |
|---|---|
| `lib/ipc.ts` | 모든 Tauri `invoke`/이벤트의 단일 타입 표면(UI는 `@tauri-apps/api` 직접 접근 금지) [확인](헤더) |
| `lib/api.ts`, `lib/auth/` | 서버 HTTP 클라이언트·인증 [확인] |
| `store.ts` | Zustand — **UI 뷰 상태 미러만** [확인](CLAUDE.md) |
| `lib/editor/` | CM6 라이브 프리뷰, OFM 문법(`ofm/`), 노트 헤더(제목·속성 패널), 표/머메이드/위키링크 [확인](디렉터리 목록) |
| `lib/formats.ts` | "이 파일은 무엇인가"의 단일 권위(확장자→표시/열기/임베드/업로드) [확인](헤더) |
| `lib/frontmatter/`, `lib/graph/`, `lib/dashboard/`, `lib/health/`, `lib/presence/`, `lib/voice/`, `lib/vault/` | 속성 편집, 캔버스 그래프, HTML 대시보드 브리지, 무결성 UI, 프레전스, 음성, 볼트 수명주기 [확인](디렉터리 목록) |
| `lib/updater.ts` | Tauri updater + `pending` 재시도(2/4/8분, 60분) [확인](CLAUDE.md) |
| `components/` (146 항목) | 화면 컴포넌트(설정, 멤버/접근 보드, 사이드바 등) [확인](`ls | wc -l`) |

### 2.4 서버 (`S/src/`)

| 위치 | 책임 1줄 |
|---|---|
| `index.ts` | 프로세스 엔트리: HTTP(3010) + Hocuspocus WS(3011, 같은 인스턴스를 `/sync`로도 노출), 스케줄러 기동, 프로세스 가드 [확인](`index.ts` 헤더 주석) |
| `http/app.ts` + `http/routes/*` (28개) | Hono 앱·라우트: registry, shares, orgs, members, appearance, graph, sync-token, blobs, bulk, bootstrap, mcp, billing, public-links, trash, versions, housekeeper … [확인](`ls`) |
| `auth/` | Better Auth 설정, 로그인 스로틀(Postgres `signin_throttle`) [확인] |
| `sync/` | Hocuspocus(`hocuspocus.ts`), `vault-channel.ts`(vault-wide 복제 채널), `pubsub.ts`(메모리/Redis), `redis-extension.ts`, `doc-batch.ts`, `bulk-protocol.ts` [확인] |
| `yjs/persistence.ts`, `yjs/bootstrap.ts` | 바이너리 Yjs 업데이트 로그 + 스냅샷 압축, 부트스트랩 세션 [확인] |
| `permissions/` | `resolver.ts`(effectivePermission), `vault-docs.ts`(읽기 가능 집합), `http-gates.ts`, `access-management.ts`, `access-board.ts` [확인] |
| `registry/` | 트리 연산(`tree-ops.ts`), 상태 포함 등록(`seed-on-register.ts`), 이름 변경 가드, 노트 쿼터 [확인] |
| `blobs/` | 저장소 어댑터(`postgres-store`/`s3-store`/`memory-store`), 업로드 토큰/승인(admission), GC [확인] |
| `versions/`, `trash/` | 버전·일일 체크포인트·shrink-guard·복구, 30일 휴지통 [확인] |
| `mcp/` | JSON-RPC 2.0 MCP(`POST /api/mcp`), `createDocWriter`(AI 편집을 CRDT로 반영) [확인] |
| `billing/` | Polar 연동, `plan.ts` 단일 플랜 해석기, 락/연체(lapse) [확인] |
| `index/` | `embedder.ts`(256차원 해시 BoW, 오프라인 동작), `indexer.ts`(검색+위키링크 그래프) [확인](`embedder.ts:4,14`) |
| `db/migrate.ts`, `migrations/` | 평문 SQL 마이그레이션 52개 파일, `_migrations` 추적 [확인](`ls | wc -l`) |
| `render/note-html.ts`, `appearance/`, `invitations/`, `members/`, `metrics/`, `email/`, `tokens/` | 공개 링크 렌더, 공유 외관, 초대, last-seen, 인프로세스 카운터, 메일, JWT [확인] |

---

## 3. 데이터 저장 지도

### 3.1 데스크톱 로컬

#### (a) 볼트 폴더 — 진짜 원본 (`<vault>/`)
- 노트 `.md` 등 평문 파일 = **내구성 있는 단일 진실 원천** [확인](CLAUDE.md "one idea"). 기본 볼트 루트: `~/Documents/Baalda Vaults/<볼트명>` [확인](`commands.rs:1006-1014`). 이 Mac에는 해당 폴더가 **없음** [확인].
- `attachments/`(볼트 루트): 임베드 이미지/바이너리. 트리에서 숨김, 파일 인덱스 대상 아님(`INDEX_ATTACHMENTS=false`) [확인](`vault.rs:111`).

#### (b) `<vault>/.context/` — "신성하고 숨겨진" 앱 상태 (동기화/인덱싱/워크 대상 아님)
| 파일 | 내용 | 태그 |
|---|---|---|
| `index.sqlite` (+ `-wal`, `-shm`) | 파생 인덱스 + **CRDT 로컬 영속**. 설정: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL` | [확인](`index.rs:294-307`) |
| `config.json` | 서버 vault 매핑·doc-id 맵. 키(소스 `configSnapshot`): `organizationId, serverVaultId, docs{relPath→docId}, folders, files, filesConfirmed, fileBases, revokedFolders, pushed[], ackedSv, unhydratedPlaceholders, baseline, authored, bootstrap`. 컴팩트 JSON, 체크포인트 때마다 전체 재작성(원자적), "볼트와 함께 이동" | [확인](`registry.ts:2196-2230, 3380-3398`; `commands.rs:1440-1466`) |
| `types.json` | 볼트별 속성 타입(프런트매터) | [확인](`.context/types.json` 7회 참조, grep) |
| `trash/<stamp>/<rel>` | 동기화가 로컬 텍스트를 밀어낼 때 남기는 복구본 | [확인](`trash.rs` 헤더) |
| (임시) `.write-test` | 앱 설정 폴더 쓰기 검증용 프로브 — 이건 볼트가 아니라 앱 설정 폴더 쪽 | [확인](`commands.rs:225-231`) |

#### (c) `index.sqlite` 스키마 (소스 DDL 추출 → 빈 DB 적용 → `sqlite3 -readonly … .schema`)
실측 환경: sqlite3 3.54.0. 결과: **일반 테이블 13개 + FTS5 가상 테이블 2개**(FTS 섀도 테이블 10개 포함 `sqlite_master` 테이블 객체 총 25개) + 인덱스. 실제 볼트가 없어 **빈 픽스처에 DDL을 적용한 결과**임을 명시 [확인].

```
-- 파일에서 파생(rebuild()가 재구성; id는 보존)
notes(id PK=doc_id, path UNIQUE NOT NULL, title, mtime, sha256, frontmatter)
note_file_identity(doc_id PK, path NOT NULL, file_id NOT NULL)  + idx(file_id)   -- 외부 rename 추적
notes_fts  = fts5(title, body, tokenize='unicode61 remove_diacritics 2')          -- 자체 포함형(snippet 때문)
tags(id PK, name UNIQUE)   note_tags(note_id, tag_id, PK(note_id,tag_id))
links(id PK, src_note_id NOT NULL, dst_note_id, dst_path_raw, link_text, position)
folders(id PK, parent_id, name, path)
files(id PK, path UNIQUE, ext, kind, size, mtime, sha256, text_sha, text_status, indexed_at)  -- 비노트 파일(2계층)
files_fts  = fts5(name, body, tokenize=…)
file_text(sha256 PK, chars, body, created_at)                                       -- 추출 텍스트(콘텐츠 키)
attachment_hashes(path PK, size, mtime_ns, sha256)                                  -- attachments/ 해시 캐시
-- rebuild()가 건드리지 않는 영속 테이블
yjs_updates(id PK, doc_id, "update" BLOB, created_at) + idx(doc_id)                 -- 추가 전용 로그
yjs_snapshot(doc_id PK, snapshot BLOB, state_vector BLOB, seq)
yjs_disk_base(doc_id PK, sha256 NOT NULL, updated_at)                               -- 마지막으로 디스크에 쓴/읽은 바이트 해시(#200)
note_ui_state(doc_id PK, state TEXT(JSON), updated_at)                              -- 접힘 상태 등 UI
```
근거: `index.rs:346-521`; 덤프 109줄 [확인](`sqlite3 -readonly fixture.sqlite ".schema"`, `sqlite_master` 조회). CRDT 압축: 노트당 업데이트 64행에서 스냅샷 [확인](`bridge/types.ts:209 compactThreshold: 64`). 별도 `ALTER TABLE` 마이그레이션은 **없음**(`CREATE IF NOT EXISTS`만, `index.rs` grep) [확인] → 스키마 버전 필드 없음(§5 D-9).

#### (d) 앱 전역 위치 — `~/Library/…` (macOS)
| 구분 | 경로 | 내용 | 코드 확인 | 이 Mac 실재 |
|---|---|---|---|---|
| 앱 설정 | `~/Library/Application Support/com.baalda.context/config.json` | 최근 볼트(`recent_vaults`), `server_url`, `vaults_root`(+ legacy `last_vault`, `workspace_root` alias). 볼트가 열리기 **전**에 읽혀야 하므로 볼트 `.context`와 분리 | 코드는 `app_config_dir()`(실패 시 `app_local_data_dir()` 폴백)에 쓴다 [확인](`commands.rs:163-231`, `AppConfig` `:92-109`). macOS에서 그 값이 위 경로인 것은 **[추정](상: 코드 주석이 "`~/Library/Application Support/<bundle id>` on macOS"로 local-data 쪽을 명시, Tauri v2 규약)** | **없음** [확인] |
| 로그 | `~/Library/Logs/com.baalda.context/baalda.log` | 릴리스 빌드만, 파일당 2 MB, `KeepOne` 회전(≈4 MB 상한) | [확인](`lib.rs:112, 124-135`) | **없음** [확인] |
| WebView 저장소 | `~/Library/WebKit/com.baalda.context/…`(localStorage 등) | UI 선호(예: 상태·자동 색상·`context.memberAccess.view`), 원격 경로 | 코드가 `localStorage`를 사용 [확인](`lib/prefs.ts`, CLAUDE.md). 정확한 디렉터리는 **[추정](중: WKWebView 규약)** | 없음 [확인] |
| 캐시 | `~/Library/Caches/com.baalda.context/…` | WKWebView 네트워크 캐시 | **[추정](중)** — 코드에 명시적 캐시 쓰기 없음 | 없음 [확인] |
| Preferences | `~/Library/Preferences/com.baalda.context.plist` | 앱이 `NSUserDefaults`를 직접 쓰는 코드는 발견하지 못함 → 생성되지 않을 가능성 | **[추정](중)** | 없음 [확인](`defaults domains`에 baalda 없음) |
| Keychain | 서비스 `com.baalda.context`, 계정 = 호출자 지정 `service_key`(예: `session:<serverUrl>`) | 세션 토큰, (옵트인) 기억된 비밀번호(서버 URL+이메일 바인딩), 개인 AI 키 | [확인](`keychain.rs:5-6,30`; CLAUDE.md `rememberedPassword.ts`) | 항목 없음 [확인](`security …` 출력) |
| 딥링크 스킴 | 프로덕션 `baalda://`, 스테이징 `baalda-staging://` (id `com.baalda.context.staging`), 개발 `baalda-dev://` | — | [확인](`tauri.conf.json`, `tauri.staging.conf.json`, `tauri.dev.conf.json`) | — |

### 3.2 서버

#### (a) PostgreSQL 테이블 그룹 (`S/migrations/*.sql`, 52개 파일)
| 그룹 | 테이블 | 마이그레이션 | 태그 |
|---|---|---|---|
| 인증(Better Auth, camelCase 인용) | `user, session, account, verification, organization, member, invitation` | 001 | [확인] |
| 사용자/조직 확장 | `org_join_codes, invitation_access, invitation_notices, organization_access_settings, member_access_snapshots, account_entitlements, signin_throttle` | 005,046,045,032,031,036 | [확인] |
| **문서(바이너리 Yjs)** | `doc_updates`(BIGSERIAL, `doc_id, seq, update BYTEA`), `doc_snapshots`, `doc_state_vectors`, `bootstrap_sessions`, `bootstrap_session_docs` | 002,025,030 | [확인](`002_app_tables.sql:12-28`) |
| 레지스트리 | `vaults`(org 1:1), `folders`, `notes`(id==doc_id, 소프트 삭제 `deleted_at`), `files`, `folder_tombstones`, `file_tombstones` | 002,019,029 | [확인] |
| 권한/공유 | `shares`(폴더·파일·vault 리소스, per-user/org), `public_links`, `mcp_tokens`, OAuth 3종(`oauthApplication/AccessToken/Consent`)+`mcp_oauth_workspace`(013에서 `..._vault`로 개명) | 002,004,008,020,006,007 | [확인] |
| **파생 텍스트·검색(평문 포함)** | `note_index`(`content TEXT`, `vector JSONB`), `note_links`, `note_texts`(`content TEXT`, 콘텐츠 주소), `note_versions`(`content TEXT`) | 005,038,016 | [확인](`005…:17-24`, `038…:`, `016…:9-20`) |
| 체크포인트/복구 | `vault_checkpoints, vault_checkpoint_docs, vault_checkpoint_blobs, checkpoint_blob_bytes, shrink_brake_events` | 016,047,042 | [확인] |
| 바이너리 메타 | `blobs`(+`storage_provider` `postgres|s3`, `storage_key`, `status`, `pending_register`), `blob_refs`, `blob_deletions`, `blob_text`(추출 텍스트+벡터) | 002,026,027,028,048 | [확인](`026_blob_storage.sql`) |
| 과금 | `subscriptions, billing_events, billing_accounts, billing_account_orgs` (+ tombstone/discount 컬럼) | 010,024,051-055 | [확인] |
| 외관/기타 | `vault_appearance`(vault당 1행 JSON) | 053 | [확인] |
- 모든 id는 `TEXT`(UUID 아님; Better Auth 호환 + 리소스 다형 참조) [확인](`002…` 헤더 주석).
- 미기재 번호: 037, 040, 044가 파일 목록에서 빠져 있음(번호 비연속) [확인](`ls migrations`; 사유는 [추정](하)).

#### (b) Blob 저장소 — Postgres 또는 S3(R2/MinIO) (`S/src/blobs/*`)
- 선택은 **행 단위 `storage_provider`**: 업로드 시 기록되고 설정 변경으로 재작성되지 않음 → 다시 `postgres`로 바꿔도 S3 시대 blob 읽기 가능 [확인](`026_blob_storage.sql` 주석).
- Postgres 모드: 바이트가 `blobs.data BYTEA`. node-postgres에 바이너리 파라미터가 없어 업로드 1건이 힙에서 **≈3.7×N**. 그래서 `MAX_BLOB_BYTES` 기본 **25 MB**, 동시 업로드 바이트 예산 50 MB [확인](`blobs/config.ts` 주석·상수).
- S3 모드: presigned PUT/GET, 직접 업로드 상한 **500 MB**, 멀티파트, 체크섬 모드 `auto|sha256|md5|none`(R2는 md5), `proxyDownloads`, `S3_KEY_PREFIX` [확인](`blobs/config.ts`).
- 수명주기: pending TTL 60분, 고아 GC는 **기본 OFF**(`BLOB_GC_ENABLED`), 30일, 실행당 최대 200개 삭제 [확인](`blobs/config.ts`).
- 체크포인트 핀: `vault_checkpoint_blobs`(sha 참조, 바이트 복제 없음), Postgres 저장소 핀은 체크포인트당 **2 GiB** 상한 [확인](CLAUDE.md "Checkpoints").

#### (c) 기타 서버 영속/상태
- Redis(선택): 펍서브 + Hocuspocus 확장. 미설정 시 인메모리 단일 인스턴스 [확인](`config.ts:101`, `sync/hocuspocus.ts:169-171`, `docker-compose.yml`).
- 인프로세스(재시작 시 소멸): sync 메트릭 카운터, 미리보기 토큰(제한된 프로세스 메모리) [확인](CLAUDE.md `metrics/`, Assistant 절).
- 연결 풀: `max: poolMax()`, 유휴 30 s, 연결 타임아웃 5 s [확인](`db/pool.ts:32-38`).
- 업데이트 압축: `COMPACTION_THRESHOLD` 기본 50 [확인](`config.ts:84`). 보존: 체크포인트 5개 / 노트당 버전 50개 [확인](`038_note_texts.sql` 주석). 휴지통 30일 [확인](CLAUDE.md).

---

## 4. 데이터 흐름도

### 4.1 타이핑 → 서버 → 다른 클라이언트

```
[키 입력, CodeMirror 6]                                          (ORIGIN_EDITOR)
      │ y-codemirror.next (yCollab) — 버퍼가 곧 마크다운
      ▼
 Y.Text("content")  ◀── Y.Doc (노트당 1개, noteBridge.ts)
      │ doc.on("update")
      ├──▶ ① 로컬 영속: IPC → Rust → index.sqlite.yjs_updates 추가
      │        └ 64행 초과 시 yjs_snapshot으로 압축(`compactThreshold: 64`)
      │
      ├──▶ ② EGEST (CRDT→디스크), 300 ms 디바운스 [bridge/types.ts:208]
      │        a. lastWrittenHash = sha256(직렬화 텍스트)  ← 쓰기 "전에" 계산
      │        b. IPC write_note → notefile.rs: temp 파일 + rename (원자적)
      │        c. yjs_disk_base 갱신(마지막으로 디스크에 쓴 해시)
      │        d. Rust가 쓰기 시점에 index.sqlite 재색인: notes/notes_fts/tags/links
      │
      └──▶ ③ 네트워크: HocuspocusProvider(`vault:<vaultId>/note:<docId>`)
               │ WS  ws(s)://<server>/sync  (토큰=POST /api/sync-token, 만료 60초 전 재발급)
               ▼
        [서버 Hocuspocus]  onAuthenticate: 문서별 JWT + effectivePermission(읽기전용 설정)
               │ onChange: 바이너리 업데이트를 doc_updates에 append, 재색인 예약
               │   (shrink-guard / 버전 캡처 / 체크포인트 훅)
               ├──▶ Postgres: doc_updates · doc_snapshots · (파생) note_index/note_links/note_versions
               └──▶ 열린 다른 클라이언트에 릴레이 ──▶ 상대 Y.Doc ▶ 상대 egest ▶ 상대 디스크·인덱스
                  (+ vault 채널 /vault-sync 로 닫힌 문서도 백그라운드 복제, 서버는 stateless relay)
```

### 4.2 외부 편집(AI/에디터/스크립트) → CRDT (역방향)

```
[외부 프로세스가 .md 수정]
      │ notify(8) → watcher.rs  150 ms 디바운스(상한 1,000 ms)
      ▼  ONE 배치 `files-changed {changes:[{path,kind}]}`  (kind=modified|removed|tree, 존재 검사로 도출)
 Rust 재색인(같은 트랜잭션) ─▶ UI(`ipc.ts` 이벤트)
      │
      ├─ 열린 노트: NoteBridge INGEST (150 ms 디바운스)
      │     · 파일 해시 == lastWrittenHash → 자기 에코, 폐기
      │     · 다르면 diff-match-patch(현재 직렬화 vs 파일) → Y.Text insert/delete 연산 (ORIGIN_DISK)
      │     · diff 비율 > 0.6 (AI 전체 재작성) → 복구 스냅샷 먼저
      │     · onTextChange가 disk-origin은 무시 → 되쓰기 루프 차단
      └─ 닫힌 노트: docSession.handleLocalFileChanged → ContentUploader(force+ingestFromFile)
            → 서버 푸시 큐 (앱 종료 중 편집은 시작 시 index.sha256 vs diskBase 비교, `list_disk_drift`)
```
근거: [확인](CLAUDE.md "Ingest/Egest"; `bridge/types.ts:207-209`; `watcher.rs:46,50`; `bridge/noteBridge.ts` lastWrittenHash 다수 줄). "MCP/AI 서버측 편집" 경로는 `mcp/doc-writer.ts`의 `createDocWriter`가 같은 Hocuspocus 경로로 CRDT를 직접 수정해 사람 편집과 동일하게 전파 [확인](CLAUDE.md MCP 절, `index.ts:186`).

### 4.3 오프라인 → 재접속 (순서 규칙)
`startup.ts decideSeed`: **서버를 먼저 pull, 문서가 여전히 비어 있을 때만 로컬 고아 파일을 seed** — 순서를 뒤집으면 영구 분기 [확인](CLAUDE.md, `sync/startup.ts` 헤더). 대량 경로: `notes/batch`에 `state`(base64 Yjs) 동봉 일괄 등록, 다운로드는 `bootstrap` 페이지 + 재개 커서 [확인](`docBatchPush.ts`, `bootstrap.ts` 헤더).

### 4.4 첨부 파일
`attachments/` 및 트리 바이너리 → Rust `reqwest` 스트리밍 → 서버 `POST /vaults/:id/blobs/intent` → (S3 presigned PUT | Postgres BYTEA) → `complete`. 바이트는 **웹뷰 JS 힙을 거치지 않음**, Yjs에도 안 들어감 [확인](`Cargo.toml` reqwest 주석, CLAUDE.md "bytes remain in the configured blob store").

---

## 5. 아키텍처 관점 단점 후보

심각도는 **내 판단**이며 [추정]으로 취급(근거는 [확인] 가능한 사실). 

### 높음
**D-1. 핵심 동기화 로직의 거대 파일 집중 (유지보수/온보딩 비용)**
- `docSession.ts` 7,555줄, `registry.ts` 5,842줄, `attachments.ts` 2,890줄, Rust `index.rs` 5,127줄, `commands.rs` 3,999줄(명령 80개) [확인](`wc -l`).
- 한 파일에 시작 순서·삭제 전파·충돌·권한 회수 규칙이 얽혀 있고, 규칙 수가 많음(삭제 유예 2.5 s, 상한 `max(5, ceil(mapped*0.2))`, 회수 7조건, `revokeCap = max(20, ceil(mapped*0.5))` 등). [확인](CLAUDE.md "Desktop — sync")
- 영향: 신규 기여자 진입 어려움, 회귀 위험. 테스트 478개가 방어선이나 [확인], "크라운 주얼"이라 부르는 브리지 4개 스위트가 제품 정합성 전체를 지탱 [확인](CLAUDE.md Test).

**D-2. 문서(CLAUDE.md)가 곧 설계 명세가 된 상태 — 진입장벽**
- 저장소 루트 `CLAUDE.md` 991줄에 구현 세부(상수, 이슈 번호, 날짜별 결정)가 누적 [확인](`wc -l`). 별도 `docs/specs` 7개 + `STATUS.md`(합계 1,979줄)와 이중 관리 [확인].
- 여러 곳에 "한 곳을 바꾸면 다른 곳도"라는 **수동 락스텝 계약**: `ALLOWED_EXTS`↔`formats.ts`↔`sync/registry.ts`/`inbound.ts`(테스트로 방어 `formatsLockstep.test.ts`), 해시태그 정규식 TS↔Rust `TAG_RE`, 권한 `resolver.ts`↔`accessMode.ts`↔`vault-docs.ts`↔`http-gates.ts` [확인](CLAUDE.md). 불일치는 "보이지만 검색 불가 태그", 권한 오판으로 직결.

**D-3. 동일 진실을 여러 곳에 저장 (정합성 복잡도)**
- 노트 위치가 `rel_path` + `folder_id`로 **이중 저장**, 서버가 매 요청 검증(`path_folder_mismatch`)하며 과거 drift로 마이그레이션 022 필요 [확인](CLAUDE.md "rel_path and folder_id must agree").
- 노트 본문 상태가 디스크 `.md`, 로컬 `yjs_*`, 로컬 `notes_fts`, 서버 `doc_updates`, 서버 `note_index`/`note_texts`/`note_versions`에 분산 [확인](§3). 어디가 어긋났는지 판별용 보조 장치(`yjs_disk_base`, `ackedSv`, `diskBase`, `pushed`, `baseline`)가 별도로 필요 [확인].
- "서버는 바이너리 Y.Doc만 저장" 불변식(CLAUDE.md)은 **전송 관점**이고, 서버 DB엔 `note_index.content`, `note_texts.content`, `note_versions.content` **평문**이 존재 [확인](`005…:17-24`, `038…`, `016…:15`). 문서 표현과 실제 저장이 달라 혼동 여지.

### 중간
**D-4. 서버는 사실상 단일 프로세스·단일 DB 설계 (확장성)**
- 기본은 인메모리 pubsub, 다중 인스턴스는 Redis 선택 사항 [확인](`config.ts:101`, spec 05 §5). 관리형 운영 형상은 이 공개 repo 밖이라 **실제 인스턴스 수는 알 수 없음** [추정](하).
- 컨테이너 1 GiB / V8 힙 512 MB 가정으로 한도 설계(blob 25 MB, 동시 50 MB) [확인](`Dockerfile:59`, `blobs/config.ts`). Postgres blob 모드는 힙 3.7배 증폭 → S3 필수화 압력 [확인].
- Hocuspocus는 열린 문서를 메모리에 상주(스펙은 "편집 중인 문서 수로 RAM 한정"이라 설계) [확인](spec 05:49). 대규모 동시 편집 시 Node 단일 스레드 한계는 STATUS가 스스로 "Node scale limits 시 y-sweet 재검토"로 인정 [확인](`STATUS.md:263`).
- `doc_updates`는 단일 테이블 append 로그, 압축 임계 50 [확인]. 장기 보관 CRDT 크기 비용은 "Loro 재평가"로 이월 [확인](`STATUS.md:268`).

**D-5. 클라이언트 SQLite 인덱스가 CRDT 이력까지 보관 → 비대화 사고 실적**
- 실제 사고 기록: `index.sqlite` **1.27 GB**(68 MB 노트 1개가 위키링크 86,370개·`links` 2,025,307행·FTS 503 MB 유발) / 한 볼트가 죽은 문서 953개로 **900 MB** [확인](`index.rs` 주석 `:1476-1487`, `:2678-2682`). 가드(`MAX_INDEX_BYTES`, `prune_yjs_docs`)가 사후에 추가됨 [확인].
- 인덱스 한 뮤텍스가 UI도 막음("every index pass … holding the index mutex, which is the lock the UI waits on") [확인](`index.rs` 같은 주석). `AppState`도 단일 `Mutex<Inner>` [확인](`state.rs`).
- 감시 폭주 이력: 유휴 볼트에서 **~32 MB/s**를 index.sqlite에 쓴 사례(#155) [확인](`index.rs:1441-1443` 주석).
- `config.json`은 노트당 3엔트리 맵을 **통째로 재작성**, 5,000노트에 ~500 KB [확인](`registry.ts` writeConfig 주석). 규모 천장 후보 [추정](중).

**D-6. 용어/개념 혼선**
- "vault"가 사용자 관점에서는 Better Auth `organization`, 저장소에서는 Postgres `vaults` 행(1:1)으로 이중 대응; 컬럼은 `organizationId`·`vault_id`·`org_id` 혼재, "workspace" 잔재 별칭 [확인](CLAUDE.md "Terminology"; `013_vault_rename.sql`).
- 코드네임 `Context` vs 브랜드 `Baalda`: crate/lib 이름 `desktop_lib`, 식별자 `com.baalda.context`, `.context/` 폴더 [확인](Cargo.toml, tauri.conf.json).

**D-7. 레거시 호환 부채가 활성 코드에 상주**
- `ContentUploader`는 구버전 서버용 fallback이며 "MIN_CLIENT_VERSION가 올라가면 삭제" 예정 [확인](CLAUDE.md). 과금 `vault|team` 이중 모델, 구 402 코드 유지(`upgrade_in_new_app` 등) [확인]. 기능 플래그(`/health.features`)로 신/구 서버 분기하는 경로가 다수 [확인].
- 관리형 서버의 느린 배포와 클라이언트 자동 업데이트의 시차를 `pending` 상태·재시도로 흡수하는 복잡도(2/4/8분, 60분) [확인](CLAUDE.md).

### 낮음~중간
**D-8. 보안 표면이 넓은 편 (설계상 의도이나 단점 후보)**
- WebView CSP: `connect-src … https: wss: http://localhost:* …`, `img-src … https:`, `frame-src … https:` — 외부 HTTPS 전면 허용(자체 호스팅 서버 URL을 사용자 지정하기 위함 추정) [확인](`tauri.conf.json:28`) / 이유는 [추정](중).
- 자식 웹뷰(`unstable` Tauri multi-webview), CLI 에이전트 실행(`agent_runner`), HTML 대시보드 격리 등 고위험 기능이 앱 코어에 상주 [확인](Cargo.toml `unstable`; `agent_runner.rs`, `dashboard*.rs`). 완화책(권한 프로파일, 격리 iframe, 경로 거부)이 있으나 감사 대상이 늘어남 [확인].
- 서버측 저장 평문 + **at-rest 암호화 미구현**(Phase 4 이월) [확인](`STATUS.md:255`, CLAUDE.md 925행). 서버 운영자(관리형) 신뢰가 전제 [추정](상).
- 서버 검색 임베딩은 256차원 해시 BoW(의미 검색 약함, `OPENAI_API_KEY` 교체는 "미연결") [확인](`embedder.ts:4,14`; CLAUDE.md `index/`). 검색 품질 한계는 W-검색 담당과 교차 확인 필요.

**D-9. 로컬 스키마 버전 관리 부재**
- `index.rs migrate()`는 `CREATE IF NOT EXISTS`만 사용, `user_version`/ALTER 마이그레이션 없음 [확인](`grep ALTER|user_version` → `index.rs`에는 `DROP TABLE _live_docs`만). 컬럼 추가 시 구 볼트 호환 전략이 코드 주석 수준("기존 볼트는 행이 없을 뿐") [확인](`index.rs:430-434`). 향후 컬럼 변경은 rebuild에 의존 [추정](중).

**D-10. 의존성/빌드 이슈**
- `serde_yaml 0.9.34+deprecated`(아카이브) 사용 [확인](Cargo.lock) — 프런트매터 파싱의 장기 유지 리스크.
- Tauri `unstable` 기능(멀티 웹뷰) 의존으로 마이너 업데이트 시 파손 가능 [확인](Cargo.toml) / 영향도는 [추정](중).
- 4개 플랫폼 빌드를 직렬 4잡으로 게시하여 `latest.json`이 단계적으로 갱신됨(업데이터 pending 처리 필요) [확인](CLAUDE.md). 서명은 macOS만(Linux/Windows 미서명) [확인].
- 번들 프런트 의존성(mermaid, dicebear collection, mammoth, read-excel-file 등)이 크다 — 설치본은 40 MB로 양호하나 [확인], JS 번들 분할 상태는 이번에 빌드하지 않아 **미측정**.

### 강점(비교용, 후보 단점의 반례)
- Rust가 디스크/인덱스/키체인을 독점, UI는 IPC 단일 표면(`ipc.ts`) — 경계가 명확 [확인].
- yjs/hocuspocus 버전을 pnpm catalog로 **양쪽 강제 동일** [확인].
- 원자적 쓰기, epoch 핀(`vault_epoch`)으로 볼트 전환 레이스 차단, 대량 삭제 상한, 복구 휴지통 등 데이터 손실 방어가 촘촘 [확인](`state.rs`, CLAUDE.md).
- 설치본 40 MB 단일 바이너리(Electron 대비 소형, spec 00 근거) [확인](`du`, spec 00 §9 표).

---

## 6. 한계 및 미확인 사항

1. 실제 볼트·앱 데이터가 이 Mac에 없어 **실제 인덱스 크기/행 수/성능은 측정 불가**. §3.1(c)는 소스 DDL의 빈 DB 적용 결과.
2. `~/Library/WebKit`/`Caches`/`Preferences`의 정확한 하위 경로는 앱 미실행으로 확인 불가 → [추정] 표기.
3. 서버는 로컬에서 기동하지 않았고(Postgres 미기동 — 저장소 규칙상 `pnpm test`가 개발 DB를 지우므로 실행 금지) 마이그레이션은 파일 읽기로만 분석. 최종 DB 상태(컬럼 전수)는 52개 마이그레이션 누적 결과로 **일부 컬럼 변경은 미추적**.
4. 번들 크기·콜드 스타트·메모리 사용량 등 **런타임 리소스 실측은 하지 않음**(앱 미실행·읽기 전용 지침). 리소스 관련 서술은 소스 상수/주석 근거.
5. 관리형 인스턴스(api.baalda.com)의 실제 구성은 공개 repo 범위 밖(경계 규칙) — 확장성 평가는 코드/스펙 기준.
