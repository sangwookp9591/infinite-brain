# A1 1차 구현 보고서

2026-10-17 · 워커 a1 · 브랜치 `sangwookpark/ib-hub-a1` · 시작 HEAD `d63ca5e` · 모델 GPT-6.

## 변경

- A1-1: `permissions/roles.ts`에 팀 역할, 활성 역할, 관리자 역할 판정을 모았다. 작성자에 대한 공유/공개 링크 관리 지름길은 팀 역할일 때만 허용한다. 제거된 작성자와 guest 작성자는 관리할 수 없다.
- A1-1: MCP 노트/폴더 adopt는 읽을 수 없는 기존 항목을 `NOT_READABLE`로 거부한다. 폴더 INSERT 충돌 뒤 winner adopt도 같은 검사를 한다. `list_folders`는 HTTP와 같은 `listVisibleFolders`를 사용한다.
- A1-1 R1: coordinator가 전달한 Q1 승인에 따라 활성 vault 관계가 없는 사용자는 저장된 개인 공유가 있어도 접근할 수 없다. `effectivePermission`, `resolveAccessForUser`, `vaultAccess`에 적용하여 문서 토큰, HTTP/첨부/검색, MCP, readable set이 같은 판정을 사용한다. sync-token 경로와 Hocuspocus는 공통 `syncPermission`/resolver를 사용하므로 별도 중복 조회를 추가하지 않았다. 기존 shares 행은 보존한다.
- A1-2: 모든 개인 공유의 대상이 리소스 조직의 활성 멤버인지 확인한다. 존재하지 않는 ID, 다른 vault 멤버, 비멤버를 view/edit/locked/denied 모두에서 거부한다. guest 개인 vault 수준은 거부하며, guest 항목 공유는 owner/admin만 허용한다(Q13 승인). 조직 principal은 기존처럼 리소스 조직 ID로 강제한다.
- 대상 검증과 공유 INSERT를 같은 트랜잭션으로 묶고 member 행을 `FOR SHARE`로 잠근다. bulk access와 MCP manage_access도 같은 검증기를 사용한다. team-access는 조직 principal만 기록하므로 guest 개인 vault 수준을 만들지 않는다. 관리자도 guest 항목 접근을 관리할 수 있다.
- 데스크톱: ShareDialog, MembersAccessTab, MemberAccessBoard에서 기계용 거부 코드 대신 초대/개별 항목 선택/관리자 문의 안내를 표시한다. 기존 UI의 영어 문체와 제품 용어 vault를 유지했다.
- 설계 §9: A1-3~A1-7의 migration 계획을 062~066으로 정정했다. main의 `061_mcp_oauth_audience.sql`은 그대로다. §10에 Q1~Q9/Q11~Q15 권장안 승인과 Q10 보류를 기록했다.
- 이 범위에서 migration을 추가하지 않았다. main 변경, merge/rebase/push, 외부 게시를 하지 않았다.

## 범위 결정과 남은 일

- coordinator 메시지 `msg_27cbeaa4b311`: Q1~Q15 권장안 승인, Q10만 보류. 따라서 R1은 이번에 구현했다.
- coordinator 메시지 `msg_a3778c4fa95a`: V4의 off/domains 재검사는 정책 스키마가 생기는 A1-6으로 이동 승인. guest 초대 수락의 V8 적용은 guest 초대 자체를 만드는 A1-5에서 이어간다.
- V9 감사 기록은 A1-3이며 이번 범위가 아니다. 외부 공유 정책, guest 전용 리소스 권한 전체, 초대/역할/스냅샷 migration 등 A1-3 이후 조각도 이번 범위가 아니다. guest는 아직 정식 제품 기능으로 추가되지 않았다.
- 네이티브 Windows WebView2, macOS Tauri 실행, 실제 Hocuspocus 연결/다중 인스턴스 소켓 종료는 미검증이다. 문서 토큰과 공통 판정 회귀는 검증했다.

