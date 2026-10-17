# A1 2차 구현 보고서

2026-10-17 · 워커 a1b · 브랜치 `sangwookpark/ib-hub-a1` · 시작 HEAD `2fb7950` · 모델 GPT-6.


A1-3~A1-7의 승인된 최소 범위를 구현했다. Q3 전체 구조 쓰기/첨부 상대 경로 계약은 coordinator 승인으로 이월했고, Q10 좌석 정책은 현재 계산을 유지한다. 필수 기존 권한/MCP 파일과 새 회귀는 전체 실행 및 실패 파일의 최종 재실행을 합쳐 모두 통과했으며, 전체 단일 실행의 실패 기록도 아래에 보존한다.

| 조각 | 상태 |
|---|---|
|A1-3 감사 로그|완료: 원자적 기록/조회/보존/화면|
|A1-4 참가 코드|완료: 만료/재발급/제한/화면|
|A1-5 guest|최소 지원 완료: D6 64경로 매핑, Q3 전체 계약/Q10 정책은 승인된 후속|
|A1-6 외부 정책|완료: off/domains/on 및 V4 재검사|
|A1-7 일괄 회수|완료: 진행 상태/부분 재시도/Redis 다중 인스턴스 종료/화면|

## Q3 경로 재기준 사전 추정

현재 registry의 folder/file/note 목록과 커서, bootstrap manifest의 `rel_path` 정렬 및 부모 ID, vault-channel의 registry 재조회가 원래 디스크 경로를 공유한다. guest에게 문자열만 잘라 주면 중첩 공유 루트의 이름 충돌, 문서 단위 공유와 폴더 공유 혼합, 첨부 상대 경로, rename/move 쓰기 역변환, 기존 bootstrap 이어받기가 서로 어긋난다. 서버 DTO 투영과 desktop 동기화의 역변환 계약을 함께 바꾸는 별도 조각이 필요하며, 구현·양쪽 플랫폼 검증·회귀까지 약 2~4일 범위로 추정한다(측정된 일정이 아니라 코드 경계를 확인한 작업량 추정).

위 선택지와 추정을 coordinator에게 먼저 보고하고, 아래 최소 지원 승인을 받았다. 조상 이름 노출은 허용하지 않는다.

## 결정 보류

Q10 guest 결제 좌석은 승인되지 않았으므로 좌석 계산은 현재 동작을 유지한다.

## Q3 답변 및 구현 범위

coordinator가 공유 루트 투영 + guest 구조 변경(rename/move/폴더 생성삭제) 제한을 승인했다. HTTP/registry와 bootstrap에서 조상 이름을 숨기고, 커서는 사용자/vault별 인증 암호문으로 보낸다. 단건 생성은 편집 가능한 폴더 ID를 원래 경로로 바꾸며, 노트·파일 batch는 기존 공유 폴더의 표시 경로를 역변환한다. 폴더 쓰기와 파일 rename/move는 서버에서 막고, 데스크톱 루트 생성·이름 변경·이동도 파일 변경 전에 거부한다. 전체 폴더 쓰기·첨부 상대 경로·기존 디스크 재배치까지 포함한 Q3 전체 계약은 후속이다.

## 구현

