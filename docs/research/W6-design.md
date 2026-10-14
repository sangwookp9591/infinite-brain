# W6 — infinite-brain(가칭) 종합 설계

- 작성일 2026-10-14 · 작성: W6 종합 설계자 · 저장소 `/Users/iron/Project/psw/baalda`는 **읽기만 했고 수정하지 않았다**.
- 원자료: `W1-rea.md`, `W2-architecture.md`, `W3-search.md`, `W4-deep-research.json`(summary·findings·caveats·refuted), `W4b-market.md`, `W5-mcp-connect.md`, `G1-verify.md`. 모두 같은 폴더에 있다. 아래에서는 `W2 §3` 형태로 인용한다.
- **G1 정정 사항을 반영했다.** ① `commands.rs` 명령은 90개(`#[tauri::command]` 80 + `(async)` 10)이고 앱 전체 등록은 114개다. ② `note_versions.content`는 038 이후 신규 행이 NULL이고 평문은 `note_texts`에 있다(`vault_checkpoint_docs`도 같다). ③ 제품 안에서 Claude Code를 실행하려면 **Commercial Terms 동의 + 조건 3가지**가 필요하므로 "약관상 안전"이 아니라 "조건을 충족하는 구조이며 법무 확인이 필요하다"로 쓴다. ④ MCP 차단 플래그는 `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`다. ⑤ SIWC 토큰 엔드포인트는 `https://auth.openai.com/api/accounts/oauth/token`이다. ⑥ 2026-07-28 스펙에서 `ping`이 제거됐다.
- 태그: **[확인]** = 파일:줄, 실행 출력, URL, 원자료의 [확인] 항목. **[추정]** = 근거와 신뢰도(상/중/하). 원자료의 태그는 그대로 옮겼다.
- 경로 약어: `D/` = `app/apps/desktop`, `S/` = `app/apps/server`

---

## 0. 결론 요약

1. **판정은 하드 포크다(신규 구축 아님).** Baalda의 핵심 자산인 md↔Y.Text 브리지, doc_id 체계, 권한 리졸버, MCP+OAuth 서버는 Apache-2.0이다. 시장 조사에서 "아무도 입증하지 못한 조합"(W4b G1·G2)이 바로 이 자산의 조합과 겹친다. 다시 만들면 몇 달짜리 일이다. [확인](LICENSE, `ee/README.md`) / 기간은 [추정](중)
2. **차별점은 기능 하나가 아니라 조합이다.** 조합은 세 가지다. (a) 로컬 .md 그대로 팀 실시간 공동편집, (b) 각자 쓰는 Claude/ChatGPT를 터미널 없이 "URL+로그인"으로 연결하되 읽기 전용 같은 권한 범위를 고를 수 있음, (c) AI가 바꾼 내용이 연결 단위로 기록되고 되돌릴 수 있음. "MCP 지원"만으로는 차별점이 되지 않는다. Slite·Granola·Notion·Tela·Onyx가 이미 제공한다. [확인](W4b §2, §5, §7 "빈 곳이 아닌 것")
3. **6주 MVP는 5개다.** ① AI 연결 마법사와 scope 커넥터, ② AI 변경 원장과 되돌리기, ③ 5분 팀 온보딩, ④ 한국어 검색 결함 수정(위생 작업), ⑤ 설치된 CLI로 노트 작업(**법무 확인 통과 시에만**). SIWC(ChatGPT 로그인), 진짜 벡터 검색, 웹 클라이언트, 노코드 MCP 생성은 2~3단계로 미룬다. [추정](채점표 §2 근거)
4. **가장 큰 미검증 가정은 수요다.** 하나는 "팀이 Relay($5~6)·Notion 대신 이것으로 옮길 만큼의 차이"이고, 다른 하나는 "비개발자가 실제로 커넥터 연결을 끝까지 해내는가"다. 한국어 검색 수요는 입증되지 않았다(직접 불만 0건). [확인](W4b §4, §7)

---

## 1. Baalda 진단

### 1.1 동작 원리 요약

| 요소 | 동작 | 근거 |
|---|---|---|
| 진실의 원천 2개 | 디스크 `.md`가 **내구 원천**이다. 노트가 열려 있거나 동기화 중일 때는 노트별 `Y.Doc`의 `Y.Text("content")`(원시 마크다운 문자열)가 **라이브 원천**이다. 브리지가 양방향으로 맞춘다 | [확인](CLAUDE.md "The one idea"; W2 §2.2 `bridge/noteBridge.ts`) |
| Ingest(디스크→CRDT) | 150ms 디바운스로 현재 직렬화와 파일을 diff-match-patch로 비교하고, 그 결과를 `Y.Text` insert/delete 연산(`ORIGIN_DISK`)으로 적용한다. diff 비율이 0.6을 넘으면(AI 전체 재작성 등) 복구 스냅샷을 먼저 뜬다 | [확인](`bridge/types.ts:207-209`; W2 §4.2) |
| Egest(CRDT→디스크) | 300ms 디바운스. 쓰기 **전에** `lastWrittenHash`를 정하고 temp+rename으로 원자적으로 쓴다. Rust가 쓰기 시점에 재색인한다 | [확인](W2 §4.1, G1 W2-7) |
| 루프 차단 가드 2개 | `onTextChange`는 disk-origin 트랜잭션을 무시한다. 해시가 `lastWrittenHash`와 같은 파일 읽기는 자기 에코로 보고 버린다 | [확인](CLAUDE.md "Loop avoidance") |
| doc_id | `.md`, Y.Doc, SQLite `notes.id`, Postgres `notes/files.id`가 같은 UUID를 쓴다. 이름 변경이나 이동이 노트를 갈라놓지 않는다 | [확인](CLAUDE.md 불변식 1; W2 §3.1(c)) |
| 서버 저장 | **전송**되는 것은 바이너리 Yjs 업데이트뿐이다(`doc_updates`, `doc_snapshots`). 그러나 서버 DB에는 **파생 평문**이 있다: `note_index.content`(+`vector JSONB`), `note_texts.content`(038 이후 버전 평문), `blob_text.content`. `note_versions.content`·`vault_checkpoint_docs.content`는 038 이전 레거시 행에만 평문이 있다 | [확인](G1 (d), W2-5; `005_join_codes_and_index.sql:16-22`, `038_note_texts.sql:31-35,42`, `028_blob_text.sql:34-47`, `versions/capture.ts:168-171`) |
| 검색 3경로 | **A** 데스크톱 SearchPanel → Rust FTS5(`unicode61`), 접두어 AND, BM25. **B** 서버 `GET /vaults/:id/search` → `searchNoteIndex`(256차원 해시 BoW + ASCII 부분문자열 가산점). **데스크톱에 호출자가 없다.** **C** MCP `search_notes` → B와 같은 함수. 결국 서버 검색은 사실상 **MCP 전용 경로**다 | [확인](G1 (b)(c), W3-2, h-3; `SearchPanel.tsx:42`, `index.rs:3154-3170`, `graph.ts:108,134`) |
| AI 접점 | (1) 원격 MCP `POST /api/mcp`: 22개 툴, 노트별 ACL, `createDocWriter`로 CRDT에 합류해 사람 편집처럼 전파된다. (2) OAuth 2.1+DCR+PKCE: claude.ai/ChatGPT 커스텀 커넥터가 이미 접속할 수 있다. (3) `agent_runner.rs`: 사용자가 설치한 `claude`/`codex` CLI를 무수정으로 실행한다. MCP는 비우고, 현재 용도는 대시보드 갱신뿐이다. (4) Assistant(housekeeper): 사용자의 OpenRouter 키로 진단·수리를 제안하고, 승인·적용·되돌리기를 거친다 | [확인](W5 §2.1~2.4, G1 (e)(f), W5-1) |
| 규모 | Tauri 명령 앱 전체 114개(`commands.rs` 90개). 비테스트 코드는 TS 109,454줄, Rust 23,139줄, 서버 TS 41,879줄. 테스트 파일 478개 | [확인](G1 W1-4, W2-2; W2 §1) |

### 1.2 강점

