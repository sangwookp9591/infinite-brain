# W5. 비개발자용 AI·MCP 연결/생산 방법 조사 + Baalda 결합 지점 매핑

- 작성일: 2026-10-14 · 대상: Baalda 0.1.83 오픈소스(`/Users/iron/Project/psw/baalda`) · 저장소 파일은 읽기 전용으로만 다룸(수정 없음), 사용자 실제 볼트는 접근하지 않음.
- 태그 규칙: **[확인]** = 파일:줄 / 실행 출력 / URL로 직접 본 것. **[추정]** = 근거 + 신뢰도(상/중/하).
- GitHub 수치(stars·last push·license)는 2026-10-14에 `gh api repos/<owner>/<repo>`로 직접 조회한 값이다 [확인](실행 출력).

---

## 0. 한 장 요약 (결론 먼저)

1. **Baalda는 "AI가 Baalda에 접속하는" 쪽(MCP 서버 + OAuth 2.1 + DCR)과 "설치된 CLI를 로컬에서 돌리는" 쪽(agent_runner.rs)을 이미 갖고 있다.** 비개발자가 막히는 지점은 기술 부재가 아니라 **UX(복붙 토큰·터미널 명령)와 권한 단위(읽기 전용 커넥터 불가)** 이다.
   - [확인] 데스크톱 MCP 탭은 토큰을 발급해 `claude mcp add --transport http context <url> --header "Authorization: Bearer …"` 명령을 보여준다 (`app/apps/desktop/src/components/VaultSettingsDialog.tsx:1980`). 터미널을 쓰는 사람 기준 UX다.
   - [확인] 그러나 서버는 이미 Claude 커스텀 커넥터가 요구하는 OAuth(PRM·AS 메타데이터·DCR·PKCE S256)를 낸다: `https://api.baalda.com/.well-known/oauth-authorization-server` 실행 출력에 `registration_endpoint`, `code_challenge_methods_supported:["S256"]` 존재. 즉 **claude.ai/ChatGPT에서 "URL 한 줄 + 로그인 + 볼트 선택"만으로 연결**은 이미 가능하다(추가 개발 최소).
2. **"로그인으로 AI 연결"은 회사마다 정책이 크게 다르다.**
   - **OpenAI**: 공식 *Sign in with ChatGPT(SIWC)* 프로그램이 있고, **오픈소스·로컬 앱**에는 자체 등록(dynamic_agent_client) 경로를 열어 두었다. 상업/원격 호스팅 앱은 "선별된 파트너 + 관심 폼"이다. Baalda 데스크톱은 오픈소스 로컬 앱이라 **합법적 후보 경로가 존재**한다(단, 서버 경유 사용은 별개 문제). [확인](URL 아래 §1.1)
   - **Anthropic**: 제3자가 claude.ai 로그인/구독 토큰을 제품에 넣는 것을 **금지**한다. 허용되는 패턴은 "사용자가 **수정되지 않은 Claude Code 바이너리**에 자기 구독으로 로그인". 이는 Baalda의 `agent_runner.rs`(설치된 CLI를 spawn)와 정확히 같은 구조라 **지금 구조가 약관상 안전한 쪽**이다. [확인](URL 아래 §1.1)
   - **비공식 토큰 재사용(auth.json·OAuth 토큰 추출, localhost 프록시)은 위험** — OpenAI는 "ChatGPT 토큰 재사용"에 대해 명시적 허가 문구가 없고(직원도 법률 답변 거부), Anthropic은 명시적 금지. Baalda는 하지 말 것.
3. **노코드 MCP 생성은 "직접 만드는 도구"보다 "연결(OAuth 위임) 게이트웨이를 붙이는 것"이 비개발자에게 현실적.** 라이선스 주의: n8n(Sustainable Use), Pipedream(Source Available), Smithery CLI(AGPL), Zapier(비공개)는 **번들·재배포 불가/제약**. 결합 후보로 안전한 건 **MIT/Apache**: FastMCP(Apache-2.0), mcp-use(MIT), Composio SDK(MIT), openapi-mcp-generator(MIT).
4. **MCP 스펙이 2026-07-28로 바뀌었다 — Baalda 서버는 2025-06-18 기준.** (stateless, `initialize` 제거, DCR **deprecated** → CIMD 권장). 현재 연결은 되지만, **CIMD·`iss` 파라미터·scope 미지원**은 곧 부채가 된다. Better Auth `mcp` 플러그인은 "곧 deprecated"이고 `@better-auth/cimd`가 별도로 존재한다. [확인](아래 §2.4, §3)
5. **새로 필요한 것 TOP3** (§4 표 참조): ① 읽기전용/권한 범위(scope) 커넥터 + 연결 관리 UI, ② "AI 연결" 원클릭 마법사(앱 안에서 Claude/ChatGPT/Cursor별 딥링크·URL 복사·상태 확인), ③ OAuth 최신화(CIMD + `iss` + scope + `server/discover`).
6. **"Aside" 사이드패널형 제품은 조사에서 특정하지 못했다**(§1.4 참조). 사이드패널 AI의 일반 구조(확장/호스트가 모델을 직접 호출, 키는 클라이언트 보관)로만 정리했고, 정확한 제품명을 받으면 보강 가능.

---

## 1. 조사 결과 (4개 축)

### 1.1 축 1 — 로그인으로 AI 연결

#### (a) OpenAI 계열