## 검증 환경

`app/`에서 `pnpm install --frozen-lockfile` 성공. 테스트는 아래 워커 전용 일회용 DB만 사용했다. 공유 context DB나 다른 컨테이너를 건드리지 않았다.

```sh
docker run -d --name ib-test-a1 -e POSTGRES_USER=ibtest -e POSTGRES_PASSWORD=ibtest -e POSTGRES_DB=ibtest_a1 -p 127.0.0.1:55442:5432 postgres:16-alpine
```

서버 명령의 실행 위치는 `app/apps/server/`, 환경은 모두 `DATABASE_URL=postgres://ibtest:ibtest@127.0.0.1:55442/ibtest_a1`이다. 테스트 helper가 migration을 적용한다.

## 검증 결과

- 수정 전: `pnpm exec vitest run tests/removed-creator-regrant.test.ts tests/shares-target-validation.test.ts` → **2개 파일, 6개 실패**. P2의 비멤버/존재하지 않는 ID/타 vault ID와 guest vault 수준은 201을 반환했다. P3의 제거된 작성자 공유도 201, 공개 링크 생성도 200으로 예상 거부와 달랐다. `/tmp/a1-before.log`에 실행 기록이 있다.
- 초기 수정 후: `pnpm exec vitest run tests/removed-creator-regrant.test.ts tests/shares-target-validation.test.ts tests/mcp.test.ts tests/sync-token.test.ts tests/vault-docs.test.ts` → **5개 파일, 59개 통과**. P2/P3 수정 전 실패와 수정 후 통과를 확인했다. `/tmp/a1-targeted.log`.
- 권한 확장 묶음: 아래 24개 파일 실행 → **23개 파일 통과, 추가 target-validation 파일 1개 실패(260 통과/1 실패)**. A0가 실행한 기존 20개 파일은 모두 통과했다. 실패 원인은 MCP 오류 변환이 거부 코드를 버리던 기존 동작이며 `McpToolError(error.message, error.code)`로 수정했다. 아래 최종 재실행으로 확인한다. `/tmp/a1-authz.log`.

```sh
pnpm exec vitest run tests/permissions.test.ts tests/vault-docs.test.ts tests/shares.test.ts tests/http-authz-gates.test.ts tests/sync-token.test.ts tests/member-access-defaults.test.ts tests/join-default-seed.test.ts tests/orgs.test.ts tests/invitations.test.ts tests/invitations-access.test.ts tests/mcp-access-surface.test.ts tests/resolve-access.test.ts tests/person-vault-level.test.ts tests/member-access-manager.test.ts tests/members-overview.test.ts tests/vault-channel-member-removed.test.ts tests/blob-visibility.test.ts tests/public-links.test.ts tests/team-access.test.ts tests/access-deny.test.ts tests/removed-creator-regrant.test.ts tests/shares-target-validation.test.ts tests/mcp.test.ts tests/access-index.test.ts
```

이 실행에 함께 전달한 `tests/resolver-cache.test.ts` 경로는 존재하지 않아 선택되지 않았다. 실제 파일명 `resolver-cache-drift.test.ts`로 별도 실행한다.

