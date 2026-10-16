---
type: design
product: Infinite Brain
date: 2026-10-16
phase: A0
status: draft (승인 대기)
base: docs/superpowers/specs/2026-10-15-team-second-brain-prd.md (PRD v2)
covers: PRD §4 D6, §5.1 F1, §5.2 F2, §9 A0
tags: [authz, guest, hub, join-code, a0]
---

# A0 설계: 허브 모드 권한 판정 (게스트 도입 전 고정)

이 문서는 PRD v2의 D6(권한 판정 일치), F1(팀 합류), F2(게스트), §9의 A0 행을 구현할 수 있는 수준으로 고정한다. A1은 이 문서만 보고 작업을 시작할 수 있어야 한다. 코드는 바꾸지 않았다.

경로 약어는 PRD와 같다. `S/` = `app/apps/server/src/`, `D/` = `app/apps/desktop/src/`, `T/` = `app/apps/server/tests/`, `M/` = `app/apps/server/migrations/`. 코드 인용은 이 문서를 쓰면서 `iron/docs-a0-authz` 브랜치(c10a7ea)에서 직접 확인한 줄만 적었다.

## 0. 요약

- **판정을 두 단계로 나눈다.** 먼저 "이 사람이 이 vault와 어떤 관계인가"(`relation`: internal / guest / partner / none)를 정하고, 그다음 "이 리소스에서 무엇을 할 수 있는가"를 정한다. 지금 코드는 관계를 `role !== null` 하나로만 본다. 그래서 `guest` 값을 `member.role`에 넣기만 하면 게스트가 조직 기본 권한, join snapshot, 만든 사람 규칙을 모두 물려받는다(§3).
- **게스트 도입과 무관하게 지금 있는 구멍 세 개를 먼저 막는다.**
  1. 개인 공유는 멤버십을 보지 않는다(`S/permissions/resolver.ts:574-585`). 그런데 `POST /shares`는 대상이 멤버인지 검사하지 않는다(`S/http/routes/shares.ts:524-540`). 정적 분석상 비멤버도 공유 한 줄로 `sync-token`을 받아 문서를 열 수 있다(`S/http/routes/sync-token.ts:105-116`).
  2. Better Auth의 자체 멤버 제거 경로는 개인 공유를 지우지 않는다(`S/auth/auth.ts:386-391`). 우리 경로는 지운다(`S/http/routes/orgs.ts:168-176`).
  3. MCP `listFolders`는 ACL 없이 vault의 모든 폴더 이름을 돌려준다(`S/mcp/service.ts:289-306`). 데스크톱 폴더 트리는 같은 사람에게 그 이름들을 숨긴다(`S/permissions/vault-docs.ts:610-680`).
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
| G6 | Better Auth `acceptInvitation`은 로그인한 사용자의 이메일과 초대 이메일이 같아야 수락한다(라이브러리 기본 동작). 이 문서에서는 라이브러리 코드를 확인하지 않았으므로 A1-1에서 테스트로 고정한다 | §6 |
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
2. 지금 resolver를 그대로 따른다. 조직 기본 권한(baseline), join snapshot, 개인 vault 수준, 팀 전체 공유, 만든 사람 규칙, 개인 공유, 잠금이 모두 적용된다.
3. admin은 owner와 다른 admin을 건드릴 수 없다. 지금 규칙(`S/http/routes/orgs.ts:947-952`, `S/http/routes/shares.ts:533-539`)을 유지한다.
4. **명시적인 개인 공유(폴더·파일)가 닿는 범위만.** 폴더 공유는 하위로 상속된다. 조직 전체 권한, snapshot, 개인 vault 행, `principal_type='org'` 공유, 만든 사람 규칙은 적용하지 않는다. 개인 거부와 잠금은 적용한다.
5. 4의 범위 안에서 `edit` 공유를 받은 곳에서만 가능하다. 루트에는 만들 수 없다. 자기가 만든 노트를 공유 범위 밖으로 옮기면 접근을 잃는다. 삭제는 `edit` 권한이 있고 **자기가 만든** 항목만 할 수 있다. 이것은 권한을 주는 규칙이 아니라 제한이다.
6. member는 자기가 만든 항목만 공유를 관리할 수 있다(지금 규칙, `S/http/routes/shares.ts:263-268`, `S/http/routes/public-links.ts:115-120`). 단, 대상이 게스트이면 외부 공유 정책(F4)이 허용해야 한다.
7. 게스트의 트리에는 공유 진입점과 그 하위만 보인다. 진입점의 상위 폴더 이름은 보내지 않는다(§3.2).
8. 읽을 수 있는 노트가 참조하는 첨부와, 읽을 수 있는 폴더 안의 파일만 받는다. 다운로드 URL은 항상 서버 프록시를 거친다(§3.6).
9. 지금 휴지통 관리자 단축(`S/trash/service.ts:137-142, 236-246`)을 유지한다.
10. 버전과 휴지통의 작성자, 삭제자 이름은 사람 투영(§3.8)을 거친다.
11. 게스트는 자기 자신만 받는다. 다른 사람은 "팀원"이라는 표시 이름으로만 나타나고 ID, 이메일, 사진은 없다(§3.8).
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
- 접근 색인 `loadAccessIndex`(376-429)는 조직의 모든 폴더·노트·파일·공유 행을 리소스 기준으로 읽는다(396-413). "누가 접근하나" 화면은 `resolveAccessForUserInner`(1532-)를 쓴다. 여기도 `role !== null`을 쓴다(1566, 1590, 1619, 1632-1648).

