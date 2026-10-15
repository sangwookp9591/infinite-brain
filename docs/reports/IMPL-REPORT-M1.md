# M1 구현 보고서 — AI 연결 마법사와 scope 커넥터

작성일: 2026-10-14. 작업 디렉터리: `/Users/iron/Project/psw/ib-wt/m1-connect`.
브랜치: `feat/m1-connect`. 시작 HEAD: `ddeb7005b465ff5819097ae6696c894082941bfb`.
기준: `docs/research/W6-design.md` §5.1 F1, `docs/FINAL-report.md` §6 M1.
지정한 scratchpad FINAL-report와 저장소 사본이 동일함도 확인했다.

## 구현 결과

- 서버에 `notes:read`, `notes:write`, `notes:delete`, `access:manage`를 추가했다. AS/보호 리소스 메타데이터와 401 `WWW-Authenticate`에 scope를 알린다.
- OAuth 동의 화면의 기본은 읽기+쓰기다. 읽기만 및 삭제·이동 포함 프리셋을 제공한다. `access:manage`는 해당 vault의 owner/admin에게만 보이고 기본 꺼짐이며 서버에서도 역할을 검증한다. 클라이언트가 명시적으로 좁은 scope를 요청했다면 그것을 초과하는 선택은 비활성화하고 승인 요청도 거부한다.
- Better Auth 1.6.23의 검증된 pending consent grant에서 사용자·클라이언트·만료·동의 상태를 확인한 뒤 선택 scope를 저장한다. 기존 Better Auth PKCE, code 교환, consent 및 token 저장 경로를 유지한다. 발급 후 `getMcpSession().scopes`와 승인된 vault binding의 교집합으로 MCP 권한을 판정한다.
- `tools/list`에서 미승인 도구를 숨기고 `tools/call`은 handler 실행 전에 `insufficient_scope`로 거부한다. 도구 annotation 분류를 재사용하되 `update_note`는 내용 쓰기, 모든 `move_*`는 삭제·이동 scope로 판정한다. 기존 파일 ACL과 쓰기 리졸버는 그대로 적용된다.
- migration `058_mcp_scopes.sql`은 `mcp_tokens.scopes`를 기본 전체 권한으로 추가하고 OAuth binding에 승인 scope 및 활동 정보를 추가한다. scope 없는 기존 OAuth/OIDC grant와 scope를 생략한 기존 token API 호출은 현재 전체 동작을 유지한다. 새 UI가 발급하는 토큰은 읽기+쓰기가 기본이다.
- `GET /api/mcp/connections`는 사용자와 active vault의 OAuth·토큰 연결을 합쳐 이름, scope, 마지막 사용, 사용 횟수, 종류를 반환한다. legacy OAuth grant도 sole-vault fallback이 가능한 경우 첫 MCP 사용 전부터 목록에 나온다. 기존 `/api/mcp/tokens` 조회·발급·해제 API도 유지한다.
- `DELETE /api/mcp/connections/:kind/:id`는 해당 사용자의 해당 vault 연결만 해제한다. OAuth는 access/refresh token, consent, vault binding, 미교환 승인 코드를 함께 삭제한다. 다음 MCP 호출은 401이며 refresh도 거부된다. 해제 후 미교환 code로 다시 토큰을 얻는 문제를 먼저 실패 테스트로 재현하고 수정했다. 새 scoped token은 binding이 없어지면 legacy fallback으로 살아나지 않는다.
- `?key=`/`?token=`의 기존 MCP 토큰 호환을 유지한다. 새 안내와 JSON/CLI 스니펫은 Authorization 헤더만 사용한다.
- OAuth callback에 `iss`를 추가하고 AS 메타데이터에 `authorization_response_iss_parameter_supported: true`를 알린다. authorize/token 요청에 잘못된 `resource`가 있으면 400 `invalid_target`으로 거부한다. resource 생략은 기존 DCR 호환을 위해 허용한다.
- Vault Settings의 기존 `mcp` 탭 ID는 유지하고 표시 이름을 **AI 연결**로 바꿨다. Claude, ChatGPT(고급·Developer mode), Cursor, VS Code, Claude Code/Codex(고급)를 선택하면 대상별 3단계 안내, URL 복사, 적합한 JSON/CLI/TOML 복사가 나온다.
- 토큰 발급과 scope 선택은 고급 접힘 영역에 있다. 통합 연결 목록은 scope에 맞는 도구만 표시하고 해제를 제공한다. 새 토큰을 해제하면 화면의 해당 토큰과 스니펫에서도 제거한다. 최근 사용 상태는 요청 수신 기반이며 첫 1분은 마지막 사용을 초 단위로 표시한다.
- 안내·스니펫·scope·도구 필터·최근 사용 판정을 `src/lib/aiConnection.ts`의 순수 함수로 분리해 테스트했다. 두 플랫폼의 fixture는 같은 OAuth/토큰 데이터를 사용하며 실서버·실 vault를 호출하지 않는다.