- A1-3: 062 audit_log, 같은 transaction의 row trigger, Better Auth/application 양쪽 pool의 transaction-local actor/request context, 거부된 HTTP/MCP 기록, manager-only 조회 및 365일 보존. 토큰/코드/비밀번호와 노트 내용은 기록하지 않는다. context 누락은 system/unknown이며 savepoint·병렬 독립 쓰기·재사용 연결 회귀를 추가했다.
- A1-4: 063 expires_at/rotated_at/created_by 및 시도 기록. 기존 코드30일/새 코드7일, 8자 비혼동 알파벳 유지, 교체 즉시 이전 코드 무효, 사용자별15분10회. 수락 시 transaction 안에서 코드를 재확인한다.
- A1-5: 064 guest 역할/초대 대상, guest snapshot 없음, 조직 공유/개인 vault 수준/작성자 예외 없음, 개인 folder/file grant + deny/lock만 허용. HTTP·sync·bootstrap·첨부·MCP 경계를 맞추고 사람 정보/조상 경로/목록을 제한했다. guest MCP 금지(Q7). 초대 수락은 membership/item shares/invitation status를 하나의 transaction에 쓴다.
- A1-6: 065 off/domains/on(기존 on), 초대 생성·수락·대상 grant·bulk access·MCP 공유 도구의 공통 검증, domains에서 검증된 이메일 도메인 재확인, 공개 링크 생성/열람/자산은 on에서만 허용. 기존 guest는 정책 변경만으로 제거하지 않는다.
- A1-7: 066 operation ID/진행 counts/항목별 errors. guest/대기 초대/공개 링크/guest MCP·OAuth binding/bootstrap를 제거하며 progress와 감사도 각 제거와 같은 transaction이다. partial 재시도는 남은 항목만 처리하며 completed 재전송은 같은 결과다. org advisory lock으로 초대 수락·grant와 회수의 경쟁을 직렬화한다. 활성 guest가 team으로 승격됐다면 제거하지 않는다.
- 데스크톱: Security(감사/정책/회수), 코드 만료·교체, explicit folder/note guest 초대, guest 역할과 빈 화면, 관리/대화/공유 버튼 제한. 회수 전 대상 수 및 이미 받은 내용/5분 다운로드 한계를 알린다.

## M8 / M9 확인

M9: 설치된 Better Auth의 직접 listMembers API가 guest에게 다른 사람을 돌려주는 것을 테스트로 재현했다. HTTP 자기 행만/전체조직·초대목록 거부/조직 display-name-only/leave 공통 teardown으로 보완했다. M8: Redis extension 소스에는 document close 전파가 없었다. 두 실제 Hocuspocus 서버, 별도 Redis pub/sub 연결, 열린 guest 문서 연결을 이용한 회수 테스트가 통과했다(`/tmp/a1b-revoke-final.log`, 2파일5검사).

## 검증 중 기록

전용 `ib-test-a1b` Postgres16(port55442, DB ibtest_a1b)와 `ib-test-a1b-redis` Redis7(port55443)만 사용했다. 공유 context DB는 사용하지 않았다.

- 초기 감사/대상 검증: 2파일14개 통과(`/tmp/a1b-audit.log`).
- 코드 만료/교체 및 orgs: 2파일11개 통과(`/tmp/a1b-codes-final.log`). 초기 기존8자 코드 형식 회귀를 고친 뒤 재실행했다.
- guest resolver/core 3파일20개, membership 2파일12개, HTTP 3파일16개 통과. sync/HTTP/membership/audit 최종 묶음 5파일24개 통과(`/tmp/a1b-guest-final.log`). 실제 websocket awareness 이름 차단과 회수 뒤 옛 token 재접속 거부를 확인했다.
- 외부 정책/공개 링크/guest 수락: 21개 통과(`/tmp/a1b-policy-final2.log` 2파일15개, `/tmp/a1b-accept-final.log` 1파일6개).
- 일괄 회수/Redis 두 인스턴스: 2파일5개 통과(`/tmp/a1b-revoke-final.log`).
- 추가 첨부·MCP·버전/휴지통: 3파일11개 통과(`/tmp/a1b-matrix-extra.log`). 채널 추가 시험의 fixture signature/capability, 첨부 fixture의 필수 principal_id 등을 바로잡았다.
- 데스크톱 정책/회수/guest 초대: 2파일10개 통과(`/tmp/a1b-desktop-policy-revoke.log`).
- 타입 검사: `pnpm --dir app/apps/server exec tsc --noEmit`, desktop 동일 명령의 중간 실행 통과. 최종 실행은 아래에 기록한다.
- 부하 상태 전체 authz 실행에서 person-vault-level 4건이 약15초에 실패했고 실행을 중단했다(`/tmp/a1b-authz-full.log`, 완료 결과가 아님). 해당 (b) 사례 단독 실행은 1개 통과(18skip, `/tmp/a1b-person-debug.log`), 68초 중 import64초/실제 검사3초였다. 시스템 load60~90, TRUNCATE fsync6초를 관찰했고 다른 프로젝트 프로세스/컨테이너는 건드리지 않았다.
- 부하 상태 desktop 묶음은 7파일 중1파일실패(32통과/10실패, `/tmp/a1b-desktop-final.log`). 첫 membersAccessTab 사례의5초 timeout 뒤 나머지9개가 영향을 받았다. 실패를 성공으로 집계하지 않으며 단독/직렬 재검사와 최종 결과를 아래에 추가한다.

