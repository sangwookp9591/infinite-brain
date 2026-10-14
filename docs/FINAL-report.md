# infinite-brain: Baalda 분석과 협업형 세컨드 브레인 설계 (최종 보고서)

- 작성일: 2026-10-14
- 분석 대상: Baalda 0.1.83. 설치본 `/Applications/Baalda.app`과 같은 버전의 오픈소스를 함께 봤다.
- 진행 방식: Orca Run `run_362804bd876d`으로 워커를 띄웠다. 모델 배치는 model-routing 규칙을 따랐다.

| 워커 | 맡은 일 | 모델 |
|---|---|---|
| W1 | REA로 바이너리 검증 | Codex Sol |
| W2 | 아키텍처와 데이터 저장 | Sonnet |
| W3 | 검색 추적과 실측 | Codex Sol |
| W4 | 시장 조사 (deep-research) | — |
| W4b | 시장 조사 보강 | Sonnet |
| W5 | MCP와 AI 연결 | Sonnet |
| G1 | 사실 검증 | Opus |
| W6 | 종합 설계 | Opus |
| W7 | 독립 교차 검증 (W6 결론을 보지 않음) | Opus |

- 태그: **[확인]**은 파일:줄, 실행 출력, URL로 직접 확인한 것이다. **[추정]**은 추론이고 신뢰도(상/중/하)를 붙였다. 원자료와 근거는 `research/` 폴더에 있다.
- 사실 검증(G1) 결과: 핵심 주장 31개 중 26개 일치, 4개 부분 일치, 1개 불일치였다(엄격 불일치율 3%). 정정 사항은 이 문서에 반영했다.

---

## 1. 결론 요약

1. **REA는 거의 필요 없었다.** 설치본은 이 오픈소스로 빌드된 것으로 보인다(신뢰도 상).
   - [확인] 서명과 공증이 유효하다. Tauri 2.11.5가 일치하고, 소스에 등록된 IPC 명령 114개의 이름이 바이너리에 모두 있다(W1).
   - 한계: 압축된 프론트엔드 JS의 내용이 소스와 같은지는 확정하지 못했다. 그래서 분석은 오픈소스를 기준으로 했다.
2. **새로 짜지 말고 하드 포크한다.** W6과 W7이 독립적으로 같은 결론을 냈다.
   - 이유: md↔CRDT 병합, 권한 리졸버, MCP+OAuth 서버라는 가장 어려운 부분이 이미 Apache-2.0으로 작동한다.
   - 포크하려면 정리할 것: `ee/` 폴더, 브랜드, 업데이터 키.
3. **"내 GPT/Claude 계정으로 로그인" 아이디어는 방향을 뒤집어야 한다.** "우리 앱이 사용자의 AI 계정으로 로그인"하는 방식은 막혀 있다.
   - Anthropic은 금지한다 [확인].
   - OpenAI는 오픈소스·로컬 앱에 한해 프리뷰로만 허용한다 [확인].
   - 합법적이고 이미 구현된 경로는 반대 방향이다. "사용자의 AI 앱(Claude, ChatGPT, Cursor)이 우리에게 로그인"하는 **커넥터** 방식이다.
4. **차별점은 기능 하나가 아니라 조합이다.**
   - 조합: 로컬 `.md` 그대로 팀이 실시간 편집 + 터미널 없이 AI 연결(읽기 전용 같은 권한 범위 선택) + AI가 바꾼 것을 기록하고 한 번에 되돌림.
   - "MCP 지원" 자체는 Slite, Granola, Notion에도 이미 있다 [확인].
5. **가장 큰 미검증 가정은 수요다.**
   - 팀이 Obsidian+Relay($5~6)나 Notion 대신 이것으로 옮길 이유가 충분한지 아직 모른다.
   - 비개발자가 커넥터 연결을 실제로 혼자 끝낼 수 있는지도 모른다.
   - 한국어 검색에 대한 직접 불만은 0건이었다 [확인]. 다만 서버·MCP 검색이 한글을 처리하지 못하는 것은 **AI 기능 결함**이라서 MVP에 넣는다.

---

## 2. Baalda 분석

