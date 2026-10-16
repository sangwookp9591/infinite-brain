---
type: verification-report
target: docs/superpowers/specs/2026-10-16-a0-authorization-design.md (6682e13)
basis: docs/superpowers/specs/2026-10-15-team-second-brain-prd.md §4 D6, §5.1, §5.2, §9 A0
verifier: Claude Opus 5.5 (독립 검증, 작성자 아님)
date: 2026-10-16
---

# A0 권한 설계 독립 검증

경로 약어는 설계 문서와 같다. `S/` = `app/apps/server/src/`, `D/` = `app/apps/desktop/src/`, `T/` = `app/apps/server/tests/`. `BA/` = 설치된 `better-auth@1.6.23`의 `dist/plugins/organization/`이다. DB가 필요한 테스트는 실행하지 않았다. 판정은 모두 정적 분석이고, 재현 경로는 기존 테스트 패턴(`T/orgs-remove-member.test.ts`, `T/helpers/seed.ts`, `T/helpers/auth.ts`)을 따라 적었다.

## 1. 판정: 수정 후 승인

판정 구조(관계 → 리소스 권한), 기대 권한 표, 11개 경로 분석, migration 원칙은 PRD D6·F1·F2와 맞는다. 코드 인용 약 200개를 줄 단위로 대조했고 실질적인 오류는 없었다. 다만 다음 네 가지는 승인 전에 문서에 반영해야 한다.

1. **Better Auth organization 플러그인 endpoint가 경로 목록에서 빠졌다.** 데스크톱이 실제로 호출한다. 게스트가 모든 사람의 이름과 이메일을 받고, 외부 공유 정책을 우회해 게스트를 초대할 수 있다(§4 누락 1).
2. **구멍 (a)의 심각도를 낮게 적었다.** 제거된 멤버가 관리자 개입 없이 **자기가 쓴 노트에 스스로 공유를 다시 걸어** 접근을 되찾는다(§3).
3. **구멍 (b)는 경로가 하나 더 있다.** `/organization/leave`도 개인 공유를 남긴다(§3).
4. **A1 작업 순서에 의존 오류 세 개**가 있고, MCP `listVaults` 변경이 HTTP와 어긋난다(§5).

## 2. 확인된 주장

| 주장 | 확인 결과 |
|---|---|
| resolver 판정 순서(§3.1 1~11단계), `role !== null` 위치 1320/1332/1379/1386/1394 | 일치. `S/permissions/resolver.ts:1302-1400` |
| `rowsGrant`가 user 원칙 vault 행·항목 행을 `orgClause`와 무관하게 센다(574-585), 주석 910-913 | 일치 |
| `resolveAccessForUserInner`의 `role !== null`(1566, 1590, 1619, 1632-1648) | 일치 |
| `vaultAccess`가 LEFT JOIN이라 비멤버에게도 값을 준다(`S/permissions/vault-docs.ts:60-67`) | 일치. 그래서 `S/permissions/http-gates.ts:261`의 주석 "unknown vault or not a member"는 틀렸다. 비멤버도 null이 아닌 값을 받는다 |
| `listDocsInVault`의 `isMember`(297), 분기 375/388/409/441/462, `listVisibleFolders` 상위 채우기(658-664)와 675 | 일치 |
| HTTP 게이트 줄 번호(138, 180-188, 262, 267-273, 405, 446, 484-492, 518, 616-673) | 일치 |
| 라우트 진입부 `orgRole` 검사(registry 477/547/602/649, bulk 150-151, bootstrap 42-43, blobs 9곳, graph 34, vault-token 33-34, trash 57) | 모두 일치 |
| `sync-token`은 멤버십을 따로 보지 않는다(`S/http/routes/sync-token.ts:105-116`). `onAuthenticate` 252/279/290-293 | 일치 |
| 채널 프레임 동작(`S/sync/vault-channel.ts:1117-1172`) | 일치. `member-joined`는 모든 구독자에게 가고, `presence`의 `docId === null`은 항상 통과한다 |
| 서명 URL 300초, 프록시는 환경 변수(`S/blobs/config.ts:225-226`), 다운로드 URL 2084 | 일치 |
| 초대 미리보기는 로그인 없이 이메일과 inviterId를 준다(`S/http/routes/invitations.ts:114-119`, `S/registry/invitations.ts:69-81`) | 일치 |
| 초대 역할 member/admin만(`S/http/routes/members.ts:425-428`), 역할 PATCH member/admin만(`S/http/routes/orgs.ts:956`), admin→admin 금지(947-952) | 일치 |
| 참가 코드: 8자, 32문자, 편향 없음(`randomBytes % 32`), 만료 없음, 조직당 1개(`S/http/routes/orgs.ts:97-108, 479-520`) | 일치. 32^8 ≈ 1.1×10^12 맞음 |
| 032 트리거(`M/032_member_access_defaults.sql:33-70`)는 AFTER INSERT이고 owner만 건너뛴다(43-45) | 일치. snapshot은 `member` FK `ON DELETE CASCADE`라 멤버 제거 시 함께 지워진다 |
| `vault` 리소스의 `resource_id` = 조직 ID(`S/permissions/lookup.ts:35-57`), `docsForResource` 115-127 | 일치 |
| G6: BA `acceptInvitation`은 이메일이 같아야 수락한다 | **라이브러리 코드로 확인됨**(`BA/routes/crud-invites.mjs:269`). 가정에서 사실로 올려도 된다 |