## 검증

`app/`에서 먼저 `pnpm install`을 실행했고 완료됐다. 새 의존성과 lockfile 변경은 없다.
공유 컨테이너에는 전용 DB `m1_connect_test`만 만들었다. 서버 통합 테스트는 모두 이 DB를 가리키는 `DATABASE_URL`로 실행했다. 기본 DB `context` 및 기존 3010/3011 서버를 변경·중단하지 않았다.
아래 `M1_TEST_DATABASE_URL`은 실제 실행한 전용 DB URL을 재현 시 지정하는 변수다. 인증 값은 보고서에 기록하지 않는다.

| 위치 | 실행 명령 | 결과 |
| --- | --- | --- |
| 저장소 | `docker exec context-pg createdb -U context m1_connect_test` | 전용 DB 생성 성공 |
| `app/apps/server` | `DATABASE_URL="$M1_TEST_DATABASE_URL" pnpm run migrate` | 056까지 적용 성공 |
| `app/apps/server` | `DATABASE_URL="$M1_TEST_DATABASE_URL" pnpm exec vitest run tests/mcp-scopes.test.ts tests/oauth-discovery.test.ts tests/mcp-oauth-consent.test.ts tests/mcp.test.ts tests/mcp-access-surface.test.ts tests/mcp-files.test.ts tests/mcp-edits.test.ts` | **7 파일, 88 통과, 0 실패** |
| `app/apps/server` | `DATABASE_URL="$M1_TEST_DATABASE_URL" pnpm exec vitest run tests/mcp-scopes.test.ts` | grant 삭제 후보 조회 SQL 보완 후 **15 통과, 0 실패** |
| `app/apps/server` | `pnpm exec tsc --noEmit` | 성공 |
| `app/apps/desktop` | `pnpm exec vitest run src/lib/aiConnection.test.ts src/lib/__tests__/api.test.ts` | **2 파일, 49 통과, 0 실패** |
| `app/apps/desktop` | `pnpm exec tsc --noEmit` | 성공 |
| `app/apps/desktop` | `TAURI_ENV_PLATFORM=windows pnpm run build` | 최종 성공; Vite의 기존 동적/정적 import 및 큰 chunk 경고 있음 |
| 저장소 | `git diff --check` | 성공 |

새 서버 테스트는 실제 Better Auth DCR → authorize → 동의 → PKCE token 교환 → MCP 요청을 in-process HTTP와 전용 Postgres로 실행한다. 읽기 전용 필터·호출 거부, 읽기+쓰기의 update 허용/이동 거부, 관리자 opt-in, grant/token scope 저장, 기존 grant 호환, OAuth/토큰 해제 후 401, refresh 거부, 미교환 code 무효화, 잘못된 resource, 다른 vault의 해제 거부를 확인했다. 외부 Claude/ChatGPT 서비스에 접속했다는 증거는 아니다.

## 화면 확인

window-simulator + ego-browser로 Windows/macOS 각각 **1600×1000 및 720×600**을 확인했다. 안내, URL/스니펫, 창 chrome, overlay, 연결 카드의 아이콘·텍스트·줄바꿈을 살펴봤다. 검사한 좁은 화면에서 문서와 설정 modal의 가로 overflow가 모두 없었다. synthetic 읽기 전용 토큰 생성, OAuth의 읽기 도구 3개 표시, 해제 후 카드 제거, URL 복사 완료 피드백을 확인했다. 테스트용 Vite(1425)는 확인 후 종료했다.