## D6 회귀 매핑 (64 경로)

표는 경로별 검증 위치다. 기존 경계가 같아 변경하지 않은 경로도 guest fixture 또는 기존 A0 회귀를 함께 실행한다. Q10은 결정 후 정책 변경 검사가 아니라 현행 유지 검사다.

| D6 | 회귀 검사 위치/핵심 |
|---|---|
|01,02|guest-resolver: 개인 항목 공유만/외부 관계 없음/deny·lock|
|03,04|guest-resolver: cache·prefetch·index와 reference 일치|
|05|guest-migration: guest snapshot 없음, 기존 team snapshot 유지|
|06,07|guest-resolver: vaultWide false, live/deleted set와 resolver 일치|
|08|guest-listings: 조상 없는 Shared 루트|
|09|guest-revocation: activity cache TTL 10초 뒤 사라짐|
|10,11,12|guest-http-gates: 편집 공유 폴더/루트 거부/공유 안 자신의 항목만 삭제|
|13|guest-blobs: 편집 가능한 대상 노트로만 업로드 쓰기|
|14|guest-http-gates + removed-creator-regrant + sync-token: guest 공유 문서만 mint, external 거부|
|15|guest-sync: 실제 열린 연결 회수 뒤 이전 token 거부|
|16|guest-history-trash: 삭제 문서 보존 기간 안에서만 syncPermission|
|17|guest-revocation: Redis 두 실제 서버의 문서 연결 종료|
|18,19|guest-vault-channel: ready/empty/뒤처짐 및 삭제 ID에 공유 범위만|
|20,21,22,23|guest-vault-channel: member 이름 차단/표시 이름만/presence 범위·익명/voice 송수신 차단(정상 team 수신도 확인)|
|24|guest-vault-channel: 정확히 잃은 ID만 revoked|
|25|guest-sync: bootstrap 각 page에서 회수 재확인|
|26,27|guest-listings: scope 있는 collection만, 사람 이름/ID 제거|
|28|guest-http-gates: unreadable adopt 409, guest batch 경로 역변환·이동 거부|
|29,30|guest-http-gates: 관리 경로 거부, 단건/bulk 삭제 일치, content batch 유지|
|31,32,33|guest-blobs: 공유 참조만/고아 거부/회수 뒤 URL 거부/충돌 readable ref만/트리 파일 lock 우회 없음|
|34|guest-listings: storage 거부, guest-http의 tombstone filter; 채널 deleted ID 검사|
|35,36,37|guest-mcp: mint 거부/강등 token 중지/프로토콜 세 가지 전면 거부/OAuth consent guest 제외|
|38,39,40|mcp-access-surface/mcp + guest-mcp: 폴더 가시성·unreadable adopt·접근 관리 도구 및 guest 인증 전면 거부|
|41,42|guest-membership: overview 자기 행만/activity granter 제거|
|43,44,45|guest-membership + external-sharing-policy: explicit targets/guest 수락 항목만/전체 vault access 거부/현재 정책 재검사|
|46|guest-membership: raw Better Auth 취약 동작 재현, HTTP self-only/list 제한, leave teardown|
|47|join-code-lifecycle: guest pending 초대는 코드로 승격 불가|
|48,49|guest-membership: 강등 snapshot·vault grant 제거, admin guest 항목 관리|
|50|guest-listings: 인증 없는 guest 초대 preview에 이메일/초대한 사람 ID 없음|
|51,52,53|guest-shares + shares-target-validation: guest/제거된 작성자 거부, 활성 대상 검증, manager 조회에 guest 역할|
|54,55|guest-listings locks scope + guest-membership access summaries와 resolver 일치|
|56|guest-public-links + external-sharing-policy: guest 생성 거부/domains 익명 링크 거부|
|57|guest-listings: graph/search 제목·snippet·간접 링크 비공개 범위 없음|
|58,59,60,61,62|guest-history-trash: 작성자 제거/checkpoints 거부/범위 밖 복원409/shrink scope/AI ledger scope·attribution 제거|
|63|external-revoke + guest-revocation: progress/감사 원자성, 재시도, Redis 전달|
|64|guest-billing: 기존 guest 포함 좌석 계산 유지(Q10 보류)|