| 후보 | 무엇 | 공식 허용 범위 / 약관 | 위험 | 결합 난이도 | URL |
|---|---|---|---|---|---|
| **Sign in with ChatGPT (SIWC) — 오픈소스 토큰공유 경로** | 앱이 PKCE 루프백 OAuth로 사용자 ChatGPT **플랜 사용량**을 쓴다. `client_id=dynamic_agent_client` + `ext_agent_host_id` + `agent_name_hint`로 첫 등록 → `oaiapp_…` client_id 발급, **client secret 불필요**. 엔드포인트 `https://auth.openai.com/api/accounts/authorize`·`/oauth/token`, scope `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`, redirect는 **`127.0.0.1` 루프백만(localhost 불가)** | 문서가 다루는 범위는 "open-source and locally hosted apps". **유료/원격 호스팅 앱은 범위 밖 → 관심 폼**. 접근은 **Responses API 요청에 한정**, "ChatGPT 대화나 계정 컨텍스트 접근 권한은 주지 않음" | **중** — 공식 경로지만 *프리뷰*. 제약: `store:false`, `stream:true`, 호스티드 MCP/커넥터·file search·Code Interpreter·`tool_search` 미지원 (Preview limitations) | **중** — Baalda에 루프백 리스너(oauth.rs)가 이미 있어 "열기→콜백→코드 교환" 뼈대 재사용 가능. 토큰 보관(키체인)·갱신·Responses 스트리밍 어댑터가 신규 | https://developers.openai.com/siwc · https://developers.openai.com/siwc/token-sharing-open-source · https://developers.openai.com/siwc/token-sharing-open-source/sign-in · https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations |
| SIWC — 상업 파트너 경로 | 웹사이트/플러그인용 로그인 + 플랜 사용 | "select group of commercial partners", 관심 폼 대기 | 높음(접근 자체가 불가) | 대기열 | https://developers.openai.com/siwc/request-client-id |
| **Codex CLI 로그인 흐름** | `codex login`(브라우저 PKCE, 로컬 콜백 포트 1455) / `codex login --device-auth`(기기 코드, 베타). 자격증명은 `~/.codex/auth.json` 또는 OS 키체인(`cli_auth_credentials_store`) | 공식 문서: 지원 클라이언트는 ChatGPT 데스크톱·CLI·IDE 확장. **CI/프로그램 워크플로는 API 키 권장**, "auth.json은 비밀번호처럼 취급". 제3자 앱 사용에 대한 언급 없음 | 사용자가 설치한 **공식 CLI를 실행**하는 건 안전. **auth.json을 읽어 다른 곳에 쓰는 건 위험** | **낮음**(이미 구현됨 — agent_runner.rs) | https://learn.chatgpt.com/docs/auth (← developers.openai.com/codex/auth 308 리다이렉트) |
| **Codex app-server** (JSON-RPC over stdio) | 리치 클라이언트(VS Code 확장)가 쓰는 인터페이스. `account/login/start`(`apiKey`/`chatgpt`/`chatgptDeviceCode`/실험적 `chatgptAuthTokens`), 스레드·승인·스트리밍 이벤트 | 문서: "app-server 인증은 **상업·호스팅 서비스에 허용된 적 없음**", SIWC로 이전 권장. app-server·WebSocket은 *experimental, 프로덕션 비지원* | 중(실험적·불안정 스키마) | 중~상 | https://learn.chatgpt.com/docs/app-server · https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server |
| 비공식 토큰 재사용(OpenClaw류 localhost 프록시) | Codex 로그인 토큰을 다른 앱이 가져다 씀 | OpenAI 직원은 "변호사가 아니라 답할 수 없다 / OpenCode 같은 OSS가 비슷한 일을 한다 / 법률 자문을 받아라"로만 답함. 이후 질문들은 무응답 | **높음(회색지대·정책 변경 시 차단 가능)**. Baalda 채택 금지 권고 | — | https://github.com/openai/codex/discussions/8338 · https://github.com/openai/codex/issues/10974 (제3자용 SIWC 요청, 검색 결과상 "not planned"로 종료 — 단 이슈 페이지 직접 열람은 404여서 **[추정 중]**) |
| **ChatGPT 커넥터(커스텀 MCP)** | ChatGPT가 *우리* 원격 MCP 서버에 붙는 방향. Plugins → "Add custom MCP server" → 공개 HTTPS URL(`/mcp`) 또는 Secure MCP Tunnel → 인증 설정 | 계정·워크스페이스 정책이 적용됨. 플랜·개발자 모드 요건은 **출처마다 상충**(Zuplo: Pro/Team/Enterprise/Edu; 다른 글: Pro는 읽기 전용) → 공식 문서에서 확인 못 함 | 낮음(공식 경로) / 플랜 요건 **[추정 하]** | **낮음** — 이미 OAuth+DCR 제공 | https://learn.chatgpt.com/docs/extend/mcp · https://developers.openai.com/apps-sdk/deploy/connect-chatgpt |
| **OpenAI Apps SDK** | MCP 서버 + (선택) 위젯 UI를 ChatGPT 안에 표시. 인증: PRM(`/.well-known/oauth-protected-resource`), PKCE S256, **`resource` 파라미터를 토큰 audience로**, CIMD 우선·DCR 허용, 고정 리다이렉트 `https://chatgpt.com/connector_platform_oauth_redirect`(또는 `…/connector/oauth/{callback_id}`), 머신-투-머신 grant 미지원, 도구별 `securitySchemes` + `_meta["mcp/www_authenticate"]` | 공식. 앱 디렉터리 제출은 별도 심사 | 낮음 | 중 — **audience(resource) 검증을 Baalda가 지금 안 함**(§2.3) | https://developers.openai.com/apps-sdk/build/auth · https://github.com/openai/openai-apps-sdk-examples (MIT, ★2,369, push 2026-04-15) |

#### (b) Anthropic 계열

| 후보 | 무엇 | 공식 허용 범위 / 약관 | 위험 | 결합 난이도 | URL |
|---|---|---|---|---|---|
| **Claude 커스텀 커넥터(원격 MCP)** | claude.ai/Desktop/모바일/Cowork가 *우리* MCP 서버에 붙음. Customize → Connectors → Add custom connector → URL → "Sign in now / when needed / No sign in" | **Free(1개 제한)·Pro·Max·Team·Enterprise 모두 가능**. Team/Enterprise는 Owner가 추가. 경고: "Anthropic이 검증하지 않은 임의 서비스", 프롬프트 인젝션 주의 | 낮음 | **낮음** | https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp · https://claude.com/docs/connectors/building/authentication |
| Claude 커넥터 인증 요건(서버 측) | `401`+`WWW-Authenticate: resource_metadata` **필수**(200엔 무시), `authorization_servers` **첫 항목만** 사용, DCR/CIMD 둘 다 기본 지원, 고정 콜백 `https://claude.ai/api/mcp/auth_callback`(claude.com 이동 가능), Claude Code는 loopback 임의 포트, PKCE S256, 엔드포인트 응답 10초(refresh 30초), `/token`은 `application/x-www-form-urlencoded`, 공용 클라이언트는 refresh 토큰 **회전** 권장 | 공식 | — | 낮음~중 | 같은 URL |
| **Claude Agent SDK** (Python/TS) | Claude Code의 에이전트 루프·도구·훅·서브에이전트·MCP를 라이브러리로 | "**Unless previously approved**, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use API key…" | **claude.ai 로그인을 Baalda 안에 넣으면 금지**. API 키(Console/Bedrock/Vertex)는 허용 | 중 | https://code.claude.com/docs/en/agent-sdk/overview |
| Claude Code 법무 문구 | "개발자는 claude.ai 로그인을 제 앱에 제공하거나 Free/Pro/Max **플랜 크레덴셜로 사용자 요청을 라우팅할 수 없고**, claude.ai 크레덴셜/세션 토큰을 **수집·저장·중개할 수 없다** … 사용자가 **수정되지 않은 Claude Code 바이너리**에 자기 구독으로 로그인하는 것은 막지 않는다" + "바이너리는 수정 금지, 인증 수단 제거/제한 금지, 최종 사용자가 각자 인증" | 공식(Legal & compliance) | **Baalda의 현재 방식(설치된 CLI spawn)은 이 허용 조항에 부합**, Baalda가 토큰을 읽거나 저장하면 위반 | — | https://code.claude.com/docs/en/legal-and-compliance |

> 참고: 검색 결과에는 "2026-02 법무 문구에 'Agent SDK 포함 OAuth 금지' 명시 → 이후 일부 삭제/혼선(직원 'docs cleanup')" 같은 2차 보도가 있으나, 원문 변천은 직접 확인하지 못했다 **[추정 하]**. 현재 공식 페이지(위 URL, 2026-10-14 열람)의 문구가 기준이다 [확인].

