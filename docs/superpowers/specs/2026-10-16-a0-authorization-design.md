---
type: design
product: Infinite Brain
date: 2026-10-16
phase: A0
status: draft (독립 검증 반영본, 승인 대기)
verified-by: docs/reports/A0-VERIFY-opus.md (2f8adf8) — 반영 내역은 문서 끝 "검증 반영 기록"
base: docs/superpowers/specs/2026-10-15-team-second-brain-prd.md (PRD v2)
covers: PRD §4 D6, §5.1 F1, §5.2 F2, §9 A0
tags: [authz, guest, hub, join-code, a0]
---

# A0 설계: 허브 모드 권한 판정 (게스트 도입 전 고정)

이 문서는 PRD v2의 D6(권한 판정 일치), F1(팀 합류), F2(게스트), §9의 A0 행을 구현할 수 있는 수준으로 고정한다. A1은 이 문서만 보고 작업을 시작할 수 있어야 한다. 코드는 바꾸지 않았다.

경로 약어는 PRD와 같다. `S/` = `app/apps/server/src/`, `D/` = `app/apps/desktop/src/`, `T/` = `app/apps/server/tests/`, `M/` = `app/apps/server/migrations/`. 코드 인용은 `iron/docs-a0-authz` 브랜치에서 직접 확인한 줄만 적었다. 처음에는 c10a7ea에서, 독립 검증 반영 때는 2f8adf8에서 다시 확인했다. `BA/` = 설치된 `better-auth@1.6.23`의 `dist/plugins/organization/`이다. 이 코드와 DB 테스트는 바꾸거나 실행하지 않았다.

## 0. 요약

- **판정을 두 단계로 나눈다.** 먼저 "이 사람이 이 vault와 어떤 관계인가"(`relation`: internal / guest / partner / none)를 정하고, 그다음 "이 리소스에서 무엇을 할 수 있는가"를 정한다. 지금 코드는 관계를 `role !== null` 하나로만 본다. 그래서 `guest` 값을 `member.role`에 넣기만 하면 게스트가 조직 기본 권한, join snapshot, 만든 사람 규칙을 모두 물려받는다(§3).
- **게스트 도입과 무관하게 지금 있는 구멍 세 개를 먼저 막는다.** 심각도는 독립 검증(`docs/reports/A0-VERIFY-opus.md`)이 정적 분석으로 확인한 값이다.
  1. **[High] 비멤버 개인 공유 → sync token, 제거된 멤버의 자기 재부여.** 개인 공유는 멤버십을 보지 않는다(`S/permissions/resolver.ts:574-585`). 그런데 `POST /shares`는 대상이 멤버인지 검사하지 않고(`S/http/routes/shares.ts:524-540`), `canManage`는 **리소스를 만든 사람이면 역할 확인 없이** 통과시킨다(`shares.ts:259-268`). 그래서 관리자 실수가 없어도, 제거된 멤버가 혼자서 자기가 만든 노트에 자기 앞으로 공유를 걸어 `sync-token`(`S/http/routes/sync-token.ts:105-116`)과 공개 링크를 다시 얻는다. 제거는 세션을 지우지 않고(`orgs.ts:177-180`, 세션 30일 `S/auth/auth.ts:125-128`) resolver의 `role !== null` 주석(`resolver.ts:1386-1391`)이 막으려던 상황이 공유 행 한 줄로 되살아난다(§3.1).
  2. **[Medium 단독 / High (1)과 결합] Better Auth 자체 제거 경로 두 개가 개인 공유를 남긴다.** `remove-member`의 `afterRemoveMember`(`S/auth/auth.ts:386-391`)와 `/organization/leave`(`S/auth/auth.ts:215-228`의 after-hook)는 둘 다 채널 알림만 하고 개인 공유 삭제, `disconnectDoc`, `onAclChanged`를 하지 않는다. 우리 경로는 지운다(`S/http/routes/orgs.ts:168-176`). 데스크톱은 둘 다 쓰지 않는다(제거·나가기는 우리 라우트, `D/lib/api.ts:2099-2110`). 그래서 직접 API를 호출해야 일어난다(§3.9).
  3. **[Medium] MCP `listFolders`는 ACL 없이** vault의 모든 폴더 이름을 돌려준다(`S/mcp/service.ts:289-306`). 데스크톱 폴더 트리는 같은 사람에게 그 이름들을 숨긴다(`S/permissions/vault-docs.ts:610-680`). 내용은 드러나지 않고 이름만 드러난다. 같은 파일의 `listVaults`(281-287)는 HTTP `GET /vaults`(`S/http/routes/registry.ts:314-326`)와 **같은 동작**이라서 member에게는 구멍이 아니다(§3.7).
- **Better Auth organization 플러그인 endpoint도 판정 경로다.** 데스크톱이 `list-members`, `list-invitations`, `invite-member`를 직접 호출한다(`D/lib/api.ts:1888-1895, 1904, 1914`, `D/store.ts:3736, 4150`). 이 표면이 §3의 경로 목록에서 빠져 있었다. 게스트가 모든 사람의 이름과 이메일을 받고, 외부 공유 정책을 우회해 게스트를 초대할 수 있으며, `guest` 역할은 BA에 등록되지 않아 초대 자체가 거부된다(§3.8, §3.9).
- **게스트는 명시적인 개인 공유(폴더·파일)만으로 접근한다.** 이름, 이메일, 내부 폴더 경로, 다른 vault 이름을 받지 않는다. 경로는 공유 진입점 기준으로 잘라서 보여 준다(§3.2).
- **참가 코드**에 만료, 재발급, 시도 제한을 둔다. 코드는 member로만 합류시킨다. 대기 중인 다른 역할의 초대가 있으면 코드 대신 초대 수락으로 보낸다(§7).
- **기존 데이터의 권한은 바뀌지 않는다.** 어떤 행도 guest가 되지 않는다. 비멤버에게 남아 있던 개인 공유는 지우지 않고 격리 테이블로 옮긴다(§4).

## 1. 가정

합리적인 가정으로 진행했다. 승인 때 하나라도 뒤집히면 해당 절을 고친다.

| # | 가정 | 영향 받는 절 |
|---|---|---|
| G1 | partner는 E 단계 전까지 **비멤버와 똑같이** 모든 경로에서 거부한다. 값은 예약만 하고 DB 제약으로 쓰기를 막는다 | §2, §4 |
| G2 | 게스트는 A1에서 MCP 토큰과 OAuth 연결을 만들 수 없다. 기존 토큰은 게스트가 되는 순간 무효다 | §2, §3.7 |
| G3 | 게스트는 vault 단위 개인 권한(`resource_type='vault'`의 user 행)을 받을 수 없다. 폴더와 파일만 받는다 | §2, §5 |
| G4 | 게스트에게는 공유 진입점보다 위의 폴더 이름을 보이지 않는다. 서버가 경로를 투영(projection)한다(§3.2). 비용이 크다는 판단이 나오면 "상위 폴더 이름 노출 + 공유 화면 경고"로 바꾸되, PRD F2 문구를 함께 고친다 | §3.2 |
| G5 | 협업 커서(awareness)의 이름도 PRD F2의 "다른 사람의 이름" 금지에 포함한다. Hocuspocus에서 연결별로 awareness를 고쳐 쓸 수 있는지는 A1 첫 spike에서 확인한다. 안 되면 게스트 연결에는 원격 커서를 보내지 않는다 | §3.4 |
| G6 | Better Auth `acceptInvitation`은 로그인한 사용자의 이메일과 초대 이메일이 같아야 수락한다. **라이브러리 코드로 확인했다**(`BA/routes/crud-invites.mjs:269`, 같은 검사가 380, 503에도 있다). 가정이 아니라 사실이다. A1-1에서 회귀 테스트로만 고정한다 | §6 |
| G7 | 외부 공유 정책의 기본값은 기존·신규 조직 모두 **끔**이다. owner/admin은 게스트 초대 화면에서 한 번 눌러 켤 수 있다 | §4, §6 |
| G8 | Better Auth 초대 ID는 추측할 수 없는 무작위 값이다. 메일 없는 설치에서는 초대 링크 자체가 비밀이 되므로 A1-1에서 길이와 생성 방식을 확인한다 | §6 |

## 2. 기대 권한 표

### 2.1 관계와 역할

| 역할 값 (`member.role`) | 관계 (`relation`) | 뜻 |
|---|---|---|
| `owner` | internal | vault를 만든 사람. 제거·강등 불가 |
| `admin` | internal | 관리자. 다른 admin과 owner는 건드리지 못한다(`S/http/routes/orgs.ts:947-952`) |
| `member` | internal | 일반 팀원 |
| `guest` | guest | 외부 협력자. A1 신규 |
| `partner` | partner | 연결된 vault(E)의 상대 조직 사람. **A1에서는 none과 같다**(G1) |
| (행 없음) / 알 수 없는 값 | none | 비멤버. 알 수 없는 문자열은 fail closed로 none |

Better Auth의 역할 문자열은 쉼표로 이어질 수 있다(`S/permissions/http-gates.ts:595-602`, `S/http/routes/bulk.ts:861`). 해석은 한 함수(`parseRole`)만 한다. `owner`, `admin`, `member`, `guest` 중 하나를 포함하면 가장 높은 것을 고르고, 그 외에는 none으로 본다.

### 2.2 표

기호: ✅ 허용, ◐ 조건부(번호 주석), ❌ 거부. "읽기/쓰기/공유/관리"는 다음 뜻이다.
- **읽기:** 내용이나 목록을 받는다.
- **쓰기:** 만들기, 고치기, 옮기기, 지우기, 복원.
- **공유:** 다른 사람에게 권한을 주거나 공개 링크를 만든다.
- **관리:** 역할, posture, 초대, 참가 코드, 정책을 바꾼다.

| 리소스 | 동작 | owner | admin | member | guest | partner(예약) | 비멤버 |
|---|---|---|---|---|---|---|---|
| vault (조직 전체) | 읽기 | ◐1 | ◐1 | ◐2 | ❌ | ❌ | ❌ |
| | 쓰기(루트에 만들기) | ◐1 | ◐1 | ◐2 | ❌ | ❌ | ❌ |
| | 공유(posture, 팀 전체 공유) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| | 관리 | ✅ | ◐3 | ❌ | ❌ | ❌ | ❌ |
| 문서(노트·파일) | 읽기 | ◐1 | ◐1 | ◐2 | ◐4 | ❌ | ❌ |
| | 쓰기 | ◐1 | ◐1 | ◐2 | ◐5 | ❌ | ❌ |
| | 공유(개인 공유, 공개 링크) | ✅ | ✅ | ◐6 | ❌ | ❌ | ❌ |
| 폴더 | 읽기(트리에 보임) | ◐1 | ◐1 | ◐2 | ◐4 ◐7 | ❌ | ❌ |
| | 쓰기(이름, 이동, 하위 생성) | ◐1 | ◐1 | ◐2 | ◐5 | ❌ | ❌ |
| | 공유 | ✅ | ✅ | ◐6 | ❌ | ❌ | ❌ |
| 첨부 | 읽기 | ◐1 | ◐1 | ◐2 | ◐8 | ❌ | ❌ |
| | 쓰기 | ◐1 | ◐1 | ◐2 | ◐5 | ❌ | ❌ |
| 휴지통·버전 | 읽기 | ✅9 | ✅9 | ◐2 | ◐4 ◐10 | ❌ | ❌ |
| | 복원·되돌리기 | ✅9 | ✅9 | ◐2 | ◐5 | ❌ | ❌ |
| | 영구 삭제·checkpoint·복구 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 그래프·검색 | 읽기 | ◐1 | ◐1 | ◐2 | ◐4 | ❌ | ❌ |
| 멤버 목록 | 읽기 | ✅ | ✅ | ✅ | ◐11 | ❌ | ❌ |
| | 관리(초대, 역할, 제거) | ✅ | ◐3 | ❌ | ❌ | ❌ | ❌ |
| 초대 미리보기 | 읽기 | ✅ | ✅ | ✅ | ◐12 | ◐12 | ◐12 |
| MCP 토큰 | 만들기·사용 | ✅ | ✅ | ✅ | ❌ (G2) | ❌ | ❌ |
| | `access:manage` scope | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