**차이**
- guest 값은 `role !== null`을 통과한다. 그래서 개인 vault 행, snapshot(032 트리거가 만든다, §4), 팀 공유, Read-only posture, 만든 사람 규칙을 모두 받는다. 표의 주석 4와 다르다.
- 비멤버는 개인 공유 한 줄로 `view`/`edit`를 받는다. 표에서는 ❌다.

**변경**
- `effectivePermissionInner`는 역할을 읽은 직후에 다음을 한다.
  - `relation === "none"`이면 `"none"`을 돌려준다. 비멤버와 partner는 어떤 공유로도 들어오지 못한다. 이것으로 `orgs.ts:128-141`의 "지워야만 안전한" 계약이 "판정에서 막힌다"로 바뀐다. 정리는 유지하되 안전의 근거로 쓰지 않는다.
  - `relation === "guest"`이면 별도 함수 `guestPermission`으로 간다. 이 함수는 `userItemVerdict`(494-529)의 개인 항목 판정(거부, 가장 깊은 행 우선, 잠금 cap)만 쓴다. 개인 vault 행, org 행, snapshot, 역할 단축, 만든 사람 규칙은 보지 않는다. 결과에는 결제 lapse cap(1241-1243)을 그대로 적용한다.
- `resolveAccessForUserInner`와 `ResolverCache`, `AccessIndex` 경로에도 같은 분기를 넣는다. drift 테스트에 guest와 비멤버 행을 추가한다.

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
- `GET /vaults`(`S/http/routes/registry.ts:314-326`)는 멤버면 조직의 **모든** 노트 모음(`vaults` 행)과 그 이름을 준다.

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
- `GET /vaults`: guest는 공유 진입점이 있는 노트 모음만 받는다. 이름은 조직 이름으로 바꿔 보낸다.

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
  - 접근 관리: `requireAccessManager`(178-214, `S/permissions/access-management.ts:31-37`)
- **`listVaults`(281-287)와 `listFolders`(289-306)는 ACL 없이** 조직의 모든 노트 모음 이름과 모든 폴더 이름·경로를 준다.

**차이**
- 게스트는 G2에 따라 토큰을 쓸 수 없어야 하는데, 지금은 역할이 있으면 통과한다.
- **member에게도 이미 차이가 있다.** private-by-default vault에서 데스크톱 트리가 숨기는 폴더 이름(`S/permissions/vault-docs.ts:610-680`)을 MCP `listFolders`는 보여 준다. CLAUDE.md의 "Authorization must agree across … MCP" 위반이다.