## 실행 환경과 검증 한계

부하가 load171까지 올라가는 동안 기본 Postgres 내구 설정에서 TRUNCATE fsync가8초 이상 걸렸다. 이 작업의 일회용 `ib-test-a1b`에만 `ALTER SYSTEM SET fsync=off; ALTER SYSTEM SET synchronous_commit=off; SELECT pg_reload_conf()`를 적용했다. 운영 설정/코드와 statement timeout은 바꾸지 않았다. transaction의 논리적 원자성/권한/회수 검증은 계속하지만 전원 장애·서버 crash 뒤 감사 데이터 내구성은 이 환경에서 검증하지 않는다. 이 설정과 컨테이너는 작업 종료 시 함께 폐기한다.

데스크톱 직렬 최종 묶음(초대 목록의 마지막 CSS 수정 전): `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --maxWorkers=1 src/components/__tests__/membersAccessTab.test.ts src/__tests__/tabStore.test.ts src/__tests__/renameFollowStore.test.ts src/components/__tests__/externalSharing.test.ts src/components/__tests__/invitePeopleDialog.test.ts src/lib/__tests__/membersAccess.test.ts src/components/SecurityHistoryTab.test.ts src/components/shareErrorMessage.test.ts src/lib/__tests__/accessBoardFailure.test.ts` → **9파일67개 통과**, `/tmp/a1b-desktop-serial-final.log`. 부하 실행에서 실패했던 membersAccessTab도 모두 통과했다.

기본 브랜치 비교: `2fb7950`을 `/tmp/ib-a1b-baseline`의 detached 임시 checkout에 두고 같은 전용 컨테이너의 별도 `ibtest_a1b_focus` DB에서 `pnpm exec vitest run --maxWorkers=1 tests/person-vault-level.test.ts -t 'folder denied|folder readonly|GET /locks lifts|GET /locks padlocks'` 실행 → **5개 통과/14skip**, `/tmp/a1b-main-person-compare.log`. main을 checkout/수정/merge/rebase하지 않았다. focus DB는 전체 검사 DB와 다르며 reset이 서로 겹치지 않는다.

전체 직렬 실행 결과(`/tmp/a1b-authz-final.log`): **50파일 중43통과/7실패, 459통과/20실패**, 1605.60초, exit1. 실패는 team-access12(11 statement timeout/1 connection timeout), guest preview1(statement timeout), guest adopt code1(기존 실제 code는 소문자 not_readable), batch 경로1(진행 중 실행에서는403, 최종 역변환 코드는 단독 통과), voice fixture1(수신 capability 누락), OAuth consent fixture1(guest 외 team 선택지를 두어 실제200 picker를 확인하도록 수정), MCP viewer1(HTTP mint도 팀 역할로 맞춤), 기존 동시 제거2(정상 제거에도 추가한 FOR UPDATE 때문에 기존 대기 지점이 바뀌고 뒤 검사가 영향을 받음)다. 정상 제거는 기존 DELETE 잠금을 유지하고 bulk의 expectedRole 검사에만 FOR UPDATE를 사용하도록 고쳤다. 최종 코드 고정 뒤 focus DB 재실행 결과는 아래에 별도로 기록한다.


## 화면 및 후속 검증 범위

window-simulator와 ego-browser로 실제 컴포넌트를 합성 API에 연결해 Windows/macOS의 1500×780과720×600을 확인했다. guest 초대의 전체 vault 접근/코드 숨김, 폴더·노트 선택과 view/edit, 긴 선택 목록의 스크롤 및 하단 버튼, 정책 세 가지와 domains 입력, 회수 수/5분 안내/보안 기록을 확인했다. guest 초대 목록이 창을 넘치던 것을 max-height와 내부 스크롤로 고쳤다. 스크린샷은 `/tmp/a1b-{windows,macos}-guest-invite-{wide,narrow}.png`, `/tmp/a1b-{windows,macos}-security-{wide,narrow}.png` 등이며 저장소에 넣지 않았다. Windows 네이티브 WebView2/창 조작, 실제 macOS Tauri 패키지, 실제 메일·Google·S3 발송/다운로드와 crash 내구성은 미검증이다. role 제한 동작은 서버/데스크톱 회귀 검사를 기준으로 한다.