주석:
1. 지금 resolver를 그대로 따른다. 거부(deny)와 개인 vault 수준이 먼저 적용되고, posture가 Read-only나 sealed이면 역할 단축을 잃는다(`S/permissions/resolver.ts:1296-1395`). owner/admin도 예외가 아니다. 관리 권한은 역할로만 판정하므로 스스로 건 제한을 언제든 풀 수 있다(`S/permissions/resolver.ts:1189-1196`).
2. 지금 resolver를 그대로 따른다. 조직 기본 권한(baseline), join snapshot, 개인 vault 수준, 팀 전체 공유, 만든 사람 규칙, 개인 공유, 잠금이 모두 적용된다. **예외:** 노트 모음 루트에 만들기는 HTTP에서는 member도 되지만(`S/permissions/http-gates.ts:446`) MCP에서는 admin만 된다(`S/mcp/service.ts:267-270`). 코드 주석이 의도된 차이라고 적고 있어 이 문서는 바꾸지 않는다. 표의 "쓰기(루트에 만들기)"는 MCP에서 member에게 성립하지 않는다.
3. admin은 owner와 다른 admin을 건드릴 수 없다. 지금 규칙(`S/http/routes/orgs.ts:947-952`, `S/http/routes/shares.ts:533-539`)을 유지한다.
4. **명시적인 개인 공유(폴더·파일)가 닿는 범위만.** 폴더 공유는 하위로 상속된다. 조직 전체 권한, snapshot, 개인 vault 행, `principal_type='org'` 공유, 만든 사람 규칙은 적용하지 않는다. 개인 거부와 잠금은 적용한다.
5. 4의 범위 안에서 `edit` 공유를 받은 곳에서만 가능하다. 루트에는 만들 수 없다. 자기가 만든 노트를 공유 범위 밖으로 옮기면 접근을 잃는다. 삭제는 `edit` 권한이 있고 **자기가 만든** 항목만 할 수 있다. 이것은 권한을 주는 규칙이 아니라 제한이다.
6. member는 자기가 만든 항목만 공유를 관리할 수 있다(지금 규칙, `S/http/routes/shares.ts:263-268`, `S/http/routes/public-links.ts:115-120`). 단, 대상이 게스트이면 외부 공유 정책(F4)이 허용해야 한다.
7. 게스트의 트리에는 공유 진입점과 그 하위만 보인다. 진입점의 상위 폴더 이름은 보내지 않는다(§3.2).
8. 읽을 수 있는 노트가 참조하는 첨부와, 읽을 수 있는 폴더 안의 파일만 받는다. 다운로드 URL은 항상 서버 프록시를 거친다(§3.6).
9. 지금 휴지통 관리자 단축(`S/trash/service.ts:137-142, 236-246`)을 유지한다.
10. 버전과 휴지통의 작성자, 삭제자 이름은 사람 투영(§3.8)을 거친다.
11. 게스트는 자기 자신만 받는다. 다른 사람은 "팀원"이라는 표시 이름으로만 나타나고 ID, 이메일, 사진은 없다(§3.8). 우리 `overview` 라우트뿐 아니라 Better Auth의 `list-members`·`get-full-organization`·`list-invitations` endpoint도 같은 규칙을 따른다. 게스트에게는 403이다(§3.8).
12. 로그인하지 않았거나 초대 대상이 아니면 조직 이름, 초대한 사람 표시 이름, 역할, 만료, **가린 이메일**만 받는다. 로그인한 사용자의 이메일이 초대 이메일과 같을 때만 원래 이메일을 받는다(§3.8).

## 3. D6의 11개 경로: 현재 판정, 차이, 변경

각 경로는 같은 형식으로 쓴다. **현재**는 코드가 지금 하는 일, **차이**는 §2 표와 다른 점, **변경**은 A1에서 할 일이다.

### 3.0 공통 변경: 관계 헬퍼

`S/permissions/lookup.ts`에 다음을 둔다. 다른 파일은 역할 문자열을 직접 비교하지 않는다.

```ts
type Role = "owner" | "admin" | "member" | "guest";
type Relation = "internal" | "guest" | "none"; // partner는 E 전까지 none
parseRole(raw: string | null): Role | null      // 모르는 값은 null (fail closed)
relationOf(role: Role | null): Relation
isParticipant(role)  // internal 또는 guest: vault에 연결해도 되는가
isInternal(role)     // 조직 기본 권한, snapshot, 만든 사람 규칙, 팀 공유를 받는가
isManager(role)      // owner 또는 admin
```

지금 `orgRole`(`S/permissions/lookup.ts:6-16`)과 resolver의 `memberRole`(`S/permissions/resolver.ts:867-877`)은 같은 SELECT를 따로 갖고 있다. 둘 다 `parseRole`을 거치게 한다.

치환 규칙은 하나다.
- `role !== null`이 "조직 권한을 받는가"라는 뜻이면 `isInternal(role)`로 바꾼다.
- `!role` 또는 `role === null`이 "vault에 들어올 수 있는가"라는 뜻이면 `isParticipant(role)`로 바꾼다.

기존 역할(owner/admin/member)에서는 두 함수 모두 지금과 같은 값을 낸다. 그래서 이 치환만으로는 기존 동작이 바뀌지 않는다. drift 테스트(`T/resolver-cache-drift.test.ts`, `T/resolver-prefetch-drift.test.ts`)로 확인한다.

### 3.1 권한 판정 (resolver)

**현재**
- `effectivePermission`(`S/permissions/resolver.ts:1229-1244`)은 다음 순서로 판정한다(`effectivePermissionInner` 1246-1402).
  1. 개인 거부와 항목 Private(1302-1303)
  2. 역할 조회(1305-1306)
  3. 개인 vault 수준(1314-1323)
  4. join snapshot(1325-1343)
  5. posture(1348-1351)
  6. 항목 Private(1353-1362)
  7. Read-only/sealed(1363-1379)
  8. owner/admin 단축(1380-1385)
  9. 만든 사람 규칙(1386-1392)
  10. 나머지 공유(1394)
  11. 잠금 cap(1398-1400)
- "멤버인가"는 모두 `role !== null`이다(1320, 1332, 1379, 1386, 1394).
- **개인 공유는 멤버십을 보지 않는다.** `rowsGrant`는 user 원칙의 vault 행과 항목 행을 `orgClause`와 무관하게 센다(574-585). 주석도 "Per-user grants are inherently scoped, so they need no gate"라고 적어 두었다(910-913). 이 계약은 "멤버를 지울 때 개인 공유도 지운다"는 운영 규칙에 기대고 있다(`S/http/routes/orgs.ts:128-141`).
- **제거된 멤버의 자기 재부여 경로(확정, High).** 제거 경로 `revokeMembership`은 세션을 지우지 않고 `activeOrganizationId`만 비운다(`S/http/routes/orgs.ts:177-180`). 세션 수명은 30일이고 하루마다 갱신된다(`S/auth/auth.ts:125-128`). 제거된 사용자 R이 자기가 만든 노트 N에 대해 할 수 있는 일은 다음과 같다.
  1. `POST /api/shares {resourceType:"file", resourceId:N, principalId:R, permission:"edit"}`. `canManage`(`S/http/routes/shares.ts:242-280`)는 owner/admin **또는 리소스를 만든 사람**이면 통과하고, 만든 사람 판정(263-266)에는 역할 확인이 없다. 대상 검증도 없다(524-540). 대상 역할 검사는 행위자가 admin일 때만 하고 `targetRole`이 null이면 그냥 지나간다(536).
  2. resolver에서 R은 role이 null이다. snapshot은 멤버 FK `ON DELETE CASCADE`로 이미 사라졌다. 그래서 마지막 분기 `grant(false, true)`(1394)로 가고, `rowsGrant`가 user 항목 행으로 `view`/`edit`를 준다. posture가 Read-only나 sealed여도 같다(1379). user **vault** 행이 있으면 개인 vault 분기(1317-1322)로 조직 전체 문서에 접근한다.
  3. `POST /api/sync-token {docId:N}`이 200, `readOnly:false`를 준다(`sync-token.ts:105-116`). 공개 링크 gate(`S/http/routes/public-links.ts:106-125`)도 만든 사람이고 `effectivePermission`이 `edit`이므로 통과해서 **공개 링크까지 만들 수 있다.**
  
  `resolver.ts:1386-1391` 주석("a user REMOVED … can re-mint sync tokens indefinitely")이 막으려던 상황이 공유 행 한 줄로 되살아난다. 관리자 실수가 필요 없고 제거된 사람 혼자 할 수 있다. 폴더는 `createdBy`가 null이라(`S/permissions/lookup.ts:75`) 노트에만 해당한다. 기존 테스트에는 "개인 공유가 있는 비멤버" 사례가 없다(`T/permissions.test.ts:156, 202`와 `T/resolver-cache-drift.test.ts:63`의 `outsider`는 모두 공유가 없다).
- 접근 색인 `loadAccessIndex`(376-429)는 조직의 모든 폴더·노트·파일·공유 행을 리소스 기준으로 읽는다(396-413). "누가 접근하나" 화면은 `resolveAccessForUserInner`(1532-)를 쓴다. 여기도 `role !== null`을 쓴다(1566, 1590, 1619, 1632-1648).

**차이**
- guest 값은 `role !== null`을 통과한다. 그래서 개인 vault 행, snapshot(032 트리거가 만든다, §4), 팀 공유, Read-only posture, 만든 사람 규칙을 모두 받는다. 표의 주석 4와 다르다.
- 비멤버는 개인 공유 한 줄로 `view`/`edit`를 받는다. 표에서는 ❌다. **심각도는 High다.** 제거된 멤버가 자기 노트에 자기 앞으로 공유를 걸어 스스로 접근과 공개 링크를 되찾을 수 있기 때문이다(위 "자기 재부여 경로").

**변경**
- `effectivePermissionInner`는 역할을 읽은 직후에 다음을 한다.
  - `relation === "none"`이면 `"none"`을 돌려준다. 비멤버와 partner는 어떤 공유로도 들어오지 못한다. 이것으로 `orgs.ts:128-141`의 "지워야만 안전한" 계약이 "판정에서 막힌다"로 바뀐다. 정리는 유지하되 안전의 근거로 쓰지 않는다.
  - `relation === "guest"`이면 별도 함수 `guestPermission`으로 간다. 이 함수는 `userItemVerdict`(494-529)의 개인 항목 판정(거부, 가장 깊은 행 우선, 잠금 cap)만 쓴다. 개인 vault 행, org 행, snapshot, 역할 단축, 만든 사람 규칙은 보지 않는다. 결과에는 결제 lapse cap(1241-1243)을 그대로 적용한다.
- `resolveAccessForUserInner`와 `ResolverCache`, `AccessIndex` 경로에도 같은 분기를 넣는다. drift 테스트에 guest와 비멤버 행을 추가한다.
- **자기 재부여 차단은 세 겹이다.** 어느 하나만 있어도 위 경로는 막히지만 모두 둔다.
  1. §5 규칙 1: `canManage`와 공개 링크 gate가 `isInternal(actorRole)`을 먼저 요구한다. 제거된 만든 사람은 403이다.
  2. §5 규칙 2: user 대상은 현재 참여자여야 한다.
  3. 위 resolver의 비멤버 fail closed. 공유 행이 이미 있어도 `none`이고, `sync-token`과 공개 링크 gate의 `effectivePermission` 검사도 함께 막힌다.
- 이 세 가지는 게스트 없이도 출시할 수 있는 보안 수정이다. A1-0에 넣는다(§9). 이때는 역할이 owner/admin/member뿐이므로 `isInternal`/`relation` 대신 `role !== null`로 쓰고, A1-1에서 §3.0 헬퍼로 치환한다.

### 3.2 읽기 가능 목록

**현재**
- `vaultAccess`(`S/permissions/vault-docs.ts:50-83`)는 `LEFT JOIN member`라서 비멤버에게도 null이 아닌 값을 준다(60-67). 개인 vault 행이 있으면 그것으로 `vaultWide`를 정한다(70-72). org 행은 `row.role !== null`일 때만 센다(73).
- `listDocsInVault`(266-)의 멤버 판정은 `isMember = role !== null`이다(297).
  - 만든 사람 분기는 `($4 AND $6 AND n.created_by = $1)`이다(409).
  - 팀 공유 분기는 `$4 AND $5`다(375, 388).
  - sealed이면 만든 사람 규칙을 뺀다(441).
  - snapshot을 적용한다(462-).
- `listVisibleFolders`(610-)는 보이는 항목의 **상위 폴더를 모두** 트리에 넣는다(605-608, 658-664). 멤버 판정은 `access.role !== null`이다(675).
- 결과는 표시용 캐시를 거친다. TTL은 10초다(`S/permissions/readable-cache.ts:36`). 같은 인스턴스의 변경은 즉시 무효화하고, 다른 인스턴스의 변경은 TTL 동안 낡을 수 있다(28-32). 멤버십 자체는 캐시하지 않는다(33-34).