**종합 판정 (Baalda 관점)**
- **안전·즉시**: (1) 우리 MCP 서버를 Claude/ChatGPT **커넥터**로 노출 (사용자가 자기 AI 앱에서 로그인) (2) 설치된 CLI(Claude Code/Codex) spawn — 현재 구현.
- **신중·조건부**: SIWC 오픈소스 경로로 **데스크톱 로컬**에서만 ChatGPT 플랜 사용 (프리뷰·Responses 한정·루프백·로컬 토큰 보관). 서버(api.baalda.com)가 그 토큰을 받아 대신 호출하면 "원격 호스팅 앱"에 해당 **[추정 중]** — 그 경우 파트너 경로가 필요.
- **금지 권고**: Claude 구독 토큰/Codex auth.json 읽어서 재사용, claude.ai 로그인 UI 자체 구현.

### 1.2 축 2 — 노코드 MCP 생성·게이트웨이

| 후보 | 역할 | 라이선스 | 성숙도 (★ / 최근 push) | 결합 난이도 | 비고 / URL |
|---|---|---|---|---|---|
| **Composio** | 1000+ 툴킷·OAuth/키 관리(connected accounts)·Tool Router(단일 MCP로 검색→인증→실행) | **MIT** (SDK) — 매니지드 서비스는 별도 약관 | ★30,537 / 2026-10-14 | 중 (SaaS 의존 시 키·데이터 경로 외부화) | Tool Router는 2025-09 changelog 기준 *experimental* 표기(현재 상태 미확인 **[추정 하]**). https://github.com/ComposioHQ/composio · https://docs.composio.dev/docs/mcp |
| **FastMCP** (Python) | 코드로 MCP 서버. `FastMCP.from_openapi()`로 OpenAPI→MCP 자동 변환, OAuthProxy(DCR 없는 IdP용)·AuthKit/RemoteAuthProvider | **Apache-2.0** | ★28,067 / 2026-10-13 | 낮음(Python 사이드카) | 문서 스스로 "자동 변환 서버는 큐레이션 서버보다 LLM 성능이 낮다, 프로토타이핑용" 권고. https://github.com/PrefectHQ/fastmcp · https://gofastmcp.com/integrations/openapi |
| **mcp-use** | "MCP Apps(ChatGPT/Claude용 위젯) + MCP 서버를 만드는 풀스택 프레임워크" (TS/Python), 인증 프로바이더에 **Better Auth 연동 문서** 있음 | **MIT** | ★10,755 / 2026-10-13 (v2.9.0) | 낮음~중 | Baalda가 Better Auth를 이미 사용 → 문서 직접 참고 가능. https://github.com/mcp-use/mcp-use · https://docs.mcp-use.com/typescript/server/authentication/providers/better-auth |
| **n8n** (+ n8n-mcp) | 워크플로 자동화. **인스턴스 레벨 MCP 서버**(워크플로 단위 opt-in, OAuth2 또는 개인 토큰) + MCP Server Trigger 노드 | n8n: **Sustainable Use License(+`.ee.` 별도)** = 소스공개이나 *비-OSI*, 재배포·상용 제약. `czlonkowski/n8n-mcp`: MIT | n8n ★207,286 / 2026-10-14 · n8n-mcp ★23,063 / 2026-10-13 | 중~상 | **번들 금지**(라이선스). 사용자가 *자기* n8n에 Baalda MCP를 연결하는 시나리오는 OK. https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server |
| **Activepieces** | 노코드 플로우 + "pieces"(커넥터). 프로젝트별 MCP 서버(Streamable HTTP, Bearer) | 코어 MIT, `packages/ee/` 별도 상용 | ★25,041 / 2026-10-14 | 중~상 | 피스를 MCP 툴로 노출하는 기능은 임베딩 SDK(유료 에디션) 문서 — 셀프호스트 커뮤니티판 가능 여부 **[추정 하]**. https://www.activepieces.com/docs/mcp/overview |
| **Pipedream (Connect MCP)** | 앱별 호스팅 MCP(`remote.mcp.pipedream.net/v3`), **사용자별 managed OAuth**, "3,000+ APIs" | **Pipedream Source Available License v1.0**(비-OSS) · 서비스는 상용 | ★11,734 / 2026-10-13 | 중 | 2025-11 Workday 인수 보도(2차) — 장기 의존 리스크 **[추정 중]**. 가격은 공식 페이지에서 확인 못함(2차: Connect $99/월 언급). https://pipedream.com/docs/connect/mcp/developers |
| **Zapier MCP** | 9,000+ 앱/40,000+ 액션을 한 MCP로. OAuth 대부분, Streamable HTTP 필요(SSE 불가), 호출당 2 task 차감, SOC2 Type II | **독점(SaaS)** | — | 낮음(사용자가 URL만 붙임) | Baalda가 "Zapier 쪽 MCP를 쓰는 AI"와 만나는 구조. 번들 불가. https://docs.zapier.com/mcp/home |
| **Smithery** | MCP 레지스트리 + 호스팅 + Connect(OAuth/토큰갱신) | CLI: **AGPL-3.0**(저장소가 `arcadeai-labs/smithery-cli`로 이동, ★840, last push 2026-05-31) | 2026-08 Arcade가 인수했다는 2차 보도 **[추정 중]**(공식 확인 못함) | 중 | AGPL이라 앱에 내장 비권장. 퍼블리시 대상(배포 채널)로만 고려. 공식 문서 직접 열람은 못함. |
| **OpenAPI→MCP 변환기** | `harsha-iiiv/openapi-mcp-generator`(MIT, ★639, 2026-09-26), `tadata-org/fastapi_mcp`(MIT, ★12,021, **last push 2025-11-24 — 정체**), `open-webui/mcpo`(MIT, ★4,400, 2026-05-17; MCP→OpenAPI 역방향), Speakeasy Gram(AGPL-3.0, ★273) | 위 표기 | — | 낮음 | 자동 변환물은 툴 수가 많아 품질 저하(FastMCP 문서 경고와 동일 맥락). |
| **게이트웨이** | IBM `mcp-context-forge`(Apache-2.0, ★4,624), `agentgateway`(Apache-2.0, ★5,320), `docker/mcp-gateway`(MIT, ★1,599), MetaMCP 등 | 위 표기 | 모두 2026-09~10 활동 | 중 | 팀/조직용 *중앙 통제*. 개인용 Baalda 우선순위 낮음. |

**비개발자 관점 결론**: "MCP 서버를 *만든다*"는 일은 Baalda 사용자의 핵심 니즈가 아니다. 필요한 건 (1) 자기 AI(Claude/ChatGPT)를 **Baalda에 붙이는** 일, (2) Baalda 안의 에이전트가 **외부 앱(캘린더·메일 등)을 쓰게** 하는 일이다. (2)는 직접 구현보다 **Composio/Zapier/Pipedream 같은 외부 MCP URL을 "커넥터로 추가"하는 UI**가 현실적이다(우리가 MCP *클라이언트*가 되는 방향 — 현재 없음, §3 참조).

### 1.3 축 3 — 원클릭 연결