스크린샷은 추적 파일 밖에 저장했다:

- `/private/tmp/M1-windows-claude-1600.png`
- `/private/tmp/M1-windows-cursor-720.png`
- `/private/tmp/M1-windows-vscode-720.png` — 초기 password-input 스니펫 확인 당시 화면. 최종 VS Code 스니펫은 아래 macOS 최종 화면처럼 헤더 값만 사용한다.
- `/private/tmp/M1-macos-claude-1600.png`
- `/private/tmp/M1-macos-chatgpt-720.png`
- `/private/tmp/M1-macos-cli-720.png`
- `/private/tmp/M1-macos-vscode-final-720.png`

안내는 공식 [Claude 커넥터 문서](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [ChatGPT Developer mode 문서](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt), [Cursor MCP 문서](https://prod.cursor.com/help/customization/mcp), [VS Code MCP 문서](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [Codex MCP 문서](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)를 확인해 작성했다. VS Code의 interactive input은 Agent Host로 전달되지 않는 제한이 있어 최종 스니펫은 단순 Authorization 헤더로 통일했다.

## 남은 한계와 수용 기준 상태

- F1 1–4의 **구현 및 로컬 검증**을 완료했다. 실제 Claude/ChatGPT 계정으로 OAuth 연결하는 외부 서비스 확인은 **NOT RUN**이다. Cursor/VS Code/Claude Code/Codex 프로그램에서 실제 설정을 적용하는 확인도 **NOT RUN**이다.
- F1 5 중 scope 및 `iss`는 구현·검증했다. **CIMD와 완전한 audience binding은 TODO**다. 현재 Better Auth MCP 플러그인은 resource를 grant/token에 보존하지 않으므로, 이번 범위는 요청 resource 검증까지다. 지원하지 않는 CIMD 플래그를 광고하거나 인증 검증을 우회하지 않았다. 이를 닫으려면 resource를 보존하는 provider 경로와 CIMD 지원을 별도 검토해야 한다.
- F1 6의 **비개발자 5명, 성공률 80%, 3분 목표는 NOT RUN**이다. 사용성 목표 달성을 주장하지 않는다.
- 화면 검증은 Mac의 브라우저 시뮬레이션이다. Windows WebView2·native 창/DPI/Snap, macOS WKWebView, 패키지 CSP 확인은 **NOT RUN**이다. Rust 코드 변경이 없어 cargo test는 실행하지 않았다.
- 새로운 OAuth scope 반영은 Better Auth 1.6 consent verification 값 구조에 의존한다. 라이브러리 업그레이드 시 새 end-to-end scope/PKCE 테스트를 게이트로 유지해야 한다.
- 최근 상태는 3분 이내 요청 수신 여부이며 UI는 20초마다 갱신한다. 이미 진행 중인 요청을 취소하는 기능은 없다.
- 새 UI와 서버/056 마이그레이션은 함께 적용해야 한다. 이전 서버에는 통합 연결 API가 없다. 기존 연결을 자동으로 축소하지 않으며, 필요한 경우 사용자가 해제하고 새 scope로 다시 연결한다.

## 커밋과 전달

- `370da22` — MCP scope, OAuth 승인/목록/해제, 마이그레이션과 서버 테스트.
- `26dceaf` — AI 연결 마법사, 헤더 전용 대상별 스니펫, API/순수 함수 테스트, 플랫폼 fixture.
- `6551ff1` — 해제 시 미교환 grant 삭제, scoped token의 binding 강제, 회귀 테스트.
- 본 보고서는 별도 문서 커밋으로 기록한다.
- **push, PR, 배포는 수행하지 않았다.** 다음 단계는 coordinator 통합 리뷰, 마이그레이션과 서버·UI 동시 적용, 실제 대상 앱 및 비개발자 사용성 검증이다.
