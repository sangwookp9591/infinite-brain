# G1 — W1·W2·W3·W5 보고서 독립 사실 검증

- 검증일 2026-10-14 · 검증자: Gate1 독립 검증 담당 (구현자 아님)
- 대상: `W1-rea.md`, `W2-architecture.md`, `W3-search.md`, `W5-mcp-connect.md` (같은 폴더)
- 방법: 각 보고서의 [확인] 주장 중 결론을 좌우하는 것을 골라 원본을 **직접** 다시 열람·실행했다. 저장소 `/Users/iron/Project/psw/baalda`는 읽기만 했고, 실행은 `sed/grep/wc`, 설치본 바이트 검색(Python), `codesign/spctl/plutil`, `api.baalda.com` 공개 메타데이터 GET, 공식 문서 웹 열람으로 제한했다.
- 경로 약어: `D/` = `app/apps/desktop`, `S/` = `app/apps/server`
- 판정: **일치** / **부분일치**(결론은 맞지만 세부가 틀리거나 빠짐) / **불일치**

## 결론 (먼저)

| 보고서 | 검증 항목 | 일치 | 부분일치 | 불일치 | 실패율(부분+불일치) | 재작업 필요 |
|---|---:|---:|---:|---:|---:|---|
| W1-rea | 7 | 7 | 0 | 0 | 0% | 없음 |
| W2-architecture | 8 | 6 | 1 | 1 | 25% | **경미한 정정 필요**(명령 수, `note_versions` 서술) |
| W3-search | 7 | 7 | 0 | 0 | 0% | 없음 |
| W5-mcp-connect | 9 | 6 | 3 | 0 | 33% | **경미한 정정 필요**(Anthropic 약관 해석의 조건, 플래그·엔드포인트 표기) |
| **합계** | **31** | **26** | **4** | **1** | **16%** (엄격 불일치만 3%) | 결론을 뒤집는 오류 없음 |

- [확인] 필수 항목 (a)~(g)는 모두 원본과 **일치**한다. 보고서들의 핵심 결론은 유지된다: 서버 임베더는 한글을 버리고, 로컬 FTS는 접두어 AND이며, SearchPanel은 서버 검색을 부르지 않는다. 서버 DB에는 평문 사본이 있고, agent_runner는 MCP를 차단한다. 서버는 OAuth와 DCR을 제공하며 약관 문구도 실재한다.
- [확인] 불일치 1건: W2는 `commands.rs`의 Tauri 명령이 80개라고 했지만 실제로는 **90개**다. `#[tauri::command(async)]` 10개가 집계에서 빠졌다.
- [추정](신뢰도 상) 재작업 범위는 W2와 W5의 **문장 단위 정정**이다. 보고서 전체를 다시 쓸 필요는 없다. 결론에는 W5의 "현재 CLI spawn 구조는 약관상 안전"에 조건을 다는 정정이 가장 크게 영향을 준다(§W5-3).

---

## (a)~(g) 필수 항목