| 기술 | 내용 | 성숙도 / 라이선스 | Baalda 적합성 | URL |
|---|---|---|---|---|
| **MCP OAuth 2.1 + DCR/CIMD** | 스펙 2025-11-25: 등록 우선순위 = 사전등록 → **CIMD(SHOULD)** → DCR(MAY) → 사용자 입력. PRM(RFC 9728) MUST, PKCE S256 MUST, `resource`(RFC 8707) MUST. **2026-07-28**: **DCR deprecated**(CIMD 권장), `iss` 파라미터(RFC 9207) SHOULD·클라이언트 검증 MUST, DCR 시 `application_type` 지정, 자격은 issuer별로 보관 | 스펙 저장소 ★9,449, Apache-2.0 전환 중(MIT 병존) | 핵심. Baalda는 DCR만 → CIMD·iss 추가 필요 | https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization · https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization · https://modelcontextprotocol.io/specification/2026-07-28/changelog |
| **Better Auth CIMD 플러그인** | `@better-auth/cimd`로 CIMD 지원, `mcp()`와 조합 시 `metadataProfile: "mcp-2026-07-28"`, Node SSRF 방어(비공개 주소 거부, 리다이렉트 미추적). Better Auth `mcp` 플러그인 문서에 "곧 `oauth-provider`로 대체 예정" 경고 | better-auth MIT, ★30,287 / 2026-10-13 (Baalda는 `^1.6.23`) | **가장 적은 변경으로 CIMD 확보** 가능(검색 결과 기준, 코드는 미실행 **[추정 중]**) | https://better-auth.com/docs/plugins/cimd · https://better-auth.com/docs/plugins/mcp |
| **.mcpb (구 DXT)** | 로컬 MCP 서버를 zip(`manifest.json`)으로 묶어 Claude Desktop 등에서 더블클릭 설치. CLI `@anthropic-ai/mcpb pack`. Node/Python/uv/바이너리 | `modelcontextprotocol/mcpb` ★2,141, latest v2.1.2(2025-12-04), last push 2026-05-26, MIT→Apache-2.0 전환 중 | **원격(HTTP) MCP에는 불필요** — 커넥터 URL로 충분. **의미 있는 용도 = "로컬 볼트 직접 읽기" stdio 서버**(오프라인·서버 없이 .md 접근) 또는 `mcp-remote` 브리지 | https://github.com/modelcontextprotocol/mcpb · https://www.anthropic.com/engineering/desktop-extensions |
| **딥링크 설치** | Cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64 JSON>` (2026-08 포럼에 "카드 미표시" 버그 보고 1건, 미확인). VS Code: `vscode:mcp/install?<URL-encoded JSON>`. Claude Code: `claude mcp add --transport http …`. Codex: `~/.codex/config.toml`의 `[mcp_servers.<name>] url=…` + `codex mcp login <name>` | 각 제품 공식 문서 | **Baalda 앱의 "AI 연결" 화면에서 버튼으로 제공** — 비개발자에게 가장 체감 큰 개선 | https://cursor.com/docs/mcp/install-links · https://code.visualstudio.com/docs/copilot/guides/mcp-developer-guide · https://learn.chatgpt.com/docs/extend/mcp |
| **Baalda 자체 딥링크** | `baalda://` 스킴(+dev `baalda-dev://`)이 이미 등록(`tauri.conf.json:59-61`), `connect`/`invite`/`note`/`signin`/`verified` 처리 존재(`store.ts:325-332, 726-732, 843`) | — | 반대 방향(AI→Baalda 열기)에 재사용: 예) 커넥터 승인 후 "Baalda로 돌아가기" | (저장소 내) |
| `mcp-remote` / `mcp-proxy` | stdio 전용 클라이언트가 원격 MCP에 붙게 하는 브리지(OAuth 포함) | `punkpeye/mcp-remote` MIT ★1,628 / 2026-09-21 | mcpb에 넣어 구형 클라이언트 지원용 **[추정 중]** | https://github.com/punkpeye/mcp-remote |

### 1.4 축 4 — 에이전트 런타임

| 후보 | 역할 | 라이선스 | 성숙도 | 인증/약관 포인트 | 결합 난이도 |
|---|---|---|---|---|---|
| **OpenAI Agents SDK** (Python/JS) | 에이전트 루프, MCP 4종(HostedMCPTool / MCPServerStreamableHttp / Sse / Stdio), `require_approval` | **MIT** | py ★30,022 (2026-10-14) · js ★3,917 (2026-10-10) | **API 키 기반**. SIWC 토큰과의 결합은 Preview limitations(호스티드 MCP 불가) 때문에 제약 | 중 — 서버(Node)엔 JS판 가능. 다만 Baalda는 이미 OpenRouter SDK로 추론(housekeeper) |
| **Claude Agent SDK** | Claude Code 엔진 임베드 (도구·훅·서브에이전트·MCP·권한·세션) | Python MIT(★8,272), **TS 저장소 license 없음(★1,806)** → 상용약관(Commercial Terms) 적용 | 2026-10-14 활발 | **claude.ai 로그인 금지(위 §1.1) → API 키 필요.** 브랜딩: "Claude Code" 명칭 불가, "Claude Agent"/"Powered by Claude" 허용 | 중 — 단 사용자 키 입력(비개발자 허들) 필요. **현 CLI-spawn 방식이 구독 사용자에겐 더 쉬움** |
| **ACP (Agent Client Protocol)** | 편집기↔코딩에이전트 표준(LSP 유사). 로컬은 서브프로세스 + stdio JSON-RPC, 원격은 HTTP/WS(진행 중). **MCP의 JSON 표현 재사용** | **Apache-2.0**, ★4,431 (2026-10-13), schema v1.25.0 | 활발. `agentclientprotocol/claude-agent-acp`(Apache-2.0, ★2,644) = Claude Agent SDK를 ACP로 노출. `zed-industries/codex-acp`는 **archived**(2026-07-22) | 에이전트가 자기 인증을 소유 → **Baalda는 토큰을 만지지 않음** | **중** — agent_runner.rs의 CLI별 하드코딩(`Agent::{Claude,Codex}`)을 ACP 클라이언트로 일반화하면 Gemini CLI 등 확장·권한요청/diff 표시 표준화 가능 **[추정 중]** |
| **Codex app-server** | (§1.1) Codex 엔진을 JSON-RPC로 임베드 | Apache-2.0(openai/codex ★129,071, 2026-10-14, 릴리스 `rust-v0.162.1`) | *experimental* | 상업/호스팅 비허용, SIWC로 이전 권장 | 중~상 |
| **goose** | 오픈소스 로컬 에이전트(MCP 확장 기반) | Apache-2.0, ★55,258 (aaif-goose/goose) | 활발 | 사용자 자체 모델 키 | 참고용(참조 구현) |
| **사이드패널형 AI ("Aside")** | **"Aside"라는 제품은 검색으로 특정하지 못함.** 유사 사례(WebBrain, OpenSidekick, Nanobrowser 등 크롬 확장; Sider Omni Sidebar 등 macOS 사이드바)의 공통 구조: ① 호스트(확장/앱) UI가 **현재 문맥(DOM/접근성 트리/활성 앱 창)**을 모아 ② **사용자 선택 LLM을 직접 호출**(키는 클라이언트 보관, 백엔드 없음)하고 ③ 도구 호출은 호스트가 중개 | OpenSidekick MIT 등(미검증) | — | — | Baalda는 이미 "에디터 옆 패널"이라는 호스트를 가짐. **Aside류의 핵심 = 현재 노트·선택영역을 문맥으로 자동 전달 + 제안(diff)을 승인 후 적용** — Baalda는 `edit_note`(앵커 기반 편집)·`expectedRevision`·housekeeper preview/apply/undo 로 이미 기반이 있음 |

> "Aside" 정확한 제품/URL을 알려주시면 구조 비교를 보강할 수 있다. 현 보고서의 Aside 관련 내용은 **[추정 하]** 이다.