### 조사 범위 밖 질문 2개

- **`orgs.ts:560` 참가 코드가 대기 중인 게스트 초대자를 member로 만드는가:** **그렇다(잠재 결함).** `liveInvite?.role === "admin" ? "admin" : "member"`라서 admin이 아닌 역할은 모두 member가 된다. 지금은 게스트 초대를 만들 수 없으므로(`members.ts:425-428`) 실제로 일어나지는 않는다. 하지만 A1에서 `guest` 초대를 열면서 이 줄을 고치지 않으면 바로 F1.1 위반이 된다. 같은 경로에서 `applyInvitationAccess`(603-608)도 게스트용 접근 수준을 member에게 적용한다. 설계 문서 §3.9의 409 `use_invitation` 변경이 올바른 수정이다.
- **032 트리거가 게스트에게 join snapshot을 주는가:** **그렇다.** `NEW.role = 'owner'`만 건너뛴다. 그래서 `guest` 행을 INSERT하면 그 시점의 `join_default`(open이면 기존 내용 전체 edit)로 snapshot이 생긴다. resolver는 `existingAtJoin`이면 role과 관계없이 snapshot 모드를 적용한다(1326-1342). §4의 `CREATE OR REPLACE` 수정이 필요하다는 설계 판단이 맞다.

## 3. 기존 구멍 3개

### (a) 비멤버 개인 공유 → sync token: **확정, 심각도 High**

경로(정적 추적):
1. `POST /shares`의 `canManage`(`S/http/routes/shares.ts:242-280`)는 owner/admin **또는 리소스를 만든 사람**이면 통과한다. 만든 사람 판정(263-266)에는 **역할 확인이 없다.**
2. 대상 검증이 없다(524-540). 대상 역할 검사는 행위자가 admin일 때만 하고, `targetRole`이 null이면 그냥 지나간다(536).
3. resolver: 비멤버는 role이 null이다. snapshot은 CASCADE로 이미 없다. 그래서 마지막 분기 `grant(false, true)`(1394)로 간다. `rowsGrant`가 user 항목 행으로 `view`/`edit`를 준다. posture가 Read-only나 sealed여도 같다(1379). user **vault** 행이 있으면 개인 vault 분기(1317-1322)로 조직 전체 문서에 접근한다.
4. `syncPermission`이 그 값을 받고, `sync-token`은 `none`이 아니면 토큰을 준다.

**설계 문서가 놓친 더 강한 경로: 제거된 멤버의 자기 재부여.** 제거 경로 `revokeMembership`은 세션을 지우지 않는다. `activeOrganizationId`만 비운다(`S/http/routes/orgs.ts:177-180`). BA 세션 수명은 30일이고 하루마다 갱신된다(`S/auth/auth.ts:125-128`). 그래서 제거된 사용자 R은 자기가 만든 노트 N에 대해 다음을 할 수 있다.
- `POST /api/shares {resourceType:"file", resourceId:N, principalId:R, permission:"edit"}` → `canManage`가 `isCreator`로 통과한다 → 행이 삽입된다.
- `POST /api/sync-token {docId:N}` → 200, `readOnly:false`.
- 이어서 `public-links` gate(`S/http/routes/public-links.ts:106-125`)도 만든 사람이고 `effectivePermission`이 `edit`이므로 통과한다. **공개 링크까지 만들 수 있다.**