| # | 강점 | 근거 |
|---|---|---|
| S1 | **이 카테고리의 공백(W4b G1)에 가장 가까운 OSS 구현이다.** 로컬 .md 소유, 키 입력 단위 실시간 공동편집, 폴더·노트 단위 권한, 셀프호스트를 한 제품에 갖췄다. 경쟁 OSS는 사람 사이 동기화를 git 지연으로 하거나(OpenKnowledge, Onyx, Isomorphic) 서버 우선이다(Tela) | [확인](W4b §5 표) / "가장 가깝다"는 [추정](중: 경쟁 제품은 README 자기서술만 확인) |
| S2 | **AI와 사람이 같은 CRDT 층에서 편집한다.** MCP 쓰기가 Hocuspocus 라이브 문서에 transact되고, 열려 있지 않은 문서는 detached 적용 후 영속된다. 외부 프로세스의 디스크 편집도 diff 연산으로 병합되어 덮어쓰기가 일어나지 않는다 | [확인](W5 §2.1 `doc-writer.ts:118-210`; W2 §4.2) |
| S3 | **데이터 손실 방어가 촘촘하다.** 원자적 쓰기, 대량 삭제 상한, 0바이트 파일이 내용을 지우지 못하는 가드, 복구 휴지통, shrink-guard 버전, 30일 휴지통, 체크포인트가 있다 | [확인](W2 §5 "강점"; CLAUDE.md) |
| S4 | **권한 모델이 세밀하고 모든 경로에 일관되게 적용된다.** `effectivePermission`이 MCP·검색·블롭·동기화 토큰에 같이 쓰이고, 검색은 후보를 SQL WHERE로 먼저 제한한다(점수 매긴 뒤 거르지 않는다) | [확인](W3 §C; CLAUDE.md permissions) |
| S5 | **원격 커넥터 연결에 필요한 기술이 이미 있다.** PRM, AS 메타데이터, DCR, PKCE S256, 볼트 선택 동의 화면이 운영 서버에서 응답한다 | [확인](G1 (f) 실측) |
| S6 | 약관을 의식한 AI 실행 구조다. 설치된 CLI를 무수정으로 실행하고, 자격증명 파일을 건드리지 않으며, 네트워크·MCP·셸을 막는다 | [확인](G1 (e)) / 약관 충족 여부는 [추정](중, §4.3) |
| S7 | 라이선스 경계가 명확하다. `ee/` 밖은 Apache-2.0, `ee/`는 별도 상용이다. 브랜드는 `brand.ts` 2곳과 명시된 목록에만 있다 | [확인](`ee/README.md`, `docs/BRANDING.md` Layer 1) |
| S8 | 설치본이 40MB 단일 바이너리다. 서명·공증 파이프라인도 있다 | [확인](W1 §1, W2 §0) |

### 1.3 단점