---

## 2. Baalda 코드 결합 지점 분석 (읽은 파일 기준)

### 2.1 MCP 서버 코어 — `app/apps/server/src/mcp/`

| 파일 | 핵심 사실 | 근거 |
|---|---|---|
| `protocol.ts` | JSON-RPC 2.0, **단일 JSON 응답(Streamable HTTP, SSE 없음)**. `PROTOCOL_VERSION="2025-06-18"`, `initialize`는 클라이언트 요청 버전을 에코. 지원 메서드: `initialize`/`ping`/`tools/list`/`tools/call`뿐 — **resources·prompts·subscriptions 없음**. 툴 결과는 `content`(text JSON) + `structuredContent`; 오류는 `isError`. 툴별 `mcp.tool.<name>.ok/refused/internal` 카운터 | [확인](`protocol.ts:16-18, 85-142`) |
| `tools.ts` | **22개 툴**: `list_vaults, get_access_default, set_access_default, list_resource_access, manage_access, list_folders, list_notes, read_note, search_notes, list_attachments, read_attachment_text, create_note, update_note, append_note, edit_note, delete_note, delete_file, move_file, create_folder, delete_folder, move_note, move_folder`. 모든 툴에 MCP annotations 5필드(readOnly/destructive/idempotent/openWorld) 명시. `attach_file`은 의도적으로 없음(base64 over JSON-RPC 회피) | [확인](`tools.ts:224-694`의 name 목록 grep, `tools.ts:40-47, 51-75`). ※ CLAUDE.md는 18개 목록(액세스 툴 4종 누락) → 문서 드리프트 [확인] |
| `service.ts` | 모든 툴이 `effectivePermission`(리졸버)로 노트별 ACL 검사 후 동작. 토큰 범위 밖 볼트 접근 거부. `read_note`는 `revision`(sha256) 반환, 쓰기 계열은 `expectedRevision` 지원(CLAUDE.md 기술; `service.ts` 1,372줄 중 일부만 열람) | [확인](`service.ts:179, 225, 582, 613-621, 742, 1167`); `expectedRevision` 세부는 CLAUDE.md 기반 **[추정 상]** |
| `doc-writer.ts` | AI 편집의 CRDT 합류 경로. 문서가 **열려 있으면** Hocuspocus 라이브 문서에 `transact`(origin = `{source:"local", context:{source:"mcp", userId}}`)로 적용 → 사람 편집과 동일하게 영속·브로드캐스트. 열려있지 않으면 detached Y.Doc에 적용 후 증분 업데이트 영속. `editContent(plan)`은 **문서 락 안에서** 현재 텍스트로 plan 실행 → 리비전 검사와 쓰기가 원자적. `setContent`는 **최소 span 치환**(prefix/suffix 보존, 서로게이트 쌍 보호). 크기 상한 `MAX_NOTE_MB` | [확인](`doc-writer.ts:118-155, 168-210, 243-278, 80-101`) |
| `tokens.ts` | `mcp_`+24바이트 base64url, **sha256 해시만 저장**, (user, vault) 범위. 매 요청마다 멤버십 재확인. `last_used_at`·`use_count`·`last_client`(User-Agent) 기록 | [확인](`tokens.ts:48-50, 139-170`) |
| `oauth.ts` | OAuth 액세스 토큰 → `McpAuth` 변환. 볼트는 동의 화면에서 고른 값이 `mcp_oauth_vault(client_id,user_id)`에 저장; 없으면 "유일한 볼트" 폴백, 아니면 401(`no_vault_selected`). 멤버십 재확인 | [확인](`oauth.ts:25-38, 76-95`) |

### 2.2 HTTP 라우트