### 2.1 사용 기술 [확인](W2)
| 층 | 기술 |
|---|---|
| 데스크톱 셸 | Tauri 2.11.5 (Rust). 프론트엔드는 Brotli로 압축해 실행파일 안에 넣었다(W1 [추정·상]) |
| Rust 코어 | rusqlite 0.32 (SQLite 내장, FTS5), notify 8, keyring 3, reqwest, tokio, tauri-plugin-updater |
| UI | React 19, Vite 7, TypeScript 5.8, CodeMirror 6, Zustand 5, mermaid |
| 동기화 | Yjs 13.6, y-codemirror.next, @hocuspocus/provider 4.4, diff-match-patch |
| 서버 | Node, Hono HTTP + Hocuspocus WS (단일 포트 `/sync`), Postgres 16, Better Auth (argon2id), MCP (JSON-RPC over HTTP) |
| 배포 | macOS만 서명·공증한다(Developer ID). Linux/Windows는 서명하지 않는다. 자동 업데이트는 minisign으로 검증한다 |

### 2.2 주요 모듈 [확인](W2, CLAUDE.md)
- **Rust (`src-tauri/src/`)**: 디스크 I/O를 전부 맡는다.
  - `vault.rs`: 경로 안전성
  - `notefile.rs`: 원자적 쓰기
  - `index.rs`: SQLite 인덱스, FTS5, CRDT 로그
  - `watcher.rs`: 파일 감시, 150ms 디바운스
  - `agent_runner.rs`: 설치된 Claude/Codex CLI 실행
  - `oauth.rs`: 루프백 OAuth
  - `commands.rs`: IPC 명령 90개 (앱 전체로는 114개, G1 정정)
- **브리지 (`src/lib/bridge/`)**: 노트마다 `Y.Text("content")` 하나를 둔다.
  - ingest(디스크→CRDT): 150ms, diff를 CRDT 연산으로 적용
  - egest(CRDT→디스크): 300ms, 원자적 쓰기
  - 무한 루프를 막는 가드 두 개: disk-origin 트랜잭션 무시, 마지막으로 쓴 해시와 같은 읽기 무시
- **동기화 (`src/lib/sync/`)**: `docSession.ts`(7,555줄), `registry.ts`(5,842줄), `attachments.ts`. 삭제 전파, 권한 회수, 충돌 처리, 오프라인 재조정 규칙이 수십 개 있다.
- **서버 (`app/apps/server/src/`)**:
  - `permissions/resolver.ts`: 노트 단위 ACL
  - `mcp/`: 22개 도구, `createDocWriter`로 사람 편집과 같은 CRDT 경로에 합류
  - `index/`: 검색
  - `versions/`, `trash/`, `billing/`

### 2.3 데이터 저장 위치 [확인](W2)
| 위치 | 내용 |
|---|---|
| `<vault>/*.md` | 영구 원본 |
| `<vault>/.context/index.sqlite` | 일반 테이블 13개 + FTS5 2개: notes, notes_fts, files_fts, tags, links, folders, yjs_updates, yjs_snapshot 등 |
| `<vault>/.context/config.json` | 서버 vault id, doc-id 맵, ackedSv, fileBases |
| `<vault>/.context/trash/` | 복구용 사본 |
| OS keychain `com.baalda.context` | 세션 토큰, (선택) 저장된 비밀번호, BYO AI 키 |
| Postgres | Better Auth 테이블, vaults/folders/notes/files, shares, doc_updates/doc_snapshots(바이너리), note_index·note_texts·blob_text(**평문 파생 사본**), mcp_tokens, 체크포인트 |
| Blob | Postgres BYTEA 또는 S3/R2 |

- [확인] 이 Mac에서는 앱을 한 번도 실행하지 않았다. 볼트, `~/Library` 아래 앱 데이터, keychain 항목이 모두 없었다. 그래서 스키마는 소스의 DDL을 빈 DB에 적용해 실측했다.

### 2.4 동작 원리 한 장 요약
```
타이핑 → CodeMirror(yCollab) → Y.Text ──egest 300ms──▶ .md (원자적 쓰기) → Rust 재인덱싱
              ▲                                         │
              └──ingest 150ms (diff→CRDT 연산) ◀── watcher ◀── AI/외부 편집기의 파일 수정
Y.Doc ⇄ Hocuspocus WS(바이너리 업데이트만 전송) ⇄ 서버 doc_updates → 2초 뒤 note_index(평문) 파생
MCP(Claude/ChatGPT) → OAuth → ACL → DocWriter → 같은 CRDT로 합류 → 모든 클라이언트에 실시간 반영
```