| # | 주장 (출처 보고서) | 판정 | 근거 |
|---|---|---|---|
| a | 서버 `embedder.ts`가 한글 토큰을 버린다 (W3 §B, W2 D-8) | **일치** | [확인] `S/src/index/embedder.ts:22-25` `tokenize` = `text.toLowerCase().match(/[a-z0-9_]+/g)`이므로 한글 문자는 어떤 토큰에도 들어가지 않는다. `localEmbedder.embed`(`:49-58`)는 이 토큰만 해싱한다. `setEmbedder`를 정의한 곳만 있고 호출자가 없다(`grep -rn setEmbedder S/src D/src` 결과 `embedder.ts:63` 정의 1건). 검색은 `qTokens = tokenize(query)`, `boost = qTokens.length>0 ? … : 0`이며(`indexer.ts:371-372,400-401`) 0점을 거르지 않고 `sort().slice(0,k)`만 한다(`indexer.ts:422`). 따라서 W3의 "순수 한글 질의는 0점 + 무관한 top-k 반환" 추정은 코드와 정합한다. |
| b | `index.rs` FTS5 토크나이저와 쿼리 빌더가 접두어 AND다 (W3 §A) | **일치** | [확인] `D/src-tauri/src/index.rs:370-372` `notes_fts USING fts5(… tokenize='unicode61 remove_diacritics 2')`, `:484-486` `files_fts` 같음, trigram·porter 없음(grep). `build_fts_query`(`:3154-3170`)는 `split_whitespace` 후 `is_alphanumeric()`·`_`·`-`만 남기고 `"{t}"*`를 만든 뒤 `" AND "`로 잇는다. `bm25` 오름차순 LIMIT 100(`:1865-1873`), 파일 `FILE_RANK_PENALTY = 0.1`(`:201`), `html_escape` 후 sentinel을 `<mark>`로 바꾼다(`:3173-3177,3203-3217`). |
| c | SearchPanel이 서버 검색을 호출하지 않는다 (W3) | **일치** | [확인] `D/src/components/SearchPanel.tsx:42` `ipc.searchNotes(query)`, `:57` `ipc.onFilesIndexed`만 호출하고 `api.`·`fetch(` 호출은 없다(grep). `D/src/lib/ipc.ts:587-588`은 `invoke("search_notes")`다. `D/src/lib/api.ts`에는 `/search` 경로가 없다(`grep -n search` 결과 `searchParams` 3건뿐). 서버 `GET /vaults/:vaultId/search`는 `S/src/http/routes/graph.ts:108`에 있지만 데스크톱에 호출자가 없다. |
| d | 서버에 평문 content 테이블이 있다 (W2 D-3, W3 §B) | **일치** (W2 세부는 부분일치, §W2-5) | [확인] `S/migrations/005_join_codes_and_index.sql:16-22` 주석에 "plain text + embedding vector", `note_index.content TEXT NOT NULL`, `vector JSONB`. `indexer.ts:113-120`이 `INSERT INTO note_index (… content, vector …)`로 Y.Text 원문을 저장한다. 추가로 `038_note_texts.sql:31-35` `note_texts.content TEXT NOT NULL`, `028_blob_text.sql:34-47` `blob_text.content TEXT`, `016_versioning.sql:43` `vault_checkpoint_docs.content`도 있다. |
| e | `agent_runner.rs`가 MCP를 차단한다 (W5 §3.3) | **일치** | [확인] `D/src-tauri/src/agent_runner.rs:721-723` `"--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}"`, `:724-727` 도구 `Read,Glob,Grep,Edit,Write`, `:729` `dontAsk`이다. Codex 쪽은 `:659` network `enabled=false`, `:667` `approval_policy="never"`, `:669` `web_search="disabled"`, `:679` `features.apps=false`다. 테스트 `:1389-1405`가 `--mcp-config` 값이 `{"mcpServers":{}}`인지 단언한다. 상태 문구 `:607` "No shell or MCP tools."도 있다. |
| f | Baalda 서버에 OAuth와 DCR이 있다 (`app.ts` 메타데이터 라우트) (W5 §2.2) | **일치** | [확인] `S/src/http/app.ts:273` `/.well-known/oauth-authorization-server`, `:276` `/.well-known/oauth-protected-resource`, `:282` `…/api/mcp` 접미형, `:295` AS 접미형. `S/src/auth/auth.ts:428-437` `mcp({ resource: …/api/mcp, loginPage, consentPage })`. 운영 서버 실측(2026-10-14 `curl`): `"registration_endpoint":"https://api.baalda.com/api/auth/mcp/register"`, `code_challenge_methods_supported:["S256"]`, `scopes_supported:["openid","profile","email","offline_access"]`. `client_id_metadata_document_supported`와 `authorization_response_iss_parameter_supported`는 **없음**. PRM: `resource: https://api.baalda.com/api/mcp`, `authorization_servers:["https://api.baalda.com"]`. `/health` = `{"version":"0.1.0","minDesktopVersion":"0.1.49","features":[…4개]}`. W5의 실측과 같다. |
| g-1 | Anthropic 법무 문구 (W5 §1.1(b)) | **일치** (해석은 부분일치, §W5-3) | [확인] https://code.claude.com/docs/en/legal-and-compliance 원문: "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens …" 및 "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription …". Agent SDK 문구("Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits …")와 브랜딩 규칙("Claude Code" 사용 불가, "Claude Agent"·"Powered by Claude" 허용)도 https://code.claude.com/docs/en/agent-sdk/overview 원문과 일치한다. |
| g-2 | OpenAI SIWC 오픈소스 범위 문구 (W5 §1.1(a)) | **일치** | [확인] https://developers.openai.com/siwc/token-sharing-open-source 원문: "These docs explain ChatGPT plan usage for open-source and locally hosted apps." 유료·원격 호스팅 앱은 "If you're interested in offering it in a paid or remotely hosted app …"로 관심 폼 안내. "eligible Responses API requests", "This does not grant access to their ChatGPT conversations or other account context." `…/sign-in` 원문: `client_id=dynamic_agent_client`(등록 진입점일 뿐 저장용 ID 아님), `ext_agent_host_id`, `agent_name_hint`, scope `openid profile email` + `offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`, "Use an HTTP loopback callback on `127.0.0.1`" / "Do not substitute with `localhost`", "No client secret is required." `…/preview-limitations`: `store:false`, `stream:true`, hosted MCP/connectors·file search·Code Interpreter·`tool_search` 미지원. |