**변경**
- `verifyMcpToken`과 OAuth 검증은 `isInternal`이 아니면 null을 돌려준다.
- 게스트가 토큰을 만드는 라우트는 403이다. 게스트로 강등하면 그 사람의 해당 조직 토큰을 지운다.
- `listFolders`는 `listVisibleFolders`를 쓴다. `listVaults`는 읽을 수 있는 문서가 있는 노트 모음만 준다. 이 두 줄은 게스트와 무관한 기존 버그 수정이므로 A1-0에서 먼저 한다.

### 3.8 멤버·vault 목록, 초대 미리보기

**현재**
- `GET /orgs/:orgId/members/overview`(`S/http/routes/members.ts:79-180`)
  - 역할이 있으면 누구에게나(85-86) 모든 멤버의 이름, 이메일, 사진(100-104)과 대기 중인 초대 이메일(116-120)을 준다.
  - 접근 수준은 관리자에게만 준다(131, 172).
- 다른 사람의 활동 피드는 관리자이거나 본인일 때만 볼 수 있다(240-251).
- `GET /invitations/:id/preview`(`S/http/routes/invitations.ts:114-119`)는 **로그인 없이** `invitationJson` 전체를 준다. 여기에는 초대받은 사람의 이메일, 초대한 사람 ID와 이름, 조직 ID와 이름이 들어 있다(`S/registry/invitations.ts:69-81`).
- `GET /vaults`는 §3.3에서 다뤘다.

**차이**
- 게스트가 모든 사람의 이름과 이메일을 받는다.
- 초대 링크를 가진 누구나 초대받은 사람의 이메일을 볼 수 있다.

**변경**
- **사람 투영 헬퍼 `projectPerson(viewer, person)`** 를 하나 두고, 사람 필드(`userId`, `name`, `email`, `image`)를 내보내는 모든 응답에 쓴다.
  - viewer가 guest이고 대상이 본인이 아니면 `{ label: "팀원" }`만 남긴다.
  - 적용 대상: overview, 활동 피드, 버전 작성자, 휴지통 삭제자, AI 변경 기록, last edited by, presence.
- overview: guest에게는 `members=[본인]`, `invitations=[]`만 준다.
- 초대 미리보기
  - 로그인하지 않았거나 이메일이 다르면 `email`을 `j***@example.com`처럼 가리고 `inviterId`를 뺀다.
  - 이메일이 같은 로그인 사용자에게만 원문을 준다.
  - `role`이 `guest`이면 화면에 "게스트로 초대됨: 공유받은 항목만 볼 수 있습니다"를 보여 준다(§0.1 문구 원칙).

### 3.9 합류 경로 전체

**현재**
- 초대 만들기는 owner/admin만 한다(`S/http/routes/members.ts:408-411`). 역할은 `member`와 `admin`만 받는다(425-428).
- 초대는 Better Auth `createInvitation`으로 만들고(441-444), 선택한 접근 수준은 `invitation_access`에 저장한다(449-455). 메일은 켜져 있을 때만 보낸다(456).
- Better Auth hook
  - `beforeCreateInvitation`: 좌석 검사(`S/auth/auth.ts:325-345`)
  - `beforeAcceptInvitation`: 좌석 검사(348-355)
  - `afterAcceptInvitation`: 접근 수준 적용(400-411)
  - Better Auth 자체 역할 변경 endpoint는 막혀 있다(417-421)
  - 재초대는 이전 대기 초대를 취소한다(262)
- **`afterRemoveMember`(386-391)는 소켓만 닫고 개인 공유를 지우지 않는다.** 우리 제거 경로 `revokeMembership`(`S/http/routes/orgs.ts:142-200`)은 같은 트랜잭션에서 개인 공유를 지운다(168-176).
- 참가 코드
  - 조회·생성: owner/admin, 조직당 하나, 만료 없음(`S/http/routes/orgs.ts:479-520`)
  - 코드: 8자, 32문자 알파벳(97-108)
  - 합류(523-624): 이미 역할이 있으면 아무것도 바꾸지 않는다(541-543). **같은 이메일의 살아 있는 초대가 admin이면 admin, 아니면 member로 넣는다**(552-560). 이메일은 인증되지 않았을 수 있다(`S/auth/auth.ts:136`).