**차이**
- guest는 `isMember`가 참이라 팀 공유, 만든 사람 규칙, snapshot을 받는다.
- 비멤버도 개인 공유로 목록을 받는다.
- `S/permissions/http-gates.ts:261`의 주석 "unknown vault or not a member"는 틀렸다. `vaultAccess`가 LEFT JOIN이라 비멤버도 null이 아닌 값을 받는다. 비멤버를 걸러 내는 곳은 이 줄이 아니다.
- 게스트가 공유 폴더의 상위 폴더 이름을 받는다. 노트의 `rel_path`에도 상위 폴더 이름이 들어 있다.

**변경**
- `vaultAccess`가 `relation`을 돌려준다. none이면 빈 집합이다. guest이면 `vaultWide=false`, 팀 공유와 만든 사람 규칙은 끄고(`$4=false`, `creatorCounts=false`), snapshot은 건너뛰고, 개인 vault 행은 무시한다.
- **경로 투영(G4).** 게스트에게 나가는 응답의 `rel_path`, 폴더 `path`·`name`·`parent_id`는 `projectPath(viewer, path)`를 거친다.
  - 공유 진입점 `A/B/Shared`는 게스트에게 `Shared`로 보인다.
  - 진입점의 `parent_id`는 null이 된다.
  - 같은 이름의 진입점이 둘이면 ` (2)`를 붙인다.
  - 게스트가 보낸 경로(만들기, 이동)는 진입점을 기준으로 다시 붙인다. 진입점 밖으로 나가는 경로는 400으로 거부한다.
  - 투영은 응답 직렬화 경계에서만 한다. DB와 Yjs, `doc_id`는 그대로다. CLAUDE.md의 "doc_id가 정체성" 불변 조건을 지킨다.
  - 적용 대상: registry 목록, 폴더 목록, MCP(게스트는 A1에서 막지만 같은 함수를 쓴다), 검색 결과, 그래프 노드, 첨부 목록, 휴지통 목록, 버전 목록.
- `listVisibleFolders`의 상위 폴더 채우기(658-664)는 게스트에게 하지 않는다.
- `vaultAccess`가 비멤버에게 none을 돌려주면 `http-gates.ts:261`의 주석도 맞게 된다. 그래도 주석은 A1-0에서 사실대로 고친다("none이면 거절").

### 3.3 HTTP 게이트

**현재**
- `canEditDoc`은 resolver를 그대로 쓴다(`S/permissions/http-gates.ts:83-89`).
- `canEditFolder`(106-195)
  - `role === null`이면 거부한다(138).
  - 개인 vault 수준, 항목 Private, posture, snapshot 중 하나라도 걸리면 resolver로 넘긴다(180-184).
  - 아니면 owner/admin 단축(187)과 **폴더 만든 사람 단축**(188)을 쓴다.
- `canCreateIn`은 폴더가 있으면 `canEditFolder`로 넘기고, 루트면 `role === null`을 거부한 뒤(405) `vaultRootWritable`을 부른다(393-407).
- `vaultRootWritable`은 posture가 Read-only나 sealed가 아니면 **누구에게나 참**이다(446). 역할은 호출자가 확인한다.
- `canReadAttachment`(250-275)
  - 파일 문서면 resolver로 판정한다.
  - 아니면 `vaultWide`이면 통과한다(262).
  - 그 밖에는 읽을 수 있는 노트의 본문에 경로가 나오는지 `note_index`에서 LIKE로 찾는다(267-273).
- `filterReadableBlobs`(296-334)도 같은 구조다.
- `canWriteAttachment`는 `access.role === null`이면 거부하고(484), 루트에 쓸 수 있거나 어딘가에 `edit`를 가졌으면 허용한다(485-492). `editsSomethingInVault`(505-539)는 org 행도 센다(518).
- `canDeleteItem`(616-674)은 관리자면 무조건 허용한다(630). 아니면 만든 사람만 허용한다(639, 647-673).
- 라우트 진입부의 "멤버인가" 검사는 모두 `orgRole`이 참인지 본다.
  - `S/http/routes/registry.ts:477, 547, 602, 649`
  - `S/http/routes/bulk.ts:150-151`
  - `S/http/routes/bootstrap.ts:42-43`
  - `S/http/routes/blobs.ts:434, 943, 1569, 1740, 1859, 1880, 1959, 2136, 2234`
  - `S/http/routes/graph.ts:34`
  - `S/http/routes/vault-token.ts:33-34`
  - `S/trash/service.ts:57`
- `GET /vaults`(`S/http/routes/registry.ts:314-326`)는 멤버면 조직의 **모든** 노트 모음(`vaults` 행)과 그 이름을 준다. MCP `listVaults`(`S/mcp/service.ts:281-287`)도 토큰 조직의 **모든** 노트 모음을 준다. 두 곳은 member에게 같은 동작이다.

**차이**
- 게스트가 루트에 쓸 수 있다(446).
- 게스트가 만든 폴더에서 만든 사람 단축(188)을 받는다.
- 게스트가 org `edit` 공유로 첨부를 쓸 수 있다(518).
- 게스트가 모든 vault 이름을 받는다.

**변경**
- 라우트 진입부의 검사를 모두 `isParticipant`로 바꾼다. 기존 역할에서는 동작이 같다.
- `canEditFolder`: guest이면 바로 `guestPermission`의 폴더 판정으로 간다. 187-188 단축을 쓰지 않는다.
- `vaultRootWritable`: 호출자가 guest이면 false다. 함수 시그니처에 `relation`을 받는다.
- `editsSomethingInVault`: guest는 user 행만 센다.
- `canDeleteItem`: guest는 `edit`이면서 만든 사람이어야 한다. 폴더는 하위에 다른 사람의 항목이 없어야 한다(647-673 규칙 그대로).
- `GET /vaults`와 MCP `listVaults`: **한 함수 `listVaultsFor(viewer)`를 둘이 함께 쓴다.** internal(owner/admin/member)은 지금처럼 조직의 모든 노트 모음을 받는다. 바꾸지 않는다. guest는 공유 진입점이 있는 노트 모음만 받고 이름은 조직 이름으로 바꿔 보낸다. none은 빈 목록이다. member에게 "읽을 수 있는 문서가 있는 노트 모음만" 규칙을 먼저 적용하지 않는다. 그렇게 하면 HTTP와 MCP가 어긋나 CLAUDE.md의 "Authorization must agree across … MCP"를 새로 깨기 때문이다. member에게 노트 모음 목록을 좁히는 것은 별도 제품 결정이고, 하게 되면 두 입구를 같은 PR에서 바꾼다.

### 3.4 문서 동기화

**현재**
- `POST /sync-token`은 문서의 vault를 찾고(`S/http/routes/sync-token.ts:93-97`) `syncPermission`만 본다(105). `none`이 아니면 토큰을 발급한다(111-116). **멤버십을 따로 확인하지 않는다.**
- `syncPermission`은 살아 있는 문서의 resolver 결과를 쓰고, 휴지통 보존 기간 안이면 삭제된 문서로 다시 판정한다(`S/trash/access.ts:36-46`). 휴지통 내용 읽기는 `trashedNotePermission`을 쓴다(49-56).
- Hocuspocus `onAuthenticate`(`S/sync/hocuspocus.ts:228-320`)
  - 토큰의 doc/vault와 요청 문서가 같은지 본다(252-254).
  - 연결할 때마다 `syncPermission`으로 다시 판정한다(279).
  - `none`이면 거부하고(290-292), `view`이면 읽기 전용으로 연다(293).

**차이**
- 비멤버도 개인 공유가 있으면 토큰을 받는다(§3.1). 게스트는 resolver를 고치면 표와 맞는다.
- 협업 커서(awareness)에 다른 사람의 이름이 실린다(G5).

**변경**
- 판정 자체는 §3.1의 resolver 변경으로 맞춘다. 경로 고유 변경은 없다.
- 심층 방어로 `sync-token`에서 `isParticipant`를 먼저 검사한다. 두 번 검사하지만 비용은 이미 캐시된 `membership` 한 번이다.
- awareness: A1-6 spike로 Hocuspocus에서 게스트 연결로 가는 awareness 상태를 고쳐 쓸 수 있는지 확인한다. 된다면 다른 사람의 `name`을 "팀원 N"으로 바꾼다. 안 되면 게스트 연결에는 awareness를 보내지 않는다(G5). 이 부분의 코드 위치는 이 문서에서 확인하지 않았다.

### 3.5 vault 채널

**현재**
- `POST /vault-token`은 역할이 있으면 누구에게나 발급한다(`S/http/routes/vault-token.ts:30-37`).
- 채널은 접속할 때와 ACL이 바뀔 때 읽기 가능 목록을 다시 계산한다(`S/sync/vault-channel.ts:636, 1201`).
- 프레임별 동작
  - `member-removed`: 해당 사용자의 소켓만 닫는다(1117-1130).
  - `member-joined`: **모든 구독자**에게 새 멤버의 이름을 보낸다(1132-1137).
  - `org`, `appearance-changed`: 조직 전체에 보낸다(1138-1147).
  - `presence`: 읽을 수 있는 문서에 대해서만 보낸다. `docId === null`(보고 있지 않음)이면 항상 보낸다(1148-1156). presence에는 `userId`와 `name`이 들어 있다(`S/sync/vault-protocol.ts:94-100`).
  - `voice`: vault 전체에 보낸다(1158-1172).
- 데스크톱은 `member`(`D/lib/sync/vaultProtocol.ts:155, 268-269`)와 `presence`(163) 프레임을 그대로 받는다.

**차이**
- 게스트가 모든 새 멤버 이름, 아무 문서도 보고 있지 않은 사람의 presence 이름, 음성을 받는다.

**변경**
- 채널 연결이 `relation`을 기억한다.
- guest 구독자
  - `member` 프레임은 보내지 않는다.
  - `presence`는 읽을 수 있는 문서에 대한 것만, 이름을 투영해서 보낸다. `docId === null` 정리 프레임은 그 사용자를 이전에 보여 준 적이 있을 때만 보낸다.
  - `voice`는 보내지도 받지도 않는다.
  - `org`, `appearance-changed`는 보낸다. 조직 이름은 초대 미리보기에서 이미 알고 있다.
- 데스크톱은 프레임이 오지 않는 경우만 다루면 되므로 프로토콜 변경이 필요 없다.

### 3.6 첨부

**현재**
- 읽기 게이트는 §3.3의 `canReadAttachment`, `filterReadableBlobs`다. 쓰기 게이트는 `canWriteBlob`(`S/permissions/http-gates.ts:560-590`)이다.
- 다운로드 URL 경로(`S/http/routes/blobs.ts:2059-2088`)는 S3 저장소면 서명된 URL을 직접 준다(2084).
- 서명 URL 수명 기본값은 300초다(`S/blobs/config.ts:225`). 프록시 모드는 `S3_PROXY_DOWNLOADS` 환경 변수로만 켠다(226).

**차이**
- 게스트에서 회수한 뒤에도 이미 받은 서명 URL은 최대 300초 동안 동작한다. 외부 접근 일괄 회수(F4)의 "즉시"와 맞지 않는다.

**변경**
- 판정은 §3.2, §3.3 변경으로 맞춘다.
- guest가 요청하면 저장소 설정과 관계없이 항상 프록시 URL(`direct:false`)을 준다. 게스트 회수가 다음 요청부터 바로 적용된다. 내부 사용자의 동작은 바뀌지 않는다.

### 3.7 MCP

**현재**
- 토큰 검증은 쓸 때마다 역할을 다시 읽고, 역할이 없으면 거부한다(`S/mcp/tokens.ts:167-169`). `access:manage` scope는 owner/admin만 남긴다(180). OAuth 경로도 같다(`S/mcp/oauth.ts:102-106`).
- 서비스 경로
  - 범위 검사: `requireVaultInScope`(`S/mcp/service.ts:225-235`), `locateNote`(643-645)
  - 노트 목록·읽기: 문서별 resolver(612-614, 651-652)
  - 검색: 읽기 가능 목록(1278-1279)
  - 첨부: `filterReadableBlobs`(1346)
  - 접근 관리: `listResourceAccessTool`(178-214)이 184에서 `requireAccessManager`를 부른다. 정의는 `S/permissions/access-management.ts:31-37`이다.
  - 루트에 만들기: admin만 가능하다(267-270). HTTP와 다른 의도된 차이다(§2.2 주석 2).
- **`listFolders`(289-306)는 ACL 없이** 조직 토큰의 vault에 있는 모든 폴더 이름·경로를 준다. `requireVaultInScope`로 조직만 확인한다.
- `listVaults`(281-287)는 조직의 모든 노트 모음 이름을 준다. HTTP `GET /vaults`와 같은 동작이다(§3.3).