---

## W1-rea (설치본 ↔ 소스 대조) — 7항목, 실패 0

| # | 주장 | 판정 | 근거 |
|---|---|---|---|
| W1-1 | 실행파일 40,326,240 B, SHA-256 `04c3b2…0b00` | **일치** | [확인] Python `len(read_bytes())` = 40326240, `hashlib.sha256` = `04c3b2023e5ecb445a2f4ad77ad14a1e8b3b1bb5891bcc51266ace933ee80b00` |
| W1-2 | 버전 0.1.83 / `com.baalda.context` / 소스 minimumSystemVersion 10.15 | **일치** | [확인] `plutil -p …/Info.plist` 결과 `CFBundleShortVersionString=0.1.83`, `CFBundleIdentifier=com.baalda.context`, `LSMinimumSystemVersion=10.15`; `D/src-tauri/tauri.conf.json:4,5` 및 `minimumSystemVersion "10.15"` |
| W1-3 | Tauri 2.11.5 문자열이 offset 10892835에 있고 lockfile과 일치 | **일치** | [확인] 바이트 검색 `tauri-2.11.5/src/plugin.rs` → 10892835; `Cargo.lock:4318-4319` `name="tauri" version="2.11.5"` |
| W1-4 | `generate_handler!` 114개 이름 모두 바이너리에서 발견 | **일치** | [확인] `lib.rs`의 `generate_handler![` 블록을 다시 파싱하니 114개, 미발견 `[]`. `detect_agents`는 `lib.rs:209`, `google_oauth_return_to_app`은 `:322` |
| W1-5 | `api.baalda.com`·`AccountMenu`·`An update is on its way.`는 미발견, OAuth 오류문구는 offset 37541599, `/assets/AuthDialog-51Ae6DnZ.js`는 26337453 | **일치** | [확인] 바이트 검색 결과 앞의 셋은 -1, 뒤의 둘은 37541599·26337453, `index.html` 10905126. 업데이터 URL 접미부 offset 11905581에서 접두 `https://github.com/naveedharri/baalda/` 38바이트를 빼면 W1의 11905543과 일치 |
| W1-6 | 서명은 Developer ID Naveed Harri (S3AT3TK8MR), notarized, codesign 유효 | **일치** | [확인] `codesign --verify --deep --strict` 통과, `spctl` → `accepted / source=Notarized Developer ID`, `codesign -dvv` → Authority·TeamIdentifier·`Timestamp=Oct 13, 2026 at 7:28:48 PM` |
| W1-7 | Resources에는 `icon.icns`만 있고 `frontendDist="../dist"`이며 소스에는 `PRODUCTION_SERVER_URL`이 있음 | **일치** | [확인] `ls …/Resources` → `icon.icns`; `tauri.conf.json:10`; `D/src/lib/api.ts:58` |

- [추정](신뢰도 상) W1의 범위 한정("소스 계열 일치까지이며 정확한 빌드 동일성은 아님")은 검증 결과에 비춰 적절하다. `api.baalda.com`을 찾지 못한 것은 프론트엔드가 압축 임베드됐기 때문으로 설명된다. 불일치 증거로 볼 수 없다.

## W2-architecture — 8항목, 실패 2