- 역할 변경은 `member`/`admin`만 받는다(`S/http/routes/orgs.ts:954-958`).

**차이**
- 게스트 초대를 받은 사람이 참가 코드를 쓰면 **member로 들어온다**(560). F1.1 위반이다.
- 미인증 이메일로 가입한 사람이 코드를 알면 그 이메일 앞으로 온 admin 초대를 가져간다(555-560).
- Better Auth 제거 경로는 개인 공유를 남긴다. §3.1 변경 전에는 이것이 실제 접근으로 이어진다.

**변경**
- 초대 역할에 `guest`를 추가한다(425-428). 외부 공유 정책이 끔이면 `external_sharing_off`로 거부한다.
- **참가 코드는 member로만 합류시킨다.** 같은 이메일의 살아 있는 초대가 있으면 역할과 관계없이 코드를 소비하지 않는다. 대신 `409 use_invitation { invitationId }`를 돌려주고, 데스크톱이 초대 수락 흐름으로 넘긴다. admin 초대도 이 길로 가므로 (560)의 역할 결정 분기는 없어진다.
- 이미 guest인 사람이 코드를 쓰면 지금처럼 `alreadyMember: true`로 아무것도 바꾸지 않는다(541-543). 화면에는 "이미 게스트로 참여 중입니다. 팀원이 되려면 관리자에게 요청하세요"를 보여 준다.
- `afterRemoveMember`는 `revokeMembership`과 같은 정리(개인 공유 삭제, 세션 정리)를 한다. 공통 함수로 뽑아 두 경로가 같은 코드를 쓴다.
- 역할 변경 PATCH는 `guest`↔`member`를 허용한다(owner/admin만).
  - guest→member 승격: 그 시점의 join default로 `member_access_snapshots`를 만든다. 업데이트에는 032 트리거가 돌지 않기 때문이다(§4).
  - member→guest 강등: snapshot과 개인 vault 행을 지우고, MCP 토큰을 지우고, 소켓을 닫는다.
- 메일이 켜져 있으면 guest와 admin 초대의 수락에는 `emailVerified=true`를 요구한다(`beforeAcceptInvitation`). member 초대는 지금처럼 요구하지 않는다. #99처럼 기존 계정이 잠기는 실패를 피하기 위해서다(`S/auth/auth.ts:131-136`).
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

**차이**
- 판정 자체는 모두 resolver나 읽기 가능 목록으로 수렴한다. §3.1, §3.2를 고치면 맞는다.
- 남는 차이는 사람 이름(버전 작성자, 휴지통 삭제자)과 경로(`relPath`)다.