| # | 단점 | 영향 | 근거 |
|---|---|---|---|
| W-1 | **핵심 로직이 거대 파일에 몰려 있다.** `docSession.ts` 7,555줄, `registry.ts` 5,842줄, `index.rs` 5,127줄, `commands.rs` 3,999줄(명령 90개). 삭제 유예, 상한, 회수 7조건 같은 규칙이 얽혀 있다 | 포크 팀의 학습·회귀 비용이 크다 | [확인](W2 D-1, G1 W2-1·W2-2) |
| W-2 | **CLAUDE.md(991줄)가 사실상 명세다.** 수동 락스텝 계약이 많다(`ALLOWED_EXTS`↔`formats.ts`, `TAG_RE`↔`hashtag.ts`, 권한 4곳) | 한 곳만 바꾸면 "보이지만 검색 안 되는 태그"나 권한 오판이 생긴다 | [확인](W2 D-2) |
| W-3 | **"서버는 바이너리만 저장한다"는 문구가 실제 저장과 다르다.** 위 1.1처럼 평문 파생 테이블이 있고, at-rest 암호화는 미구현(Phase 4)이다 | 프라이버시 민감 팀(W4b P5)에 정직하게 설명해야 한다 | [확인](G1 (d); `docs/STATUS.md:255`) |
| W-4 | **한국어 검색 결함.** 로컬 A는 어절 앞부분만 찾는다(`검색기능과`에서 `기능`은 못 찾음). 서버 B/C는 한글 토큰을 버려 순수 한글 질의가 전부 0점이 되고, 0점을 거르지 않아 **무관한 top-k를 성공처럼 반환**한다 | 한국어 사용자에게 MCP 검색이 틀린 답을 준다(AI가 엉뚱한 노트를 근거로 쓴다) | [확인](G1 (a)(b); W3 실측 표) / 체감 영향은 [추정](상) |
| W-5 | **진짜 의미 검색이 없다.** 256 버킷 해시 BoW이고, `setEmbedder`는 호출자가 없으며, ANN 인덱스도 없다. 파일 후보는 앞의 2,000개로 잘린다 | AI 검색 품질의 천장이 낮다 | [확인](G1 (a); W3 §B·§C) |
| W-6 | **MCP가 스펙 2025-06-18 기준이다.** `initialize`/`ping`이 있고 CIMD·`iss`·자체 scope가 없다. `?key=` 쿼리 토큰을 허용하고, 동의 화면은 허용/거부 2택뿐이며 읽기 전용이 없다. OAuth 연결은 목록에 보이지 않는다 | 비개발자의 불안("AI가 지우면?")을 해소할 장치가 없다. 2026-07-28 스펙 대비 부채다 | [확인](G1 W5-2, W5-6, W5-7, W5-8) |
| W-7 | **비개발자 연결 UX가 터미널 기준이다.** MCP 탭은 토큰과 `claude mcp add …` 명령을 보여준다 | 마찰이 시장 페인 P3와 직결된다 | [확인](G1 W5-9; W4 findings #1~3) |
| W-8 | **데스크톱 전용이다.** 웹 클라이언트가 없고 공유는 공개 읽기 전용 링크(`/p/:token`)뿐이다. 게스트·댓글이 없다 | 외부 협력자나 모바일 사용자 온보딩이 어렵다 | [확인](`S/src/http/routes/public-links.ts:26-28`) / 수요는 [추정](중) |
| W-9 | **음성은 무전기(PTT)뿐이다.** `lib/voice/`는 16kHz PCM16 실시간 송수신만 하고 녹음 전사·회의록이 없다 | 회의록 기능은 처음부터 새로 만들어야 한다 | [확인](`D/src/lib/voice/capture.ts:1-2`, `pcm.ts` 헤더) |
| W-10 | 확장성 가정: 단일 Node 프로세스, Redis는 선택, 힙 512MB, 블롭 25MB 상한. 클라이언트 `index.sqlite`가 1.27GB까지 커진 사고 기록이 있다 | 팀이 커지면 운영 부담이 생긴다 | [확인](W2 D-4, D-5) |
| W-11 | 레거시 호환 부채(`ContentUploader` fallback, 과금 vault/team 이중 모델, 구 402 코드)와 로컬 스키마 버전 관리 부재 | 포크 직후 정리 대상이다 | [확인](W2 D-7, D-9) |
| W-12 | 상표: TRADEMARK가 **"Baalda"와 "Context" 두 이름**을 보호한다. 번들 ID `com.baalda.context`, 스킴 `baalda://`, 업데이터 URL, `PRODUCTION_SERVER_URL=https://api.baalda.com`, 서명 인증서가 모두 원 프로젝트 것이다 | 포크하면 반드시 바꿔야 할 목록이 생긴다(§4.2) | [확인](`TRADEMARK.md:15`, `tauri.conf.json:5,54-61`, `D/src/lib/api.ts:58`) |

---

## 2. 기능 후보 채점표

**채점 규칙.** 각 기준을 1~5점으로 매긴다. 가중합 = 0.30×페인 + 0.25×차별성 + 0.20×구현비용 + 0.15×비개발자 친화 + 0.10×약관/보안 위험.
**구현비용**과 **약관/보안 위험**은 "높을수록 유리"(5 = 싸다 / 안전하다) 방향으로 매겼다. 점수 자체는 모두 판단이므로 [추정]이다. 근거 줄의 사실은 원자료의 태그를 따른다.

| 순위 | 후보 | 페인 30% | 차별성 25% | 비용 20% | 비개발자 15% | 위험 10% | **가중합** |
|---|---|---|---|---|---|---|---|
| 1 | **M. 로컬 .md 팀 실시간 협업의 "설정 없는" 온보딩**(기존 코어 재포장) | 5 | 3 | 4 | 4 | 4 | **4.05** |
| 2 | **A. AI 연결 마법사 + scope(읽기/쓰기/삭제) 커넥터 + 연결 목록** | 4 | 3 | 4 | 5 | 5 | **4.00** |
| 3 | **I. AI 변경 원장·승인·되돌리기 레이어** | 3 | 4 | 3 | 4 | 5 | **3.60** |
| 4 | C. 로그인 AI 연결 — SIWC(ChatGPT), 데스크톱 로컬 전용 | 4 | 4 | 2 | 5 | 2 | **3.55** |
| 5 | B. 로그인 AI 연결 — 설치된 Claude Code/Codex CLI로 노트 작업 | 4 | 3 | 4 | 2 | 3 | **3.35** |
| 6 | L. 팀 공용 에이전트 지침·메모리(볼트가 정본, MCP prompts/resources로 배포) | 2 | 4 | 4 | 3 | 4 | **3.25** |
| 7 | J. 사이드패널 AI(현재 노트·선택 영역 문맥 → diff 제안) | 3 | 2 | 3 | 5 | 3 | **3.05** |
| 7 | F. 팀 공유링크·게스트(좌석 없는 뷰어/댓글) | 3 | 2 | 3 | 5 | 3 | **3.05** |
| 9 | N. 서버 평문 최소화·at-rest 암호화(E2E 아님) | 3 | 2 | 3 | 3 | 5 | **2.95** |
| 10 | G. 웹 클라이언트 | 3 | 2 | 1 | 5 | 3 | **2.65** |
| 11 | D. 진짜 벡터·하이브리드 검색 + 한국어 | 2 | 2 | 3 | 4 | 3 | **2.60** |
| 12 | H. 회의록·음성 전사 | 3 | 1 | 2 | 4 | 2 | **2.35** |
| 13 | K. 템플릿/대시보드 마켓 | 1 | 2 | 3 | 4 | 2 | **2.20** |
| 14 | E. 노코드 MCP/커넥터 생성(우리가 MCP 클라이언트) | 2 | 2 | 1 | 3 | 2 | **1.95** |

### 점수 근거 (각 칸 한 줄)

**M. 설정 없는 팀 온보딩**
- 페인 5: 이번 표본에서 가장 일관된 페인은 로컬 .md 도구의 다인 동시편집 불가·충돌이다(독립 출처 약 10개, 강도 상). "Obsidian doesn't do team." [확인](W4b P1, HN 48675435)
- 차별성 3: 소규모 팀에는 Obsidian+Relay($5~6)가 이미 답이다. P1이 반복되는 원인은 인지·설정·가격 경계일 수 있다. [확인](W4b §2 Relay 가격) / 원인은 [추정](중, W4b §7)
- 비용 4: 기능은 이미 있다(초대, 가입 코드, 접근 보드, 볼트 채널). 일은 흐름을 재포장하는 것이다. [확인](CLAUDE.md members/orgs) / 공수는 [추정](중)
- 비개발자 4: 셀피쉬클럽은 비개발자 9명에게 GitHub 워크숍이 필요했다. 앱 설치와 초대만으로 끝나면 이 장벽이 사라진다. [확인](W4b §4) / 효과는 [추정](중)
- 위험 4: 새 외부 노출이 없다. 초대 링크 유출만 관리하면 된다. [추정](상)

**A. AI 연결 마법사 + scope 커넥터**
- 페인 4: 비개발자의 AI 연결 마찰(JSON, 경로, 모호한 오류)은 독립 출처 약 8개, 강도 중~상이다. 다만 원격 커넥터와 .mcpb로 이미 완화됐을 수 있다. [확인](W4 findings #1~3, caveats; W4b P3)
- 차별성 3: MCP 노출 자체는 기본기다(Slite Basic, Granola Business). 차별 지점은 "읽기 전용 선택 + 기존 폴더 권한 상속 + 연결 목록·해제"를 비개발자 UX로 묶는 것이다. [확인](W4b §2) / 차별 지점 판단은 [추정](중)
- 비용 4: OAuth·DCR·PKCE·동의 화면이 있고 `TOOL_CATALOG`에 read/write/destructive 분류가 있다. 새로 할 일은 scope 정의, UI, 목록 통합이다. [확인](W5 §3.1; G1 (f))
- 비개발자 5: Claude는 "커스텀 커넥터에 URL 붙여넣기 + 로그인"으로 끝난다(토큰 불필요). 단 ChatGPT는 Developer mode가 필요하고, OpenAI가 "dangerous, intended for developers"라고 표기한다. [확인](W5 §1.1(b); W4 finding #3 high)
- 위험 5: 공식 커넥터 경로이고 권한을 줄이는 방향이다. [확인](W5 §1.1)

**I. AI 변경 원장·승인·되돌리기**
- 페인 3: 에이전트 쓰기 안전성(diff, undo, 승인) 신호는 약 5개이고 강도 중이다. 대부분 제작자 쪽 서술이고 사용자의 직접 불만은 약하다. [확인](W4b P7, 🔶 표기)
- 차별성 4: "실시간 다인 편집 중 에이전트 변경을 한 화면에서 되돌리는 제품"은 확인되지 않았다(W4b G6). OpenKnowledge는 로컬 개인 범위, Isomorphic은 git PR이다. [추정](중하, W4b §7)
- 비용 3: 재사용할 수 있는 것이 있다. housekeeper preview/apply/undo, `DocWriter.editContent` + revision 가드, `note_versions.created_by`, shrink-guard. 신규는 연결 ID 귀속 필드, 원장 테이블, UI다. [확인](W5 §2.4; `016_versioning.sql:32`) / 공수는 [추정](중)
- 비개발자 4: "되돌리기" 버튼은 누구나 이해한다. diff 화면은 단순화가 필요하다. [추정](중)
- 위험 5: 위험을 줄이는 기능이다. [추정](상)

**C. SIWC(ChatGPT 로그인)**
- 페인 4: Notion AI 번들 반발(P2, 강도 상)과 BYO 수요(G4)가 있다. 내 ChatGPT 플랜으로 앱 안 AI를 쓰면 좌석 번들 없이 해결된다. [확인](W4 #4~5; W4b P2) / 연결은 [추정](중)
- 차별성 4: 팀 노트 앱이 SIWC를 채택한 사례는 이번 자료에서 확인되지 않았다. [추정](중하: 조사 범위 한정)
- 비용 2: 새 OAuth 클라이언트(`dynamic_agent_client`, `ext_agent_host_id`, PKCE+nonce+JWKS)와 Responses 스트리밍 어댑터가 필요하다. 루프백 리스너(`oauth.rs`)만 재사용할 수 있다. [확인](W5 §3.2)
- 비개발자 5: 버튼 로그인이다. [확인](SIWC sign-in 흐름, G1 g-2)
- 위험 2: 프리뷰이고 범위가 "open-source and locally hosted apps"다. **유료나 원격 호스팅이면 범위 밖이라 관심 폼을 거쳐야 한다.** 호스티드 MCP·file search가 미지원이다. [확인](G1 g-2)

**B. 설치 CLI로 노트 작업**
- 페인 4: C와 같은 BYO 수요다. 구독자는 키 없이 쓸 수 있다. [추정](중)
- 차별성 3: OpenKnowledge가 이미 "설치된 Claude/Codex 사용"을 내세운다. [확인](W4b §2·§5)
- 비용 4: `agent_runner.rs`에 탐지, 로그인 상태, 샌드박스, 스트림, 취소가 있다. `dashboard_path` 필수 제약을 "작업 대상 경로 집합"으로 일반화하면 된다. [확인](W5 §2.3, §3.2)
- 비개발자 2: 사용자가 CLI를 설치하고 터미널에서 로그인해야 한다. [확인](W5 §3.2 "로그인 명령은 사용자가 실행")
- 위험 3: Anthropic은 제품에서 Claude Code를 실행하는 데 **Commercial Terms 동의**와 조건(바이너리 무수정, 인증 수단 제거·제한 금지, 사용량 대납·재판매·중개 금지)을 요구한다. 구조는 조건을 충족하지만 법무 확인이 필요하다. `--restricted --safe-mode`가 "인증 수단 제한"에 해당하는지는 문구상 불명확하다. [확인](G1 W5-3) / 해석은 [추정](중)

**L. 팀 공용 에이전트 지침·메모리**
- 페인 2: 신호는 약 2개이고 강도 하~중이다. 홍보성 출처뿐이다(untactit). [확인](W4b P12)
- 차별성 4: 노트 앱이 이 역할을 하는 사례는 확인되지 않았다(G7, 새 카테고리 가능성). [추정](하)
- 비용 4: 지침은 그냥 노트다. MCP `prompts`/`resources` 메서드만 추가하면 된다(현재 없음). [확인](W5 §2.1 protocol.ts 메서드 목록) / 공수는 [추정](중)
- 비개발자 3: "팀 AI 규칙 노트"라는 개념 자체를 설명해야 한다. [추정](중)
- 위험 4: 지침 노트가 프롬프트 인젝션 매개가 될 수 있다. 편집 권한으로 통제할 수 있다. [추정](중)

**J. 사이드패널 AI**
- 페인 3: Notion AI 같은 경험에 대한 기대가 있다. 다만 "workspace를 모르고 검색만 한다"는 불만도 있다(2차 인용). [추정](중, W4b §3-2)
- 차별성 2: Notion AI, Obsidian 플러그인 등에 흔하다. Aside는 노트 앱이 아니라 AI 브라우저다(경쟁 아님). [확인](W4 finding #8) / 흔함은 [추정](상)
- 비용 3: 모델 호출 경로(B, C, BYO 키 중 하나)에 의존한다. housekeeper의 diff 미리보기 패턴을 재사용할 수 있다. [확인](W5 §1.4 마지막 행)
- 비개발자 5: 에디터 옆 버튼이다. [추정](상)
- 위험 3: 경로에 따라 약관·키 보관 위험이 다르다. [추정](중)

**F. 공유링크·게스트**
- 페인 3: Notion에서 Member/Guest를 잘못 초대해 좌석 요금 사고가 난 사례가 있다. Anytype·untactit는 뷰어 무료를 내세운다. [확인](W4 finding #6; W4b §2, §4)
- 차별성 2: Anytype Business, Outline 등이 이미 한다. [확인](W4b §2)
- 비용 3: 공개 읽기 링크는 있다. 로그인 게스트는 리졸버 역할 추가와 (데스크톱 전용이므로) 웹 뷰어가 필요하다. [확인](`public-links.ts:26-28`) / 공수는 [추정](중)
- 비개발자 5: 링크 클릭이다. [추정](상)
- 위험 3: 링크 유출 위험이 있다. 현재 공개 페이지는 방어적으로 설계됐다(동일 404 등). [확인](`public-links.ts:36`)

**N. 서버 평문 최소화·at-rest**
- 페인 3: vault를 서버에 올리는 데 대한 거부감은 약 5개 출처, 강도 중이다. [확인](W4b P5)
- 차별성 2: E2E 수준이 아니면 차별점이 약하다. Anytype은 로컬 우선 E2E를 표방한다. [추정](중)
- 비용 3: 디스크·백업 암호화는 운영 영역이다. "서버 검색·AI 끄기" 모드에서 파생 평문 생성을 중지하는 것은 코드 변경이다. [추정](중)
- 비개발자 3: 체감되지 않는 기능이다. [추정](중)
- 위험 5: 위험을 줄인다. [추정](상)

**G. 웹 클라이언트**
- 페인 3: 비개발자 설치 장벽, 게스트·모바일 수요가 있다. 셀피쉬클럽은 실시간 회의 문서를 노션에 남겼다. [확인](W4b §4) / 수요 크기는 [추정](중)
- 차별성 2: Notion, Outline, Tela 모두 웹이다. [확인](W4b §2·§5)
- 비용 1: 브리지가 Rust 디스크 I/O와 SQLite 인덱스를 전제한다(`ipc.ts` 단일 표면). `docSession.ts` 7,555줄을 웹용으로 분리해야 한다. [확인](W2 §2.1~2.3)
- 비개발자 5: 설치가 없다. [추정](상)
- 위험 3: 브라우저 세션, XSS 표면이 늘어난다. [추정](중)

**D. 진짜 벡터·하이브리드 + 한국어**
- 페인 2: **한국어 검색에 대한 직접 불만은 0건이다.** 간접 신호 4개뿐이고 수요는 입증되지 않았다. 큰 워크스페이스에서 못 찾는다는 신호는 약 2개다. [확인](W4b §4, P9, P11)
- 차별성 2: Tela는 pgvector, OpenKnowledge는 내장 검색을 내세운다. 흔하다. [확인](W4b §5)
- 비용 3: 로컬 보조 인덱스는 중간 난이도다. 서버 임베딩은 제공자 선택(외부 API 또는 로컬 모델), 재인덱싱, pgvector 도입이 필요하다. [확인](W3 §검증 경계, pgvector 마이그레이션 없음: `grep pgvector migrations` 0건) / 공수는 [추정](중)
- 비개발자 4: 사용자는 그냥 검색할 뿐이다. [추정](상)
- 위험 3: 외부 임베딩 API를 쓰면 평문이 제3자에게 전송된다. [추정](상)
- **주의:** W-4의 "한국어 질의가 무관한 결과를 성공처럼 반환" 결함은 수요와 무관한 **정확성 버그**다. 그래서 D와 별개로 MVP에 소량(F4)을 넣는다.

**H. 회의록·음성**
- 페인 3: 돈을 내는 기능이다(Granola $14~35, Tana 미팅 전사, Notion AI Meeting Notes). [확인](W4b §2; W4 finding #4)
- 차별성 1: 붐비는 영역이다. [확인](같은 근거)
- 비용 2: 현재 voice는 PTT뿐이라 전사 엔진·녹음 저장이 신규다. [확인](§1.3 W-9)
- 비개발자 4: [추정](상)
- 위험 2: 녹음 동의, 음성 데이터 보관 문제가 있다. [추정](상)

**K. 템플릿/대시보드 마켓**
- 페인 1: 이번 자료에 수요 근거가 없다. [확인](W4·W4b에 해당 항목 없음)
- 차별성 2: [추정](중)
- 비용 3: `dashboard.rs` 격리 렌더링이 있다. 마켓 운영·심사가 신규다. [확인](CLAUDE.md dashboard)
- 비개발자 4: [추정](중)
- 위험 2: 실행형 HTML을 배포하는 공급망 위험이 있다. [추정](상)

**E. 노코드 MCP/커넥터 생성**
- 페인 2: W5 결론은 "MCP를 만드는 일은 비개발자의 핵심 니즈가 아니다"다. [확인](W5 §1.2 결론) / 판단은 [추정](중)
- 차별성 2: Zapier, Composio, Pipedream, n8n이 있다. [확인](W5 §1.2)
- 비용 1: MCP 클라이언트, OAuth 위임, 토큰 보관, 호출별 승인, 위협 모델이 모두 필요하다. 현재 "무MCP·무네트워크" 안전 철학과 충돌한다. [확인](W5 §3.3; G1 (e))
- 비개발자 3: [추정](중)
- 위험 2: 프롬프트 인젝션 경로가 늘고, n8n·Pipedream·Smithery는 번들할 수 없는 라이선스다. [확인](W5 §4 체크리스트)

### 채점에서 정직하게 짚을 점

- **카테고리는 이미 붐빈다.** 마크다운 + MCP + Yjs/git + 팀 조합을 내건 OSS가 2026년에 5개 이상 나왔다(OpenKnowledge, Tela, Onyx agent-wiki, Isomorphic, doci). 따라서 어떤 단일 기능의 차별성도 4를 넘기지 않았다. [확인](W4b §5 관찰 1)
- **한국어 검색은 수요가 입증되지 않았다.** 그래서 D는 하위권이다. 다만 결함 수정은 위생 작업으로 분리했다. [확인](W4b §4 결론)
- 1위 M은 "새 기능"이 아니라 이미 있는 코어를 재포장하는 일이다. **제품의 해자는 코어(S1)이고, 새로 만드는 것은 그 위의 AI 신뢰층(A·I)이다**라는 해석이다. [추정](중)

---

## 3. 포지셔닝

**한 문장 차별점**
> "내 컴퓨터의 마크다운 파일을 그대로 쓰면서 팀원과 실시간으로 함께 편집하고, 각자 쓰던 Claude·ChatGPT를 터미널 없이 로그인으로 붙인다. AI가 바꾼 것은 연결별로 남고 한 번에 되돌릴 수 있다."

**경쟁 대비 근거**

| 경쟁 | 그들의 한계(근거) | 우리의 다른 점 |
|---|---|---|
| Notion | AI를 Business 좌석에 번들했고 단독 판매를 중단했다. 파일 소유권이 없다 [확인](W4 #4) | BYO AI, 로컬 .md 소유 |
| Obsidian + Relay | Relay는 실시간·폴더 공유가 되지만 AI 에이전트 계층이 없다고 제작자가 말했다(2025-03, 이후 미확인). RBAC는 $6 이상이고 플러그인 설정이 필요하다 [확인](W4b §3-1, §2) | 단일 앱에 AI 연결·scope·변경 원장 내장 |
| OpenKnowledge | 사람↔사람 동기화가 git으로 수 분 지연된다. 중앙 CRDT는 "near future"라고 한다 [확인](W4b §5) | 키 입력 단위 실시간 + 서버 권한 |
| Tela / Onyx agent-wiki | 서버 우선이거나 git 기반이다. 로컬 .md 원천이 아니다(README 자기서술) [확인](W4b §5) | 로컬 파일이 원천 |
| Granola / Slite | MCP를 가격 티어에 넣었다. 클라우드 문서라 로컬 파일이 아니다 [확인](W4b §2) | 로컬 + 팀 + 권한 상속 커넥터 |

**타깃 사용자 (1차)** [추정](중: W4b 사례 기반이며 인터뷰로 검증해야 함)
- 5~30명의 **비개발자 중심 지식 팀**이다. 스타트업 운영·기획·리서치팀, 커뮤니티·스터디 운영팀(셀피쉬클럽 유형)이 해당한다.
- 조건: 팀원 다수가 이미 Claude 또는 ChatGPT를 **개인 구독**으로 쓴다. Notion의 AI 좌석 요금이나 Obsidian 팀 동기화 우회(git)에 불만이 있다.
- 2차: 셀프호스트를 원하는 프라이버시 민감 팀(W4b P5).

---

## 4. 아키텍처 결정

### 4.1 포크 vs 신규 구축 → **하드 포크**

| 기준 | 포크 | 신규 구축 |
|---|---|---|
| 핵심 난제(md↔CRDT 양방향 병합, 에코 루프, split-brain, 삭제 전파) | 이미 해결됐고 회귀 테스트가 있다(브리지 4개 스위트 "crown jewels", 테스트 478개) [확인](CLAUDE.md Test; W2 §1) | 처음부터 다시 해야 한다. Baalda 문서의 사고 기록(#93, #98, #155, #200, #215 등)을 다시 겪을 가능성이 높다 [추정](상) |
| 라이선스 | `ee/` 밖은 Apache-2.0으로 상업 이용·호스팅 가능 [확인](LICENSE, TRADEMARK "You may") | 제약 없음 |
| 차별 자산(S1·S2·S5) | 그대로 상속 | 6주 MVP 안에서 재현 불가 [추정](상) |
| 비용 | 거대 파일 학습(W-1), 레거시 부채(W-11), 업스트림 추적, 리브랜딩 작업 [확인] | 깨끗한 설계 |
| **판정** | **채택.** 단, "업스트림 무추적 하드 포크 + 보안·버그 수정만 선별 체리픽"으로 한다 | 기각 |

- [확인] 현재 로컬 사본에는 `.git`이 없다(W1, W3). 포크 기준점은 **GitHub 원본 저장소의 특정 커밋 해시로 고정**해야 하고, 설치본 0.1.83과 소스가 정확히 같은지는 미확인이다(W1 결론: "소스 계열 일치"까지만 확인).

### 4.2 재사용 / 수정 / 교체·제거 / 신규 모듈 표

**재사용(그대로)** [확인](경로는 W2 §2, CLAUDE.md)

| 영역 | 경로 |
|---|---|
| md↔CRDT 브리지 | `D/src/lib/bridge/*` (`noteBridge.ts`, `diff.ts`, `adapter.ts` …) |
| Rust 디스크·인덱스 코어 | `D/src-tauri/src/{notefile,parse,vault,tree,watcher,note_file_identity,attachments,keychain,trash,extract,extract_worker}.rs` |
| 동기화 엔진 | `D/src/lib/sync/*`, `S/src/sync/*`, `S/src/yjs/*` |
| 권한·레지스트리 | `S/src/permissions/*`, `S/src/registry/*` |
| 블롭·버전·휴지통 | `S/src/blobs/*`, `S/src/versions/*`, `S/src/trash/*` |
| MCP 쓰기 경로 | `S/src/mcp/doc-writer.ts`, `S/src/mcp/service.ts`, `S/src/mcp/tokens.ts` |
| 인증 기반 | `S/src/auth/*` (Better Auth, argon2id, 로그인 스로틀) |

**수정(확장)**

| 경로 | 변경 | 근거 |
|---|---|---|
| `S/src/mcp/protocol.ts` | 2026-07-28 대응: `server/discover` 추가, stateless 요청 처리, `ping`·`initialize`는 **구 클라이언트용으로 유지**(이중 지원) | [확인](G1 W5-6) / 구 클라이언트 협상 방식은 [추정](중) |
| `S/src/mcp/tools.ts`, `S/src/http/routes/mcp.ts` | scope로 `tools/list`·`tools/call` 필터링, `WWW-Authenticate`에 `scope` 추가, 신규 토큰은 헤더 전용(`?key=` 폐지 예고), OAuth 연결을 목록에 통합 | [확인](G1 W5-7; W5 §3.1) |
| `S/src/http/routes/oauth-connect.ts` | 동의 화면 체크박스(읽기 / 쓰기 / 삭제·이동 / 권한 관리). `manage_access` 계열은 기본 해제 | [확인](G1 W5-8) |
| `S/src/auth/auth.ts`, `S/src/http/app.ts` | `@better-auth/cimd`(`metadataProfile:"mcp-2026-07-28"`), `iss` 응답 + 메타데이터 플래그, `scopes_supported`에 자체 scope 추가, `resource` audience 검증 | [확인](W5 §1.3, §3.1) / 1.6.23 호환은 [추정](중, 미실행) |
| `S/src/index/embedder.ts`, `S/src/index/indexer.ts` | 토큰화를 `\p{L}\p{N}` 유니코드 + 한글 2-gram으로 바꾸고, **0점 컷오프**와 재인덱싱 | [확인](G1 (a), W3-3) |
| `D/src-tauri/src/index.rs` | 한글 중간 문자열 fallback(§4.5) | [확인](G1 (b)) |
| `D/src-tauri/src/agent_runner.rs` | `dashboard_path` 필수 제약을 "작업 대상 노트 집합"으로 일반화, 실행 전후 스냅샷으로 원장 기록. **MCP·네트워크 차단 원칙은 유지** | [확인](W5 §2.3, G1 (e)) |
| `D/src/components/VaultSettingsDialog.tsx`(MCP 탭) | 신규 마법사 컴포넌트로 대체, 기존 토큰 UI는 "고급" 영역으로 이동 | [확인](G1 W5-9) |
| 브랜드 층 | `D/src/lib/brand.ts`, `S/src/brand.ts`, `tauri.conf.json`(`productName`, `identifier`, `plugins.updater.pubkey`/`endpoints`, `deep-link.schemes`), `D/src/lib/api.ts:58 PRODUCTION_SERVER_URL`, `keychain.rs:30 SERVICE`, `.github/workflows/*`(서명 인증서·minisign 키) | [확인](`docs/BRANDING.md` Layer 1; `tauri.conf.json:5,54-61`; `TRADEMARK.md:15`) |

**교체·제거**

| 대상 | 처리 | 근거 |
|---|---|---|
| `ee/` | **삭제**(Apache 밖이며 상용 라이선스) | [확인](`ee/README.md`) |
| `S/src/billing/*`(Polar) | 셀프호스트·초기 무료 단계에서는 env 미설정으로 비활성화(이미 "billing-disabled = unlimited"). 결제 모델이 정해지면 교체 | [확인](CLAUDE.md billing) |
| 레거시 호환(`ContentUploader` fallback, 구 402 코드, `vault` 과금 모델) | 포크 서버가 처음부터 `notes-with-state`·`bootstrap-only`를 제공하므로 단계적으로 삭제할 수 있다 | [확인](W2 D-7) / 삭제 안전성은 [추정](중) |
| `docs/*`, `CLAUDE.md` | 새 제품 기준으로 재작성. MCP 툴 목록(22개) 드리프트도 정정 | [확인](G1 W5-1) |

**신규**

| 모듈 | 내용 |
|---|---|
| `S/src/mcp/scopes.ts` | scope ↔ 툴 매핑(`notes:read`, `notes:write`, `notes:delete`, `access:manage`). `TOOL_CATALOG`의 read/write/destructive 분류를 재사용 |
| `S/migrations/0xx_ai_change_ledger.sql` + `S/src/ai-ledger/*` | 원장 행: (connection_id, client_name, user_id, doc_id, before_sha, after_sha, version_id, op, created_at). `doc-writer`의 transact origin(`{source:"mcp", userId}`)에 connection_id를 덧붙여 기록 |
| `S/migrations/0xx_connection_scopes.sql` | OAuth 동의·토큰별 scope 저장 |
| `D/src/components/ConnectAiWizard.tsx` | 대상 선택(Claude / ChatGPT / Cursor / VS Code / Codex) → URL 복사·딥링크 → "연결 확인(최근 호출 수신)" 표시 |
| `D/src/components/AiActivityPanel.tsx` | 연결별 변경 목록, diff, 개별·일괄 되돌리기, 연결 해제 |
| (2단계) `D/src-tauri/src/siwc.rs` | SIWC 오픈소스 경로 클라이언트(데스크톱 로컬 전용) |

### 4.3 AI 연결 계층 — 약관을 준수하는 경로만

| 경로 | 방향 | 허용 근거 | 채택 |
|---|---|---|---|
| **① 원격 MCP 커넥터** | 사용자의 Claude/ChatGPT 앱 → 우리 MCP(OAuth) | 공식 커넥터 경로. Claude 커스텀 커넥터는 Free(1개 제한, 미검증)부터 Enterprise까지 쓸 수 있다. ChatGPT는 Developer mode가 필요하다 [확인](W5 §1.1; W4 #3) / Free 1개 제한은 [추정](G1 미검증 목록) | **MVP 주 경로** |
| **② 설치된 무수정 CLI** | 앱 → 사용자가 설치·로그인한 `claude`/`codex` 실행 | Anthropic: "unmodified Claude Code binary"에 사용자 본인이 로그인하는 것은 허용된다. 단 제품에서 실행하려면 **Commercial Terms 동의** + 바이너리 무수정 + 인증 수단 제거·제한 금지 + 사용량 대납·재판매·중개 금지 [확인](G1 g-1, W5-3). OpenAI: 공식 CLI 실행은 안전하지만 `auth.json`을 읽어 재사용하면 위험하다 [확인](W5 §1.1(a)) | **MVP 조건부**(법무 확인 통과 시) |
| ③ SIWC 오픈소스 경로 | 데스크톱 → `auth.openai.com` PKCE 루프백(127.0.0.1만, `client_id=dynamic_agent_client`, 토큰 `https://auth.openai.com/api/accounts/oauth/token`) → Responses API | 범위는 "open-source and locally hosted apps". 유료·원격 호스팅이면 관심 폼을 거친다. 프리뷰 제약: `store:false`, `stream:true`, hosted MCP·file search 미지원 [확인](G1 g-2, W5-5) | 2단계 PoC. **서버가 토큰을 받아 대리 호출하는 것은 금지**(원격 호스팅에 해당할 가능성) [추정](중) |
| ④ BYO API 키 | OS 키체인 보관 → 요청마다 전달, 서버는 저장하지 않음 | housekeeper가 이미 쓰는 패턴(OpenRouter) [확인](W5 §2.4) | 유지·확장(OpenAI 호환 `baseURL`) |
| ✗ 금지 | claude.ai 로그인 UI를 직접 구현, Claude/ChatGPT 구독 토큰·`auth.json` 수집·저장·중개, 서버에서 사용자 구독으로 대리 호출, Agent SDK에 claude.ai 로그인, Codex app-server 인증의 상업·호스팅 사용 | [확인](G1 g-1; W5 §1.1(a) app-server 행) | — |

- 명칭: 제품 기능명에 "Claude Code"를 쓰지 않는다. Agent SDK를 쓰면 "Claude Agent"나 "Powered by Claude"를 쓴다. [확인](G1 g-1)
- 프롬프트 인젝션: 노트 본문은 신뢰할 수 없는 데이터다. 이 원칙(housekeeper 프롬프트에 이미 있음)을 CLI 실행 프롬프트와 MCP 쓰기 응답에도 일관되게 적용한다. 생성된 텍스트를 실행 권한으로 해석하지 않는다. [확인](W5 §3.2 안전 모델; CLAUDE.md Agents)

### 4.4 MCP 계층 (2026-07-28 스펙 · CIMD · scope)

1. **프로토콜**: `server/discover`를 구현한다(MUST). stateless 요청을 처리한다. `initialize`/`ping`은 구 클라이언트 호환을 위해 당분간 유지한다(2025-06-18과 이중 지원). [확인](G1 W5-6) / 클라이언트들의 실제 전환 시점은 [추정](하)
2. **인가**: 클라이언트 등록 우선순위는 사전등록 → **CIMD** → DCR(하위호환용으로 유지)이다. `@better-auth/cimd`와 `metadataProfile:"mcp-2026-07-28"`를 쓰고 SSRF 방어를 켠다. 인가 응답에 `iss`를 넣고 메타데이터에 `authorization_response_iss_parameter_supported:true`를 둔다. PKCE S256과 `resource`(RFC 8707) audience를 검증한다. 공용 클라이언트는 refresh 토큰을 회전한다. [확인](W5 §1.3, §3.1)
   - Better Auth `mcp` 플러그인은 `oauth-provider`로 대체될 예정이다. 이전은 2단계에서 한다(`oauth*` 테이블 영향 검토). [확인](W5 §1.3) / 영향 범위는 [추정](중)
3. **scope**

| scope | 허용 툴 | 동의 화면 기본값 |
|---|---|---|
| `notes:read` | list_vaults/folders/notes, read_note, search_notes, list_attachments, read_attachment_text | 켜짐 |
| `notes:write` | create_note/folder, update_note, append_note, edit_note | 켜짐(비개발자 기본은 "읽기만" 프리셋을 함께 제공) |
| `notes:delete` | delete_note/file/folder, move_note/file/folder | **꺼짐** |
| `access:manage` | get/set_access_default, list_resource_access, manage_access | **꺼짐**, 소유자·관리자에게만 표시 |

   - 툴 분류는 기존 `TOOL_CATALOG` read/write/destructive annotation을 재사용한다. [확인](W5 §2.2 `mcp.ts:26-34`)
   - scope는 권한을 **줄이기만** 한다. 실제 접근은 여전히 사용자의 `effectivePermission`을 상속한다(현행 유지). [확인](W5 §3.1)
   - 폴더 단위 제한("이 폴더만")은 2단계로 미룬다(Board 접근 모델과 정합 설계 필요, 난이도 상). [추정](중)
4. **연결 관리**: 토큰 연결과 OAuth 연결을 한 목록에 보여준다. 항목은 클라이언트명, scope, 마지막 사용, 호출 수, 해제 버튼이다. 해제하면 토큰과 동의를 삭제한다. [확인](W5 §3.1 "OAuth has no row" `mcp.ts:222`)

### 4.5 검색 계층

| 단계 | 로컬 A (데스크톱) | 서버 B/C (MCP) |
|---|---|---|
| **MVP(위생)** | 유지: `unicode61` 접두어 AND. 추가: 접두어 결과가 0건이고 질의 토큰에 한글이 있으면 **본문 부분문자열 fallback**을 쓴다(`notes_fts`가 self-contained라 본문 보유, `instr` 스캔에 상한을 둔다). trigram은 3자 미만 질의를 못 다루는데 한국어 핵심어는 2음절이 많아 단독 채택하지 않는다. 수용 기준은 "`기능` → `검색기능과` 적중" | 토큰화를 `\p{L}\p{N}`로 바꾸고 한글은 2-gram으로 쪼갠다. 점수가 0 이하인 결과는 **반환하지 않는다**. 기존 벡터 재인덱싱(boot `backfillIndex` 경로 재사용). 빈 질의(공백만)는 MCP에서도 거부한다(`reqStr` 보강) |
| 2단계 | frontmatter tags·파일명 컬럼 검색 결정(현재 JOIN 없음) | `setEmbedder` 연결: 옵트인 실제 임베딩(BYO 키 또는 로컬 다국어 모델) + pgvector + 키워드 하이브리드(RRF). 파일 후보 2,000개 상한 제거 |
| 3단계 | SearchPanel에 "팀 전체(서버) 검색" 탭 추가 여부 결정 | 리랭킹, 검색 로그 기반 튜닝 |

- 근거: [확인](W3 §A·§B·§C 실측, G1 (a)(b), W3-5). 로컬 fallback의 성능(노트 2만 개 스캔)은 [추정](중)이며 벤치마크가 필요하다. 2-gram 방식이 의미 검색 품질에 주는 영향은 [추정](중)이다.
- 근거 기록: 한국어 수요가 입증되지 않았으므로(W4b) MVP는 **"틀린 답을 내지 않게"까지만** 한다. 한국어 품질 고도화는 검색 로그(0결과율)로 수요를 확인한 뒤 진행한다.

### 4.6 데이터·보안

| 항목 | 결정 | 근거 |
|---|---|---|
| 문서 정직화 | "서버는 동기화용 바이너리 Yjs와 **검색·버전용 평문 파생 사본**(`note_index`, `note_texts`, `blob_text`; 레거시 `note_versions`/`vault_checkpoint_docs`)을 저장한다"고 사용자 문서·보안 페이지에 명시한다 | [확인](G1 (d), W2-5) |
| at-rest(서버) | MVP: Postgres 볼륨·백업 디스크 암호화(운영 정책). 2단계: 볼트 설정 "서버 평문 최소 모드". 켜면 `note_index.content`·`blob_text` 생성을 중지하고, 이 볼트에서는 서버 검색·MCP 검색 품질이 떨어진다는 트레이드오프를 표시한다 | [확인](STATUS.md:255 미구현) / 설계는 [추정](중) |
| E2E | **기각.** 서버 검색, MCP, 체크포인트, 권한 회수와 정면으로 충돌한다. Relay 제작자도 실시간 협업에서의 E2E를 "too much complexity", "debugging nearly impossible"이라고 했다. 대신 **셀프호스트**를 프라이버시 해법으로 제시한다 | [확인](W4b §3-1 forum 87170) |
| 로컬 | `index.sqlite`는 비암호화 상태로 유지하고 OS 디스크 암호화(FileVault/BitLocker)를 권고한다. libSQL at-rest는 3단계 | [확인](W2 §3.1) / 권고는 [추정](중) |
| MCP 보안 | 신규 토큰은 헤더 전용, `access:manage` 기본 비노출, scope 축소, 연결별 원장, 실패 토큰 429 유지 | [확인](W5 §2.2, §3.1) |
| CSP | 데스크톱 `connect-src https: wss:` 전면 허용(자체 서버 URL 지원용)은 유지하되 포크 후 감사 대상에 올린다 | [확인](W2 D-8) / 이유는 [추정](중) |

### 4.7 텍스트 아키텍처 다이어그램

```
                         ┌──────────── 사용자 기기 (데스크톱 앱, Tauri) ────────────┐
 디스크 vault/            │                                                       │
  ├─ *.md  ◀── 원자적 쓰기(egest 300ms) ── NoteBridge(Y.Doc / Y.Text "content")   │
  │          ── watcher 150ms → ingest(diff→Y.Text 연산, ORIGIN_DISK) ──▶          │
  └─ .context/index.sqlite  (FTS5 A + [MVP] 한글 fallback, yjs_updates/snapshot) │
                         │        ▲                     │                        │
 외부 프로세스·CLI 에이전트 ──┘        │ IPC(ipc.ts)          │ HocuspocusProvider     │
 (② 설치된 무수정 claude/codex,      │                     │  vault:<id>/note:<docId>│
  MCP·네트워크 차단, 실행 전후        React UI ── ConnectAiWizard / AiActivityPanel │
  스냅샷 → 원장)                     │   ④ BYO 키(키체인)   ③ [2단계] SIWC 루프백      │
                         └────────────┼─────────────────────┼────────────────────────┘
                                      │ HTTPS               │ WSS /sync, /vault-sync
                         ┌────────────▼─────────────────────▼────────────────────────┐
                         │ 서버 (Node: Hono HTTP + Hocuspocus, 단일 포트)                │
                         │  Better Auth + [신규] CIMD / iss / scope / audience          │
                         │  /api/mcp  ── 2025-06-18 + 2026-07-28(server/discover)       │
                         │     │ scope 필터 → service(effectivePermission) → DocWriter  │
                         │     │                       │ transact(origin=mcp+connId)   │
                         │     └──▶ [신규] ai_change_ledger ◀── 되돌리기(editContent+rev)│
                         │  Postgres: doc_updates/snapshots(바이너리)                    │
                         │            note_index·note_texts·blob_text(평문 파생 ⚠)       │
                         │  Blob: Postgres BYTEA | S3/R2                               │
                         └───────────────▲────────────────────────────────────────────┘
                                         │ ① OAuth 커넥터 (URL + 로그인 + scope 동의)
                         Claude(claude.ai/Desktop) · ChatGPT(Developer mode) · Cursor · VS Code
```

---

## 5. MVP(6주) · 로드맵 · 리스크

### 5.1 MVP 범위 (0주차는 포크 정리, 기능 5개)

**0주차(1주) — 포크 기반 정리** (기능이 아니라 선행 조건)
- 수용 기준: ① `ee/` 삭제. ② 브랜드 층(§4.2)을 새 이름으로 교체: `identifier`, 스킴, 키체인 서비스, 업데이터 키·엔드포인트, `PRODUCTION_SERVER_URL`. ③ 자체 서명 인증서·minisign 키로 macOS 빌드 1회 성공. ④ 자체 서버를 Compose로 배포하고 `/health` 응답 확인. ⑤ `pnpm test`와 `cargo test`의 기존 통과율 유지(브리지 4개 스위트 전부 통과). ⑥ 바이너리 문자열 검색에서 `api.baalda.com`, `naveedharri`, `com.baalda` 0건. [추정](공수 1주, 신뢰도 중)

**F1. AI 연결 마법사 + scope 커넥터** (후보 A)
- 수용 기준:
  1. 앱의 "AI 연결" 화면에서 Claude를 고르면 커넥터 URL 복사 버튼과 3단계 안내가 나온다. 사용자가 claude.ai에서 붙여넣고 로그인하면 **토큰 복붙 없이** 연결되고, 앱에 "연결됨(마지막 호출 n초 전)"이 뜬다.
  2. 동의 화면에 "읽기만 / 읽기+쓰기 / +삭제·이동" 프리셋이 있다. "읽기만"으로 연결한 클라이언트가 `update_note`를 호출하면 거부되고, 이 툴은 `tools/list`에도 나오지 않는다.
  3. `access:manage`는 소유자·관리자 동의 화면에서만 선택할 수 있고 기본은 꺼짐이다.
  4. OAuth 연결과 토큰 연결이 한 목록에 나오고, 해제하면 다음 호출부터 401을 받는다.
  5. AS 메타데이터에 CIMD 지원, `iss` 플래그, 자체 scope가 포함된다. 기존 DCR 클라이언트(Claude Code `claude mcp add`)도 계속 연결된다.
  6. 비개발자 5명 사용성 테스트에서 Claude 연결 성공률 80% 이상, 중앙값 3분 이내. [추정] 목표치
- ChatGPT는 Developer mode 요건 때문에 MVP에서 "고급(개발자용)" 표시를 붙여 안내한다. [확인](W4 #3)

**F2. AI 변경 원장 + 되돌리기** (후보 I)
- 수용 기준:
  1. MCP 쓰기(`create/update/append/edit/delete/move`)마다 원장 행이 생기고, 연결명·노트·시각·변경 전후 diff를 앱 패널에서 볼 수 있다.
  2. 원장 항목 "되돌리기"는 역편집을 `DocWriter.editContent` + 현재 리비전 가드로 적용한다. 그 사이 사람이 같은 구간을 고쳤으면 되돌리기를 거부하고 diff를 보여준다(조용히 덮어쓰지 않는다).
  3. "이 연결의 최근 1시간 변경 모두 되돌리기"가 동작하고, 삭제된 노트는 휴지통 복원 경로로 되돌린다.
  4. 동시에 사람이 편집 중인 노트에서도 되돌리기가 CRDT 연산으로 병합된다(브리지 echo/concurrent 스위트에 시나리오 1개 추가).
  - [확인] 재사용 근거: housekeeper undo = 역편집 + 리비전 가드(W5 §2.4), 30일 휴지통 restore(CLAUDE.md trash). / 구현 가능성은 [추정](중)

**F3. 5분 팀 온보딩** (후보 M)
- 수용 기준:
  1. 소유자가 "팀 초대"에서 이메일 또는 링크를 만든다. 초대받은 사람이 앱 설치 → 링크 열기(딥링크) → 가입 → 볼트 선택까지 하면 공유 폴더가 로컬에 내려오고 같은 노트를 동시에 편집할 수 있다. 총 5분 이내(측정).
  2. 기본 권한(Everyone: 편집/보기/없음)을 초대 화면 한 곳에서 고른다(기존 `invitation_access`, `join_default` 재사용).
  3. git, 터미널, 설정 파일이 등장하지 않는다.
  - [확인] 재사용: 초대·가입 코드·접근 수준(CLAUDE.md members, `invitation_access`). / 5분 목표는 [추정]

**F4. 한국어 검색 결함 수정** (D의 위생 부분)
- 수용 기준:
  1. 로컬: `기능` → `검색기능과` 노트 적중, `어검색` → `한국어검색을` 적중. 기존 W3 실측 표의 영어 케이스 결과는 변하지 않는다(W3 `fts_probe.py`를 회귀 테스트로 이식).
  2. 서버/MCP: 순수 한글 질의가 관련 노트를 상위에 반환하고, 관련 노트가 없으면 **빈 결과**를 반환한다(무관한 top-k 금지). 공백만 있는 MCP 질의는 400과 같은 의미의 오류를 낸다.
  3. 노트 2만 개 합성 볼트에서 로컬 fallback 검색 p95가 300ms 이하. [추정] 목표치

**F5. (조건부) 설치 CLI로 노트 작업** (후보 B)
- 진입 조건: **Anthropic Commercial Terms 적용 여부와 조건 충족을 법무가 확인**해야 한다. 미확인이면 Codex만 출시하거나 F5 전체를 2단계로 미룬다. [확인](G1 W5-3)
- 수용 기준:
  1. 노트 또는 폴더 선택 → "AI로 정리/요약" 실행 → 설치된 CLI가 기존 샌드박스 인자(`--strict-mcp-config --mcp-config '{"mcpServers":{}}'`, 도구 `Read,Glob,Grep,Edit,Write`, 네트워크 차단)로 돈다.
  2. 실행 전후 스냅샷으로 변경 파일 목록과 diff가 F2 원장에 "로컬 에이전트" 연결로 기록되고, 일괄 되돌리기가 된다.
  3. 미설치·미로그인이면 공식 설치 링크와 "터미널에서 로그인" 안내만 보여주고, 앱은 자격증명 파일을 읽지 않는다.

**일정** [추정](중): 0주차 포크 정리 → 1~2주 F1 + F4 → 3~4주 F2 → 4~5주 F3 + F5(조건부) → 6주 비개발자 사용성 테스트와 수정.

### 5.2 로드맵 3단계

| 단계 | 기간(추정) | 내용 | 진입 조건 |
|---|---|---|---|
| **1. MVP** | 0~6주 | 포크 정리, F1~F5 | — |
| **2. 신뢰·연결 확장** | 7~14주 | SIWC 오픈소스 경로 PoC(C, 데스크톱 로컬 전용) · 폴더 단위 scope · 사이드패널 AI(J: ①②③④ 경로 재사용, diff 승인) · 팀 에이전트 지침(L: MCP `prompts`/`resources`) · 게스트 뷰어(F: 공개 링크 확장, 좌석 없음) · 옵트인 실제 임베딩 + 하이브리드(D) · 서버 평문 최소 모드(N) · Better Auth `oauth-provider` 이전 | MVP 사용성 지표 달성. SIWC는 OpenAI에 "유료 관리형 서비스와 함께 배포되는 OSS 데스크톱"의 자격 여부를 확인한 뒤 진행 |
| **3. 도달 범위** | 15~26주 | 웹 클라이언트(G: 읽기·댓글 → 편집) · ACP 기반 에이전트 일반화 · 외부 MCP 클라이언트(E: 별도 위협 모델 후, opt-in 허용 목록) · 로컬 at-rest(libSQL) · Windows 서명 · 회의록(H)은 수요 확인 시에만 | 웹 수요(게스트·모바일) 근거 확보 |

### 5.3 리스크·미검증 가정과 검증 방법

| # | 가정/리스크 | 상태 | 검증 방법 | 실패 시 |
|---|---|---|---|---|
| R1 | 팀이 Relay·Notion 대신 옮길 만큼의 차이가 있다 | [추정](중하) — Relay($5~6)가 이미 P1을 푼다 | 타깃 팀 10곳 인터뷰 + 랜딩 대기열(전환율) + MVP 파일럿 3팀의 4주 리텐션 | "AI 신뢰층(A·I)"만 Obsidian/Relay용 플러그인·서버로 축소 |
| R2 | 비개발자가 커넥터 연결을 혼자 끝낸다 | [추정](중) — 원격 커넥터로 완화됐을 수 있음(W4 caveats) | 5명 사용성 테스트(F1 수용 기준 6) | 앱 안에서 claude.ai 창을 열어 단계별 하이라이트하는 가이드 |
| R3 | ChatGPT 사용자도 연결할 수 있다 | [확인] Developer mode가 필요하고 "dangerous" 표기(W4 #3) — 비개발자에게는 사실상 막힘 | 플랜별 실계정 테스트, Apps 디렉터리 심사 요건 확인 | ChatGPT는 SIWC(③)나 BYO 키(④)로 우회 |
| R4 | Claude Free 커스텀 커넥터 1개 제한 | [추정] G1 미검증 | 무료 계정 실측 | 온보딩 문구에 명시 |
| R5 | 설치 CLI 실행이 Anthropic 약관을 충족한다 | [확인] Commercial Terms 동의 필요(G1). 충족 여부는 [추정](중) | 법무 검토, 필요하면 Anthropic에 문의 | F5에서 Claude 제외, Codex·BYO 키만 |
| R6 | SIWC를 우리 배포 형태에 쓸 수 있다 | [추정](중) — "open-source and locally hosted"의 경계가 불명확 | OpenAI 관심 폼·문의 | ④ BYO 키 |
| R7 | 한국어 검색이 구매 요인이다 | [확인] 직접 불만 0건(W4b) | F4 출시 후 검색 로그의 0결과율·재검색률, 인터뷰 질문 포함 | 2단계 D 투자 보류 |
| R8 | Better Auth 1.6.23 + `@better-auth/cimd` + `mcp()`가 함께 동작한다 | [추정](중) 미실행 | 1일 스파이크 | CIMD를 메타데이터·검증 로직으로 직접 구현 |
| R9 | 단일 Node 프로세스가 파일럿 규모를 감당한다 | [추정](중) W2 D-4 | 30명 × 노트 5천 개 부하 테스트 | Redis 확장 활성화, y-sweet 재검토 |
| R10 | 포크 유지비(거대 파일·업스트림 속도) | [확인] W-1·W-2 | 0주차에 핵심 파일 소유자를 지정하고 체리픽 정책 문서화 | 업스트림 추적 포기를 명시 |
| R11 | 경쟁 OSS(OpenKnowledge 중앙 CRDT 예고, Tela, Onyx)가 격차를 좁힌다 | [확인] 예고 존재(W4b §5) / 속도는 [추정] | 분기별 경쟁 점검 | 실행 속도와 비개발자 UX에 집중 |
| R12 | 내부 식별자(`.context/`, DB명 `context`)를 유지해도 상표 문제가 없다 | [추정](중) — TRADEMARK는 "Context"도 보호하지만 "as used to identify this project" 한정 | 법무 확인 | 전부 새 코드네임으로 변경(볼트 마이그레이션 필요) |
| R13 | 로컬 에이전트의 디스크 편집을 정확히 귀속할 수 있다 | [추정](중) — 디스크 경로는 origin이 `disk`로 섞임 | F5에서 실행 창 기준 스냅샷 diff로 귀속, 동시 사람 편집 테스트 | 원장에 "실행 단위 스냅샷"만 기록 |
| R14 | 서버 평문 보관에 대한 사용자 반발 | [확인] P5 신호 약 5개 | 보안 페이지 공개 후 파일럿 피드백 | 2단계 "평문 최소 모드" 앞당김, 셀프호스트 가이드 강화 |

---

## 6. 이용자가 결정해야 할 질문

1. **사업 모델**: (a) Apache-2.0 OSS + 유료 관리형 호스팅, (b) 셀프호스트 전용, (c) 유료 비공개 중 무엇인가? 이 답에 따라 SIWC 자격(R6), Commercial Terms(R5), 결제 모듈 처리가 달라진다. **권고: (a)**.
2. **1차 타깃**: 한국 비개발자 소규모 팀인가, 글로벌인가? 언어 우선순위와 F4 투자 깊이가 달라진다.
3. **포크 기준 커밋**: 로컬 사본에 `.git`이 없다. GitHub 원본의 어느 커밋(또는 0.1.83 태그)을 기준으로 할 것인가? 업스트림을 계속 추적할 것인가, 무추적 하드 포크로 갈 것인가? **권고: 무추적 + 보안 수정만 체리픽**.
4. **이름·식별자**: 가칭 infinite-brain의 상표 검색을 할 것인가? 내부 식별자(`.context/`, DB명 `context`)를 유지할 것인가, 전부 바꿀 것인가(R12)?
5. **F5(설치 CLI)를 MVP에 넣을 것인가?** 법무 검토 비용과 시간을 쓸 것인가, 2단계로 미룰 것인가?
6. **SIWC PoC를 2단계에서 진행할 것인가?** OpenAI 문의를 누가 할 것인가?
7. **서버 평문 정책**: 서버 검색·MCP 품질을 위해 평문 파생 사본을 기본 허용할 것인가, 볼트별 선택으로 둘 것인가? E2E 기각에 동의하는가?
8. **결제**: Polar를 유지할 것인가, 다른 제공자로 바꿀 것인가, 초기 무료로 갈 것인가? 좌석제인가 팀 합계제(Relay·Outline 방식)인가?
9. **플랫폼**: MVP를 macOS만으로 할 것인가? Windows·Linux 서명 비용을 언제 쓸 것인가?
10. **웹 클라이언트 시점**: 게스트·모바일 요구가 MVP 파일럿에서 나오면 3단계를 앞당길 것인가?
11. **운영 경계**: 원본처럼 "공개 저장소에는 관리형 운영 정보를 두지 않는다" 규칙을 채택할 것인가?
12. **검증 리소스**: 인터뷰 10팀과 사용성 테스트 5명을 누가 섭외할 것인가?

---

## 부록 A. 근거 대조표 (원자료 → 이 문서)

| 이 문서의 결론 | 주 근거 |
|---|---|
| 서버 검색은 MCP 전용 경로이고 한글 0점 결함이 있다 | G1 (a)(c), W3 §B·§C·실측 |
| 서버 평문 위치(note_texts 등) | G1 (d), W2-5 |
| 명령 수 90/114 | G1 W2-2, h-1 |
| Claude Code 실행 = Commercial Terms + 조건 | G1 W5-3, g-1 |
| MCP 차단 플래그 정식 표기 | G1 W5-4, (e) |
| SIWC 엔드포인트·범위 | G1 W5-5, g-2 |
| 2026-07-28 스펙(initialize·ping 제거, server/discover, CIMD, iss) | G1 W5-6 |
| 카테고리 혼잡, MCP는 기본기, 한국어 수요 미입증 | W4b §2, §4, §5, §7 |
| Notion AI 번들, ChatGPT Developer mode "dangerous", Aside = AI 브라우저 | W4 findings #3, #4, #8 |
| W4가 폐기한 주장(ChatGPT 원격 전용, Developer mode 플랜 제한 등)은 재사용하지 않음 | W4 refuted |