| # | 주장 | 판정 | 근거 |
|---|---|---|---|
| W2-1 | 파일 줄 수: `docSession.ts` 7,555 / `registry.ts` 5,842 / `attachments.ts` 2,890 / `index.rs` 5,127 / `commands.rs` 3,999 / CLAUDE.md 991 | **일치** | [확인] `wc -l` 출력이 모두 같다 |
| W2-2 | `commands.rs`의 `#[tauri::command]`는 **80개** | **불일치** | [확인] `grep "#\[tauri::command" commands.rs | sort | uniq -c` 결과 `#[tauri::command]` 80개, `#[tauri::command(async)]` 10개(나머지 3건은 doc 주석). 실제 명령 수는 **90개**이며 `lib.rs` `generate_handler!`에서도 `commands::` 90개로 일치한다. W1의 114개는 9개 모듈 합계로 정확하다(commands 90 + dashboard 6 + agent_runner 3 + dashboard_remote 3 + trash 3 + keychain 3 + oauth 3 + relaunch 2 + clipboard 1). W2 §2.1과 D-1의 "명령 80개"를 90개로 정정해야 한다. |
| W2-3 | `index.sqlite`는 일반 테이블 13 + FTS5 2이며 WAL / `foreign_keys=ON` / `busy_timeout=5000` / `synchronous=NORMAL` | **일치** | [확인] `grep -oE "CREATE (VIRTUAL )?TABLE IF NOT EXISTS …" index.rs | sort -u` → 일반 13개(`attachment_hashes … yjs_updates`) + `files_fts`·`notes_fts`; `index.rs:294-307` pragma 4개 |
| W2-4 | 서버 마이그레이션 52개, 037·040·044 결번 | **일치** | [확인] `ls S/migrations/*.sql | wc -l` → 52, 목록에서 037·040·044가 빠져 있다 |
| W2-5 | 서버 DB에 `note_index.content`, `note_texts.content`, **`note_versions.content`** 평문이 존재한다 | **부분일치** | [확인] `note_index`와 `note_texts`는 맞다. 그러나 `038_note_texts.sql:42`가 `note_versions.content`의 `NOT NULL`을 해제했고, 현재 쓰기 경로 `S/src/versions/capture.ts:168-171`은 `storeNoteText(...)` 후 `INSERT INTO note_versions (…, content, …) VALUES ($1,$2,NULL,…)`로 **NULL**을 넣는다. 신규 버전의 평문은 `note_texts`에 있고, `note_versions.content`에는 038 이전의 레거시 행만 평문을 가진다(`038` 헤더 주석 "Existing rows keep their inline content"). 같은 이유로 `vault_checkpoint_docs.content`(016:43, 038:43)도 레거시만 해당한다. 결론("서버 DB에 평문 있음")은 유지된다. |
| W2-6 | 기본 볼트 루트 `~/Documents/Baalda Vaults` (`commands.rs:1006-1014`) | **일치** | [확인] `commands.rs:1006-1015` `default_vaults_root` → `home.join("Documents").join(DEFAULT_ROOT_DIR_NAME)`, doc 주석 "`<home>/Documents/Baalda Vaults`" |
| W2-7 | 디바운스 150/300 ms, CRDT 압축 64 (`bridge/types.ts:207-209`), 키체인 서비스 (`keychain.rs:30`) | **일치** | [확인] `types.ts:207-209` `ingestDebounceMs:150, egestDebounceMs:300, compactThreshold:64`; `keychain.rs:30` `pub const SERVICE: &str = "com.baalda.context"` |
| W2-8 | 1.27 GB 인덱스와 900 MB 사고 주석, at-rest 암호화 미구현 (`STATUS.md:255`) | **일치** | [확인] `index.rs` 주석에 "~86,370 wikilinks", "2,025,307 rows", "503 MB", "1.27 GB"(`:1479-1481`) 및 `:2682` "953 such docs inside a 900 MB index.sqlite"; `docs/STATUS.md:255` "- [ ] libSQL at-rest encryption …" |

- 참고(판정 대상 외) [확인]: W2 §2.1은 `checks.rs`를 "통계·무결성 점검(Vault Health)"이라 적었다. CLAUDE.md에 따르면 Vault Health **탭**은 2026-10-04에 제거됐다. 명령 `vault_checks`(`lib.rs` 등록)와 `D/src/lib/health/`는 남아 있으므로 틀린 서술은 아니다. 다만 "Health 탭" UI가 있다고 오해될 수 있다.

## W3-search — 7항목, 실패 0