후속: Q3 전체 경로/첨부 상대 경로/기존 로컬 폴더 재배치 및 구조 쓰기 역변환, Q10 guest 요금 정책 결정. 이 두 승인된 이월 이외의 검증 실패를 이월로 바꾸지 않는다. 다중 인스턴스 실시간 종료는 모든 인스턴스가 같은 정상 Redis에 연결되어야 한다; Redis 장애 중의 내구성 있는 종료 신호 재전달(outbox)은 이번 최소판 범위가 아니다.


## 최종 검증 결과와 실제 명령

서버 명령은 `app/apps/server/`에서, `DATABASE_URL`을 전용 `ibtest_a1b` 또는 `ibtest_a1b_focus`에 지정해 실행했다. Redis 두 인스턴스 검사에는 `REVOCATION_TEST_REDIS_URL=redis://127.0.0.1:55443`를 지정했다. DB는 같은 **이 작업의 컨테이너** 안에 있으며 동시 reset 대상이 다르다.

전체 실행 명령(당시 존재한 glob 파일; 50파일):

```sh
pnpm exec vitest run --maxWorkers=1 tests/permissions.test.ts tests/vault-docs.test.ts tests/shares.test.ts tests/http-authz-gates.test.ts tests/sync-token.test.ts tests/member-access-defaults.test.ts tests/join-default-seed.test.ts tests/orgs.test.ts tests/invitations.test.ts tests/invitations-access.test.ts tests/mcp-access-surface.test.ts tests/resolve-access.test.ts tests/person-vault-level.test.ts tests/member-access-manager.test.ts tests/members-overview.test.ts tests/vault-channel-member-removed.test.ts tests/blob-visibility.test.ts tests/public-links.test.ts tests/team-access.test.ts tests/access-deny.test.ts tests/removed-creator-regrant.test.ts tests/shares-target-validation.test.ts tests/mcp*.test.ts tests/access-index.test.ts tests/guest*.test.ts tests/audit-log.test.ts tests/join-code-lifecycle.test.ts tests/external*.test.ts tests/bootstrap*.test.ts tests/bulk-docs-batch.test.ts tests/resolver-cache-drift.test.ts tests/readable-cache.test.ts
```

위 결과는 **43파일459개 통과/7파일20개 실패(exit1)**다. A0의 20개 권한 파일을 포함하며 실패한 파일은 아래 최종 재실행에서 모두 확인했다. 전체50파일을 다시 한 번에 실행한 성공 로그가 있다는 뜻은 아니다.

| 최종/집중 명령 | 실제 결과 | 기록 |
|---|---|---|
|`pnpm exec vitest run --maxWorkers=1 tests/guest*.test.ts tests/person-vault-level.test.ts tests/team-access.test.ts tests/mcp-scopes.test.ts tests/shares-target-validation.test.ts tests/audit-log.test.ts tests/external*.test.ts tests/join-code-lifecycle.test.ts`|22파일 중21파일189개 통과/1개 실패(exit1). 남은 MCP HTTP mint 팀 역할 수정은 이 실행 시작 뒤였으며 다음 실행으로 확인.|`/tmp/a1b-final-focus.log`|
|`pnpm exec vitest run --maxWorkers=1 tests/mcp-scopes.test.ts tests/audit-log.test.ts tests/guest-mcp.test.ts`|**3파일35개 통과(exit0)**|`/tmp/a1b-mcp-audit-final.log`|
|`pnpm exec vitest run --maxWorkers=1 tests/guest-listings.test.ts`|**1파일9개 통과(exit0)**. HTTP file/folder tombstone의 scope·개인 deny/direct grant도 확인.|`/tmp/a1b-tombstones-final.log`|
|`pnpm exec vitest run --maxWorkers=1 tests/guest-history-trash.test.ts`|**1파일6개 통과(exit0)**. 다른 team vault가 활성화된 상태의 AI 변경 detail과 경로형 before/after 제목까지 확인.|`/tmp/a1b-history-verified.log`|
|`pnpm exec tsc --noEmit` (server)|**통과(exit0)**|`/tmp/a1b-server-tsc-done.log`|
|`pnpm exec tsc --noEmit` (desktop)|**통과(exit0)**|`/tmp/a1b-desktop-tsc-final.log`|
|위 desktop 직렬9파일 명령|**9파일67개 통과(exit0)**|`/tmp/a1b-desktop-serial-final.log`|
|`NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --maxWorkers=1 src/components/__tests__/externalSharing.test.ts src/components/__tests__/invitePeopleDialog.test.ts` (마지막 UI 수정 후)|**2파일10개 통과(exit0)**|`/tmp/a1b-desktop-checked-final.log`|
|`git diff --check`|**통과**|마지막 커밋 전 확인|