**변경**
- 진입부를 `isParticipant`로 바꾼다.
- 응답에 §3.2 경로 투영과 §3.8 사람 투영을 적용한다.
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
- resolver는 이 행을 `resource_id = $4(organizationId)`로 찾는다(`S/permissions/resolver.ts:885-892, 919-923, 940-941`). 접근 색인도 같다(402).
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
1. **행위자:** `canManage`는 `isInternal(actorRole)`을 먼저 요구한다. 만든 사람 예외는 member 이상에만 적용한다. 게스트와 비멤버는 403 `not_allowed_to_share`다. 공개 링크 gate(`S/http/routes/public-links.ts:106-125`)도 같은 규칙을 쓴다.
2. **user 대상:** `principalId`가 같은 조직의 `member` 행을 가지고 `isParticipant(parseRole(role))`여야 한다. 아니면 400 `share_target_not_member`다. 화면 문구는 "이 사람은 아직 이 vault에 없습니다. 먼저 초대하세요"다.
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
| 3 | HTTP 게이트 | `authz/http: guest cannot create at root` | `POST /folders`(parent 없음) → `HTTP 403` |
| | | `authz/http: guest edits inside edit share only` | Drafts에 만들기 `HTTP 200`, Acme에 만들기 `HTTP 403` |
| | | `authz/http: guest delete requires creator` | 남이 만든 Drafts 노트 삭제 → `HTTP 403`, 자기 노트 `HTTP 200` |
| | | `authz/http: GET /vaults for guest` | 노트 모음 1개, 이름 = 조직 이름, `canary∅` |
| 4 | 문서 동기화 | `authz/sync: sync-token per role` | 표와 같음(`HTTP 200`의 readOnly 값, 또는 `HTTP 403`). X는 개인 공유 행이 있어도 `HTTP 403` |
| | | `authz/sync: onAuthenticate rechecks after demotion` | 토큰 발급 → member를 guest로 강등 → 연결 거부 또는 읽기 전용 |
| | | `authz/sync: awareness names projected for guest` | G 연결이 받은 awareness에 `canary∅`(G5 spike 결과에 따라 "awareness 없음"으로 바뀜) |
| 5 | vault 채널 | `authz/vault-channel: guest gets no member frames` | A1 합류 이벤트 → G `frame∅` |
| | | `authz/vault-channel: guest presence limited to readable docs` | B가 Secret을 열면 G `frame∅`, Acme를 열면 이름이 투영된 프레임 |
| | | `authz/vault-channel: guest gets no voice` | `frame∅` |
| 6 | 첨부 | `authz/blobs: guest reads only referenced attachments` | Acme 첨부 `HTTP 200`, Secret 첨부 `HTTP 403` |
| | | `authz/blobs: guest download url is always proxied` | S3 설정에서도 `direct=false` |
| | | `authz/blobs: guest revocation applies to next download` | 공유 삭제 직후 프록시 다운로드 `HTTP 403` |
| 7 | MCP | `authz/mcp: guest token rejected` | 토큰과 OAuth 모두 `HTTP 401` |
| | | `authz/mcp: listFolders matches desktop tree` | member A의 MCP 폴더 목록 = `listVisibleFolders` 결과(기존 버그 회귀 테스트) |
| | | `authz/mcp: demotion revokes tokens` | 강등 뒤 토큰 사용 `HTTP 401`, 토큰 행 없음 |
| 8 | 멤버·미리보기 | `authz/members: guest overview is self only` | `members.length=1`, `invitations=[]`, `canary∅` |
| | | `authz/invitations: preview masks email when anonymous` | 익명 → 가린 이메일, `inviterId` 없음. 같은 이메일로 로그인 → 원문 |
| | | `authz/people: versions and trash project names for guest` | `canary∅` |
| 9 | 합류 | `authz/join: code never grants guest or admin` | 같은 이메일에 guest 초대가 있으면 → `HTTP 409 use_invitation`, member 행 없음 |
| | | `authz/join: guest using code stays guest` | `alreadyMember=true`, 역할 guest 유지 |
| | | `authz/join: expired, revoked, rotated codes refused` | `HTTP 410`(만료, 끔), 이전 세대 코드 `HTTP 404` |
| | | `authz/join: attempts are throttled` | 실패 5회 뒤 `HTTP 429` |
| | | `authz/join: better-auth remove-member purges shares` | BA endpoint로 제거 → 개인 공유 0행, sync-token `HTTP 403` |
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
| — | migration | `authz/migration: legacy permissions unchanged` | §4의 전후 비교가 같음. 비멤버 공유만 격리 |
| | | `authz/migration: rerun is a no-op` | 두 번 실행해도 오류 없음, 결과 같음 |

## 9. A1 구현 작업 분해

순서는 의존 관계를 따른다. 각 작업은 한 PR 크기이고, 자기 테스트를 같은 PR에 넣는다.