resolver의 1386-1391 주석("a user REMOVED … can re-mint sync tokens indefinitely")이 막으려던 상황이 공유 행 한 줄로 되살아난다. 관리자 실수가 필요 없고, 제거된 사람 혼자 할 수 있다. 그래서 High로 본다. 폴더는 `createdBy`가 null이므로(lookup.ts:75) 노트에만 해당한다.

재현 테스트 초안(`T/orgs-remove-member.test.ts` 패턴, 전용 DB):
```
owner=signUp; org=createOrg(owner); r=signUp; addMember(org, r)
vault=seedVault(org); note=seedNote(vault, …, createdBy=r.userId)
DELETE /api/orgs/:org/members/:r            → 200, shareCount(r)=0
POST /api/shares (r.token) file note→r edit → 기대 403, 현재 200
POST /api/sync-token (r.token) {docId:note} → 기대 403, 현재 200
```
기존 테스트에는 "개인 공유가 있는 비멤버" 사례가 없다(`T/permissions.test.ts:156`, `:202`는 공유가 없는 경우만 다룬다). drift fixture의 `outsider`(`T/resolver-cache-drift.test.ts:63`)도 공유가 없다.

설계 문서의 수정안(A1-0에 §5 규칙 1·2·6과 resolver의 비멤버 fail closed를 넣는 것)으로 막힌다. 다만 §0과 §3.1에 이 자기 재부여 경로와 High 심각도를 명시하고, §8에 `authz/shares: removed creator cannot re-grant self` 테스트를 추가해야 한다.

### (b) Better Auth 멤버 제거가 개인 공유를 남긴다: **확정, 경로 2개, 심각도 Medium(단독) / High((a)와 결합)**

- `afterRemoveMember`(`S/auth/auth.ts:386-391`)는 `onMembershipTrimmed`와 채널 `member-removed`만 한다. 개인 공유 삭제, `disconnectDoc`, `onAclChanged`가 모두 없다. BA `removeMember`(`BA/routes/crud-members.mjs:119-215`)는 `/api/auth/*` catch-all(`S/http/app.ts:322` → `handleOAuthRequest`)로 그대로 노출된다.
- **누락된 두 번째 경로:** BA `/organization/leave`(`BA/routes/crud-members.mjs:386-416`)도 `deleteMember`만 하고 organization hook을 부르지 않는다. 우리 쪽 after-hook(`S/auth/auth.ts:215-228`)도 채널 알림만 한다. 아무 멤버나 이 endpoint로 나가면 자기에게 걸린 개인 공유가 남는다. 지금 resolver에서는 그 공유가 계속 접근을 준다.
- 부수 차이: BA `removeMember`는 BA 기본 권한(admin의 `member:delete`)만 본다. 그래서 admin이 다른 admin을 제거할 수 있다. 우리 규칙(`S/http/routes/orgs.ts:950-952`)과 다르다.
- 데스크톱은 둘 다 쓰지 않는다. 제거와 나가기는 우리 라우트를 쓴다(`D/lib/api.ts:2099-2110`). 그래서 직접 API를 호출해야 일어난다.
- 재현: `POST /api/auth/organization/remove-member {memberIdOrEmail, organizationId}`(owner 토큰) 또는 `POST /api/auth/organization/leave {organizationId}`(멤버 토큰) → `shareCount(member)=1`이 남는다 → `sync-token` 200.
- 수정 제안: 공통 함수를 `afterRemoveMember`와 `/organization/leave` after-hook **둘 다**에서 부른다. 더 단순하게는 `/api/auth/organization/remove-member`·`leave`를 HTTP 계층에서 404로 막는다. 데스크톱이 쓰지 않으므로 이 방법이 가장 짧다. §8 테스트 `better-auth remove-member purges shares`에 leave 사례를 추가한다.

### (c) MCP `listFolders` ACL 없음: **확정, 심각도 Medium**