추가 재현: 경로형 `before_title`/`after_title`이 canonical 경로를 그대로 담으면 게스트 AI 변경 기록이 `Clients/Acme`를 노출했다. 최종 제목 회귀를 수정 전 HEAD 코드로 실행해 **1실패/5skip(exit1)**를 확인했다(`/tmp/a1b-beforetitle-before.log`). path와 같은 메타데이터 제목만 투영하고 노트 내용은 바꾸지 않는 수정 뒤 위 history6개가 통과했다.

이 결과를 합치면 초기50파일의 실패7개 및 추가 guest/migration/표면 검사가 모두 최종 코드에서 통과했다. 실행 시점·중복 검사를 섞은 총 검사 수를 별도의 단일 성공 건수로 합산하지 않았다.

## 정리와 남은 일

전용 Postgres `ib-test-a1b`와 Redis `ib-test-a1b-redis`를 제거했다(두 테스트 DB도 함께 폐기). 임시 baseline checkout을 제거했고 simulator와 agent 브라우저 공간도 종료했다. 다른 프로젝트 컨테이너/프로세스와 전역 캐시를 건드리지 않았고, main/staging을 변경하거나 push/merge/rebase하지 않았다.

남은 일은 승인된 Q3 전체 계약, Q10 요금 결정, 위에 명시한 native/실제 외부 서비스/crash 검증이다. 코드 변경에 필요한 권한 회귀와 타입 검사의 미해결 실패는 없다.

## 커밋 목록

- `477d74a` feat(server): add audit log table and writer
- `8ee26c9` feat(server): audit membership, share and invitation changes
- `4777077` feat(server): audit log listing and retention
- `22cd28c` feat(desktop): security log view for admins
- `1a86045` feat(server): join code expiry and rotation
- `a7069df` feat(desktop): show join code expiry and regenerate
- `5a82b72` fix(server): preserve readable join codes with redemption throttling
- `21cda0e` test(desktop): cover join code expiry and regeneration
- `1cf66c9` feat(server): guest role definition and snapshot trigger
- `5f947b9` feat(server): resolve guest access from per-user grants only
- `7ec0cbc` fix(server): serialize implicit audit transactions and bound audit pages
- `6587ca9` feat(server): scope HTTP gates and listings for guests
- `72a63c5` feat(server): scope sync, bootstrap and vault channel for guests
- `c748b5f` feat(server): guest invitations with explicit targets and metadata boundaries
- `a009a7e` feat(desktop): guest invite flow and guest view
- `ad04589` feat(server): external sharing policy
- `289e393` feat(desktop): external sharing settings
- `e296242` feat(server): bulk external access revocation
- `9e664d7` fix(server): close document sockets on every instance
- `ddc8b88` feat(desktop): revoke all external access
- `c846a81` fix(desktop): keep guest actions scoped before local changes
- `a7517ad` fix(server): serialize guest grants before membership locks
- `05014c8` fix(server): align MCP management and audit boundaries
- `36900e5` feat(server): complete guest metadata and registration boundaries
- `7bc0e8c` fix(desktop): show external access removal progress
- `305f5a3` fix(server): redact inherited paths in guest history titles
- `74cc42d` test(server): cover the D6 guest authorization matrix
- `ca6e639` docs: record A1 rollout and scoped guest support
- 이 보고서 자체는 마지막 `docs: report A1 part two implementation and verification` 커밋에 포함한다.