**차이**
- 게스트는 G2에 따라 토큰을 쓸 수 없어야 하는데, 지금은 역할이 있으면 통과한다.
- **member에게도 이미 차이가 있다. [Medium]** private-by-default나 sealed vault에서 데스크톱 트리(`listVisibleFolders`)가 숨기는 폴더 이름과 경로(`S/permissions/vault-docs.ts:610-680`)를 MCP `listFolders`는 보여 준다. MCP 토큰은 모든 멤버가 만들 수 있다(`S/http/routes/mcp.ts:282-289`). 내용은 드러나지 않고 이름만 드러나므로 Medium이다. CLAUDE.md의 "Authorization must agree across … MCP" 위반이다.
- `listVaults`는 member에게 구멍이 아니다. HTTP와 같다. 이 문서의 이전 초안은 "읽을 수 있는 문서가 있는 노트 모음만"을 MCP에만 적용하려 했는데, 그러면 HTTP와 어긋나는 새 불일치가 생긴다(검증 보고서 §5 정정 2).

**변경**
- `verifyMcpToken`과 OAuth 검증은 `isInternal`이 아니면 null을 돌려준다.
- 게스트가 토큰을 만드는 라우트는 403이다. 토큰 발급 라우트는 `S/http/routes/mcp.ts:241, 254, 264, 282`와 `S/http/routes/oauth-connect.ts:250`이다. 이 라우트들의 진입부 `orgRole` 검사를 `isInternal`로 바꾼다. 게스트로 강등하면 그 사람의 해당 조직 토큰을 지운다. 토큰 삭제 함수는 A1-7, 강등과의 연결은 A1-9에서 한다.
- `listFolders`는 `listVisibleFolders`를 쓴다. 게스트와 무관한 기존 구멍 수정이므로 A1-0에서 먼저 한다.
- `listVaults`는 이 단계에서 member 동작을 바꾸지 않는다. `GET /vaults`와 같은 `listVaultsFor(viewer)`(§3.3)로 옮기는 것은 A1-4에서 한다.

### 3.8 멤버·vault 목록, 초대 미리보기

**현재**
- `GET /orgs/:orgId/members/overview`(`S/http/routes/members.ts:79-180`)
  - 역할이 있으면 누구에게나(85-86) 모든 멤버의 이름, 이메일, 사진(100-104)과 대기 중인 초대 이메일(116-120)을 준다.
  - 접근 수준은 관리자에게만 준다(131, 172).
- 다른 사람의 활동 피드는 관리자이거나 본인일 때만 볼 수 있다(240-251).
- `GET /invitations/:id/preview`(`S/http/routes/invitations.ts:114-119`)는 **로그인 없이** `invitationJson` 전체를 준다. 여기에는 초대받은 사람의 이메일, 초대한 사람 ID와 이름, 조직 ID와 이름이 들어 있다(`S/registry/invitations.ts:69-81`).
- `GET /vaults`는 §3.3에서 다뤘다.
- **Better Auth organization 플러그인 조회 endpoint.** 멤버십만 확인하고 역할은 보지 않는다.
  - `GET /api/auth/organization/list-members`(`BA/routes/crud-members.mjs:417-`): 멤버이기만 하면 모든 멤버와 사용자 이름, 이메일, 사진을 준다. **데스크톱이 실제로 호출한다**(`D/lib/api.ts:1888-1895`, `D/store.ts:3736`). 호출은 `.catch(() => [])`로 감싸 있어 403이어도 앱이 깨지지 않는다.
  - `get-full-organization`(`BA/routes/crud-org.mjs:299-336`)과 `list-invitations`(`BA/routes/crud-invites.mjs:524-543`)도 멤버십만 본다. `list-invitations`는 데스크톱이 호출한다(`D/lib/api.ts:1914`, `D/store.ts:3740`).
  - 이 경로들은 §3.8의 `projectPerson`을 거치지 않는다.

**차이**
- 게스트가 모든 사람의 이름과 이메일을 받는다. 우리 `overview`뿐 아니라 위 BA endpoint 세 개로도 받는다. `projectPerson`을 overview에만 적용하면 F2를 위반한다.
- 초대 링크를 가진 누구나 초대받은 사람의 이메일을 볼 수 있다.

**변경**
- **사람 투영 헬퍼 `projectPerson(viewer, person)`** 를 하나 두고, 사람 필드(`userId`, `name`, `email`, `image`)를 내보내는 모든 응답에 쓴다.
  - viewer가 guest이고 대상이 본인이 아니면 `{ label: "팀원" }`만 남긴다.
  - 적용 대상: overview, 활동 피드, 버전 작성자, 휴지통 삭제자, AI 변경 기록, last edited by, presence.
- overview: guest에게는 `members=[본인]`, `invitations=[]`만 준다.
- **BA 조회 endpoint 차단.** `/api/auth/organization/list-members`, `get-full-organization`, `list-invitations`(`/list-user-invitations`는 본인 초대라서 제외)는 guest와 비멤버에게 403이다. 위치는 `S/auth/auth.ts`의 `hooks`다. 지금 `hooks.after`가 `/organization/leave`를 가로채는 자리(215-228)에 `hooks.before`를 나란히 둔다. 요청의 `organizationId`로 `parseRole(orgRole(...))`를 보고 `isInternal`이 아니면 `FORBIDDEN`을 던진다. 데스크톱은 이 호출들을 이미 `.catch`로 감싸므로 게스트 화면은 빈 명단을 받는다. 게스트 화면이 쓸 "본인만" 명단은 우리 overview(A1-11)에서 가져온다. 데스크톱 호출을 overview로 옮기는 안도 있으나 변경 범위가 커서 A1에서는 서버 차단으로 한다.
- 초대 미리보기
  - 로그인하지 않았거나 이메일이 다르면 `email`을 `j***@example.com`처럼 가리고 `inviterId`를 뺀다.
  - 이메일이 같은 로그인 사용자에게만 원문을 준다.
  - `role`이 `guest`이면 화면에 "게스트로 초대됨: 공유받은 항목만 볼 수 있습니다"를 보여 준다(§0.1 문구 원칙).

### 3.9 합류 경로 전체

**현재**
- 초대 만들기는 owner/admin만 한다(`S/http/routes/members.ts:408-411`). 역할은 `member`와 `admin`만 받는다(425-428).
- 초대는 Better Auth `createInvitation`으로 만들고(441-444), 선택한 접근 수준은 `invitation_access`에 저장한다(449-455). 메일은 켜져 있을 때만 보낸다(456).
- **데스크톱은 Better Auth의 `POST /api/auth/organization/invite-member`로 직접 초대를 만든다**(`D/lib/api.ts:1904`, `D/store.ts:4150`의 `inviteMember`, 역할 타입은 `member | admin | owner`). 이 경로는 `members.ts:425-428`의 역할 검사를 거치지 않는다. 우리 라우트(`members.ts:441-444`)는 서버 안에서 `auth.api.createInvitation`을 부르므로 같은 hook을 거친다. **그래서 정책 검사는 두 입구가 공유하는 hook에 있어야 한다.**
- Better Auth hook
  - `beforeCreateInvitation`: 좌석 검사(`S/auth/auth.ts:325-345`)
  - `beforeAcceptInvitation`: 좌석 검사(348-355)
  - `afterAcceptInvitation`: 접근 수준 적용(400-411)
  - Better Auth 자체 역할 변경 endpoint는 막혀 있다(417-421)
  - 재초대는 이전 대기 초대를 취소한다(262)
- **`afterRemoveMember`(386-391)는 소켓만 닫고 개인 공유를 지우지 않는다.** 우리 제거 경로 `revokeMembership`(`S/http/routes/orgs.ts:142-200`)은 같은 트랜잭션에서 개인 공유를 지운다(168-176). BA `removeMember`(`BA/routes/crud-members.mjs:119-215`)는 `/api/auth/*` catch-all(`S/http/app.ts:322` → `handleOAuthRequest`)로 그대로 노출된다.
- **두 번째 경로 `POST /api/auth/organization/leave`**(`BA/routes/crud-members.mjs:386-416`)도 `deleteMember`만 하고 organization hook을 부르지 않는다. 우리 쪽 `hooks.after`(`S/auth/auth.ts:215-228`)도 소켓 알림만 한다. 아무 멤버나 이 endpoint로 나가면 자기에게 걸린 개인 공유가 남고, 지금 resolver에서는 그 공유가 계속 접근을 준다.
- 부수 차이: BA `removeMember`는 BA 기본 권한(admin의 `member:delete`)만 본다. 그래서 admin이 다른 admin을 제거할 수 있다. 우리 제거 규칙(`S/http/routes/orgs.ts:845-848`: admin은 owner만 제거할 수 있다)과 다르다.
- 데스크톱은 두 경로를 쓰지 않는다. 제거와 나가기는 우리 라우트를 쓴다(`D/lib/api.ts:2099-2110`). 그래서 직접 API를 호출해야 일어난다.
- **심각도:** 단독으로는 Medium이다. 재현은 `POST /api/auth/organization/remove-member {memberIdOrEmail, organizationId}`(owner 토큰) 또는 `POST /api/auth/organization/leave {organizationId}`(멤버 토큰) → 개인 공유 1행 잔존 → `sync-token` 200이다. §3.1의 자기 재부여와 결합하면 High다.
- **`guest`는 BA에 등록되어 있지 않다.** `organization()` 설정(`S/auth/auth.ts:246-`)에 `ac`/`roles`가 없다. BA는 기본 역할(owner/admin/member)이나 `roles` 옵션에 없는 역할의 초대를 `ROLE_NOT_FOUND`로 거부한다(`BA/routes/crud-invites.mjs:101-122`).
- 참가 코드
  - 조회·생성: owner/admin, 조직당 하나, 만료 없음(`S/http/routes/orgs.ts:479-520`)
  - 코드: 8자, 32문자 알파벳(97-108)
  - 합류(523-624): 이미 역할이 있으면 아무것도 바꾸지 않는다(541-543). **같은 이메일의 살아 있는 초대가 admin이면 admin, 아니면 member로 넣는다**(552-560). 이메일은 인증되지 않았을 수 있다(`S/auth/auth.ts:136`).
- 역할 변경은 `member`/`admin`만 받는다(`S/http/routes/orgs.ts:954-958`).

**차이**
- 게스트 초대를 받은 사람이 참가 코드를 쓰면 **member로 들어온다**(560). F1.1 위반이다.
- 미인증 이메일로 가입한 사람이 코드를 알면 그 이메일 앞으로 온 admin 초대를 가져간다(555-560). 이 줄은 `liveInvite?.role === "admin" ? "admin" : "member"`라서 admin이 아닌 역할은 모두 member가 된다. 지금은 게스트 초대를 만들 수 없어서(`members.ts:425-428`) 일어나지 않는 **잠재 결함**이다. A1에서 `guest` 초대를 열면서 이 줄을 고치지 않으면 바로 F1.1 위반이 된다. 같은 경로의 `applyInvitationAccess`(603-608)도 게스트용 접근 수준을 member에게 적용한다.
- Better Auth 제거·나가기 경로는 개인 공유를 남긴다. §3.1 변경 전에는 이것이 실제 접근으로 이어진다.
- 데스크톱의 BA `invite-member` 경로는 우리 라우트의 `external_sharing_off` 검사를 건너뛴다. `guest`를 열면 정책을 우회해 게스트를 초대할 수 있다.