`S/mcp/service.ts:289-306`은 `requireVaultInScope`로 조직만 확인한다. 그 뒤 `SELECT … FROM folders WHERE vault_id = $1`로 이름, 경로, 부모를 모두 준다. MCP 토큰은 모든 멤버가 만들 수 있다(`S/http/routes/mcp.ts:282-289`). private-by-default나 sealed vault에서 데스크톱 트리(`listVisibleFolders`)가 숨기는 폴더 이름과 경로가 member에게 드러난다. 내용은 드러나지 않고 이름만 드러나므로 Medium이다. CLAUDE.md의 "Authorization must agree across … MCP"를 위반한다.

`listVaults`(281-287)는 HTTP `GET /vaults`(`S/http/routes/registry.ts:314-326`)와 **같은** 동작이다. 둘 다 멤버에게 모든 노트 모음을 준다. 그래서 member에게는 구멍이 아니다(§5 정정 2).

## 4. 누락

1. **[High] Better Auth organization 플러그인 endpoint 표면.** D6의 "멤버·vault 목록"과 "합류 경로 전체"에 해당하지만 문서 어디에도 없다.
   - `GET /api/auth/organization/list-members`(`BA/routes/crud-members.mjs:417-`): 멤버이기만 하면 모든 멤버와 사용자 이름, 이메일, 사진을 준다. **데스크톱이 실제로 호출한다**(`D/lib/api.ts:1888-1895`, `D/store.ts:3736`). `get-full-organization`(`BA/routes/crud-org.mjs:299-336`)과 `list-invitations`(`BA/routes/crud-invites.mjs:524-543`)도 멤버십만 본다. 문서의 `projectPerson`을 overview에만 적용하면 게스트가 이 경로로 모든 이름과 이메일을 받는다. F2를 위반한다.
   - `POST /api/auth/organization/invite-member`: 데스크톱이 이 경로로 초대를 만든다(`D/lib/api.ts:1904`). 문서 §3.9는 정책 검사를 `members.ts:425-428`에 넣지만, BA 경로는 그곳을 거치지 않는다. 정책 검사(`external_sharing_off`)와 역할 제한은 `beforeCreateInvitation` hook(`S/auth/auth.ts:325-345`)에 있어야 두 입구가 같아진다.
   - **BA 역할 등록:** BA는 기본 역할(owner/admin/member)이나 `roles` 옵션에 없는 역할의 초대를 `ROLE_NOT_FOUND`로 거부한다(`BA/routes/crud-invites.mjs:101-122`). `guest` 초대에는 organization 플러그인에 `ac`/`roles` 설정이 필요하다. 이때 owner/admin/member의 BA 기본 권한이 바뀌지 않게 해야 한다. guest에는 BA 권한을 하나도 주지 않는다. A1-9의 첫 작업으로 넣어야 한다.
   - 권장: 게스트에게 위 조회 endpoint를 403으로 막거나, 데스크톱을 우리 overview로 옮긴다. §8에 `authz/better-auth: guest cannot list members/invitations/full-org` 테스트를 추가한다.
2. **[Medium] §3.10 진입부 목록이 완전하지 않다.** `orgRole` 참값만 보는 다음 라우트가 빠졌다. 게스트가 통과한다.
   - `S/ai-changes/service.ts:38`: 원장 행에 `actor_user_id`, `before_path`/`after_path`가 있어 사람 투영과 경로 투영이 둘 다 필요하다. `getAiChange`(43-49)는 `requireVault` 없이 문서 권한만 본다.
   - `S/http/routes/housekeeper.ts:81`
   - `S/http/routes/shrink-brake.ts:36, 55`
   - `S/http/routes/appearance.ts:43`
   - `S/http/routes/mcp.ts:241, 254, 264, 282`: 토큰 발급 라우트. §3.7의 "게스트 토큰 생성 403"이 바로 이곳인데 인용이 없다.

   "진입부를 모두 `isParticipant`로"라는 원칙으로 덮이기는 한다. 하지만 A1-12 출시 점검용으로 `grep -n "orgRole("` 전수 목록을 문서에 고정하고, 남는 호출이 없는지 검사하는 테스트나 lint를 두는 편이 안전하다.