| 파일 | 핵심 사실 | 근거 |
|---|---|---|
| `routes/mcp.ts` | `POST /api/mcp`: ① `mcp_` 토큰(Bearer 또는 **`?key=`/`?token=` 쿼리**) ② OAuth Bearer 둘 다 → 같은 `McpAuth`. 401에 `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"` 부착. 같은 잘못된 토큰 20회/10분 초과 시 429(토큰 해시 키). GET/DELETE는 405. `/mcp/tokens` 발급·조회·삭제는 세션 인증. **툴 카탈로그는 모든 연결에 동일**(`TOOL_CATALOG`) — 연결별 권한 축소 없음 | [확인](`mcp.ts:20-42, 72-109, 151-227, 236-275`) |
| `routes/oauth-connect.ts` | Better Auth `mcp` 플러그인의 로그인/동의 화면을 **자체 호스팅**. authorize에 `prompt=consent`를 강제해 항상 **볼트 선택 화면**을 띄움(이슈 #211). 동의 화면 문구: "노트 읽기·검색 / 노트 생성·편집·정리 / 기존 공유 권한 내에서만" — **허용/거부 2택, 읽기 전용 옵션 없음**. 허용 시 멤버십 확인 후 `setVaultBinding` | [확인](`oauth-connect.ts:45-50, 53-135, 138-216, 218-268`) |
| `routes/desktop-oauth.ts` | **Google 로그인용** 데스크톱 핸드오프(루프백 `127.0.0.1`/`localhost`만 허용 → 1회용 코드 발급 → `/desktop-auth/exchange`로 베어러 토큰 교환). **AI 연결과는 무관**하지만 "브라우저 로그인 → 앱 복귀" 패턴의 서버 쪽 레퍼런스. `GET /auth-methods`로 제공 로그인 수단 공개 | [확인](`desktop-oauth.ts:33-44, 50-60, 62-102`) |
| `routes/housekeeper.ts` | 확장 모듈(`housekeeper/index.mjs`, `HOUSEKEEPER_MODULE`로 교체 가능)을 **동적 import**. 호스트 인터페이스(`notes/read/canEdit/recoveryVersion/edit`)로 권한 검사 후 `docWriter.editContent` 적용. 추론 요청은 **사용자 OpenRouter 키(`sk-or-…`)를 요청 본문으로 받아** `OpenRouter` 클라이언트를 즉석 생성(서버는 저장 안 함). Cloud는 Team/Pro 게이트(402), 셀프호스트 무제한. 본문 4KB 제한 | [확인](`housekeeper.ts:18-31, 37-67, 71-72, 101-109, 140-152`) |
| `http/app.ts` | `/.well-known/oauth-authorization-server`(+`/api/mcp` 접미형), `/.well-known/oauth-protected-resource`(+`/api/mcp` 접미형, `resource`를 `…/api/mcp`로 교정) 제공 | [확인](`app.ts:271-300`) |
| `auth/auth.ts` | `mcp({ resource: <base>/api/mcp, loginPage, oidcConfig:{consentPage} })` — Better Auth `mcp` 플러그인 | [확인](`auth.ts:428-439`) |

**운영 서버 실측** (읽기 전용 GET):
- AS 메타데이터: `registration_endpoint`(DCR) 있음, `scopes_supported:["openid","profile","email","offline_access"]`, `code_challenge_methods_supported:["S256"]`, `token_endpoint_auth_methods_supported:["client_secret_basic","client_secret_post","none"]`. **`client_id_metadata_document_supported` 없음, `authorization_response_iss_parameter_supported` 없음, Baalda 전용 scope(예: notes:read) 없음** [확인](`curl https://api.baalda.com/.well-known/oauth-authorization-server`, 2026-10-14).
- PRM: `resource: https://api.baalda.com/api/mcp`, `authorization_servers:["https://api.baalda.com"]` [확인].
- `/health`: `{"version":"0.1.0","features":["notes-with-state","bootstrap-only","files-with-bytes","access-board"]}` — 서버 package 버전은 0.1.0, 데스크톱 0.1.83과 별개(정상, CLAUDE.md의 "server package version"과 일치) [확인].

### 2.3 데스크톱 Rust

| 파일 | 핵심 사실 | 근거 |
|---|---|---|
| `agent_runner.rs` | **사용자가 설치한 `claude`/`codex` CLI를 자식 프로세스로 실행**. 크레덴셜 파일 미접촉("No shell, credential files, or persisted logs" 헤더). `Agent::{Claude, Codex}` 열거형 하드코딩. `detect_agents`가 설치·버전·로그인 여부(`signed_in`)·실행가능 여부를 탐지. **Codex**: 전용 권한 프로필(`:workspace` 확장, `.context/.git/.env/.claude/.codex/.agents` write deny, 네트워크 off, `approval_policy=never`, web_search off, hooks/plugins/apps off, `--ephemeral --ignore-user-config --ignore-rules`), 프로젝트/관리형 Codex 설정이 있으면 실행 거부. **Claude**: `--restricted --safe-mode --setting-sources ""`, 도구 `Read,Glob,Grep,Edit,Write`만, MCP 설정 비움(`--strict-mcp-config {"mcpServers":{}}`), 개인 경로 Read/Edit deny, `dontAsk`. 프롬프트 32KB·스트림 512KB·실행 30분 상한, 볼트 epoch 변경 시 중단, 동시 1건. 현재 용도는 **HTML/Home 대시보드 갱신**(`dashboard_path` 필수) | [확인](`agent_runner.rs:1-3, 23-28, 125-133, 636-651, 652-738, 759-771, 934-1085`) |
| `oauth.rs` | **Google 로그인용** 루프백 리스너. `127.0.0.1:0` 바인딩 → UUIDv4 `state` 논스 → 단일 요청 처리 → `state` 불일치 거부(로그인 CSRF 방어) → 180초 타임아웃 → `google_oauth_return_to_app`로 창 복귀. 페이지는 정적 문구만(XSS 불가 구조). 테스트 4개 | [확인](`oauth.rs:35-101, 103-140, 142-166, 223-275, 311-391`) |
| `VaultSettingsDialog.tsx` MCP 탭 | MCP URL(`<server>/api/mcp`) 표시, 토큰 발급(평문 1회 표시), **`claude mcp add …` 스니펫**, 연결 목록(활성 점·마지막 사용·툴 배지 read/write/destructive) | [확인](`VaultSettingsDialog.tsx:1872-2135`, 스니펫 `:1980`) |
| `AiSettingsTab.tsx` · `AssistantProviderSettings.tsx` · `DashboardAgentRunner.tsx` | Assistant 키 입력(OpenRouter, OS 키체인 보관) / 대시보드 에이전트 실행 UI | [확인](파일 존재: `ls components`; 내용은 HOUSEKEEPER.md 기술로 갈음) |

### 2.4 문서 — `docs/HOUSEKEEPER.md`

- Assistant는 **관찰→조사→제안→승인→실행→검증** 수명주기, 모델 출력은 **타입이 있는 capability 선택**일 뿐 실행 코드가 아님 [확인](`HOUSEKEEPER.md:102-114`).
- 개인 OpenRouter 키: OS 키체인 보관, 추론 시 선택 Baalda 서버를 거쳐 OpenRouter로 전달, 서버 미저장 [확인](`HOUSEKEEPER.md:38-46`).
- 프리뷰 토큰은 사용자/볼트 범위·15분 만료·1회용, 적용은 `DocWriter.editContent` + 리비전 가드, **되돌리기(undo)는 역편집 + 편집 후 리비전 가드** [확인](`HOUSEKEEPER.md:61-65`).
- 한도: 노트 2,000개, 100,000자, 사용자/볼트당 분당 6회, 동시 1건, **프리뷰·한도는 프로세스 로컬**(단일 프로세스/스티키 라우팅 전제) [확인](`HOUSEKEEPER.md:86-88`).
- Cloud는 Team 플랜(402 `housekeeper_requires_team`) 필요, 셀프호스트는 무료 [확인](`HOUSEKEEPER.md:67-85`).
- **정리**: 이 엔진은 "AI가 vault를 *진단·수리*"에 최적화된 **좁은 capability 모델**이다. 범용 "노트 어시스턴트"로 확장하려면 capability(요약·재작성·분류·링크 제안)를 추가하는 방식이 이 설계와 정합적 **[추정 상]**.

---

## 3. 격차 분석 표 — 이미 있는 것 / 확장하면 되는 것 / 새로 필요한 것

범례: 난이도 하/중/상은 **[추정]**(근거 포함)이며, 근거 줄은 위 §2에 있음.

### 3.1 AI → Baalda 연결 (AI 앱이 우리 볼트에 접속)

| 영역 | ① 이미 있는 것 [확인] | ② 확장하면 되는 것 | ③ 새로 필요한 것 |
|---|---|---|---|
| 원격 MCP 엔드포인트 | `POST /api/mcp`, 22개 툴, 노트별 ACL, CRDT 합류 쓰기(`mcp.ts:151`, `tools.ts`, `doc-writer.ts`) | 스펙 2026-07-28 대응: `server/discover`, `_meta` 기반 버전 협상, `ttlMs/cacheScope`, 결정적 툴 순서 (현재 `initialize` 중심, `protocol.ts:86`). 클라이언트 하위호환 협상 방식은 SDK에 의존 **[추정 중]** — 난이도 중 | `resources`/`prompts`(노트를 리소스로 노출) — 선택사항 **[추정 하]** |
| OAuth 서버(Claude/ChatGPT 커넥터) | PRM·AS 메타데이터(접미 경로 포함)·DCR·PKCE S256·로그인/동의/볼트선택 화면·볼트 바인딩·멤버십 재검증(`app.ts:271-300`, `oauth-connect.ts`, `oauth.ts`) | ① **CIMD 지원**(`@better-auth/cimd` 조합, `metadataProfile:"mcp-2026-07-28"`) ② 응답에 **`iss`** + 메타데이터 `authorization_response_iss_parameter_supported:true` ③ `WWW-Authenticate`에 **`scope`** 추가(`mcp.ts:42` 현재 `resource_metadata`만) ④ ChatGPT용 `resource`→audience 검증(현재 `getMcpSession`만 호출, `oauth.ts:81`) ⑤ refresh 토큰 회전·`invalid_grant` 코드 확인 — 난이도 중 | Better Auth `mcp` → `oauth-provider` 이전 계획(플러그인 deprecate 예고, 난이도 중~상, 마이그레이션 `oauth*` 테이블 영향 **[추정 중]**) |
| 권한 범위(scope) | 연결 = (user, vault) 범위 + **사용자의 실제 권한을 그대로 상속**(리졸버). 동의 화면에 "공유 권한 내에서만" 안내 | **읽기 전용 커넥터**: scope(`notes:read` / `notes:write` / `access:manage`)를 AS에 정의 → 동의 화면 체크박스 → `tools/list`와 `tools/call`에서 필터. `TOOL_CATALOG`에 이미 read/write/destructive 분류가 있어 재사용 가능(`mcp.ts:26-34`) — 난이도 중 | 폴더 단위 제한("이 폴더만") — Board의 접근 모델과의 정합 설계 필요, 난이도 상 **[추정 중]** |
| `manage_access` 툴 | 소유자/관리자만 변경 가능(서버 게이트) | 기본 비노출 + 명시적 scope일 때만 노출(비개발자가 AI에 접근권 변경까지 위임하는 사고 방지) — 난이도 하 **[추정 상]** | — |
| 토큰 방식(파워유저) | 발급·해시 저장·사용량·클라이언트 표시·UI(`tokens.ts`, `VaultSettingsDialog.tsx:1878`) | `?key=` 쿼리 토큰 허용(`mcp.ts:127`)은 스펙 "토큰을 URI 쿼리에 넣지 말 것" 위반 소지 → 신규 UI에선 헤더 전용 + 기존 호환 유지 — 난이도 하 | 토큰별 scope·만료일·"이 연결 일시중지" |
| OAuth 연결의 가시성 | 토큰 연결은 목록/사용량 있음. **OAuth 연결은 행이 없어 사용량·해제가 안 보임**("OAuth has no row", `mcp.ts:222`) | `oauthApplication/oauthAccessToken/oauthConsent` 테이블(m007)을 읽어 **같은 연결 목록에 통합**, 해제 = 토큰·동의 삭제 — 난이도 중 | 연결 감사로그(어떤 AI가 어떤 노트를 바꿨나) — `note_versions.created_by`·`MCP_ORIGIN` 태그 활용 가능 **[추정 중]** |
| 비개발자 UX | `baalda://` 딥링크 체계, 앱 내 MCP 탭 | **"AI 연결" 마법사**: 대상 선택(Claude / ChatGPT / Cursor / VS Code / Codex / 기타) → 대상별 정확한 한 줄(복사 버튼) 또는 딥링크 → "연결 확인(최근 호출 수신)" 표시. Claude·ChatGPT는 **서버 URL만 붙이면 끝**임을 전면에(토큰 불필요) — 난이도 하~중 | `.mcpb` 번들(로컬 볼트 직접 접근용) 배포는 별도 선택 |

### 3.2 Baalda → AI 실행 (앱 안에서 AI를 돌림)

| 영역 | ① 이미 있는 것 [확인] | ② 확장하면 되는 것 | ③ 새로 필요한 것 |
|---|---|---|---|
| 설치된 CLI 에이전트 실행 | `agent_runner.rs`: 탐지·로그인 상태·샌드박스 인자·스트림·취소·타임아웃·볼트 epoch 가드. 구독 사용자 약관에 부합(§1.1) | 용도를 대시보드 한정 → **"노트 작업"**(요약·재작성·정리)으로 일반화: `RunAgentRequest.dashboard_path` 필수 제약(`:127-133, 947`)을 "작업 대상 경로 집합"으로 — 난이도 중. 프롬프트 템플릿(`run_prompt`) 교체 | **ACP 클라이언트화**(Gemini 등 다른 CLI·권한요청·diff 이벤트 표준화) — 난이도 상 **[추정 중]** |
| CLI 설치/로그인 안내 | `detect_agents`가 `signed_in`/`runnable`/`detail` 반환 | 미설치·미로그인 상태에서 **"Claude Code/Codex 설치 → 로그인" 단계 안내**(공식 설치 링크·`login` 명령은 사용자가 실행; Baalda는 토큰을 읽지 않음) — 난이도 하 | — |
| ChatGPT 플랜으로 직접 추론 | (없음). Rust에 루프백 OAuth 리스너·state 논스·창 복귀 패턴 있음(`oauth.rs`) | SIWC용으로 리스너를 **범용화**(현재 `google_oauth_*` 이름·Google 문구 고정, `oauth.rs:223-309`) | **SIWC 오픈소스 경로 클라이언트**: dynamic_agent_client 등록, `ext_agent_host_id`(JWK thumbprint/UUIDv4) 생성·영속, PKCE+nonce+ID토큰 JWKS 검증, scope `chatgpt.tokens.use.direct` 확인, 토큰 로컬 파일/키체인(0600) 보관, Responses 스트리밍(`store:false`) 호출부. 난이도 상, **프리뷰·정책 변동 리스크** |
| 서버 측 추론(Assistant) | `housekeeper.ts` + OpenRouter 키 BYO, capability 모델, preview/apply/undo | 모델 어댑터를 OpenRouter 외 **사용자 지정 OpenAI 호환 엔드포인트**(`baseURL`)로 일반화(키 검증 정규식 `sk-or-…`, `housekeeper.ts:101-103`가 현재 강제) — 난이도 중 | 에이전트 루프(다단 툴 호출) — 현재는 단발 선택형(`provider.mjs` choose-candidate). Agents SDK/Agent SDK 도입 시 **API 키 전제** |
| 안전 모델 | 승인 후 실행, 리비전 가드, undo, 개인 경로 deny, 코드 실행 불가(HOUSEKEEPER.md) | 외부 MCP를 붙일 때도 동일 원칙: "생성된 텍스트를 실행 권한으로 해석하지 않는다" 유지 | **프롬프트 인젝션 방어 계층**: 노트 본문은 신뢰 불가 데이터(이미 housekeeper 프롬프트에 명시, `provider.mjs`)임을 CLI 프롬프트(`run_prompt`)와 MCP 쓰기 툴 응답에도 일관 적용 — 난이도 중 |

### 3.3 외부 앱을 Baalda의 AI가 쓰게 하기 (우리가 MCP *클라이언트*)

| 영역 | ① 이미 있는 것 | ② 확장 | ③ 새로 필요한 것 |
|---|---|---|---|
| 외부 커넥터 | **없음** [확인: agent_runner.rs는 `--strict-mcp-config {"mcpServers":{}}`로 MCP를 명시적으로 차단(`:721-723`), Codex는 `features.apps=false`(`:679`)] | 사용자가 켠 커넥터만 허용 목록으로 주입하는 **opt-in 경로** 설계 | "커넥터 추가" UI(URL 붙여넣기/카탈로그: Zapier·Composio·Pipedream·자체 n8n) + OAuth 위임·토큰 보관 + 호출별 승인. 난이도 상, **현 안전 철학(무MCP·무네트워크)과 충돌하므로 별도 위협모델 필요** |

---

## 4. 권고 우선순위 (비개발자 연결 UX 기준)

| 순위 | 항목 | 이유 | 난이도 [추정] | 선행조건 |
|---|---|---|---|---|
| P0 | **"AI 연결" 마법사 + 커넥터 URL 우선 안내** (토큰 숨김, OAuth 연결을 연결 목록에 통합) | 기술은 이미 있음. UX만 바꿔도 Claude/ChatGPT 사용자는 **URL 1줄 + 로그인**으로 끝 | 하~중 | 없음 |
| P0 | **읽기 전용(scope) 커넥터** + 동의 화면 체크박스 + `manage_access` 기본 비노출 | 비개발자의 가장 큰 불안은 "AI가 내 노트를 지우면?" — 현재 동의 화면은 허용/거부뿐(`oauth-connect.ts:204-212`) | 중 | OAuth scope 정의 |
| P1 | **OAuth 최신화**: CIMD + `iss` + `WWW-Authenticate scope` + audience 검증 | 스펙 2026-07-28에서 DCR deprecated; Claude는 CIMD 지원, ChatGPT는 CIMD 우선. 지금은 DCR로 동작 [확인]하므로 *장애가 아닌 부채* | 중 | Better Auth 1.6.23 → `@better-auth/cimd` 호환 확인(미실행) |
| P1 | CLI 에이전트 **작업 일반화**(대시보드→노트 작업) + 미설치/미로그인 안내 | 구독 사용자에게 가장 저비용·약관 안전 | 중 | 위협모델 재검토(쓰기 범위) |
| P2 | **ACP 클라이언트화** | CLI별 하드코딩 제거, 승인/diff UI 표준화 | 상 | ACP v1.x 안정성·Claude/Codex 어댑터 배포 형태 확인 |
| P2 | **SIWC 오픈소스 경로 PoC**(데스크톱 로컬 전용) | ChatGPT 구독자에게 키 없이 AI 제공 가능성 | 상 | 프리뷰 제약·약관 재확인, OpenAI 문의(서버 경유 시 "원격 호스팅" 해석) |
| P3 | `.mcpb` (로컬 볼트 직접 읽기 stdio 서버 또는 mcp-remote 브리지) | 오프라인/서버 미사용 사용자용. 원격 커넥터가 있으면 필요성 낮음 | 중 | 수요 확인 |
| P3 | 외부 MCP 클라이언트(Zapier/Composio 등) | 안전 철학과 충돌, 가치는 큼 | 상 | 별도 보안 설계 |

### 라이선스·약관 체크리스트 (결합 시 금지/주의)
- **번들·재배포 금지**: n8n(Sustainable Use, `.ee.` 별도), Pipedream(Source Available), Smithery CLI(AGPL-3.0 — 정적 링크·번들 시 복제 의무), Speakeasy Gram(AGPL-3.0), Zapier(독점).
- **안전한 OSS**: FastMCP Apache-2.0 · mcp-use MIT · Composio SDK MIT · Better Auth MIT · OpenAI Agents SDK MIT · Claude Agent SDK Python MIT(TS는 license 파일 없음 → 상용약관) · ACP Apache-2.0 · MCP SDK/스펙 Apache-2.0 전환 중(MIT 병존, 파일별 확인 필요).
- **Claude**: "Claude Code" 명칭·로고·모방 ASCII 사용 금지, 바이너리 수정/인증 수단 제거 금지, Baalda가 claude.ai 자격 증명을 수집·저장·중개 금지 [확인](legal-and-compliance).
- **OpenAI**: SIWC 오픈소스 경로는 "open-source and locally hosted apps" 한정, 유료/원격 호스팅은 별도 신청. app-server 인증은 상업/호스팅 비허용 [확인](URL §1.1).

---

## 5. 미확인·한계 (정직하게)

1. **"Aside" 제품 미특정** — 검색에서 동명 제품을 찾지 못함(§1.4). 구조 분석은 유사 제품 일반론이며 **[추정 하]**.
2. **ChatGPT 개발자 모드·플랜별 쓰기 권한**은 출처가 상충(공식 `connect-chatgpt` 문서는 플랜 언급 없음). 실제 사용자 플랜별 가능 범위는 **직접 계정 테스트 필요**.
3. **OpenAI SIWC "Request a client ID" 상세 심사 기준·Plus/Pro 요건**은 직접 열람한 공식 페이지에서 명시되지 않음(2차 출처는 Plus/Pro 한정이라 주장 — 확인 못함). 제3자 앱 SIWC 요청 이슈(#10974)는 페이지가 404여서 종료 사유를 **[추정 중]** 으로만 기재.
4. **Smithery 인수(Arcade)·Pipedream 인수(Workday)·가격**은 2차 자료 기반 **[추정 중]**. Zapier/Pipedream/Smithery 가격은 공식 페이지 미확인.
5. **Better Auth CIMD 플러그인의 실제 호환성**(현재 `^1.6.23` + `mcp()` 조합)은 문서 검색 결과만 확인, **코드 실행·설치 시험은 하지 않음**(저장소 읽기 전용 규칙).
6. `service.ts`(1,372줄)는 전체 정독하지 않고 ACL 호출 지점과 CLAUDE.md 기술을 교차했다. 개별 툴의 에러 코드·`expectedRevision` 동작 세부는 [추정 상].
7. 스펙 2026-07-28이 서버에 **강제**되는 시점·구버전 클라이언트와의 협상 동작은 확인하지 못함(현재 운영 서버는 2025-06-18 기준으로 정상 동작 중인 것만 [확인]).
8. GitHub star/commit은 단일 시점(2026-10-14) 스냅샷이다.

## 6. 근거 URL 모음

- OpenAI: https://developers.openai.com/siwc · …/siwc/token-sharing-open-source · …/sign-in · …/preview-limitations · …/codex-app-server · …/siwc/request-client-id · https://learn.chatgpt.com/docs/auth · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/extend/mcp · https://developers.openai.com/apps-sdk/build/auth · https://developers.openai.com/apps-sdk/deploy/connect-chatgpt · https://github.com/openai/codex/discussions/8338
- Anthropic: https://code.claude.com/docs/en/agent-sdk/overview · https://code.claude.com/docs/en/legal-and-compliance · https://claude.com/docs/connectors/building/authentication · https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp · https://www.anthropic.com/engineering/desktop-extensions
- MCP: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization · https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization · https://modelcontextprotocol.io/specification/2026-07-28/changelog · https://github.com/modelcontextprotocol/mcpb · https://agentclientprotocol.com/overview/introduction
- Better Auth: https://better-auth.com/docs/plugins/mcp · https://better-auth.com/docs/plugins/cimd
- 게이트웨이/노코드: https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server · https://www.activepieces.com/docs/mcp/overview · https://docs.composio.dev/docs/mcp · https://pipedream.com/docs/connect/mcp/developers · https://docs.zapier.com/mcp/home · https://gofastmcp.com/integrations/openapi · https://docs.mcp-use.com/typescript/server/authentication/providers/better-auth
- 딥링크: https://cursor.com/docs/mcp/install-links · https://code.visualstudio.com/docs/copilot/guides/mcp-developer-guide
- GitHub 저장소(수치 조회): ComposioHQ/composio, mcp-use/mcp-use, PrefectHQ/fastmcp, PipedreamHQ/pipedream, czlonkowski/n8n-mcp, n8n-io/n8n, activepieces/activepieces, harsha-iiiv/openapi-mcp-generator, tadata-org/fastapi_mcp, open-webui/mcpo, speakeasy-api/gram, arcadeai-labs/smithery-cli, modelcontextprotocol/{mcpb,typescript-sdk,modelcontextprotocol}, openai/{codex,openai-agents-python,openai-agents-js,openai-apps-sdk-examples}, anthropics/claude-agent-sdk-{python,typescript}, agentclientprotocol/{agent-client-protocol,claude-agent-acp}, zed-industries/codex-acp, better-auth/better-auth, punkpeye/mcp-remote, IBM/mcp-context-forge, agentgateway/agentgateway, docker/mcp-gateway, aaif-goose/goose