**변경**
- **BA 역할 등록(A1-9의 첫 작업).** `organization()` 설정에 `ac`와 `roles`를 둔다. owner/admin/member는 BA 기본 권한(`defaultRoles`)을 그대로 쓴다. 바뀌면 안 된다. `guest`는 BA 권한을 하나도 주지 않는 역할로 등록한다. 그래야 BA `hasPermission`이 guest의 모든 관리 동작을 거부한다. 등록 후 owner/admin/member의 BA 권한이 그대로인지 테스트로 고정한다.
- **정책 검사는 `beforeCreateInvitation` hook(`S/auth/auth.ts:325-345`)에 둔다.** `guest` 초대는 `external_sharing_off`(정책 끔)를 여기서 거부하고, 허용 역할은 member/admin/guest로 제한한다. 그러면 우리 라우트(`members.ts:425-428`에는 `guest`를 허용 목록에 추가만 한다)와 데스크톱의 BA `invite-member` 두 입구가 같은 검사를 받는다.
- **BA 제거·나가기 경로를 닫는다(A1-0).** `/organization/remove-member`는 `organizationHooks.beforeRemoveMember`에서 `FORBIDDEN`을 던져 막는다(`beforeUpdateMemberRole`이 `auth.ts:417-421`에서 이미 쓰는 방식이다. BA가 `beforeRemoveMember`를 부르는 곳은 `BA/routes/crud-members.mjs:193`이다). `/organization/leave`에는 organization hook이 없으므로 `hooks.before`(§3.8)에서 경로로 막는다. 둘 다 데스크톱이 쓰지 않으므로 호환성 비용이 없다. 막으면 admin이 admin을 제거하는 규칙 차이도 함께 사라진다.
- **심층 방어.** `afterRemoveMember`와 `/organization/leave`의 `hooks.after`는 `revokeMembership`과 같은 정리(개인 공유 삭제, 세션의 `activeOrganizationId` 비우기)를 공통 함수로 부른다. 위 차단이 풀리거나 BA 내부 흐름이 호출해도 개인 공유가 남지 않게 하기 위해서다.
- 초대 역할에 `guest`를 추가한다(425-428). 외부 공유 정책이 끔이면 `external_sharing_off`로 거부한다.
- **참가 코드는 member로만 합류시킨다.** 같은 이메일의 살아 있는 초대가 있으면 역할과 관계없이 코드를 소비하지 않는다. 대신 `409 use_invitation { invitationId }`를 돌려주고, 데스크톱이 초대 수락 흐름으로 넘긴다. admin 초대도 이 길로 가므로 (560)의 역할 결정 분기는 없어진다.
- 이미 guest인 사람이 코드를 쓰면 지금처럼 `alreadyMember: true`로 아무것도 바꾸지 않는다(541-543). 화면에는 "이미 게스트로 참여 중입니다. 팀원이 되려면 관리자에게 요청하세요"를 보여 준다.
- 제거·나가기 정리는 위 "BA 제거·나가기 경로를 닫는다"와 "심층 방어"대로 `afterRemoveMember`와 `/organization/leave` 후속 hook이 공통 함수를 쓴다.
- 역할 변경 PATCH는 `guest`↔`member`를 허용한다(owner/admin만).
  - guest→member 승격: 그 시점의 join default로 `member_access_snapshots`를 만든다. 업데이트에는 032 트리거가 돌지 않기 때문이다(§4).
  - member→guest 강등: snapshot과 개인 vault 행을 지우고, MCP 토큰을 지우고, 소켓을 닫는다.
- 메일이 켜져 있으면 guest와 admin 초대의 수락에는 `emailVerified=true`를 요구한다(`beforeAcceptInvitation`). member 초대는 지금처럼 요구하지 않는다. #99처럼 기존 계정이 잠기는 실패를 피하기 위해서다(`S/auth/auth.ts:131-136`). **hook 방식인 이유:** BA의 `requireEmailVerificationOnInvitation` 옵션(`BA/routes/crud-invites.mjs:31, 274`)은 역할을 가리지 않는 전역 설정이라 "guest/admin만 요구"를 표현하지 못한다. A1에서 다시 조사하지 않아도 된다.
- 우선순위는 PRD F1.4대로 고정하고 모든 합류 경로(초대 수락, 코드, 이후 A2의 도메인)가 같은 함수를 쓴다. 외부 공유 정책 → 신원 확인 → 승인 대기(A2) → 역할 부여.

### 3.10 검색·그래프·휴지통·버전·bootstrap·bulk

**현재**
- 그래프와 검색은 `gateVaultMember`로 역할을 확인한다(`S/http/routes/graph.ts:27-38`).
  - 노드와 링크는 읽기 가능 목록으로 거른다(64-65, 95-96).
  - 검색은 읽기 가능 목록과 `vaultWide`를 넘긴다(124-140).
- 버전은 문서별 resolver를 쓴다(`S/http/routes/versions.ts:132`). 되돌리기는 `canEditDoc`(204), 복구와 checkpoint는 owner/admin만 한다(260-309).
- 휴지통은 역할 확인(`S/trash/service.ts:57`) 뒤에 관리자 단축 또는 `trashedNotePermission`을 쓴다(137-142, 236-246).
- bootstrap은 역할만 확인하고 읽을 수 없는 ID는 조용히 뺀다(`S/http/routes/bootstrap.ts:36-45`).
- bulk는 진입부에서 역할을 확인하고(`S/http/routes/bulk.ts:150-151`), 문서별로 `syncPermission`/resolver를 쓴다(732, 854). 삭제는 관리자 아니면 자기가 만든 것만 한다(858-870).
- registry `access-check`는 역할 확인 뒤 문서별 resolver를 쓴다(`S/http/routes/registry.ts:471-530`).
- **앞 목록에서 빠졌던 진입부.** `orgRole` 참값만 보고 게스트를 통과시킨다.
  - `S/ai-changes/service.ts:38`(`requireVault`): 원장 행에 `actor_user_id`, `before_path`/`after_path`가 있어 사람 투영(§3.8)과 경로 투영(§3.2)이 둘 다 필요하다. `getAiChange`(43-49)는 `requireVault` 없이 문서 권한만 본다.
  - `S/http/routes/housekeeper.ts:81`
  - `S/http/routes/shrink-brake.ts:36, 55`
  - `S/http/routes/appearance.ts:43, 57`
  - `S/http/routes/mcp.ts:241, 254, 264, 282`: MCP 토큰·연결 라우트. §3.7의 "게스트 토큰 생성 403"이 이곳이다.
  - `S/http/routes/oauth-connect.ts:250`: OAuth 동의 화면
  - `S/http/routes/versions.ts:252`, `S/http/routes/invitations.ts:66`, `S/http/routes/shares.ts:259, 384, 533-535, 685`, `S/http/routes/public-links.ts:115`, `S/http/routes/registry.ts`(15곳), `S/http/routes/orgs.ts`(11곳), `S/http/routes/members.ts`(5곳)
- 전수 목록은 이 절의 줄 번호가 아니라 **부록 A의 grep 명령**을 기준으로 한다. 줄 번호는 코드가 바뀌면 틀어진다.

**차이**
- 판정 자체는 모두 resolver나 읽기 가능 목록으로 수렴한다. §3.1, §3.2를 고치면 맞는다.
- 남는 차이는 사람 이름(버전 작성자, 휴지통 삭제자)과 경로(`relPath`)다.

**변경**
- 진입부를 `isParticipant`로 바꾼다. 위 "빠졌던 진입부" 포함이다. 관리·토큰 라우트(`mcp.ts`, `oauth-connect.ts`, `appearance.ts`의 쓰기, `shrink-brake.ts`, `housekeeper.ts`)는 `isInternal`이어야 하는지를 라우트마다 정한다. 기본값은 `isInternal`이다.
- 응답에 §3.2 경로 투영과 §3.8 사람 투영을 적용한다. `ai-changes`는 두 투영을 모두 받는다.
- A1-12 출시 점검에서 `orgRole(` 호출 전수가 `isParticipant`/`isInternal`/`isManager` 중 하나를 거치는지 검사한다(부록 A).
- bulk 삭제의 관리자 판정(861)은 `isManager(parseRole(...))`로 바꾼다.

### 3.11 캐시와 다중 인스턴스

**현재**
- `ResolverCache`는 요청 하나 동안만 산다(`S/permissions/resolver.ts:94-96`). 읽기 가능 목록 캐시만 TTL 10초다(§3.2).
- ACL 변경은 이 인스턴스의 캐시를 지우고 vault 채널로 `acl-changed`를 보낸다(`S/index.ts:177-184, 323-325`).
- 멤버 제거는 commit **뒤에** 문서 소켓을 끊고 채널에 알린다(`S/http/routes/orgs.ts:190-200`). `member-removed`는 모든 인스턴스에서 해당 사용자의 채널 소켓을 닫는다(`S/sync/vault-channel.ts:1117-1130`).

**차이**
- 역할이 guest↔member로 바뀌는 것은 지금 "ACL 변경"으로 취급되지 않는다. 역할 변경 PATCH가 소켓을 닫는다고만 적혀 있다(`S/auth/auth.ts:412-416`).
- 다른 인스턴스의 읽기 가능 목록 캐시는 최대 10초 동안 낡을 수 있다. 이 캐시는 표시용이고 쓰기와 내용 읽기에는 쓰지 않는다(`S/permissions/readable-cache.ts:22-23`). 그래서 이 지연은 목록 표시에만 남는다.

**변경**
- 역할 변경, 게스트 회수, 외부 접근 일괄 회수는 모두 같은 순서를 따른다.
  1. DB commit
  2. 해당 조직의 모든 노트 모음에 `onAclChanged`
  3. 해당 사용자의 문서 소켓 끊기
  4. 역할이 바뀌었으면 `member-removed`에 준하는 프레임으로 채널 재인증
- 다른 인스턴스 캐시의 10초 지연은 허용 범위로 문서화한다. 회수 완료 표시는 commit 시점이 아니라 "모든 인스턴스가 다음 요청부터 거부"를 기준으로 한다.

### 3.12 `vault` 리소스의 `resource_id` 계약

D6이 문서화를 요구한 기존 계약이다.

- `shares.resource_type = 'vault'`이면 `resource_id`는 **조직 ID**(`organization.id`, 제품에서 보이는 vault)다. 노트 모음 ID(`vaults.id`)가 아니다(`S/permissions/lookup.ts:35-57`). 이때 `ResourceInfo.vaultId`는 빈 문자열이다(57).
- resolver는 이 행을 `resource_id = $4(organizationId)`로 찾는다. 실제 SQL은 `S/permissions/resolver.ts:919-923, 940-941`이다. 885-892는 이 계약을 설명하는 doc comment다. 접근 색인도 같다(402).
- 영향받는 문서는 조직의 모든 노트 모음에 걸친다(`S/permissions/lookup.ts:115-127`). 공유 관리의 재평가 대상도 조직의 모든 노트 모음이다(`S/http/routes/shares.ts:270-278`).
- 이 행은 두 가지만 뜻한다.
  - `principal_type='org'`: posture(Open/Read-only/sealed)
  - `principal_type='user'`: 그 사람의 vault 수준
- **A1 규칙:** 게스트에게는 `principal_type='user'`인 vault 행을 만들 수 없다(G3).
- **E 단계 규칙:** 연결된 vault는 이 행을 재사용하지 않는다. `principal_type='org'`는 계속 "자기 조직 전체"만 뜻한다(PRD F3). `organizationId`와 `vaultId`를 바꿔 쓰지 않는다.

## 4. 기존 데이터 migration 기본값