| 순서 | 작업 | 내용 | 의존 |
|---|---|---|---|
| A1-0 | 기존 구멍 막기 | Better Auth 제거 경로에서 개인 공유 삭제(공통 함수). `POST /shares` 대상 멤버 검증(§5의 1, 2, 6). MCP `listFolders`·`listVaults` ACL 적용. resolver에서 비멤버 fail closed. **게스트 없이도 출시할 수 있는 보안 수정** | 없음 |
| A1-1 | 관계 헬퍼와 migration | `parseRole`/`relationOf` 등(§3.0). 역할 CHECK `NOT VALID`, 032 트리거 교체, 비멤버 공유 격리, 정책 테이블, 참가 코드 열(§4, §7). migration 전후 비교 테스트. G6·G8 확인 테스트 | A1-0 |
| A1-2 | resolver 게스트 분기 | `guestPermission`, cache·prefetch·index 경로, drift 테스트 확장, 표 기반 matrix 테스트(§8-1) | A1-1 |
| A1-3 | 읽기 가능 목록과 경로 투영 | `vaultAccess`의 relation, `listDocsInVault`·`listVisibleFolders`의 게스트 분기, `projectPath` 헬퍼와 쓰기 경로의 역투영 | A1-2 |
| A1-4 | HTTP 게이트와 라우트 | `isParticipant` 치환, 루트 쓰기, 폴더 단축, 삭제, `GET /vaults`, bulk·bootstrap·graph·search·trash·versions, 게스트 첨부 프록시 | A1-3 |
| A1-5 | 공유 규칙 완성 | §5의 3, 4, 7. 공개 링크 gate. 일괄 접근 변경과 `applyInvitationAccess`가 `assertShareTarget` 사용 | A1-1, A1-4 |
| A1-6 | 동기화와 채널 | awareness spike(G5) → 투영 또는 차단. 채널 프레임 필터(§3.5). `sync-token` 심층 방어 | A1-2 |
| A1-7 | MCP | 게스트 토큰·OAuth 거부, 강등 시 토큰 삭제 | A1-1 |
| A1-8 | 사람 투영과 멤버 화면 | `projectPerson`, overview, 활동, 버전, 휴지통, AI 변경, 초대 미리보기 마스킹 | A1-3 |
| A1-9 | 합류 | 초대 역할 `guest`, 참가 코드 만료·재발급·시도 제한, `use_invitation`, 승격·강등과 snapshot, 이메일 인증 조건, 우선순위 함수 | A1-1, A1-5 |
| A1-10 | 회수 전파 | 역할 변경·게스트 회수의 commit 뒤 순서(§3.11), 다중 인스턴스 테스트 | A1-6, A1-9 |
| A1-11 | 데스크톱 화면 | 초대 대화상자의 "게스트로 초대", 외부 공유 켜기, 참가 코드 만료 표시와 새 코드, 오류 문장(§0.1), 게스트 표시 | A1-9 |
| A1-12 | 출시 점검 | §8 전체 통과, canary 검사, 비개발자 과제 2·4(PRD §0.1) | 전체 |

PRD A1 행의 나머지 항목(외부 공유 정책 화면, 통합 감사 로그 최소판, 외부 접근 일괄 회수)은 이 문서의 판정 계약을 그대로 쓴다. A1-9 뒤에 이어서 별도로 분해한다. 이 문서는 그 항목들이 기대는 판정 경로만 고정한다.

## 10. 열린 질문

1. G4 경로 투영의 비용. 데스크톱이 경로 기반으로 파일을 쓰는 부분이 투영된 경로를 그대로 받아들이는지 A1-3 시작 전에 확인한다. 안 되면 PRD F2 문구를 바꾸고 상위 폴더 이름 노출을 경고로 처리한다.
2. G5 awareness. Hocuspocus hook으로 연결별 고쳐 쓰기가 되는지 확인한다.
3. 게스트의 MCP(G2). 고객 요구가 생기면 "게스트용 읽기 전용 scope"를 별도로 설계한다.
4. 참가 코드 기본 만료 7일과 기존 코드 유예 30일이 적당한지.