| # | 주장 | 판정 | 근거 |
|---|---|---|---|
| W3-1 | 로컬 검색은 접두어 AND, OR 연산자 미지원 | **일치** | (b)와 같다. `Quick OR fox` → `"Quick"* AND "OR"* AND "fox"*` |
| W3-2 | 서버 B(HTTP)와 C(MCP)는 같은 `searchNoteIndex`를 쓴다 | **일치** | [확인] `S/src/http/routes/graph.ts:6` `import { searchNoteIndex }`, `:134` 호출; MCP는 `service.ts`에서 같은 함수를 쓴다(W3 인용 `:1233-1240`; 이번 검증에서는 `:1213` k 제한 줄만 재확인) |
| W3-3 | 점수 = cosine + 0.1 × 일치 토큰 비율, `position()` 부분문자열, 0점 컷오프 없음 | **일치** | [확인] `indexer.ts:384-388` `position(t.tok IN lower(coalesce(ni.title,'') || ' ' || ni.content)) > 0`, `:399-401` `sim + boost`, `:422` 컷오프 없는 `sort/slice` |
| W3-4 | HTTP는 `q` trim 후 비면 400, k 기본 10·최대 100; MCP는 k 최대 50 | **일치** | [확인] `graph.ts:116-119` `trim()` / `400` / `Math.min(kRaw,100)`; `service.ts:1213` `Math.min(Math.trunc(k), 50) : 10` |
| W3-5 | MCP `reqStr`은 길이 0만 거부하므로 공백만 있는 질의가 통과한다 | **일치** | [확인] `S/src/mcp/tools.ts:91-97` `typeof v !== "string" || v.length === 0`만 검사 |
| W3-6 | 제목 파생은 frontmatter title → 첫 H1 → stem, PDF는 Unsupported, TS PDF 추출 write-back 경로 없음 | **일치** | [확인] `parse.rs:224-237` `derive_title`; `extract.rs:7-10,76,116` PDF는 "TS opt-in" / `Unsupported`; `grep -rn 'store_file_text|set_file_text|setFileText' D/src D/src-tauri/src`는 Rust `extract_worker.rs:294`·`index.rs`만 나오고, `getTextContent|pdfjs`를 쓰는 TS 파일은 0건 |
| W3-7 | graph.ts 주석 "Owner/admin … see everything"은 실제 권한 함수와 다를 수 있다 | **일치**(주석 존재 확인) | [확인] `graph.ts:123` 주석 "Owner/admin + Open vaults see everything." 실제 판정은 `:128` `vaultAccess(pool, …)`. W3의 "역할만으로 private vault 전부를 읽는 것은 아니다"는 CLAUDE.md의 `vaultBaseline`/sealed 규칙과도 정합한다. [추정](신뢰도 중) `vault-docs.ts` 내부 분기 줄번호(`:35-48` 등)는 재열람하지 않았다. |

## W5-mcp-connect — 9항목, 실패 3