목표는 PRD F2의 "기존 member, 초대, 참가 코드, baseline, join snapshot은 지금과 같은 권한"이다. migration은 다시 실행해도 안전해야 한다(`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `CREATE OR REPLACE`). 057·058이 다시 실행되면 실패하는 위험이 있었으므로 같은 실수를 반복하지 않는다.

| 대상 | 기본값과 처리 |
|---|---|
| `member.role` | 값은 바꾸지 않는다. `CHECK (role IN ('owner','admin','member','guest'))`를 `NOT VALID`로 추가해 새 쓰기만 막는다. 기존 행 검증(`VALIDATE CONSTRAINT`)은 별도 운영 단계로 둔다. 쉼표로 이어진 값이 있을 수 있기 때문이다. 코드의 `parseRole`이 fail closed로 해석한다 |
| `partner` | 제약에 넣지 않는다. 그래서 E 전까지 저장할 수 없다(G1) |
| 대기 중인 초대 | 역할(`member`/`admin`)과 `invitation_access`를 그대로 둔다 |
| `member_access_snapshots` 트리거 | `initialize_member_access_snapshot`(`M/032_member_access_defaults.sql:33-70`)이 owner가 아닌 모든 신규 멤버에게 snapshot을 만든다(43-45, 57-61). `CREATE OR REPLACE`로 `guest`도 건너뛰게 한다. 기존 snapshot은 그대로 둔다 |
| 조직 기본 권한(posture) | 바꾸지 않는다 |
| 개인 공유 중 대상이 비멤버인 행 | **삭제하지 않고 격리한다.** `shares_orphaned`(원본 열 + `quarantined_at`, `reason`)로 복사한 뒤 원본을 지운다. 이 행들은 §3.1 변경 후에는 효력이 없다. 하지만 지금 실제 접근을 주고 있을 수 있으므로 남겨 둘 이유가 없다. 복구가 필요하면 관리자가 되돌릴 수 있다. 건수는 migration 로그에 남긴다 |
| `org_join_codes` | 새 열(§7)을 추가한다. 기존 코드의 `expires_at`은 migration 시각 + 30일로 둔다. 문서나 메신저에 이미 붙여 둔 코드가 바로 죽지 않게 하기 위해서다. 관리 화면에 "이 참가 코드는 [날짜]에 만료됩니다 · [새 코드 만들기]"를 보여 준다. 새 코드의 기본값은 7일이다 |
| 외부 공유 정책 | 새 테이블 `organization_sharing_policy(organization_id, mode)`. 기존·신규 모두 `mode='off'`다(G7) |
| `mcp_tokens` | 바꾸지 않는다. 내부 역할이면 지금처럼 동작한다 |

**migration 테스트**
- 고정 fixture(owner, admin, member 두 명, snapshot 세 모드, posture 세 종류, 항목 Private, 잠금, 개인 거부)를 migration 전에 만든다.
- migration 전과 후에 모든 (사용자, 문서) 쌍의 `effectivePermission`과 모든 사용자의 `listReadableDocsInVault`·`listVisibleFolders`를 비교한다. 결과는 **같아야 한다.**
- 비멤버 개인 공유 행만 예외로, 격리되고 결과가 `none`으로 바뀌어야 한다.

## 5. `POST /shares` 대상 검증 규칙

**현재 위치:** `S/http/routes/shares.ts:472-593`.
- 입력 형식 검증: 481-497
- 관리 권한: `canManage`, 521-522. 정의는 242-280이며 owner/admin이거나 리소스를 만든 사람이면 통과한다(259-268). **만든 사람 판정에는 역할 확인이 없다.**
- 대상 ID: 524-528
- admin이 owner를 건드리지 못하게 하는 검사: 529-540. 대상의 역할이 없으면(`targetRole` null) 그냥 통과한다(536).
- 저장: 575-593

같은 계약의 다른 입구는 이미 대상을 검증한다. 일괄 접근 변경(`S/permissions/access-management.ts:172-183`)은 "Every selected person must be a current vault member"로 거부한다.

**A1 규칙** (위에서부터 순서대로 검사한다)
1. **행위자:** `canManage`는 `isInternal(actorRole)`을 먼저 요구한다. 만든 사람 예외는 member 이상에만 적용한다. 게스트와 비멤버는 403 `not_allowed_to_share`다. 제거된 멤버가 자기가 만든 노트에 스스로 공유를 거는 경로(§3.1)가 이 규칙으로 막힌다. 공개 링크 gate(`S/http/routes/public-links.ts:106-125`)도 같은 규칙을 쓴다. A1-0에서는 `isInternal`이 아직 없으므로 `role !== null`로 쓰고 A1-1에서 치환한다.
2. **user 대상:** `principalId`가 같은 조직의 `member` 행을 가지고 `isParticipant(parseRole(role))`여야 한다(A1-0에서는 `member` 행이 있으면 된다). 아니면 400 `share_target_not_member`다. 화면 문구는 "이 사람은 아직 이 vault에 없습니다. 먼저 초대하세요"다.
3. **guest 대상**
   - `resourceType`은 `folder` 또는 `file`이어야 한다. `vault`는 400 `guest_vault_grant_forbidden`이다(G3).
   - 외부 공유 정책이 끔이면 403 `external_sharing_off`다.
   - "허용한 도메인만"이면 대상 이메일의 도메인을 확인한다.
4. **org 대상:** 지금 뜻(자기 조직 전체)을 유지한다. `principalId`는 서버가 `gate.organizationId`로 채운다(524-525).
5. **admin 행위자:** 지금 규칙(`canManageMemberAccess`)을 유지한다. 단, 2에서 대상이 비멤버인 경우를 이미 막았으므로 `targetRole` null 통과 경로는 사라진다.
6. **원자성:** 검사와 저장을 한 트랜잭션에서 한다. `INSERT … SELECT … WHERE EXISTS (SELECT 1 FROM member … FOR SHARE)` 형태로 써서, 동시에 실행된 제거(`revokeMembership`)가 공유 행을 남기지 못하게 한다.
7. **같은 규칙의 공용화:** 2-3을 `assertShareTarget(db, orgId, principalId, resourceType)` 한 함수로 둔다. `POST /shares`, 일괄 접근 변경, 초대 수락 시 `applyInvitationAccess`, MCP `manage_access`가 모두 이 함수를 쓴다.

## 6. 메일 기능이 없는 자체 설치 환경

**현재**
- 메일은 설정이 있을 때만 켜진다(`S/email/mailer.ts:274-276`).
- 메일이 없으면 초대 발송 API가 `email_not_configured`로 답한다. 화면은 "링크를 공유하세요"로 바뀐다(`S/http/routes/invitations.ts:70-75`, `S/auth/auth.ts:263-268`).
- 인증 메일도 메일이 있을 때만 보낸다(`S/auth/auth.ts:161-176`). 로그인은 인증과 관계없이 된다(136).
- 초대 만료 기본값은 7일이다(248).

**A1 동작**

| 항목 | 메일 있음 | 메일 없음 |
|---|---|---|
| 초대 전달 | 메일 + 링크 복사 | 링크 복사와 QR만. 화면에 "이 링크를 받은 사람만 들어올 수 있습니다. 메신저로 직접 보내세요"를 보여 준다 |
| 신원 확인 | guest와 admin 초대 수락에 이메일 인증을 요구한다(§3.9) | 이메일을 확인할 수 없다. **링크 소지와 이메일 일치**(G6)가 신원 확인이다. 수락된 게스트와 admin은 멤버 목록에 "이메일 확인 안 됨" 표시를 단다 |
| 참가 코드 | 지금과 같다(member만) | 같다 |
| 도메인 자동 합류(A2) | 사용 가능 | **켤 수 없다.** 도메인 소유는 확인해도 사용자의 이메일 소유는 확인할 수 없기 때문이다 |
| 비밀번호 재설정 | 메일 | 이 문서 범위 밖이다. 관리자 지원 재설정은 별도로 정한다 |
| 초대 미리보기 | §3.8 그대로 | §3.8 그대로. 이메일을 가리므로 링크가 새도 초대 대상 주소는 드러나지 않는다 |

초대 링크가 곧 비밀이므로 초대 ID가 추측 불가능해야 한다(G8). A1-1에서 Better Auth의 ID 생성 방식을 확인한다. 부족하면 링크에 별도 무작위 토큰을 붙이고 수락할 때 대조한다.

## 7. 참가 코드: 만료, 재발급, 시도 제한 데이터 모델

지금 테이블은 `org_join_codes(organization_id PK, code UNIQUE, created_at)`다(`M/005_join_codes_and_index.sql:10-14`). 조직당 활성 코드 하나라는 성질(PK)은 유지한다.

```sql
-- 061_join_code_lifecycle.sql (초안, 번호는 A1에서 확정)
ALTER TABLE org_join_codes
  ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generation  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by  TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS use_count   INTEGER NOT NULL DEFAULT 0;
UPDATE org_join_codes SET expires_at = now() + interval '30 days' WHERE expires_at IS NULL;  -- §4
ALTER TABLE org_join_codes ALTER COLUMN expires_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS join_code_attempts (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  ip_hash         TEXT,                         -- 원문 IP를 저장하지 않는다(PRD §6.7)
  organization_id TEXT,                         -- 모르는 코드면 NULL
  outcome         TEXT NOT NULL CHECK (outcome IN
                    ('joined','already_member','unknown','expired','revoked',
                     'throttled','use_invitation','policy_refused','seat_refused')),
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS join_code_attempts_user_time ON join_code_attempts (user_id, attempted_at);
CREATE INDEX IF NOT EXISTS join_code_attempts_ip_time   ON join_code_attempts (ip_hash, attempted_at);
```

**규칙**
- **만료:** 관리자가 1일, 7일(기본), 30일 중 하나를 고른다. 만료된 코드로 합류하면 410 `join_code_expired`다. 화면 문구는 "이 참가 코드는 만료되었습니다. 관리자에게 새 코드를 요청하세요"다.
- **재발급:** `POST /orgs/:orgId/join-code/rotate`(owner/admin)가 같은 행을 새 코드로 바꾸고 `generation`을 1 올린다. 이전 코드는 즉시 무효가 된다. "끄기"는 `revoked_at`을 채운다. 무효 코드는 410 `join_code_revoked`다.
- **시도 제한**
  - 사용자 기준: 15분에 실패(`unknown`/`expired`/`revoked`) 5회
  - IP 기준: 15분에 20회
  - 넘으면 15분 동안 429 `join_code_throttled`다. 화면 문구는 "잠시 후 다시 시도하세요"다.
  - 코드 공간은 32^8 ≈ 1.1×10^12이다(`S/http/routes/orgs.ts:97-108`). 이 제한이면 무작위 대입은 현실적으로 불가능하다.
  - 성공 시도도 기록하지만 제한에는 세지 않는다.
- **보존:** 시도 기록은 30일 뒤 지운다. 보존 기간 표(PRD §6.2)에 추가한다.
- **코드 원문 저장:** 관리 화면에서 "코드 다시 보기"가 필요하므로 원문을 유지한다. 만료와 시도 제한이 노출 위험을 줄인다.
- **이미 쓴 코드:** 참가 코드는 여러 사람이 쓰는 코드라서 "1회용"이 아니다. 1회용은 개별 초대 링크가 맡는다. `use_count`는 표시용이다.

## 8. 경로별 통합 테스트 목록

모든 서버 테스트는 **전용 일회용 DB**에서 돈다. 공유 `context` DB는 쓰지 않는다(CLAUDE.md). 공통 fixture는 `T/fixtures/authz-world.ts` 하나로 만든다.

- **조직:** posture Shared
- **사람:** owner, admin, member(A), member(B), guest(G), partner 값(P, 직접 DB 삽입. A1에서는 CHECK가 막으므로 제약 우회 fixture로만 만든다), 비멤버(X)
- **트리:** `Clients/Acme/`(G에게 view), `Clients/Acme/Drafts/`(G에게 edit), `Secret/`(공유 없음), 루트 노트 하나, 첨부 둘(Acme 노트가 참조하는 것, Secret 노트가 참조하는 것)
- **canary 문자열:** 이름 `CANARY_NAME_B`, 이메일 `canary-b@example.invalid`, 폴더 이름 `Clients`, `Secret`, vault 이름 `CANARY_VAULT`. "게스트 응답 어디에도 없어야 한다"는 단언에 쓴다.

기대값은 `T/fixtures/authz-expectations.ts`에 §2 표를 데이터로 옮겨 단일 출처로 둔다. 각 경로 테스트는 이 표를 읽어 판정한다. 표와 테스트가 따로 놀지 않게 하기 위해서다.

**기대 결과 수준 표기**
- `perm=`: resolver 결과(`none`/`view`/`edit`)
- `set∋`, `set∌`: 집합 포함/제외
- `HTTP n`: 상태 코드
- `frame∅`: 프레임이 오지 않음
- `canary∅`: 응답 전체에 canary 문자열 없음

| # | 경로 | 테스트 이름 | 기대 결과 |
|---|---|---|---|
| 1 | resolver | `authz/resolver: role × doc matrix matches expectations` | 표의 모든 칸 `perm=` 일치. cache, prefetch, index 세 경로 모두 |
| | | `authz/resolver: non-member with per-user share resolves none` | X에게 Acme 개인 공유 행 삽입 → `perm=none` |
| | | `authz/resolver: guest ignores baseline, snapshot, org shares, creator rule` | G가 만든 노트를 Secret으로 이동 → `perm=none`. Shared posture에서 루트 노트 `perm=none` |
| | | `authz/resolver: guest vault-level row is ignored` | DB에 G의 vault user 행 삽입 → 결과 변화 없음 |
| | | `authz/resolver: partner resolves none everywhere` | P → 모든 문서 `perm=none` |
| 2 | 읽기 가능 목록 | `authz/vault-docs: readable set equals resolver for every role` | 모든 역할에서 `set`과 resolver 결과 일치 |
| | | `authz/vault-docs: guest folder tree is projected` | G의 트리 = {`Acme`, `Acme/Drafts`}. `parent_id` null, `canary∅`(`Clients`, `Secret`) |
| | | `authz/vault-docs: deleted set for guest` | Acme 노트 삭제 → G의 삭제 목록 `set∋` |
| | | `authz/vault-docs: non-member with vault row gets empty access` | X에게 user vault 행 삽입 → `vaultAccess` 빈 결과(A1-0 뒤 null 또는 relation none) |
| | | `authz/vault-docs: guest ignores vault row in listing` | G에게 vault user 행 삽입(제약 우회) → 목록 변화 없음. resolver 쪽 행 무시(위 `guest vault-level row is ignored`)와 짝 |
| 3 | HTTP 게이트 | `authz/http: guest cannot create at root` | `POST /folders`(parent 없음) → `HTTP 403` |
| | | `authz/http: guest edits inside edit share only` | Drafts에 만들기 `HTTP 200`, Acme에 만들기 `HTTP 403` |
| | | `authz/http: guest delete requires creator` | 남이 만든 Drafts 노트 삭제 → `HTTP 403`, 자기 노트 `HTTP 200` |
| | | `authz/http: GET /vaults for guest` | 노트 모음 1개, 이름 = 조직 이름, `canary∅` |
| | | `authz/http: GET /vaults and MCP listVaults agree` | 모든 역할에서 HTTP와 MCP의 노트 모음 집합이 같음. member는 조직의 모든 노트 모음(바뀌지 않음) |
| | | `authz/http: guest cannot write attachment via org edit share` | 조직 `edit` 공유(`principal_type='org'`)만 있는 곳에 첨부 쓰기 → `HTTP 403`(`http-gates.ts:518`) |
| | | `authz/http: guest-created folder outside share gets no shortcut` | G가 만든 폴더를 공유 밖으로 옮긴 뒤 이름 변경·하위 생성 → `HTTP 403`(만든 사람 단축 188 미적용) |
| | | `authz/http: guest path outside entry point is rejected` | 진입점 밖으로 나가는 경로로 만들기·이동 → `HTTP 400`(§3.2) |
| | | `authz/http: registry access-check per role` | 게스트·비멤버·partner의 문서별 결과가 resolver와 같음 |
| 4 | 문서 동기화 | `authz/sync: sync-token per role` | 표와 같음(`HTTP 200`의 readOnly 값, 또는 `HTTP 403`). X는 개인 공유 행이 있어도 `HTTP 403` |
| | | `authz/sync: onAuthenticate rechecks after demotion` | 토큰 발급 → member를 guest로 강등(**DB에서 역할을 직접 바꾼다. 강등 PATCH는 A1-9**) → 연결 거부 또는 읽기 전용 |
| | | `authz/sync: awareness names projected for guest` | G 연결이 받은 awareness에 `canary∅`(G5 spike 결과에 따라 "awareness 없음"으로 바뀜) |
| 5 | vault 채널 | `authz/vault-channel: guest gets no member frames` | A1 합류 이벤트 → G `frame∅` |
| | | `authz/vault-channel: guest presence limited to readable docs` | B가 Secret을 열면 G `frame∅`, Acme를 열면 이름이 투영된 프레임 |
| | | `authz/vault-channel: guest gets no voice` | `frame∅` |
| | | `authz/vault-channel: docId-null presence for unseen user` | 이전에 보여 준 적 없는 사용자의 `docId === null` presence → G `frame∅` |
| 6 | 첨부 | `authz/blobs: guest reads only referenced attachments` | Acme 첨부 `HTTP 200`, Secret 첨부 `HTTP 403` |
| | | `authz/blobs: guest download url is always proxied` | S3 설정에서도 `direct=false` |
| | | `authz/blobs: guest revocation applies to next download` | 공유 삭제 직후 프록시 다운로드 `HTTP 403` |
| | | `authz/blobs: guest write outside share is refused` | `canWriteBlob` 범위 밖(루트, view 공유만 있는 폴더) → `HTTP 403` |
| | | `authz/blobs: filterReadableBlobs hides unreferenced for guest` | 첨부 목록에 Secret 첨부 없음, `canary∅` |
| 7 | MCP | `authz/mcp: guest token rejected` | 토큰과 OAuth 모두 `HTTP 401` |
| | | `authz/mcp: listFolders matches desktop tree` | member A의 MCP 폴더 목록 = `listVisibleFolders` 결과(기존 버그 회귀 테스트, A1-0) |
| | | `authz/mcp: guest cannot mint tokens` | `mcp.ts`의 토큰 발급 4곳과 OAuth 동의(`oauth-connect.ts:250`) → `HTTP 403`(A1-7) |
| | | `authz/mcp: demotion revokes tokens` | 강등 뒤 토큰 사용 `HTTP 401`, 토큰 행 없음(**강등 PATCH가 필요하므로 A1-9에서 추가**) |
| 8 | 멤버·미리보기 | `authz/members: guest overview is self only` | `members.length=1`, `invitations=[]`, `canary∅` |
| | | `authz/invitations: preview masks email when anonymous` | 익명 → 가린 이메일, `inviterId` 없음. 같은 이메일로 로그인 → 원문 |
| | | `authz/people: versions and trash project names for guest` | `canary∅` |
| | | `authz/better-auth: guest cannot list members/invitations/full-org` | G가 `/api/auth/organization/list-members`, `get-full-organization`, `list-invitations` 호출 → `HTTP 403`(또는 `canary∅`). X도 같음. member는 `HTTP 200` |
| | | `authz/people: activity feed hidden from guest` | G가 남의 활동 피드 요청 → 거부 또는 `canary∅` |
| | | `authz/ai-changes: guest sees canary-free ledger` | `ai-changes` 목록·단건에서 `canary∅`(사람 투영, 경로 투영) |
| 9 | 합류 | `authz/join: code never grants guest or admin` | 같은 이메일에 guest 초대가 있으면 → `HTTP 409 use_invitation`, member 행 없음 |
| | | `authz/join: guest using code stays guest` | `alreadyMember=true`, 역할 guest 유지 |
| | | `authz/join: expired, revoked, rotated codes refused` | `HTTP 410`(만료, 끔), 이전 세대 코드 `HTTP 404` |
| | | `authz/join: attempts are throttled` | 실패 5회 뒤 `HTTP 429` |
| | | `authz/join: better-auth remove-member and leave are closed` | BA `remove-member`(owner 토큰)와 `/organization/leave`(멤버 토큰) → `HTTP 403`, member 행·개인 공유 행 그대로 |
| | | `authz/join: removal cleanup purges shares from either hook` | 심층 방어: `afterRemoveMember`와 leave 후속 hook의 공통 정리 함수를 직접 호출 → 개인 공유 0행, sync-token `HTTP 403` |
| | | `authz/join: better-auth invite-member honors external sharing policy` | 정책 끔에서 BA `invite-member`로 `guest` 초대 → `HTTP 403 external_sharing_off`. 정책 켬이면 BA가 `guest` 역할을 받아들임(`ROLE_NOT_FOUND` 없음) |
| | | `authz/join: better-auth default role permissions unchanged` | `guest` 등록 뒤에도 owner/admin/member의 BA 권한이 그대로이고, guest는 BA 관리 동작이 모두 거부됨 |
| | | `authz/join: verified email required for guest invite when mail on` | 미인증 → 수락 거부 |
| | | `authz/join: promotion creates snapshot, demotion clears it` | 승격 뒤 snapshot 1행(join default 반영), 강등 뒤 0행 |
| | | `authz/join: precedence order is shared` | 정책 끔 + 좌석 초과 → 정책 오류가 먼저 |
| 10 | 검색·그래프·휴지통·버전·bootstrap·bulk | `authz/graph: nodes and links filtered and projected` | G 노드 = Acme 노트만, `canary∅` |
| | | `authz/search: guest search hits only readable` | Secret 본문에만 있는 단어 → 0건 |
| | | `authz/trash: guest restore requires edit` | Acme(view) `HTTP 403`, Drafts(edit) `HTTP 200` |
| | | `authz/bootstrap: guest only receives readable docs` | 응답 문서 ID `set∌` Secret |
| | | `authz/bulk: guest batch delete limited to own items` | 남의 항목은 항목별로 거부 |
| 11 | 캐시·다중 인스턴스 | `authz/cache: share revoke drops guest listing within TTL` | 같은 인스턴스는 즉시, 다른 인스턴스는 10초 안에 `set∌` |
| | | `authz/cache: demotion disconnects live sockets` | 문서와 채널 소켓 모두 닫힘 |
| — | `POST /shares` | `authz/shares: target must be participant` | X 대상 `HTTP 400 share_target_not_member` |
| | | `authz/shares: guest cannot get vault-level row` | `HTTP 400 guest_vault_grant_forbidden` |
| | | `authz/shares: guest cannot share or make public links` | `HTTP 403` |
| | | `authz/shares: external sharing off refuses guest targets` | `HTTP 403 external_sharing_off` |
| | | `authz/shares: concurrent removal leaves no orphan` | 제거와 공유를 동시에 실행 → 개인 공유 0행 |
| | | `authz/shares: removed creator cannot re-grant self` | owner·R(멤버) 생성 → R이 노트 N 작성 → R 제거(`shareCount(R)=0`) → R 토큰으로 `POST /api/shares`(N→R, edit) 기대 `HTTP 403`(현재 200), 이어서 `POST /api/sync-token {docId:N}` 기대 `HTTP 403`(현재 200). 공개 링크 생성도 `HTTP 403`. `T/orgs-remove-member.test.ts`·`T/helpers/seed.ts`·`T/helpers/auth.ts` 패턴을 따른다 |
| | | `authz/shares: non-member with a pre-existing share resolves none` | 제거 뒤 공유 행이 남은 비멤버(데이터 오염 사례)도 `perm=none`, sync-token `HTTP 403` |
| — | 출시 점검 | `authz/lint: no raw orgRole truthiness remains` | `orgRole(` 호출 전수가 `isParticipant`/`isInternal`/`isManager`/`parseRole` 중 하나를 거침(부록 A). A1-12에서 켠다 |
| — | migration | `authz/migration: legacy permissions unchanged` | §4의 전후 비교가 같음. 비멤버 공유만 격리 |
| | | `authz/migration: rerun is a no-op` | 두 번 실행해도 오류 없음, 결과 같음 |

## 9. A1 구현 작업 분해

순서는 의존 관계를 따른다. 각 작업은 한 PR 크기이고, 자기 테스트를 같은 PR에 넣는다.

| 순서 | 작업 | 내용 | 의존 |
|---|---|---|---|
| A1-0 | 기존 구멍 막기 | Better Auth 제거 경로 **두 개**(`remove-member`, `/organization/leave`) 차단과 공통 정리 함수(§3.9). `POST /shares` 행위자·대상 멤버 검증(§5의 1, 2, 6)과 공개 링크 gate의 같은 규칙. MCP `listFolders`에 `listVisibleFolders` 적용. resolver에서 비멤버 fail closed. `http-gates.ts:261` 주석 정정. 이 단계에는 `isInternal`/`isParticipant`/`parseRole`이 아직 없으므로 `role !== null`로 쓰고 A1-1에서 치환한다. **`listVaults`는 바꾸지 않는다**(HTTP와 어긋남, §3.3). **게스트 없이도 출시할 수 있는 보안 수정** | 없음 |
| A1-1 | 관계 헬퍼와 migration | `parseRole`/`relationOf` 등(§3.0). 역할 CHECK `NOT VALID`, 032 트리거 교체, 비멤버 공유 격리, 정책 테이블, 참가 코드 열(§4, §7). migration 전후 비교 테스트. G6·G8 확인 테스트 | A1-0 |
| A1-2 | resolver 게스트 분기 | `guestPermission`, cache·prefetch·index 경로, drift 테스트 확장, 표 기반 matrix 테스트(§8-1) | A1-1 |
| A1-3 | 읽기 가능 목록과 경로 투영 | `vaultAccess`의 relation, `listDocsInVault`·`listVisibleFolders`의 게스트 분기, `projectPath` 헬퍼와 쓰기 경로의 역투영. **`projectPerson` 헬퍼의 정의만 여기서 만든다**(A1-6이 쓴다. 응답 적용은 A1-8) | A1-2 |
| A1-4 | HTTP 게이트와 라우트 | `isParticipant` 치환(§3.10의 빠졌던 진입부 포함), 루트 쓰기, 폴더 단축, 삭제, `GET /vaults`와 MCP `listVaults`를 `listVaultsFor(viewer)`로 통합(§3.3), bulk·bootstrap·graph·search·trash·versions, 게스트 첨부 프록시 | A1-3 |
| A1-5 | 공유 규칙 완성 | §5의 3, 4, 7. 공개 링크 gate. 일괄 접근 변경과 `applyInvitationAccess`가 `assertShareTarget` 사용 | A1-1, A1-4 |
| A1-6 | 동기화와 채널 | awareness spike(G5) → 투영 또는 차단. 채널 프레임 필터(§3.5). `sync-token` 심층 방어 | A1-2, A1-3(`projectPerson` 정의) |
| A1-7 | MCP | 게스트 토큰·OAuth 거부, 토큰 발급 라우트 403, **토큰 삭제 함수**(강등과의 연결과 `demotion revokes tokens` 테스트는 A1-9) | A1-1 |
| A1-8 | 사람 투영과 멤버 화면 | `projectPerson` 적용(overview, 활동, 버전, 휴지통, AI 변경), 초대 미리보기 마스킹, **BA 조회 endpoint 차단**(`list-members`, `get-full-organization`, `list-invitations`, §3.8) | A1-3 |
| A1-9 | 합류 | **첫 항목: BA `guest` 역할 등록과 `beforeCreateInvitation` 정책 검사**(§3.9). 초대 역할 `guest`, 참가 코드 만료·재발급·시도 제한, `use_invitation`, 승격·강등과 snapshot, **강등 시 MCP 토큰 삭제 연결과 그 테스트**, 이메일 인증 조건, 우선순위 함수 | A1-1, A1-5, A1-7 |
| A1-10 | 회수 전파 | 역할 변경·게스트 회수의 commit 뒤 순서(§3.11), 다중 인스턴스 테스트 | A1-6, A1-9 |
| A1-11 | 데스크톱 화면 | 초대 대화상자의 "게스트로 초대", 외부 공유 켜기, 참가 코드 만료 표시와 새 코드, 오류 문장(§0.1), 게스트 표시 | A1-9 |
| A1-12 | 출시 점검 | §8 전체 통과, canary 검사, 비개발자 과제 2·4(PRD §0.1) | 전체 |

**순서 정정 기록(독립 검증 §6.4):** A1-0은 헬퍼 없이 `role !== null`로 쓴다. A1-6의 의존에 `projectPerson` 정의(A1-3)를 넣었다. 강등 PATCH가 필요한 두 테스트(`mcp: demotion revokes tokens`, A1-9)는 A1-7에서 A1-9로 옮겼다. `sync: onAuthenticate rechecks after demotion`은 DB에서 역할을 직접 바꾸므로 A1-6에 둔다. BA 역할 등록과 정책 검사는 A1-9의 첫 항목, BA 조회 endpoint 차단은 A1-8, BA `/organization/leave` 정리는 A1-0이다.

PRD A1 행의 나머지 항목(외부 공유 정책 화면, 통합 감사 로그 최소판, 외부 접근 일괄 회수)은 이 문서의 판정 계약을 그대로 쓴다. A1-9 뒤에 이어서 별도로 분해한다. 이 문서는 그 항목들이 기대는 판정 경로만 고정한다.

## 10. 열린 질문

1. G4 경로 투영의 비용. 데스크톱이 경로 기반으로 파일을 쓰는 부분이 투영된 경로를 그대로 받아들이는지 A1-3 시작 전에 확인한다. 안 되면 PRD F2 문구를 바꾸고 상위 폴더 이름 노출을 경고로 처리한다.
2. G5 awareness. Hocuspocus hook으로 연결별 고쳐 쓰기가 되는지 확인한다.
3. 게스트의 MCP(G2). 고객 요구가 생기면 "게스트용 읽기 전용 scope"를 별도로 설계한다.
4. 참가 코드 기본 만료 7일과 기존 코드 유예 30일이 적당한지.
5. member에게도 노트 모음 목록을 "읽을 수 있는 문서가 있는 노트 모음만"으로 좁힐지. 좁히면 HTTP `GET /vaults`와 MCP `listVaults`를 같은 PR에서 함께 바꾼다(§3.3). 지금은 바꾸지 않는다.

## 부록 A. `orgRole` 호출 전수 검사

줄 번호는 코드가 바뀌면 틀어지므로 이 절의 기준은 명령이다. A1-4 시작 때와 A1-12 출시 점검 때 다시 실행해 결과를 PR에 붙인다.

```sh
cd app/apps/server && grep -rn "orgRole(" src | grep -v "^src/permissions/lookup.ts"
```

2f8adf8 기준 파일별 호출 수(정의 `S/permissions/lookup.ts` 제외): `http/routes/registry.ts` 15, `orgs.ts` 11, `blobs.ts` 9, `billing.ts` 6, `members.ts` 5, `shares.ts` 5, `mcp.ts` 4, `trash/service.ts` 3, `permissions/http-gates.ts` 3, `appearance.ts` 2, `shrink-brake.ts` 2, `permissions/access-management.ts` 2, 그리고 `ai-changes/service.ts`, `billing/store.ts`, `bootstrap.ts`, `bulk.ts`, `graph.ts`, `housekeeper.ts`, `invitations.ts`, `oauth-connect.ts`, `public-links.ts`, `vault-token.ts`, `versions.ts`, `invitations/expiries.ts`, `mcp/oauth.ts`, `mcp/service.ts`, `mcp/tokens.ts` 각 1.

각 호출은 다음 셋 중 하나로 분류해 PR에 적는다.
- `isParticipant`: vault에 들어올 수 있는가
- `isInternal`: 조직 권한을 받는가(MCP, 관리, 토큰, 정책)
- `isManager`: owner/admin인가

분류하지 않은 호출이 남으면 `authz/lint: no raw orgRole truthiness remains`(§8)가 실패한다.

## 검증 반영 기록

독립 검증 `docs/reports/A0-VERIFY-opus.md`(2f8adf8, 판정 "수정 후 승인")의 "수정 필요" 지적을 이 문서에 반영한 내역이다. 반영하면서 지적한 코드 인용을 `iron/docs-a0-authz`(2f8adf8)의 실제 코드에서 다시 확인했다. 코드는 바꾸지 않았다.

### 반영한 지적

| 검증 보고서 | 반영 위치 | 내용 |
|---|---|---|
| §4 누락 1: BA 조회 endpoint | §0, §2.2 주석 11, §3.8, §8-8, §9 A1-8 | `list-members`·`get-full-organization`·`list-invitations`를 경로 표면에 추가. 게스트·비멤버 403. 위치는 `auth.ts`의 `hooks.before` |
| §4 누락 1: BA `invite-member`와 정책 | §0, §3.9, §8-9, §9 A1-9 | 데스크톱이 BA 경로로 직접 초대한다(`D/lib/api.ts:1904`, `D/store.ts:4150`). 정책 검사를 `beforeCreateInvitation`에 둔다 |
| §4 누락 1: `guest` 역할 등록 | §3.9, §8-9, §9 A1-9 | BA `ac`/`roles` 등록. owner/admin/member 기본 권한 불변을 테스트로 고정. A1-9의 첫 항목 |
| §3 (a) 구멍과 High | §0, §3.1(현재·차이·변경), §5 규칙 1, §8 shares, §9 A1-0 | 제거된 멤버의 자기 재부여, 공개 링크까지. 세 겹 차단. 재현 테스트 추가 |
| §3 (b) 구멍과 `/organization/leave` | §0, §3.9, §8-9, §9 A1-0 | 경로 두 개, Medium(단독)/High(결합), 부수 차이(admin→admin) |
| §3 (c) 구멍 | §0, §3.7 | Medium 표기와 근거(이름·경로만 노출) |
| §5 정정 2: `listVaults` 불일치 | §3.3, §3.7, §8-3, §9 A1-0·A1-4 | member 동작을 바꾸지 않는다. HTTP와 MCP가 `listVaultsFor(viewer)` 한 함수를 쓴다 |
| §6.4 순서 정정 5건 | §9 A1-0, A1-3, A1-6, A1-7, A1-8, A1-9와 "순서 정정 기록" | 아래 "추가로 발견한 의존" 포함 |
| §4 누락 2: 진입부 목록 | §3.10, 부록 A, §8 lint | 빠진 라우트 추가, grep 명령을 기준으로 고정, lint 테스트 |
| §4 누락 3: MCP 루트 쓰기 | §2.2 주석 2, §3.7 | member는 MCP에서 루트에 못 만든다는 예외 표기 |
| §4 누락 4: 주석 오류 | §3.2, §9 A1-0 | `http-gates.ts:261` 주석 정정을 A1-0에 포함 |
| §4 누락 5: BA 이메일 인증 옵션 | §3.9 | hook 방식의 근거를 한 줄로 기록 |
| §2 G6 사실 확인 | §1 G6 | 가정에서 사실로(`crud-invites.mjs:269`, 380, 503) |
| §2 범위 밖 질문: `orgs.ts:560` | §3.9 차이 | 지금은 잠재 결함, `guest` 초대를 열면 실제 결함. `use_invitation` 변경이 수정 |
| §6.3 테스트 누락 | §8 전반 | 보고서 표의 "빠진 거부 케이스"를 모두 행으로 추가 |
| §5 인용 정정 | §3.7(`listResourceAccessTool`), §3.12(SQL 위치) | 아래 "인용 정정" 참고 |

### 인용 정정

- §3.7의 `requireAccessManager`(178-214)는 `listResourceAccessTool`의 범위다. 그 함수가 184에서 부르고 정의는 `S/permissions/access-management.ts:31-37`이다. 본문을 고쳤다.
- §3.12의 `resource_id = $4`(885-892)는 doc comment다. 실제 SQL은 `resolver.ts:919-923, 940-941`이다. 위치는 이미 본문에 있었고 885-892는 설명 주석이라는 점을 확인했다.
- 재확인 중 발견한 추가 정정: 검증 보고서 §3 (b)가 "우리 규칙(`orgs.ts:950-952`)"이라고 쓴 admin→admin 제거 금지는 `S/http/routes/orgs.ts:845-848`이다. 950-952는 역할 변경(PATCH)의 matrix다. 본문에는 845-848로 적었다.

### 추가로 발견한 의존

- `authz/sync: onAuthenticate rechecks after demotion`도 강등 흐름을 쓰지만, DB에서 역할을 직접 바꾸면 되므로 A1-9로 옮기지 않았다. 테스트 설명에 직접 변경이라고 적었다.
- A1-0의 `POST /shares` 규칙 1·2도 `isInternal`/`isParticipant`를 쓰므로 `role !== null`로 쓰고 A1-1에서 치환한다고 §5에 적었다. 보고서는 `canManage`만 명시했다.

### 반영하지 않았거나 다르게 반영한 것

- **BA 조회 endpoint에서 "데스크톱을 우리 overview로 옮기는 안":** 채택하지 않았다. 서버 차단이 변경 범위가 작고, 데스크톱 호출은 이미 `.catch(() => [])`로 감싸 있어 게스트는 빈 명단을 받아도 깨지지 않는다. 게스트용 "본인만" 명단은 overview에서 가져온다(A1-11). 이유는 §3.8에 적었다.
- **BA 제거 경로 수정안 두 가지 중 "404로 막기"만 하자는 안:** 막기를 기본으로 하되 `beforeRemoveMember`/`hooks.before`로 막는다(404가 아니라 `FORBIDDEN`). 데스크톱이 두 endpoint를 쓰지 않으므로 호환성 비용은 없다. 다만 막힘이 풀리거나 BA 내부 흐름이 호출하는 경우에 대비해 공통 정리 함수를 `afterRemoveMember`와 leave 후속 hook에 함께 둔다(심층 방어). 보고서의 두 안을 합친 것이다.
- **`listVaults`:** 보고서는 "게스트 분기로 옮기거나 HTTP와 함께 바꾼다"는 두 안을 줬다. member에게 노트 모음을 좁히는 것은 제품 결정이라서 이 문서는 첫 번째 안으로 한정했다(member 불변, HTTP와 MCP가 한 함수 공유). 두 번째 안은 열린 질문 5로 올렸다.
- **구멍 (a)·(b)의 재현:** 보고서의 재현 경로는 코드를 읽어 따라가며 확인했다. DB가 필요한 테스트는 실행하지 않았다(CLAUDE.md의 일회용 DB 규칙). 따라서 "확정"은 정적 분석 수준이다. 구현 단계에서 §8의 `removed creator cannot re-grant self`를 먼저 실패하는 테스트로 만들어 확인한다.

### 코드 재확인 결과

- 확인해서 일치한 것: `canManage`와 만든 사람 판정(`shares.ts:242-280`), 대상 검증 없음(524-541), 공개 링크 gate(`public-links.ts:106-125`), resolver의 `grant(role !== null, true)`(1379, 1394)와 1386-1391 주석, `sync-token.ts:105-116`, 세션 30일(`auth.ts:125-128`), `afterRemoveMember`(386-391), leave의 `hooks.after`(215-228), `beforeUpdateMemberRole` 선례(417-421), `organization()`에 `ac`/`roles` 없음, `service.ts` `listVaults`/`listFolders`(281-306)와 HTTP `GET /vaults`(`registry.ts:314-326`), 데스크톱의 BA 호출(`api.ts:1888-1914`, `store.ts:3736-3740, 4150`).
- 설치된 `better-auth@1.6.23`(이 워크트리에는 `node_modules`가 없어 같은 저장소의 다른 체크아웃에서 확인): `ROLE_NOT_FOUND`(`crud-invites.mjs:101-122`), 수락 시 이메일 일치(269, 380, 503), `requireEmailVerificationOnInvitation`(31), `listMembers`(`crud-members.mjs:417`), `leaveOrganization`(386, `deleteMember`만), `beforeRemoveMember`/`afterRemoveMember` 호출(193, 204), `get-full-organization`(`crud-org.mjs:299`), `list-invitations`(`crud-invites.mjs:524`).
- 보고서의 "확인된 주장" 표(§2)는 전체를 다시 대조하지 않았다. 그 표가 일치한다고 한 항목은 이 문서에서 바꾸지 않았다.