### 2.5 검색 동작 추적 [확인](W3, G1 a·b·c 일치)
검색은 세 갈래이고, 엔진이 서로 다르다.

**A. 앱 검색창**
- 호출 경로: `SearchPanel.tsx`(180ms 디바운스) → `ipc.searchNotes` → `commands.rs search_notes` → `index.rs search_all` → `build_fts_query`
- 쿼리 가공: 단어마다 `"단어"*`(앞부분 일치)로 바꿔 ` AND `로 묶는다. FTS5 토크나이저는 `unicode61 remove_diacritics 2`다.
- 정렬: notes와 files를 각각 BM25로 최대 100개 뽑는다. 파일 점수에는 +0.1을 더해 합친다.
- 결과 표시: snippet은 Rust가 HTML을 escape한 뒤 `<mark>`만 넣는다.
- 한계:
  - 한국어는 **어절 앞부분만** 찾는다. `검색기능과`를 `검색`으로는 찾지만 `기능`으로는 못 찾는다(실측).
  - 파일명만으로 찾는 경로가 없다.
  - frontmatter의 태그는 검색되지 않는다.
  - PDF 본문은 검색되지 않는다.
  - 요청 순서 보호 장치가 없다 [추정·중].

**B. 서버 검색** (`GET /api/vaults/:id/search`)
- 점수 = 256차원 해시 단어빈도 벡터의 코사인 유사도 + 0.1 × ASCII 부분일치 비율
- 토크나이저가 `/[a-z0-9_]+/`만 인정해서 **한글을 통째로 버린다.** 그래서 한글로만 검색하면 모든 점수가 0이 되고, 0점 컷오프가 없어서 관련 없는 top-k가 반환된다(실측).
- 데스크톱 앱은 이 API를 호출하지 않는다.

**C. MCP `search_notes`**
- B와 같은 함수에 ACL로 후보를 미리 거른다.
- 파일은 처음 2,000개까지만 검색한다.
- **AI가 쓰는 유일한 검색 경로**라서, 한글로 물으면 AI가 엉뚱한 노트를 근거로 그럴듯한 오답을 만든다(W7 맹점 4).

### 2.6 강점과 단점
**강점** [확인]
- 로컬 파일을 우선하면서, AI가 파일을 직접 고쳐도 사람 편집과 CRDT로 병합된다.
- 권한 모델이 촘촘하다: sealed, 개인 절대 레벨, 가장 깊은 행 우선.
- 삭제와 회수에 대한 안전장치가 많다.
- MCP와 OAuth(DCR, PKCE)가 이미 운영 중이다.

**단점** [확인]
- 거대 파일과 수동으로 맞춰야 하는 락스텝 규칙 때문에 진입장벽이 높다(CLAUDE.md 991줄).
- 문서에는 "서버는 바이너리만 저장"이라고 하지만 실제로는 **평문 사본**이 있고, at-rest 암호화가 없다.
- 로컬 인덱스가 1.27GB까지 불어난 사고 기록이 있고, 단일 뮤텍스가 UI를 막는다.
- 서버 확장은 사실상 Node 프로세스 하나, DB 하나 구조다.
- 검색 품질이 약하다(2.5절).
- 비개발자에게 MCP 연결 안내가 터미널 명령과 토큰 복사다.
- 연결할 때 읽기 전용 권한을 고를 수 없다.
- MCP는 2025-06 스펙 기준이다. 2026-07-28 스펙에서 DCR이 deprecated됐다.

---

## 3. 시장 조사에서 확인된 것