- 서버 `pnpm exec tsc --noEmit` → 통과.
- 데스크톱 `pnpm exec tsc --noEmit` → 통과.
- 데스크톱 초기 관련 테스트: `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/components/shareErrorMessage.test.ts src/lib/__tests__/accessBoardFailure.test.ts src/lib/__tests__/membersAccess.test.ts` → **3개 파일, 19개 통과**.
- 최종 MCP/교차 경로 회귀: `pnpm exec vitest run tests/mcp*.test.ts tests/removed-creator-regrant.test.ts tests/shares-target-validation.test.ts tests/member-access-manager.test.ts` → **11개 파일, 136개 통과**. MCP 거부 코드 보존, guest 작성자, target validation과 양방향 동시 제거 회귀를 모두 확인했다. `/tmp/a1-mcp-final.log`.
- 최종 데스크톱 관련 테스트: `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/components/shareErrorMessage.test.ts src/components/__tests__/membersAccessTab.test.ts src/lib/__tests__/accessBoard*.test.ts src/lib/__tests__/membersAccess.test.ts` → **7개 파일, 45개 통과**. `/tmp/a1-desktop-final.log`.
- 서버 최종 `pnpm exec tsc --noEmit` → 통과. `/tmp/a1-server-tsc-final.log`.
- resolver/readable cache 회귀: `pnpm exec vitest run tests/resolver-cache-drift.test.ts tests/readable-cache.test.ts` → **2개 파일, 11개 통과**. `/tmp/a1-cache-final.log`.
- 최종 검토에서 bulk 검증 시 호출자 역할을 다시 읽어 관리자 강등/제거를 거부하는 기존 경계를 보존했다. 작성자 예외는 POST의 canManage를 통과한 경로만 허용한다. `pnpm exec vitest run tests/shares-target-validation.test.ts tests/member-access-manager.test.ts tests/member-access-defaults.test.ts tests/mcp-access-surface.test.ts tests/shares.test.ts` → **5개 파일, 30개 통과**. `/tmp/a1-actor-final.log`. 이후 서버 tsc도 재실행해 통과했다.
- `git diff --check` → 통과.

## 화면 확인

window-simulator 스킬과 ego-browser를 사용했다. `pnpm exec vite --mode simulator --host 127.0.0.1 --port 1425 --strictPort`로 실행하고 `?platform=windows` / `?platform=macos`를 확인했다. 두 플랫폼의 동일한 합성 데이터에서 실제 ShareDialog를 별도 React root로 렌더링하고, 브라우저 안 API 인스턴스에만 `share_target_not_member` 응답을 주입했다. fixture 메뉴에는 해당 Share 진입점이 없어서 이 방법으로 오류 상태를 확인했다. 실제 서버/사용자 데이터로 요청하지 않았다.

1500×780과 720×600에서 오류 문구, 버튼, 닫기, 창 chrome, 모달/텍스트 간격을 스크린샷으로 직접 확인했다. 가로 넘침이나 버튼 충돌 없이 안내가 표시됐다. 기록은 tracked 파일 밖에 있다.

- `/tmp/a1-windows-refusal.png`
- `/tmp/a1-windows-refusal-narrow.png`
- `/tmp/a1-macos-refusal.png`
- `/tmp/a1-macos-refusal-narrow.png`

Ego Lite가 업데이트 안내를 표시했지만 업데이트는 하지 않았다. 브라우저 task space 73은 닫았다.

## 커밋

- `3eaaccc` refactor(server): centralize role predicates
- `28aacdf` fix(server): require team membership for creator share management
- `d06b3f4` fix(server): refuse unreadable adopts and unfiltered folder lists over MCP
- `b88bd06` fix(server): require an active vault relation for every grant
- `f8f37fe` docs: record A1 decisions and correct migration numbering
- `6c654f9` fix(server): validate share targets against vault membership
- `b393639` feat(desktop): explain refused share targets
- `1eacd49` test(server): cover guest creators and concurrent share revocation
- `64712b1` docs: retain the existing OAuth migration number
- `f8f83fa` fix(server): preserve actor checks during target validation
- 이 보고서는 별도 docs commit에 포함한다.

## 정리

검증 완료 후 워커 전용 컨테이너 `ib-test-a1`만 `docker rm -f ib-test-a1`로 제거했다. 이 worktree의 simulator 프로세스(PID 56470, cwd를 확인한 뒤 종료)도 정리했다. 브라우저 task space는 닫았고, `app/node_modules`와 `/tmp/a1-*.log`, 스크린샷은 남겨 두었다. 다른 컨테이너와 전역 캐시는 건드리지 않았다.
