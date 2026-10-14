# W4b — 시장 니즈 보강 리서치 (2026-10-14 기준)

> 범위: W4(`W4-deep-research.json`)가 이미 검증한 항목은 **반복하지 않고 인용만** 한다. 여기서는 W4의 `openQuestions` 4개를 채운다.
> 표기: `[확인](출처)` = 이번 세션에서 해당 URL/출력으로 직접 확인. `[추정](근거, 신뢰도 상/중/하)` = 추론. `🔶홍보성` = 판매·홍보 목적 출처.
> 저장소 파일은 읽기만 했고 수정하지 않았다(읽은 것: W4 JSON 1~630행. 나머지는 workflowProgress 로그라 불필요).

---

## 0. 방법의 한계 (먼저 읽을 것)

| 한계 | 내용 |
|---|---|
| Reddit 원문 | **reddit.com 스레드 URL을 한 건도 직접 열지 못했다.** 검색 결과에 reddit 도메인이 나오지 않았다. Reddit 인용은 전부 **2차 출처(집계 블로그)가 옮긴 것**이다. 스레드 URL·정확한 업보트는 검증 불가. |
| 요약기 개입 | `WebFetch`는 소형 모델이 페이지를 요약해 돌려준다. 가격 표는 이 요약본이다. 큰 의사결정 전에는 각 공식 가격 페이지를 눈으로 재확인할 것. |
| 표본 | "언급 수"는 **내가 연 약 45개 페이지 안에서의 독립 출처 수**다. 시장 전체 빈도가 아니다. |
| 미조사 | Saga, Logseq 공식 가격, Confluence 좌석 단가, Reflect 구독 단가는 공식 확인 실패. 해당 칸에 명시했다. |
| 시점 | NotebookLM은 2026-07에 **"Gemini Notebook"으로 개명**됐다. [확인](https://notebooklm.google/plans — "NotebookLM is now Gemini Notebook as of July 2026") |

---

## 1. W4에서 인용만 하는 항목 (재검증 안 함)

- Notion AI는 2025-05-13부터 신규 고객에게 단독 판매 중단, Business(연 $20/월 $24)·Enterprise에 번들. Free/Plus는 체험만. [확인](W4 findings #4, 3-0 검증)
- Member/Guest 오초대로 좌석 요금 서프라이즈. [확인](W4 findings #6)
- AFFiNE: 로컬 워크스페이스는 단일 기기, 실시간 협업은 클라우드/셀프호스트 필요. [확인](W4 findings #7)
- MCP 비개발자 진입장벽(JSON 수작업, 절대경로, 모호한 오류). 단 홍보성 Substack이 섞여 있고 .mcpb/원격 커넥터로 완화됐을 가능성이 있다고 W4가 경고. [확인](W4 findings #1~3, caveats)
- Aside(2026-06-23 출시)는 **AI 브라우저**이지 노트 앱이 아니다. [확인](W4 findings #8)
- W4가 폐기한 주장(ChatGPT는 원격 MCP만 지원, Developer mode 플랜 제한, Notion 2025-08 기능 게이팅 등)은 재사용하지 않는다.

> **정정 메모:** W4는 "Heptabase Pro $8.99 / Premium $17.99 (Toolradar)" 주장을 1-2로 폐기했다. 이번에 **공식 페이지**가 같은 숫자를 보여준다(아래 §2). 폐기 사유가 가격 자체가 아니라 출처 신뢰도였을 가능성이 높다. 공식 페이지 숫자를 쓴다. [확인](https://heptabase.com/pricing)

---

## 2. 경쟁사별 가격·변경 (공식 페이지 우선)

| 제품 | 가격(공식 확인 시) | 팀/협업 | AI | 출처·비고 |
|---|---|---|---|---|
| **Obsidian** | 앱 무료. Sync **$4**/유저/월(연납) · $5(월납). Publish **$8**/사이트/월(연납) · $10(월납). Catalyst $25 일시불. Commercial **$50**/유저/년(선택). 학생·비영리 40% 할인. 상업 사용에 라이선스 **불필요** | Sync/Publish에 실시간 공동편집 언급 없음 | 앱 내장 AI 언급 없음 | [확인](https://obsidian.md/pricing) |
| **Relay** (Obsidian 플러그인, System 3) | Free $0(3명, 기기 2, .md만·첨부 불가) · Hobby **$5/월 합계**(6명, 10GB, 첨부) · Starter **$6**/유저/월(무제한 유저, **RBAC(비공개 폴더)**, SSO) · Premium **$18**/유저/월(Git sync, Document API, User management API) · Enterprise 협의 | 실시간 협업·라이브 커서·오프라인·셀프호스트 | 가격표에 AI 없음 | [확인](https://relay.md/pricing). 셀프호스트해도 유저 제한은 안 풀린다 [확인](https://www.xda-developers.com/obsidian-can-be-a-co-working-platform/, 2026-03-01) |
| **Reflect** | Mac 앱 "Reflect Open" **무료·구독 불필요**, iPhone/iPad 유료(앱스토어 가격), Classic 유지. AI는 **본인 API 키**, 사용료는 제공사에 별도 청구 | 팀 언급 없음 | **BYO API 키** | [확인](https://reflect.app/ — 요약기 출력). `/pricing`은 404. 구독 단가는 미확인 |
| **Mem** | Free · Plus $9 · Pro $29 · Pro 2× $49 · 5× $99 · 10× $149 · 20× $199 (메시지·노트·루틴 쿼터제) | 팀 기능 언급 없음 | 쿼터형 | [확인](https://get.mem.ai/pricing). 집계 사이트의 "Mem Pro $12"는 **구버전**으로 보임 [추정](공식 표와 불일치, 신뢰도 중) |
| **Capacities** | Basic 무료 · Pro **$9.99**/월(구조화 데이터엔 $11.99로 표기돼 **페이지 내부 불일치**) · Believer 월 $12.49~ · Plus 애드온 $8.33/월(연납) | FAQ: "**No, Capacities is designed for individuals.**" 팀·조직 플랜 없음, 보기 전용 공유만 | Pro/Believer에 월 AI 예산, Plus는 더 큼 | [확인](https://capacities.io/pricing) |
| **Anytype** | Free(100MB, 공유 채널 10) · Plus **$4**(1GB, 공유 무제한) · Pro **$8**(10GB) · Ultra **$16**(100GB). **Business: €20/에디터/월, 뷰어 무료**, 14일 체험. 셀프호스트 Business €300/월 정액(**미출시**) | 공유 스페이스, Business에 SSO·관리자 패널 | 가격표에 AI 없음 | [확인](https://anytype.io/pricing/), [확인](https://business.anytype.io/), 문서 [확인](https://doc.anytype.io/anytype-docs/advanced/monetization). 월/연 표기 기준은 페이지 발췌만으로 불명 |
| **Heptabase** | Pro **$8.99** · Premium **$17.99** · Premium+ **$53.99**(월 표기, 연납 25% 할인). AI 크레딧 100 / 1,800 / 8,100 | 팀 언급 없음 | 크레딧제, Pro는 Gemini 한정 | [확인](https://heptabase.com/pricing) |
| **Tana** | 공식 페이지 요약: Free(월 5회 미팅 AI 전사, AI 쿼리 50) · Pro **$20**(얼리버드, 정가 $30) · Business 협의 | 워크스페이스 인원 제한 언급 없음 | AI 크레딧 충전형 | [확인](https://tana.inc/pricing — 요약기 출력). 집계 사이트는 "$18~20, 4번째 $120 플랜"이라 **서로 충돌** [추정](costbench 단일 출처, 신뢰도 하). 공식 우선 |
| **Logseq** | 앱 무료, Sync 약 $5/월 | — | — | [추정](costbench·saaskart 집계, 신뢰도 하). **공식 확인 실패** |
| **NotebookLM → Gemini Notebook** | Google AI Plus/Pro/Ultra에 묶여 판매. Ultra는 페이지에 **$99.99 / $199.99** 두 단계로 표기. 노트북당 소스 한도는 Plus 100 / Pro 300 | 공유 기능은 페이지에서 확인 못함 | Gemini 내장 | [확인](https://notebooklm.google/plans), [확인](https://gemini.google/subscriptions/). Pro 단가 $19.99는 집계 사이트 값이라 [추정](신뢰도 하) |
| **Granola** | Basic **$0** · Business **$14** · Enterprise **$35** (/유저/월) | 공유 폴더(전 플랜), 워크스페이스 공유 설정은 Enterprise만 | **MCP**: Basic은 최근 30일 개인 노트, Business는 개인+공개 워크스페이스, Enterprise는 관리자 설정. **API는 Business부터** | [확인](https://www.granola.ai/pricing) |
| **Slite** | Basic **$10** · Pro **$20** (/유저/월, 연납) · Enterprise 협의 | 팀 위키 | Basic부터 **MCP·API 포함**, Pro에 Slite Agent·팩트체크·좌석당 50크레딧, AI 질문 30회/좌석/월 | [확인](https://slite.com/pricing) |
| **Outline** | 클라우드 1~10명 **$10/월 합계**, 11~100명 $79, 101~200명 $249. 셀프호스트 Business $4/유저/월(10명 최소), Enterprise $5(100명 최소), Community $0 | 팀 위키 | 클라우드는 전 티어 AI 질의응답. 셀프호스트 Community는 AI 없음 | [확인](https://www.getoutline.com/pricing) |
| **Confluence AI (Rovo)** | 좌석 단가 **미확인**. Rovo 크레딧이 유료 Confluence에 포함: Standard 25 / Premium 70 / Enterprise 150 (유저당 월). 2026-08-31 이후 사용분부터 새 과금 | 스페이스·페이지 권한 | Rovo | [확인](https://support.atlassian.com/rovo/docs/rovo-usage-limits/), [확인](https://support.atlassian.com/confluence-cloud/docs/learn-about-confluence-cloud-plans/) |
| **Saga** | **미조사** (공식 확인 못함) | — | — | — |

### 가격에서 읽히는 것
- **BYO-AI 쪽이 늘고 있다.** Reflect(자기 API 키), OpenKnowledge(이미 설치한 Claude/Codex 사용, 아래 §5). 반대로 Notion은 번들+크레딧($10/1,000크레딧). [확인](위 표, W4 #4)
- **팀 요금이 합계형인 제품이 있다.** Relay Hobby $5(6명), Outline $10(1~10명)은 소규모 팀에 좌석 과금보다 유리. [확인](위 표)
- **Granola/Slite는 MCP를 이미 가격 티어에 넣었다.** Slite는 가장 싼 Basic부터, Granola는 Business부터. 즉 "MCP 지원"은 차별점이 아니라 **기본기**가 되는 중이다. [확인](위 표)
- **Obsidian 코어는 최근 8개 릴리스(2026-09-15~10-05, 1.14.2~1.14.4)에 협업·AI·MCP 항목이 없다.** 검색(퍼지 매칭)과 Bases(칸반)만 개선. [확인](https://obsidian.md/changelog — 요약기 출력)

---

## 3. 커뮤니티 스레드·인용 (영문)

### 3-1. 확인한 스레드 (원문 URL 직접 열람)

| 스레드 | 날짜 | 인용(원문) | 의미 |
|---|---|---|---|
| HN "Introduction to Obsidian" 하위 [47759055](https://news.ycombinator.com/item?id=47759055) | 약 2026-04 ("6 months ago") | bryanhogan: "Almost all ways to sync Obsidian has a problem with multiple people editing the same file." / philips: "lots of apps have this issue but I assumed it would work since they advertise the feature." | 동시편집 충돌 [확인](요약기 출력, 댓글 3개만 노출) |
| HN Show HN OpenKnowledge [48675435](https://news.ycombinator.com/item?id=48675435) | 약 2026-07 ("3 months ago"), 381점·173댓글 | cheema33: "Obsidian doesn't do team." (자체호스팅 Outline으로 이동). kbar13: Obsidian은 LLM엔 좋지만 협업엔 "multi editor, comments" 부재. abdullin: "basic access controls for team setup"을 아직 고민, 멀티 에이전트 편집은 "문서 여러 개에 걸쳐 원자적인 changeset"이 필요. altmanaltman: AI든 누구든 자기 vault를 들여다보는 것이 싫다. cheema33: 에이전트에 파일시스템 접근을 주는 편이 MCP 서버보다 빠를 것 | 협업·권한·원자적 에이전트 편집·프라이버시를 **한 스레드에서** 동시에 언급 [확인](요약기 출력) |
| Obsidian 포럼 Relay 소개 [87170](https://forum.obsidian.md/t/relay-multiplayer-plugin-for-obsidian-collaborative-editing-and-folder-sharing/87170) | 2024-08 개설, 2025-03 답변 | 사용자 mlte: "I would have to upload my vault to your server with no privacy guarantees." 개발자 dtkav: E2E 암호화는 "too much complexity in real-time collaboration"이라 아직 못 함, "It makes debugging nearly impossible". 또 붙여넣은 이미지가 공유 안 됨(→ "Universal file sync" 알파). 개발자 발언: AI를 원하면 "add an AI agent to your relay server in the same way you would add any other user." | 서버 신뢰 이슈·이미지 미동기·에이전트=참가자 모델 [확인](검색 발췌) |
| Relay 플러그인 페이지 [community.obsidian.md/plugins/system3-relay](https://community.obsidian.md/plugins/system3-relay) | 날짜 미확인 | "Right now anyone with the share key can join the relay… you can kick the user but they could rejoin… We'll be adding stricter sharing options in the future" | 구버전 문구일 수 있음. 현재 가격표엔 RBAC가 있다 [확인](relay.md/pricing) → **개선은 되었으나 Starter($6) 이상에서만** |
| Obsidian 포럼 권한 스레드 [24108](https://forum.obsidian.md/t/multiple-users-with-per-file-access-permissions/24108) | 2021-09 (마지막 활동도 2021-09) | panos: "we will have documents that not everybody should see." | **오래됨.** 수요의 증거로만 쓰고 최신 현황 근거로는 쓰지 말 것 [확인] |

### 3-2. Reddit (2차 출처 경유 — URL 미검증)

| 인용 | 출처(집계) | 신뢰 |
|---|---|---|
| "I would 100% pay for notion. But the pricing here is insane. I am not a business, im a personal user… Trying to force me into a million enterprise features and AI subscriptions I don't need" — u/More-Key1660, 2026-07 | [hirekai.ai](https://hirekai.ai/blog/notion-pricing) 🔶 (Kai 제품 블로그) | [추정](2차 인용, 신뢰도 중) |
| "Are agents no longer covered by the Business plan? That's kind of a bait and switch, no?" — u/quicksexfm, 2026-02 | 동일 | [추정](중) |
| (긍정) "I spend way more time and get more done in Notion with Notion AI than I do in Claude… practically no limits on AI use" — u/Solowithothers, 2026-07 | 동일 | [추정](중) |
| r/Notion 최다 업보트 Notion AI 스레드(댓글 130+). 상위 댓글(132 업보트): "I wouldn't mind it if it were free, but it's definitely not something worth paying for…" / 또 다른 댓글: "it doesn't know your workspace, it just searches it" | [aitooldiscovery.com](https://www.aitooldiscovery.com/guides/notion-ai-reddit) 🔶(툴 리뷰 사이트) | [추정](중하. 업보트 수치는 검증 불가) |
| "new users will only have access to AI if they take the business plan" | W4가 인용한 costbench | [확인](W4 findings #5) |
| 집계: HN 스레드 3개(Notion's Mid-Life Crisis, Notion 3.0, 2025-05 가격 변경)의 불만 60+건 분석에서 가격 구조 개편이 "신뢰 훼손(high, 82%)" | [retentioncheck.com](https://retentioncheck.com/blog/notion-churn-analysis) 🔶(분석 SaaS 마케팅) | [추정](하~중. 방법론 자체가 홍보 목적) |

**r/ObsidianMD·r/PKMS·r/productivity: 직접 스레드 근거 없음.** "공유·권한·AI·검색" 논점을 이 서브레딧에서 직접 수집하지 못했으므로 아래 빈도표는 포럼·HN·블로그 기반이다.

### 3-3. 팀 사용의 우회(워크어라운드) 증거
- Obsidian Git 플러그인 모바일은 문서 자체가 "very unstable"이라 권고하지 않고, "Two people editing the same note between pushes produces a merge conflict, not a merged note." [확인](https://www.blogarama.com/technology-blogs/1454693-Stephan-Miller-Blog/78830726-obsidian-git-sync-2026-what-actually-works-mobile, 2026-08-03)
- XDA(2026-03-01) 댓글: "Git Plug-in for obsidian. Problem solved" / "Obsidian is magical until you try to sync your vault into different devices. Even the official paid sync option has undesirable upside." [확인](https://www.xda-developers.com/obsidian-can-be-a-co-working-platform/)
- Relay 자체 후기(**🔶 제품 공식 사이트 인용**): "so many people that love obsidian and to give them the ability to collaborate is totally worth money." [확인](https://relay.md/relay) — 수요 증거이나 큐레이션됨.

---

## 4. 한국 커뮤니티

| 출처 | 날짜 | 핵심 | 종류 |
|---|---|---|---|
| **셀피쉬클럽(비개발자 9명 팀)** — [LinkedIn 글](https://www.linkedin.com/feed/update/urn:li:activity:7446911702195068928) · [Glasp 인터뷰 요약](https://glasp.co/youtube/haM_DjiA5C8) · [Brief5](https://brief5.com/claude-code-obsidian-team-automation-selfishclub/) | 2026-04-06 / 04-27 / 06-26 | 노션으로 3주 아카이빙 → "과제가 쌓이는데 활용이 안 되는" 문제 → **옵시디언+GitHub+Claude Code**로 전환. **"옵시디언의 실시간 동기화가 유료이기 때문에" 각자 작성 후 GitHub push**로 우회. 비개발자용 **GitHub 워크숍**까지 진행. 실시간 협업이 필요한 주간 회의 문서는 **여전히 노션**에서 MCP로 가져옴. "노션이 AI를 하는 데 있어 허들이 될 수 있다는 글"을 보고 시도. Brief5는 "구조 변경 시 git 충돌, 권한 구조 검토" 필요하다고 덧붙임 | 사례 [확인]. 같은 사례의 3개 사본이라 **독립 출처는 1건**. 팀 홍보성(LinkedIn)·콘텐츠 사이트 요약 🔶 |
| **긱뉴스** [topic 8256](https://news.hada.io/topic?id=8256) | 2023-01 (댓글 50) | popopo: "협업 용으로는 다소 부적합합니다", "웹 출판 기능과 동기화 기능이 비싸고", 협업은 GitHub. clockoon: "협업용은 역시 노션이 제일 낫지 않을까" | 구버전. **2023 시점 증거**로만 사용 [확인] |
| 긱뉴스 [21710](https://news.hada.io/topic?id=21710) "두 번째 브레인을 삭제함" | 2025-06-29 | 세컨드 브레인 유지 부담론. 댓글에 "지식 베이스가 엉망이고… 버리고 더 나은 걸 만들자! … 새것도 금방 똑같이 망가짐" | 번역 요약 [확인]. 도구 니즈가 아니라 **습관/가치 회의론**이라 시장 축소 요인 |
| 긱뉴스 [23408](https://news.hada.io/topic?id=23408) | 2025-10-02 | Claude Code가 Obsidian(로컬 평문 마크다운)과 붙을 때 강력한 이유 = 파일시스템 접근. "ChatGPT나 브라우저 Claude의 치명적 결함: 대화 간 메모리 부재와 좁은 컨텍스트" | 번역 [확인] |
| 긱뉴스 [27464](https://news.hada.io/topic?id=27464) Show GN | 2026-03-13 | Claude Code 대화를 Obsidian 지식 그래프로 자동 연결. 로컬 LLM 사용 이유: "사내 코드가 외부로 유출될 걱정이 없습니다" | 제작자 글 🔶 [확인] |
| 긱뉴스 [32328](https://news.hada.io/topic?id=32328) Show GN "Obsidian Everywhere" | 2026-08-10 | 원격 에이전트가 로컬 vault를 쓰게 하려는데 "vault를 통째로 다른 서비스에 올리거나 파일을 grep으로만 훑는 것 말고 다른 방법이 마땅치 않아서" 제작. 기본 읽기 전용, dry-run 벌크 편집·롤백 스냅샷·Mount Guard | 제작자 글 🔶 [확인] |
| 브런치 [never-sleep/265](https://brunch.co.kr/@never-sleep/265) | 2026-05-14 | 노트가 Notion·메모앱·Discord 등에 흩어짐, "키워드 검색은 뭘 찾는지 알 때만 유효", 민감 데이터는 접근 통제 필요. "저장이 아니라 다시 꺼내기" | 블로그 [확인](요약기 출력) |
| [종모IT](https://jongmoit.com/notion-vs-obsidian/) | 2026-03-23 | "협업은 노션, 개인 지식 관리는 옵시디언", 5명 Plus = 월 $50, Obsidian 팀 공유는 "Git 동기화 플러그인이나 Obsidian Sync($50/년)를 별도로 설정" | 블로그 [확인] |
| [GPTers](https://www.gpters.org/dev/post/notion-subscription-fee-0-IBEaVI2GEXZfeXH) | 2026-06-18 | 비영리 2인 팀이 노션 구독료·용량 제한에 지쳐 Claude Code로 자체 업무 OS 제작 | 사례 [확인] |
| 디스콰이엇 [ideaStorming](https://disquiet.io/posts/OGCwwZ) | 2026-07-15 | AI 답변을 마크다운으로 저장, **워크스페이스 공유 권한** 포함, "노션 대체제라기보다는" | 제작자 글 🔶 [확인] |
| 디스콰이엇 [untactit](https://disquiet.io/products/untactit) | 2026-09 경 | 에이전트가 읽는 스킬·지침·메모리를 팀 단위로 승인·배포. 팀 플랜 **편집자 1인당 월 $60**, 뷰어 무료, 프리런치 | 제작자 글 🔶 [확인] |
| 바질리 블로그 | 2026-03-19 | "노션 세팅에만 3주… PM만 매일 열고 나머지는 카톡으로 돌아갔다" | **🔶 경쟁 제품 홍보글**. 인용 시 주의 |

### 한국어 검색 — 직접 불만 근거는 **못 찾았다**
- Obsidian/Notion의 한글 검색 불만을 직접 다룬 스레드: **0건 확인.** (긱뉴스·디스콰이엇·네이버·클리앙 키워드 검색 모두 해당 없음)
- 간접 신호:
  - Obsidian에 **초성·중성·종성 검색**을 붙이는 커뮤니티 플러그인 "Korean Omnisearch"가 존재 [확인](https://github.com/BrianJChoi/obsidian-hangul-search, 한글 정리 글 2025-07: https://anpigon.pages.dev/…/한국어-초성-검색-Korean-Omnisearch). → 기본 검색에 이 기능이 없어 사용자가 직접 메우고 있다는 정황 [추정](신뢰도 중).
  - Obsidian 포럼 Korean 태그의 주 이슈는 **입력(IME)**: "Cannot type Korean in Wayland", "Korean input causes line merge on second character in macOS". 검색이 아니라 입력 버그. [확인](https://forum.obsidian.md/tag/korean/158 검색 발췌)
  - 2023 블로그: 옵시디언 구글 검색 플러그인에서 "어절 단위로는 검색이 안 되고 단어 단위로만 검색". [확인](https://slowdive14.tistory.com/1300011) — 플러그인 한정, 구버전
  - Inkdrop 포럼 "I just want to search in Korean" 스레드는 FTS 모듈 교체 후 한글 검색 지원. [확인](https://forum.inkdrop.app/t/i-just-want-to-search-in-korean/975 — 제목·요약만 확인)
  - Obsidian 공식 한글 검색 도움말에는 형태소·초성 연산자가 없고 `file:`/`path:`/`content:`/`tag:`/정규식 등만 있다. [확인](https://obsidian.md/ko/help/plugins/search)
  - Obsidian 1.14.x 변경 로그의 검색 개선은 "fuzzy matching"·경로 매칭이다. [확인](changelog)
- 결론: **한국어 검색 갭은 "있을 법하다"는 수준이며 수요의 크기는 입증 못 했다.** [추정](근거: 위 간접 신호 4개 + 직접 불만 0건, 신뢰도 하~중)

---

## 5. 2026년 "팀 + AI 에이전트가 함께 쓰는 지식베이스" 신생 제품

| 제품 | 유형·라이선스 | 팀 협업 | 에이전트 접점 | 대상 출처 | 홍보성 |
|---|---|---|---|---|---|
| **OpenKnowledge** (Inkeep) | OSS(GPL), macOS/Win/Linux 앱 + 웹 CLI. 평문 .md 폴더, Obsidian vault 열기 가능 | **사람↔사람은 git/GitHub 자동 동기화(수 분 지연)**. 에이전트↔사람은 로컬 Yjs. 실시간 공동편집은 "looking at", "중앙 CRDT 서버 옵션은 near future" | Claude·Codex·Cursor 연동, 내장 MCP·스킬·검색, 에이전트가 만진 파일 diff·undo·삭제/이동 승인 | [HN 48675435](https://news.ycombinator.com/item?id=48675435)(381점), [XDA 2026-10-09](https://www.xda-developers.com/tried-free-open-source-obsidian-alternative-open-knowledge/), [GitHub](https://github.com/inkeep/open-knowledge) | HN 글은 제작자 🔶. XDA는 독립 리뷰이나 팀 기능은 다루지 않음. 제작자가 "VCs" 언급 [확인] |
| **Tela** (zcag) | OSS 셀프호스트 마크다운 팀 위키(Go+Postgres+React/Milkdown), 클라우드 telawiki.com 무료 티어 | **Yjs 실시간 멀티커서**, 댓글, 백링크, 조직·초대 | `/api/mcp` 내장, PAT 기반 스코프별 쓰기 권한, pgvector 의미검색 | [GitHub](https://github.com/zcag/tela). awesome-mcp-servers 추가(2026-07)는 검색 요약만 | README 자기서술 🔶 |
| **Onyx agent-wiki** | OSS, **git 기반 .md 파일시스템** | Tiptap+Yjs 실시간 공동편집(사람·에이전트 동시), 댓글, Trash 30일 | MCP, 외부 시스템 API push, LLM 트리거 | [GitHub](https://github.com/onyx-dot-app/agent-wiki) | README 🔶 |
| **Isomorphic "Org Brain"** | AGPL-3.0, GitHub repo가 저장소, Cloudflare Worker MCP | 조직·역할(viewer<editor<admin<owner), 이메일 매직링크, **보호된 brain은 커밋 대신 PR** | Claude 커넥터 + MCP App(WYSIWYG 편집기), `write_page` 앵커 매칭 불일치 시 전체 중단, `move_page`가 인바운드 링크 갱신 | [GitHub](https://github.com/isomorphic-team/isomorphic-app) | README 🔶 |
| **doci** (dklymentiev) | OSS 셀프호스트(PHP+Postgres), 문서 CRUD 한 건=git 커밋 | 문장 앵커 스레드, 리버스 프록시 인증 | MCP 12개 도구 | [GitHub](https://github.com/dklymentiev/doci) | README 🔶. 자기 범위 밖으로 "실시간 공동편집→HedgeDoc"를 명시 [확인] |
| **Ambiguous Wiki** | SaaS, "AI coworker"가 문서 유지 | 실시간 협업 기본 | MCP/REST, ProseMirror JSON 블록 패치, .md 임포트/익스포트 | [ambiguous.ai/applications/wiki](https://www.ambiguous.ai/applications/wiki) | 🔶 |
| **Motion** | 프론트엔드 전용, GitHub이 DB | — | 브라우저↔에이전트 WebSocket MCP | [motion.wencai.app](https://motion.wencai.app/) | 🔶 |
| **Hjarni** | SaaS, MCP 내장 KB | — | 에이전트가 쓴 노트를 다음 에이전트가 사용 | [hjarni.com](https://hjarni.com/blog/knowledge-base-for-ai-agents) | 🔶 블로그가 자사 제품 소개 |
| **untactit** (한국어 페이지) | 에이전트용 스킬·지침·메모리 **거버넌스** (노트앱 아님, 인접 영역) | 4개 역할 서버 강제, append-only 감사 로그, 승인 후 배포 | Claude·Cursor·Copilot·Gemini·MCP·AGENTS.md | [disquiet.io/products/untactit](https://disquiet.io/products/untactit) | 🔶 프리런치. Shopify CEO "Claude Code 금지 고려" 인용(2026-08-25)은 이 페이지를 통한 **2차 인용이라 미검증** |
| **기존 사업자의 확장** | Slite Agent, Granola MCP/API, Outline AI, Notion Custom Agents, Atlassian Rovo | 모두 기존 팀 기능 위에 얹음 | §2 표 참조 | — | — |

핵심 관찰
1. **2026년에 이 카테고리는 이미 붐비고 있다.** 위 신생 OSS 5개 이상이 같은 조합(마크다운 + MCP + Yjs/git + 팀)을 내걸었다. [확인](각 GitHub README) 단 전부 자기 서술이고 사용자 수·불만은 못 확인했다 → 실사용 품질은 **미검증**.
2. **"팀 실시간 + 로컬 .md 우선 + 에이전트"를 한꺼번에 실제 제공한다고 입증된 제품은 확인되지 않았다.** OpenKnowledge는 사람↔사람이 git 지연 동기화, Relay는 .md 협업은 되나 AI 에이전트 제품은 없다고(2025-03 발언) 했고 이후 상황은 미확인. [확인](HN 48675435, forum 87170) / 이후 변화는 [추정](신뢰도 하)
3. **구조적 선택이 갈린다:** git 기반(OpenKnowledge, Onyx, Isomorphic, doci, Motion) vs CRDT 서버(Tela, Relay). 이 둘 사이의 지연·충돌 차이가 사용자 불만의 원천(§3-3)이다. [추정](중)

---

## 6. 페인포인트 빈도·강도 표

> **빈도** = 이번 표본에서 독립 출처 수(대략). **강도** = 상(도구를 갈아탐/직접 돈 문제/포기), 중(우회책 사용·불편 토로), 하(바람 수준). 모두 표본 한정 수치.

| # | 페인포인트 | 빈도 | 강도 | 대표 근거 | 비고 |
|---|---|---|---|---|---|
| P1 | **로컬 .md 도구에서 다인 동시편집 불가·충돌** (Obsidian 중심) | ~10 | **상** | HN 47759055, HN 48675435(cheema33 "Obsidian doesn't do team", 자체호스팅 Outline로 이동), 포럼 다수, 긱뉴스 8256, 종모IT, 셀피쉬클럽 | 가장 일관됨. 해결책(Relay 등)이 있는데도 반복됨 → **인지도·설정 장벽**일 수 있음 [추정](중) |
| P2 | **AI 가격 번들·좌석 강제 (Notion)** | ~6 | **상** | hirekai(Reddit 3인용), aitooldiscovery, retentioncheck, W4 #4~5 | "AI만 쓰고 싶은데 Business 구매" 불만. 개인·소규모에서 격렬 |
| P3 | **AI 연결 마찰** (MCP·플러그인·권한) / "에이전트는 파일시스템이 편하다" | ~8 | 중~상 | W4 #1~3, 포럼 Obsidian MCP(2025-05, W4 소스), cheema33, OpenKnowledge 런칭 글("didn't integrate well with Claude/Codex outside of community plugins"), 셀피쉬클럽(워크숍 필요), 긱뉴스 23408 | 비개발자 쪽 고통은 W4가 이미 다룸 |
| P4 | **팀 동기화가 유료이거나 지연·충돌** → git으로 우회 | ~5 | 중 | 셀피쉬클럽("실시간 동기화가 유료"), 긱뉴스 8256("동기화 비싸고"), Git 플러그인 글, OpenKnowledge 수 분 지연 | 우회책 비용이 큼: 비개발자에게 git 교육 필요 |
| P5 | **서버에 vault를 올리는 것에 대한 거부감·프라이버시** | ~5 | 중 | forum 87170(mlte), HN altmanaltman, 긱뉴스 32328·27464, 브런치(민감정보) | Relay는 E2E 미지원(제작자 발언). 셀프호스트가 대답 |
| P6 | **폴더·노트 단위 접근 권한** | ~6 | 중 | HN abdullin("basic access controls for team setup" 고민), forum 24108(구버전), Relay RBAC는 Starter 이상, Granola 워크스페이스 공유 설정은 Enterprise만, Capacities는 팀 자체 없음 | 수요 신호는 약하지만 **유료 티어 경계가 곳곳에서 권한에 걸려 있다** |
| P7 | **에이전트 쓰기의 안전성**(원자적 다문서 변경, undo/diff, 승인) | ~5 | 중 | HN abdullin, OpenKnowledge(diff·undo·삭제 승인), Isomorphic(반쪽 적용 금지, PR), 긱뉴스 32328(롤백 스냅샷) | 대부분 **제작자 쪽 서술** 🔶. 사용자 직접 불만은 약함 |
| P8 | **Notion 복잡성·비용·용량** | ~4 | 중 | GPTers, 종모IT, Trustpilot 좌석 과금(W4 #6), 바질리(🔶) | |
| P9 | **Notion/AI 질의응답이 큰 워크스페이스에서 못 찾음** | ~2 | 중 | aitooldiscovery, webverdict(🔶) | 둘 다 2차 |
| P10 | **이미지·첨부 동기화 미흡**(Relay) | ~2 | 하~중 | forum 87170(개발자: 알파 단계), Relay Free 플랜은 .md만 | 가격 티어에 의해 제한 |
| P11 | **한국어 검색 품질** | 직접 0 / 간접 4 | **미확인** | §4 | 수요 크기 입증 못 함 |
| P12 | **에이전트 지침·메모리 파일의 팀 단위 분기(split-brain)** | ~2 | 하~중 | untactit 🔶 (+Shopify CEO 인용은 미검증) | 신호 약함. 이 영역은 새 카테고리일 가능성 [추정](하) |
| P13 | 세컨드 브레인 자체에 대한 회의(저장 강박) | ~2 | 하 | 긱뉴스 21710, 브런치 | 니즈 **축소** 요인. 팀 맥락과는 거리 |

---

## 7. "아무도 제대로 안 하는 것" — 근거와 함께

> 주의: "아무도 안 한다"를 증명할 수는 없다. 아래는 **내가 확인한 범위 안에서 충족한다고 입증된 제품이 없는** 항목이며, 각 항목에 반례 후보를 병기했다.

| # | 공백 | 근거 | 반례·경쟁 후보 | 확신 |
|---|---|---|---|---|
| G1 | **로컬 .md 소유 + 사람끼리 키 입력 단위 실시간 + 폴더/노트 단위 권한 + 서버 비신뢰(E2E 또는 셀프호스트)를 한 제품에서** | Relay는 실시간·폴더 공유·셀프호스트는 가능하나 E2E는 제작자가 "복잡해서 아직" 발언, 이미지 동기화는 알파였음, RBAC는 $6 이상, Obsidian 앱 의존. OpenKnowledge는 사람↔사람이 git 지연. Obsidian Sync는 병렬 편집용이 아님 | Relay(가장 가까움), Tela(서버 기반, 로컬 파일 아님) | [추정](근거 §3-1, §5, 신뢰도 중) |
| G2 | **AI 에이전트가 사람과 같은 CRDT 층에서 동시 편집 + 같은 권한 모델 + 감사 로그** | OpenKnowledge: 에이전트↔사람은 로컬 Yjs이나 팀 간은 git. Isomorphic: 에이전트는 git 커밋/PR. Tela·Onyx는 주장하나 자기 서술뿐. Notion/Slite/Granola는 에이전트가 있으나 로컬 .md 소유는 아님 | Tela, Onyx agent-wiki (미검증 주장) | [추정](중). **붐비는 카테고리라 "없다"가 아니라 "미입증"** |
| G3 | **비개발자가 터미널·JSON·git 없이 팀 지식베이스에 AI를 연결** | 셀피쉬클럽은 비개발자 9명에게 **GitHub 워크숍**이 필요했고 회의 문서는 노션에 남김. W4 #1~3의 MCP 진입장벽 | Notion MCP, Granola/Slite MCP(클라우드 계정 기반) | [확인](Glasp 요약) + W4 인용. 일반화는 [추정](중) |
| G4 | **AI 구독 BYO(내 Claude/ChatGPT 계정)를 팀 지식베이스에 그대로 연결하면서 좌석 번들 요금 없이** | Notion 번들 반발(P2). Reflect(BYO 키)·OpenKnowledge(설치된 CLI 재사용)는 개인/로컬 한정. 팀 단위 BYO + 권한 상속은 확인 못 함 | — | [추정](중하) |
| G5 | **한국어(형태소·초성) 1급 검색이 기본 탑재된 팀 노트** | Obsidian은 커뮤니티 플러그인에 의존(Korean Omnisearch). 다른 제품은 한국어 검색 품질 자료를 못 찾음 | Inkdrop(교체 후 한글 지원) | [추정](**하~중**: 직접 불만 0건) |
| G6 | **팀 + 에이전트의 변경 검토 UX**(누가·무엇을·어느 문서에 썼는지 diff, 일괄 되돌리기, 삭제·이동 승인) | OpenKnowledge는 로컬 개인 범위, Isomorphic은 git/PR 범위. 실시간 다인 편집 중 에이전트 변경을 한 화면에서 되돌리는 제품은 확인 못 함 | Isomorphic(PR), Obsidian Everywhere(개인) | [추정](중하) |
| G7 | **에이전트 지침·메모리의 팀 단위 정본 관리** | untactit이 자체 카테고리로 주장. 아직 프리런치. 수요는 미입증 | untactit 🔶 | [추정](하) |

### 반대로 "빈 곳이 아닌 것" (조심할 것)
- **MCP 노출 자체**: Slite(Basic부터), Granola(Business부터), Notion, Tela, Onyx 등 흔해짐. [확인](§2, §5) 차별점으로 내세우기 어렵다.
- **Obsidian+Relay 조합**: $5~6로 이미 소규모 팀에는 해결책이다. P1이 반복되는 건 해결책 부재라기보다 **인지·설정·가격 경계** 때문일 수 있다. [추정](중)
- **에이전트용 마크다운 위키 일반**: 2026년에 OSS가 쏟아졌다. 후발 진입은 "무엇이 더 낫다"의 증거가 필요하다.

---

## 8. 미해결 (다음 라운드 후보)

1. Reddit 원문 스레드 URL 확보 — 현재 사용 가능한 도구로는 도메인 검색이 안 됐다. 브라우저 도구(Claude in Chrome)로 reddit 검색을 열어보는 것이 가장 직접적.
2. Reflect 구독 단가·Logseq 공식 가격·Confluence 좌석 단가·Saga 전체.
3. Tela/Onyx/Isomorphic의 실사용 후기·GitHub 스타·이슈(현재는 README 자기서술뿐).
4. 한국어 검색: 실제 사용자 불만을 모으려면 네이버 카페·옵시디언 한국 사용자 모임·OKKY 직접 검색이 필요(검색 엔진 키워드로는 0건).
5. Relay에 2025-03 이후 AI 에이전트 기능이 추가됐는지(Document API는 Premium에 있음 [확인](relay.md/pricing)).

---

## 9. 출처 목록(주요, 신뢰도 구분)

**공식·1차:** obsidian.md/pricing · obsidian.md/changelog · relay.md/pricing · capacities.io/pricing · heptabase.com/pricing · tana.inc/pricing · get.mem.ai/pricing · reflect.app · anytype.io/pricing · business.anytype.io · doc.anytype.io/…/monetization · granola.ai/pricing · slite.com/pricing · getoutline.com/pricing · support.atlassian.com/rovo/docs/rovo-usage-limits · notebooklm.google/plans · gemini.google/subscriptions

**포럼·HN·커뮤니티(1차 발언):** news.ycombinator.com/item?id=47759055, 48675435 · forum.obsidian.md/t/…/87170, 24108 · news.hada.io/topic?id=8256, 21710, 23408, 27464, 32328

**독립 2차(블로그·미디어):** xda-developers.com (2026-03-01, 2026-10-09) · blogarama(Stephan Miller 2026-08-03) · jongmoit.com · brunch.co.kr/@never-sleep/265 · gpters.org · glasp.co · brief5.com

**🔶홍보성/이해관계 있음:** hirekai.ai(Kai) · aitooldiscovery.com · retentioncheck.com · webverdictai.com · eesel.ai · checkthat.ai · relay.md/relay(큐레이션 후기) · 제작자 README(Tela, Onyx, Isomorphic, doci, Motion, Hjarni, Ambiguous) · disquiet.io 제품 페이지(untactit, ideaStorming) · blog.basily.space · LinkedIn 팀 홍보글