| 신호 | 근거 | 확신 |
|---|---|---|
| 비개발자는 MCP 연결에서 JSON 설정, 절대경로, 모호한 오류에 막힌다 | W4 #1~2 (홍보성 출처 포함, 규모는 과장됐을 수 있음) | 중 |
| ChatGPT에서 쓰기 가능한 커스텀 MCP는 Developer mode를 거쳐야 하고, OpenAI가 "dangerous, intended for developers"라고 표시한다 | developers.openai.com (W4 #3) | 상 |
| Notion은 2025-05부터 AI를 단독 판매하지 않고 Business 좌석(약 $20)에 묶었다. 사용자 반발이 있다 | W4 #4~5 | 상 |
| 공유할 때 실수로 Member로 초대해 과금되는 사고가 있다 | W4 #6 | 중 |
| 로컬 우선과 팀 협업은 아직 한 제품에서 함께 되지 않는다(AFFiNE 사례). 로컬 `.md` 도구의 팀 동시편집 불가 언급이 약 10건 있다 | W4 #7, W4b P1 | 중 |
| Aside는 노트 앱이 아니라 AI 브라우저(에이전트, 메모리, 비밀번호 관리)다 | W4 | 상 |
| 한국어 검색 불만의 직접 근거는 0건이다 | W4b §4 | 확인 |
| "팀 + AI 에이전트 + 마크다운" 카테고리에는 이미 OSS 5개 이상이 들어와 있다(OpenKnowledge, Tela, Onyx 등). 비어 있는 시장이 아니라 아직 입증되지 않은 시장이다 | W4b §5·§7 | 중 |

**공백 후보** (모두 추정, W4b §7)
- G1: 로컬 `.md` + 실시간 편집 + 폴더 권한 + 서버를 믿지 않아도 되는 구조
- G2: AI가 사람과 같은 CRDT·권한·감사 층에서 편집
- G3: 터미널 없이 AI 연결
- G6: 팀과 에이전트의 변경 검토 UX

---

## 4. AI·MCP 연결: 약관을 지키는 경로 [확인](W5, G1 g)

| 경로 | 판정 |
|---|---|
| **커넥터**: 사용자의 Claude/ChatGPT/Cursor가 우리 MCP 서버에 OAuth로 로그인 | ✅ 합법이고 이미 구현돼 있다. Claude는 Free(커넥터 1개)부터 Enterprise까지 가능. ChatGPT 쓰기는 Developer mode가 필요하다 |
| **설치된 정품 CLI 실행** (`agent_runner.rs`) | ⚠️ 조건부. Anthropic Commercial Terms 동의가 전제다(G1 정정). 사용자가 CLI를 설치하고 터미널에서 로그인해야 해서 **비개발자 타깃과 맞지 않는다**(W7) |
| **Sign in with ChatGPT** (오픈소스 로컬 앱 경로) | ⚠️ 프리뷰이고, 데스크톱 로컬 전용이며, Responses API 요청만 가능하다. 유료 관리형 서비스는 관심 폼을 거쳐야 한다 |
| **BYO API 키** | ✅ 이미 있다(Assistant, keychain) |
| claude.ai 로그인을 앱에 넣거나, 다른 앱의 토큰(auth.json 등)을 재사용 | ❌ 금지 또는 회색지대. 채택하지 않는다 |

**쉬운 MCP 생성·연결에 쓸 수 있는 오픈소스** (라이선스 안전)
- FastMCP (Apache-2.0)
- mcp-use (MIT)
- Composio SDK (MIT)
- openapi-mcp-generator (MIT)
- OpenAI Agents SDK (MIT)
- ACP, Agent Client Protocol (Apache-2.0)
- Better Auth + `@better-auth/cimd`

**번들·재배포하면 안 되는 것**: n8n (Sustainable Use), Pipedream (Source Available), Smithery CLI (AGPL), Zapier (독점). 이런 서비스는 사용자가 자기 계정으로 연결하는 외부 서비스로만 다룬다.

**결합 방식**
1. 우리 MCP 서버를 Claude/ChatGPT 커넥터로 노출한다(이미 있음). 여기에 CIMD, `iss`, scope, audience 검증을 추가한다.
2. 비개발자를 위해 "AI 연결 마법사"를 만든다. 대상(Claude, ChatGPT, Cursor 등)을 고르면 URL 복사나 딥링크를 주고 연결 상태를 보여준다.
3. 노코드 MCP 생성은 우리가 만드는 것이 아니라 2~3단계에서 Composio·mcp-use 같은 MIT 게이트웨이를 opt-in 허용 목록으로 붙인다. 현재 앱은 MCP와 네트워크를 차단하는 안전 모델이라 별도 위협 모델이 필요하다.

---

## 5. W6 vs W7 교차 검증 결과와 최종 판단

| 쟁점 | W6 (종합 설계) | W7 (독립 검증) | **최종 판단** |
|---|---|---|---|
| 포크 vs 신규 | 하드 포크 | 선택적 하드 포크. 서버가 제품이고 데스크톱은 최소 수정 | **하드 포크, 투자는 서버와 연결 UX에 집중** (일치) |
| AI 연결 마법사 + scope | MVP F1 (4.00점) | MVP 1순위 | **MVP 1순위** (일치) |
| AI 변경 원장·되돌리기 | MVP F2 (3.60점) | MVP 2순위 | **MVP 2순위** (일치) |
| 한국어·서버 검색 | 위생 작업 F4. 수요 미입증이라 2.60점 | MVP 3순위. MCP 경로의 기능 결함 | **MVP에 넣되 서버·MCP 다국어 토큰화와 0점 컷오프를 1~2주차에 먼저.** 로컬 중간 일치 fallback은 후순위. W7 논리를 채택 |
| 5분 팀 온보딩 | 최고점(4.05)인 F3 | 공유·권한은 이미 있으니 새 MVP 항목이 아님 | **새로 만들지 않고 기존 초대 흐름을 다듬고 측정만** (W7 쪽, 단 W6의 5분 측정 기준은 유지) |
| 설치 CLI로 노트 작업 | 조건부 F5 (법무 확인 시) | 비개발자 타깃과 모순 | **MVP에서 빼고 2단계로** (W7 쪽) |
| "내 AI 계정으로 로그인" | SIWC는 2단계 PoC | 방향을 커넥터로 뒤집어야 함 | **커넥터가 기본. SIWC는 2단계에서 OpenAI 자격 확인 뒤에** (일치) |

**W7이 추가로 찾은 맹점** (0주차 체크리스트에 넣는다)
- 업데이터의 `pubkey`와 `endpoints`를 바꾸지 않으면, 포크 앱이 업스트림 Baalda 릴리스를 받아 포크를 덮어쓸 수 있다 [확인·추정 상].
- 브랜드 식별자가 `app/` 아래 **249개 파일, 1,073줄**에 있다. `baalda://`, `baalda-view`, `baalda/sdk.js`, keychain 서비스 같은 프로토콜 수준 식별자도 포함된다. 또 TRADEMARK.md는 "Context"라는 이름도 보호한다 [확인].
- 타깃과 핵심 자산이 어긋난다. 디스크 브리지의 수혜자는 개발자(CLI)이고, 비개발자는 웹 AI에서 서버 MCP로 들어온다. 그러므로 **제품은 서버다** [추정·상].
- SSO와 감사 로그는 업스트림 계획상 `ee/`(비오픈)에 들어갈 기능이라 포크가 직접 만들어야 한다. 과금, 백업, 모니터링도 마찬가지다.
- BYO-AI 구조에서는 돈을 받을 근거가 팀 동기화와 권한만 남는다. 그 시장의 가격 기준은 Relay $5~6, Outline $10이다.

---

## 6. 최종 MVP (6주)

**0주차 — 포크 정리**
- `ee/` 삭제
- 브랜드와 식별자 교체: 249개 파일, 스킴, keychain, 업데이터 키·엔드포인트, `PRODUCTION_SERVER_URL`
- 자체 서명 인증서와 minisign 키로 macOS 빌드
- Compose로 자체 서버 배포
- `pnpm test`와 `cargo test`의 기존 통과율 유지(브리지 4개 스위트)
- 바이너리에서 `api.baalda.com`, `naveedharri`, `com.baalda` 문자열 0건 확인

**M1. AI 연결 마법사 + scope 커넥터** (1~2주차)
- 대상별 URL 복사나 딥링크, 연결 상태 표시(마지막 호출 시각)
- 동의 화면에 "읽기만 / 읽기+쓰기 / +삭제·이동" 프리셋. 읽기만 고른 연결에는 쓰기 도구가 `tools/list`에도 나오지 않는다.
- `manage_access`는 기본으로 노출하지 않는다.
- OAuth 연결과 토큰 연결을 한 목록에 보여주고 해제할 수 있게 한다.
- CIMD, `iss`, scope, audience 검증을 추가하되 기존 DCR 클라이언트 호환은 유지한다.
- 수용 기준: 비개발자 5명 중 80% 이상이 Claude 연결을 3분 안에 끝낸다.

**M2. 서버·MCP 다국어 검색 결함 수정** (1~2주차)
- Unicode 토크나이저로 바꾸고 기존 벡터를 재인덱싱한다.
- 0점 컷오프를 넣어 관련 노트가 없으면 빈 결과를 반환한다.
- 공백만 있는 MCP 질의는 거부한다.
- 한글 질의 10개로 top-k 관련도를 측정한다.
- 로컬 FTS 중간 일치(trigram fallback)는 여유가 있으면 넣는다.

**M3. AI 변경 원장과 되돌리기** (3~4주차)
- MCP 쓰기마다 원장 행(연결, 노트, 변경 전후 diff)을 남긴다.
- 되돌리기는 `DocWriter.editContent`와 리비전 가드로 적용한다. 그 사이 사람이 같은 구간을 고쳤으면 거부하고 diff를 보여준다.
- 연결 단위 일괄 되돌리기와 휴지통 복원을 지원한다.

**M4. 팀 초대 흐름 다듬기와 측정** (5주차)
- 기존 `invitation_access`와 `join_default`를 쓴다.
- 앱 설치부터 동시 편집까지 5분 이내를 측정한다.
- git, 터미널, 설정 파일이 나오지 않아야 한다.

**6주차** — 비개발자 사용성 테스트와 수정. 파일럿 팀 3곳.

**2단계 (7~14주)**
- SIWC PoC
- 설치 CLI로 노트 작업 (법무 확인 뒤)
- 폴더 단위 scope
- 사이드패널 AI (diff 승인)
- 팀 공용 에이전트 지침 (MCP prompts/resources)
- 게스트 뷰어
- 옵트인 실제 임베딩 + 하이브리드 검색
- 서버 평문 최소 모드
- Better Auth `oauth-provider`로 이전

**3단계 (15~26주)**
- 웹 클라이언트
- ACP로 에이전트 일반화
- 외부 MCP 게이트웨이 (opt-in)
- 로컬 at-rest 암호화
- Windows 서명

---

## 7. 다음 판단 전에 해야 할 실측 3건
1. claude.ai와 ChatGPT에서 커넥터를 **실제로 연결**해 본다. 비개발자 계정으로 클릭 수와 막히는 지점을 기록한다.
2. 한글 질의 10개로 MCP `search_notes` 결과의 관련도를 측정한다.
3. 노트 5,000~20,000개 규모의 합성 볼트로 동기화와 인덱스 크기를 측정한다.

## 8. 이용자가 결정해야 할 것 (W6 §6에서 추림)
1. **사업 모델**: OSS + 유료 관리형 호스팅(권고), 셀프호스트 전용, 비공개 중 하나. SIWC 자격과 Commercial Terms 문제가 이 선택에 달려 있다.
2. **1차 타깃**: 한국 비개발자 소규모 팀인가, 글로벌인가.
3. **포크 기준 커밋**: 로컬 사본에 `.git`이 없다. 업스트림을 추적할지(권고는 무추적 + 보안 수정만 체리픽).
4. **이름과 식별자**: 상표 검색, 내부 식별자 `.context`를 유지할지.
5. **서버 평문 정책과 결제 모델**: 좌석제인지, 팀 합계제인지.
6. **검증 리소스**: 인터뷰 10팀과 사용성 테스트 5명을 누가 섭외할지.

---

## 부록: 원자료
| 파일 | 내용 |
|---|---|
| `research/W1-rea.md` | REA 바이너리 대조 |
| `research/W2-architecture.md` | 기술 스택, 모듈, 저장, 단점 |
| `research/W3-search.md` | 검색 세 경로 추적과 실측 |
| `research/W4-deep-research.json` | deep-research (주장 25개 중 14개 검증 통과) |
| `research/W4b-market.md` | 경쟁사 가격, 커뮤니티, 공백 |
| `research/W5-mcp-connect.md` | AI·MCP 연결과 약관, 결합 지점 |
| `research/G1-verify.md` | 사실 검증 |
| `research/W6-design.md` | 종합 설계 |
| `research/W7-independent.md` | 독립 교차 검증 |