3. **[Low] 기존 HTTP/MCP 루트 쓰기 차이.** HTTP는 member도 루트에 만들 수 있다(`http-gates.ts:446`). MCP는 admin만 가능하다(`S/mcp/service.ts:267-270`). 코드 주석이 의도된 차이라고 적고 있지만, §2 표의 "vault 쓰기(루트에 만들기) member ◐2"는 MCP에서 성립하지 않는다. 표에 MCP 예외로 적는다.
4. **[Low] `S/http/routes/http-gates.ts:261`의 잘못된 주석.** "not a member"는 비멤버를 걸러 내지 않는다. A1-0에서 `vaultAccess`가 비멤버에게 null(또는 relation none)을 돌려주게 하면 주석도 맞게 된다.
5. **[Low] BA `requireEmailVerificationOnInvitation` 옵션**(`BA/routes/crud-invites.mjs:31, 274`)이 있다. 이 옵션은 역할을 가리지 않는 전역 설정이다. 그래서 §3.9의 "guest/admin만 인증 요구"에는 hook 방식이 맞다. 문서에 이 근거를 한 줄 적어 두면 A1에서 다시 조사하지 않아도 된다.

## 5. 틀린 인용, 주장 정정

| 위치 | 문서 내용 | 정정 |
|---|---|---|
| §0, §3.1 | 구멍 1은 "비멤버도 공유 한 줄로" 들어온다는 정적 가능성 | 제거된 멤버가 자기 노트에 **스스로** 공유를 거는 경로가 실재한다(§3 (a)). 심각도 High로 올린다 |
| §0, §3.9 | BA 제거 경로는 `afterRemoveMember` 하나 | `/organization/leave`도 같다(§3 (b)) |
| §3.7, A1-0 | "`listVaults`는 읽을 수 있는 문서가 있는 노트 모음만 준다"를 member에게도 적용하는 기존 버그 수정 | member에게는 HTTP `GET /vaults`도 모든 노트 모음을 준다. 그래서 MCP만 바꾸면 **새 불일치**가 생긴다. 게스트 분기(§3.3과 같은 규칙)로 옮기거나, HTTP와 함께 바꾼다 |
| §3.7 | `requireAccessManager`(178-214) | 178-214는 `listResourceAccessTool`이다. 그 함수가 184에서 `requireAccessManager`를 부르고, 정의는 `S/permissions/access-management.ts:31-37`이다. 의미는 맞다 |
| §3.12 | resolver가 `resource_id = $4`로 찾는다(885-892, …) | 885-892는 doc comment다. 실제 SQL은 919-923, 940-941이다. 의미는 맞다 |
| PRD D6 vs 문서 | PRD는 `lookup.ts:40-57`, 문서는 35-57 | 둘 다 같은 범위를 가리킨다. 문제없다 |

그 밖의 줄 인용은 표시한 범위 안에 해당 코드가 있다. `orgs.ts:168-176`은 member 삭제(168)와 공유 삭제(172-175)를 함께 덮는다.

## 6. 기대 권한 표, 경로, 테스트, 작업 순서

### 6.1 PRD D6 비상속 6개 항목

| D6 항목 | guest | partner |
|---|---|---|
| 조직 기본 권한(baseline) | 주석 4에서 제외. §3.1 `guestPermission`이 posture를 보지 않는다 | 모든 칸 ❌ |
| join snapshot | 주석 4에서 제외. §4 트리거 교체 | ❌ |
| 개인 vault 권한 | 주석 4, G3, §5 규칙 3 | ❌ |
| org 공유 | 주석 4. `$4=false`(§3.2), `editsSomethingInVault`(§3.3) | ❌ |
| 만든 사람 규칙 | 주석 4·5. 삭제의 "만든 사람"은 부여가 아니라 제한이다. PRD "만든 사람 규칙으로 접근이 유지되지 않는다"와 맞는다 | ❌ |
| 관리 기능 | 공유·관리·멤버 관리 ❌, MCP ❌ | ❌ |

**모순 없음.** 다만 §4 누락 1의 BA endpoint를 막지 않으면 "관리 기능 비상속"은 표에서만 성립한다. BA `hasPermission`은 guest 역할에 권한이 없으면 거부하겠지만, 그 전제가 되는 역할 설정이 문서에 없다.

### 6.2 11개 경로

D6 표의 11행이 §3.1-§3.11과 일대일로 대응한다. 빠진 행은 없다. 각 행 안의 하위 경로 누락은 §4의 1·2다.