| # | 주장 | 판정 | 근거 |
|---|---|---|---|
| W5-1 | MCP 툴 22개, CLAUDE.md는 18개(액세스 툴 4종 누락)로 문서와 코드가 어긋남 | **일치** | [확인] `grep -oE 'name: "[a-z_]+"' S/src/mcp/tools.ts | sort -u` → 22개(`get_access_default, set_access_default, list_resource_access, manage_access` 포함); `CLAUDE.md:824` 목록은 18개 |
| W5-2 | `PROTOCOL_VERSION="2025-06-18"`, 메서드는 `initialize/ping/tools/list/tools/call`뿐 | **일치** | [확인] `S/src/mcp/protocol.ts:18,86,96,99,110` |
| W5-3 | Baalda의 현재 방식(설치된 CLI spawn)은 Claude Code 약관 허용 조항에 부합하며 "안전한 쪽"이다 | **부분일치** | [확인] 원문의 허용 조항("Nor does it prevent an end user from signing in to the unmodified Claude Code binary …")은 실재한다. 그러나 같은 페이지의 "Can customers offer Claude Code in their products?" 절은 "preinstalling **or running** Claude Code in your products or services … **requires agreeing to our Commercial Terms of Service** and complying with the conditions below"라고 쓴다. 조건은 바이너리 무수정, 인증 수단 제거·제한 금지, 사용량 대납·재판매·중개 금지다. W5는 이 조건들을 일반 금지 목록처럼 나열했고(§1.1(b) 마지막 행, §4 체크리스트), "제품에서 Claude Code를 실행하려면 Commercial Terms 동의가 필요하다"는 전제를 빠뜨렸다. Baalda `agent_runner.rs`는 사용자가 설치한 CLI를 무수정으로 실행하고 사용자 본인이 인증하므로 조건 자체는 충족하는 구조다([확인] `agent_runner.rs:2` "No shell, credential files …"). 그래도 "안전"이라는 결론에는 **Commercial Terms 적용 여부를 법무가 확인해야 한다**는 단서가 필요하다. [추정](신뢰도 중) `--restricted --safe-mode --setting-sources ""`가 "인증 수단 제한"에 해당하는지는 문구상 불명확하다(인증 플래그가 아니라 설정·도구 제한이므로 해당하지 않을 가능성이 높다). |
| W5-4 | Claude는 `--strict-mcp-config {"mcpServers":{}}`로 MCP를 차단한다 | **부분일치** | [확인] 결론(MCP 차단)은 맞다. 실제 인자는 `--strict-mcp-config`(값 없는 플래그) + `--mcp-config {"mcpServers":{}}`이다(`agent_runner.rs:721-723`, 테스트 `:1405`). W5 §2.3과 §3.3의 표기는 두 플래그를 하나로 합친 것으로, 그대로 복사해 실행하면 틀린 명령이 된다. |
| W5-5 | SIWC 엔드포인트 "`https://auth.openai.com/api/accounts/authorize`·`/oauth/token`" | **부분일치** | [확인] 원문의 토큰 엔드포인트는 `https://auth.openai.com/api/accounts/oauth/token`이다. W5 표기는 `/api/accounts/authorize`를 기준으로 상대 경로처럼 읽히면 `…/api/accounts/oauth/token`이 되지만, 절대 경로로 읽으면 `https://auth.openai.com/oauth/token`이 된다. 구현자가 혼동할 수 있으므로 전체 URL로 고쳐야 한다. 나머지(`dynamic_agent_client`, 127.0.0.1 전용, secret 불필요, scope, resource)는 일치한다. |
| W5-6 | MCP 스펙 2026-07-28: `initialize` 제거(stateless), DCR deprecated → CIMD, `iss` SHOULD/MUST, `server/discover` | **일치** | [확인] https://modelcontextprotocol.io/specification/2026-07-28/changelog: Major 2 "remove the `initialize`/`notifications/initialized` handshake", Major 3 "servers MUST implement" `server/discover`, Minor 7 `iss` 응답 SHOULD + 클라이언트 MUST 검증, Minor 8 DCR `application_type`, Deprecated 4 "Deprecate the OAuth 2.0 Dynamic Client Registration Protocol … in favor of Client ID Metadata Documents"(하위호환용으로는 유지). 덧붙이면 같은 스펙이 `ping`도 제거한다(Major 5). Baalda는 `ping`을 구현하고 있다(`protocol.ts:96`). W5의 부채 목록에 이 항목이 빠져 있지만 오류는 아니다. |
| W5-7 | 401 응답의 `WWW-Authenticate`에는 `resource_metadata`만 있고 `?key=`/`?token=` 쿼리 토큰을 허용하며, OAuth 연결은 행이 없다 | **일치** | [확인] `S/src/http/routes/mcp.ts:42` `Bearer resource_metadata="…"`(scope 없음), `:127` `c.req.query("key") ?? c.req.query("token")`, `:222` "OAuth has no row" |
| W5-8 | 동의 화면은 `prompt=consent`를 강제하고 허용/거부 2택이며 읽기 전용 옵션이 없다 | **일치** | [확인] `S/src/http/routes/oauth-connect.ts:47-48,61` `prompt=consent` 강제, `:210-211` `Deny` / `Allow access` 버튼뿐 |
| W5-9 | MCP 탭이 `claude mcp add --transport http context <url> --header "Authorization: Bearer …"`를 보여준다 (`VaultSettingsDialog.tsx:1980`) | **일치** | [확인] `D/src/components/VaultSettingsDialog.tsx:1979-1980` |