### 6.3 통합 테스트의 거부 케이스

| 경로 | 거부 케이스 | 빠진 거부 케이스 |
|---|---|---|
| 1 resolver | X, G, P 모두 있음 | 제거된 creator의 자기 재부여(아래 shares에 둔다) |
| 2 읽기 가능 목록 | G 투영 | X + user vault 행 → `vaultAccess` 빈 결과. G + vault 행 무시(resolver에만 있음) |
| 3 HTTP | 루트, edit 범위, 삭제, `/vaults` | G가 org `edit` 공유로 첨부 쓰기 거부(518). G가 만든 폴더가 공유 밖에 있을 때 단축(188) 거부. 진입점 밖 경로 400(§3.2). registry `access-check` |
| 4 동기화 | X 403, 강등 | 충분 |
| 5 채널 | member/presence/voice | `docId === null` presence가 처음 보는 사용자일 때 G에게 `frame∅` |
| 6 첨부 | 읽기, 프록시, 회수 | G의 `canWriteBlob` 범위 밖 거부. `filterReadableBlobs` 목록 `canary∅` |
| 7 MCP | 토큰, listFolders, 강등 | `listVaults` 규칙(§5 정정 반영 후) |
| 8 멤버·미리보기 | overview, 미리보기, 버전·휴지통 | **BA list-members / get-full-organization / list-invitations**(G 403 또는 `canary∅`). 활동 피드 |
| 9 합류 | 넓게 덮음 | BA `/organization/leave` 공유 정리. BA `invite-member` 경로의 `external_sharing_off` |
| 10 기타 | graph, search, trash, bootstrap, bulk | ai-changes(`canary∅`, 경로 투영), housekeeper, shrink-brake |
| 11 캐시 | 있음 | 충분 |
| `POST /shares` | 5개 | **제거된 creator가 자기에게 공유 → 403** |

### 6.4 A1 작업 순서

| 문제 | 정정 |
|---|---|
| A1-0이 §5 규칙 1·2를 쓰는데 `isInternal`/`isParticipant`/`parseRole`은 A1-1(§3.0)에서 생긴다 | A1-0에서는 기존 역할만 있으므로 `role !== null`로 쓰고 A1-1에서 치환한다고 명시한다. 또는 §3.0 헬퍼만 A1-0으로 당긴다(동작 변화가 없으므로 안전) |
| A1-6(채널 presence "이름 투영")이 A1-2에만 의존하는데 `projectPerson`은 A1-8에서 생긴다 | A1-6 의존에 A1-8을 추가하거나, `projectPerson`을 A1-3으로 당긴다 |
| A1-7 테스트 `demotion revokes tokens`는 강등 PATCH(A1-9)가 있어야 한다 | A1-7은 토큰 삭제 함수만 만들고, 강등 연결과 테스트는 A1-9로 옮긴다 |
| A1-9에 BA 역할 등록과 `beforeCreateInvitation` 정책 검사가 없다 | §4 누락 1을 A1-9 첫 항목으로 넣는다. BA 조회 endpoint 차단은 A1-8에 넣는다 |
| A1-0에 BA `leave` 정리가 없다 | A1-0 "Better Auth 제거 경로"에 `/organization/leave`를 넣는다 |

나머지 의존(A1-1 → A1-2 → A1-3 → A1-4, A1-5 ← A1-1·A1-4, A1-10 ← A1-6·A1-9)은 맞다.

## 7. 결론

- 구멍 (a): 확정, High. 제거된 멤버의 자기 재부여로 범위가 더 넓다.
- 구멍 (b): 확정, Medium(단독)/High((a)와 결합). `/organization/leave` 경로가 하나 더 있다.
- 구멍 (c): 확정, Medium.
- `orgs.ts:560` 게스트→member: 지금은 잠재 결함이고, A1에서 게스트 초대를 열면 실제 결함이 된다. 032 트리거의 게스트 snapshot: 확정.
- 승인 조건: §4 누락 1(BA endpoint와 역할 등록), §3 (a)·(b) 서술 보강, §5 `listVaults` 정정, §6.4 순서 정정을 문서에 반영한다. 나머지는 A1 진행 중에 고쳐도 된다.