- 미검증으로 남긴 W5 주장 [추정]: Claude 커스텀 커넥터의 "Free 1개 제한", ChatGPT 개발자 모드의 플랜 요건, GitHub star 수치, Smithery·Pipedream 인수 보도는 이번에 다시 열람하지 않았다. 결론을 좌우하지 않는 주변 사실이라 표본에서 제외했다.

---

## (h) 보고서 간 상충

| # | 상충 지점 | 판정 | 근거 / 해소 |
|---|---|---|---|
| h-1 | W1 "Tauri 명령 114개" vs W2 "`commands.rs` 명령 80개" | **실질 상충 아님, W2 수치 오류** | [확인] 114는 9개 모듈 전체, `commands.rs`만 세면 90이다(§W2-2). 두 수치 모두 정의를 밝혀 적어야 한다. |
| h-2 | W2 "`note_versions.content` 평문" vs 실제 저장 경로 | W2 단독 부분 오류 (W3와 상충 없음) | [확인] W3는 `note_index`만 언급해 정확하다. W2의 "서버 평문 존재" 결론은 W3와 일치하며, 위치 서술만 정정하면 된다(§W2-5). |
| h-3 | W2 §1(D-8)·§2.4 "서버 시맨틱 검색" 기술 vs W3 "SearchPanel은 서버 검색을 호출하지 않음" | **상충 없음** | [확인] W2는 서버 기능의 존재만 기술했다. W3가 데스크톱에 호출자가 없음을 밝혔고 (c)로 재확인했다. 종합 단계에서는 "서버 검색 = MCP 전용 경로"로 정리해야 한다. |
| h-4 | W1 "설치본에서 `api.baalda.com` 미발견" vs W2·W5 "소스 기본 서버 = api.baalda.com" | **상충 없음** | [확인] W1 스스로 "설치본 기본값은 미확인"으로 한정했다. 프론트엔드가 압축 임베드됐으므로 평문으로 검색되지 않는 것이 자연스럽다([추정](신뢰도 상)). |
| h-5 | W2 "SQLite 실측 3.54.0" vs W3 "실측은 Python SQLite 3.53.0" | **상충 없음** | 서로 다른 실측 도구(OS CLI와 Python 모듈)다. 앱 번들의 rusqlite 내장 SQLite 버전은 두 보고서 모두 미확인이다. |
| h-6 | W5 "Baalda는 MCP 클라이언트가 아니다(외부 커넥터 없음)" vs W2 "agent_runner = 설치 CLI 실행" | **상충 없음** | [확인] (e)대로 CLI 실행 시 MCP를 비운다. 두 보고서가 같은 사실을 다른 각도에서 기술했다. |
| h-7 | W3 "owner/admin이라는 역할만으로 private vault 전체를 읽지 않음" vs `graph.ts:123` 주석 "Owner/admin … see everything" | **코드 내부 주석 불일치**(보고서 간 상충 아님) | [확인] W3가 이미 지적했다. 종합 문서에는 주석이 아니라 `vaultAccess`/`vault-docs.ts`를 근거로 써야 한다. |

## 정정 권고 (재작업 목록)

1. **W2** §2.1 `commands.rs` 행과 §5 D-1: "명령 80개" → "명령 90개(`#[tauri::command]` 80 + `(async)` 10); 앱 전체 등록 114개". [확인] §W2-2
2. **W2** §3.2(a) 파생 텍스트 행과 D-3: `note_versions.content`는 038 이후 신규 행이 NULL이고 평문은 `note_texts`(sha 참조)에 저장된다는 점을 명시하고, `vault_checkpoint_docs`도 같은 구조임을 덧붙인다. [확인] §W2-5
3. **W5** §1.1(b), §1.1 종합 판정, §4 체크리스트: "제품에서 Claude Code를 실행하는 경우 Commercial Terms 동의 + 조건 3가지"를 전제로 명시하고, "안전"을 "조건 충족 구조, 법무 확인 필요"로 낮춘다. [확인] §W5-3
4. **W5** §2.3·§3.3: 플래그를 `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`로 정정. [확인] §W5-4
5. **W5** §1.1(a): 토큰 엔드포인트를 `https://auth.openai.com/api/accounts/oauth/token` 전체 URL로 쓴다. 선택 사항으로 2026-07-28 스펙의 `ping` 제거를 부채 목록에 추가한다. [확인] §W5-5, §W5-6
6. W1·W3: 재작업 불필요.
