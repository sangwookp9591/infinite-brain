---
type: design
product: Infinite Brain
date: 2026-10-17
stage: A0
status: draft (승인 전)
tags: [design, authorization, guest, hub, d6]
---

# A0 설계: 허브 모드 권한 기대표와 D6 경로 체크리스트

관련 문서: [[2026-10-15-team-second-brain-prd]] (§4 D6, §5.1 F1, §5.2 F2, §5.4 F4, §9 A0), [[reports/PRD-REVIEW-team-second-brain-astra]] (S01, F01, F02, F03, S05, S07), `CLAUDE.md`(불변 조건)

> **이 문서가 정하는 것.** PRD §9의 A0 출시 조건인 "설계 문서 승인"의 대상이다.
> 1. 역할 × 리소스 × 동작의 기대 권한 표(§3)
> 2. D6 경로별 현재 판정, 게스트 추가 시 바꿀 점, 필요한 통합 테스트(§4)
> 3. 현재 코드와 기대 표의 불일치 전체 목록(§5)
>
> 기존 데이터 migration 기본값, `POST /shares` 대상 검증, 메일 없는 자체 설치 환경의 동작, A1 작업 분해는 §6~§9에서 다룬다. 사용자 승인이 필요한 항목은 §10에 모았다.

## 0. 요약

- **지금 서버에는 `guest`를 구분하는 코드가 한 줄도 없다.** 모든 경로는 "member 행이 있는가"(`role !== null`, `orgRole(...)`가 참)나 "owner/admin인가"로만 판정한다. 그래서 `member.role = 'guest'` 행을 넣기만 하면 게스트는 member와 똑같이 판정된다. 조직 기본 권한, join snapshot, 조직 단위 공유, 만든 사람 규칙을 모두 물려받고, 팀원 이름·이메일도 받는다(§4 전 경로).
- **게스트와 무관하게 지금 고쳐야 할 결함이 있다.** 이번에 일회용 DB에서 직접 재현했다(§1.3).
  - P3: 제거된 멤버가 자기가 만든 노트에 자기 공유를 다시 만들면 편집 sync 토큰을 받는다.
  - P1: member 행이 없는 사용자도 개인 파일 공유만 있으면 문서 sync 토큰을 받는다.
  - P2: `POST /shares`는 존재하지 않는 사용자 ID에도 공유를 저장한다.
- **기대 모델:** 게스트는 "이 vault에 활성 관계로 참여"하는 것은 맞지만, 리소스 권한은 **자기 이름으로 명시 공유된 폴더·노트(`principal_type='user'`)에서만** 나온다(§3.1). 팀 역할(owner/admin/member)의 동작은 바꾸지 않는다.
- **A1은 7개 조각으로 나눈다.** 순서는 선행 보안 수정 → `POST /shares` 대상 검증 → 감사 로그 최소판 → 참가 코드 수명주기 → 허브 게스트 → 외부 공유 정책 → 외부 접근 일괄 회수다(§9).

## 1. 범위, 근거 표기, 검증 방법

### 1.1 범위
- 허브 모드 서버(`app/apps/server/src/`)의 권한 판정만 다룬다. P2P(C 단계)와 연결된 vault(E 단계, partner)는 범위 밖이다. 다만 §3의 원칙(관계와 리소스 권한 분리)은 E에서 그대로 재사용할 수 있게 정한다.
- 데스크톱은 "UI 캐시는 쓰기를 승인하지 않는다"(`CLAUDE.md`)는 불변 조건 아래에서 표시만 바꾼다. 권한 경계는 모두 서버에 둔다.

### 1.2 근거 표기
- 경로 약어는 PRD와 같다: `S/` = `app/apps/server/src/`, `D/` = `app/apps/desktop/src/`, `M/` = `app/apps/server/migrations/`, `T/` = `app/apps/server/tests/`.
- 줄 번호는 기준 커밋 `c10a7ea`(브랜치 `sangwookpark/ib-hub-a0`의 시작점) 기준이다.
- "확인"은 코드를 직접 읽은 정적 사실이다. "재현"은 §1.3의 일회용 DB 실험 결과다. "미검증"은 코드만으로 결론을 내지 못한 항목이다.

### 1.3 검증 방법과 재현 결과
- 정적 읽기: resolver, readable-set, HTTP gate, Hocuspocus, vault 채널, bootstrap, 첨부, MCP, 멤버·초대·참가 코드, 공유, 공개 링크, 버전·휴지통·체크포인트, Better Auth 설정.
- 기존 테스트 실행: 권한 관련 20개 파일, 208개 테스트가 통과했다(명령은 `docs/reports/IMPL-REPORT-A0.md`).
- 일회용 probe 테스트(커밋하지 않고 실행 후 삭제). 결과는 다음과 같다.

| ID | 조건 | 결과 | 근거 경로 |
|---|---|---|---|
| P1 | member 행이 없는 사용자에게 파일 단위 개인 공유(edit)가 있다 | `POST /api/sync-token` **200**, `permission: "edit"`. `POST /api/vault-sync-token`은 403 | `S/http/routes/sync-token.ts:78-111`에 멤버 검사가 없다. `S/http/routes/vault-token.ts:33-34`는 검사한다 |
| P2 | owner가 비멤버 사용자 ID와 **존재하지 않는 ID**로 `POST /shares` | 둘 다 **201** | `S/http/routes/shares.ts:523-540, 573-597` |
| P3 | 노트를 만든 member를 제거한 뒤, 그 사람이 자기 노트에 자기 공유를 만든다 | sync 토큰 403 → 자기 공유 **201** → sync 토큰 **200** | `S/http/routes/shares.ts:263-267`(만든 사람 경로에 멤버 검사 없음), `S/permissions/resolver.ts:910-912, 1394`(개인 공유는 멤버십을 묻지 않음) |
| P4 | `member` 행을 `role='guest'`로 넣는다 | `member_access_snapshots`에 join snapshot이 생긴다 | `M/032_member_access_defaults.sql:43`(owner만 제외) |

P1과 P3에서 확인한 것은 토큰 발급까지다. Hocuspocus 연결 단계의 `onAuthenticate`도 같은 `syncPermission`으로 다시 판정하므로(`S/sync/hocuspocus.ts:274-294`) 연결도 허용될 것으로 본다. 다만 이 단계는 **미검증**이다.

## 2. 현재 판정 모델 (게스트 설계의 출발점)

### 2.1 판정 순서 (`S/permissions/resolver.ts` `effectivePermission`:1229 → `effectivePermissionInner`:1246)
1. 개인 deny(`principal_type='user'`, `denied`)이면 `none`이다(1302).
2. 항목 Private(조직 deny) 여부를 계산하고(1303) 역할을 읽는다(1306).
3. **개인 vault 수준**(vault 리소스에 대한 개인 행)이 있으면 vault 전체 기본값을 대신한다(1314-1323).
4. **join snapshot:** 가입 전에 있던 리소스는 snapshot 모드(open→edit, readonly→view, private→none)와 직접 공유 중 높은 쪽을 쓴다(1325-1343).
5. 항목 Private이면 개인 공유만 남는다(1353-1362).
6. vault가 Read-only나 sealed이면 역할 지름길과 만든 사람 규칙이 없고, 공유만 반영한다(1363-1379).
7. 한 번이라도 공유된 vault에서 owner/admin은 `edit`이다(1380-1385).
8. 만든 사람 규칙: `role !== null`이고 작성자이면 `edit`이다(1386-1392).
9. 그 밖에는 공유를 반영한다. 조직 공유는 `isMember`(= `role !== null`)일 때만 더한다(1394, 조건절 918-924).
10. lock은 `view`로 상한을 씌울 뿐 권한을 주지 않는다. 결제 만료 시 `edit`은 `view`가 된다(1241-1243).

### 2.2 게스트 설계에 직접 걸리는 현재 사실
- **조직 공유의 문지기는 `role !== null` 하나다.** `sharePermission`(894)의 조직 조건절(918-924), `vaultAccess`(`S/permissions/vault-docs.ts:73`), `listDocsInVault`의 `isMember`(297, 409), `listVisibleFolders`(675)가 모두 이 조건 하나에 기댄다.
- **개인 공유는 멤버십을 묻지 않는다.** `sharePermission` 주석이 "Per-user grants are inherently scoped, so they need no gate"라고 명시한다(910-912). 테스트도 비멤버의 개인 vault 공유가 vault 전체 읽기를 준다고 고정한다(`T/vault-docs.test.ts:129-153`).
- **vault 단위 공유의 `resource_id`는 조직 ID다.** `S/permissions/lookup.ts:40-57`, `resolveResource`. note collection(`vaults` 행)의 ID가 아니다. 이 계약은 그대로 유지한다(PRD D6).
- **join snapshot은 trigger가 만든다.** owner를 뺀 모든 새 member 행에 대해, 조직의 `join_default`로 snapshot을 쓴다(`M/032_member_access_defaults.sql:33-70`, 제외 조건은 43행).
- **sync 토큰 발급 경로마다 멤버 검사가 다르다.** 문서 토큰은 판정 결과만 보고(`S/http/routes/sync-token.ts:105-109`), vault 채널 토큰은 멤버십을 요구한다(`S/http/routes/vault-token.ts:33-34`).
- **관리 경로는 역할로만 판정한다.** `canManage`(`S/http/routes/shares.ts:242-280`)는 owner/admin이거나 리소스를 만든 사람이면 통과한다. 만든 사람 경로는 현재 멤버인지 확인하지 않는다(263-267).

## 3. 역할과 기대 권한 표

### 3.1 역할 정의

| 역할 | 저장 형태 | 관계 | 리소스 권한의 출처 |
|---|---|---|---|
| owner | `member.role='owner'` | 활성 | 지금과 같다(§2.1) |
| admin | `member.role='admin'` | 활성 | 지금과 같다 |
| member | `member.role='member'` | 활성 | 지금과 같다 |
| guest (신규) | `member.role='guest'` | 활성 | **자기 이름의 개인 공유(`principal_type='user'`)가 걸린 폴더·노트·파일만.** 조직 기본 권한(posture), join snapshot, 개인 vault 수준, 조직 단위 공유(`principal_type='org'`), 만든 사람 규칙, 관리 기능을 상속하지 않는다 |
| external | 이 조직에 `member` 행이 없는 로그인 사용자 | 없음 | 없음. 초대 수락, 참가 코드 사용, 자기 MCP 토큰 삭제만 할 수 있다 |
| 익명 | 세션이 없는 방문자 | 없음 | 공개 링크 토큰이 가리키는 노트 1개와 그 노트가 참조하는 첨부만 볼 수 있다 |

**핵심 규칙 (A1의 판정 계약):**
- **R1 관계 판정:** "활성 관계" = owner/admin/member/guest 중 하나다. 활성 관계가 없으면 **어떤 공유 행이 있어도** `none`이다. 이 규칙으로 P1과 P3을 닫는다. external에게 이미 저장된 개인 공유를 어떻게 처리할지는 §10 Q1의 결정을 따른다.
- **R2 팀 판정:** "팀 역할" = owner/admin/member다. 지금 `role !== null`이 주는 모든 것(조직 공유, posture, snapshot, 만든 사람 규칙, 루트 쓰기)은 팀 역할에만 준다.
- **R3 게스트 리소스 권한:** 게스트의 권한은 자기 개인 공유 중 문서와 조상 폴더에 걸린 것들의 최대값이다. 개인 deny와 lock은 지금처럼 위에 덮어쓴다. **vault 리소스의 개인 행(개인 vault 수준)은 게스트에게 만들 수 없다**(§7 V3).
- **R4 이름과 메타데이터:** 게스트는 다른 사람의 이름·이메일·프로필 사진, 공유받지 않은 폴더·노트 이름, 같은 조직의 다른 note collection 이름, vault 전체 통계를 받지 못한다. 자기 정보와 자기에게 공유된 진입점은 받는다.
- **R5 관리 기능 없음:** 게스트는 초대, 공유, 공개 링크, 참가 코드, 감사 로그, vault 설정을 만들거나 바꿀 수 없다.

### 3.2 리소스별 기대 권한

표기: ✅ 허용 · ⛔ 거부 · "공유 범위" = 게스트 자신의 개인 공유가 닿는 폴더·노트(R3) · "현행" = 지금 동작을 유지한다(§2.1).

**vault (조직과 그 note collection)**

| 동작 | owner | admin | member | guest | external |
|---|---|---|---|---|---|
| vault 목록에서 보기 | ✅ | ✅ | ✅ | 참여 중인 vault(조직)의 표시 이름만. 같은 조직의 다른 note collection 이름은 ⛔ (§10 Q4) | ⛔ |
| 설정 변경(이름·아이콘·모양·root freeze·posture·참가 기본값) | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| 멤버 목록(이름·이메일·마지막 접속) | ✅ | ✅ | ✅ 현행 | 자기 자신만 | ⛔ |
| 저장 공간 사용량 | ✅ | ✅ | ✅ 현행 | ⛔ | ⛔ |
| 역할 변경·멤버 제거 | ✅ 현행 | 현행(member만) | ⛔ | ⛔ | ⛔ |
| 나가기 | ⛔(삭제만 가능) | ✅ | ✅ | ✅ | — |
| vault 삭제·서버 연결 끊기(unsync) | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |

**folder**

| 동작 | owner·admin | member | guest | external |
|---|---|---|---|---|
| 트리에서 보기 | 현행 | 현행 | 공유 범위의 폴더와 그 하위. **조상 폴더의 이름은 받지 않는다**(§10 Q3) | ⛔ |
| 만들기 | 현행 | 현행(`canCreateIn`) | 편집 공유 범위 안에서만. 루트 ⛔ | ⛔ |
| 이름 변경·이동 | 현행 | 현행 | 출발지와 도착지가 모두 편집 공유 범위 안일 때만 | ⛔ |
| 삭제 | 현행 | 현행(자기가 만든 것만) | 자기가 만들었고 편집 공유 범위 안일 때만 | ⛔ |
| 공유 관리 | ✅ | 자기가 만든 폴더 | ⛔ | ⛔ |

**note**

| 동작 | owner·admin | member | guest | external |
|---|---|---|---|---|
| 읽기 | 현행 | 현행 | 공유 범위 | ⛔ |
| 편집 | 현행 | 현행 | 편집 공유 범위. lock이면 `view` | ⛔ |
| 만들기 | 현행 | 현행 | 편집 공유 폴더 안에서만. 루트 ⛔ | ⛔ |
| 만든 사람 규칙 | 현행 | 현행 | **적용하지 않는다.** 범위 밖으로 옮긴 자기 노트도 잃는다(PRD F2) | — |
| 공유 관리, 접근 목록(`/resolve-access`) | ✅ | 자기가 만든 노트 | ⛔ | ⛔ |
| 공개 링크 만들기·끄기 | ✅ | 자기가 만든 노트(현행) | ⛔ | ⛔ |
| 익명 공개 링크로 보기 | 정책에 따름(§3.3) | 같음 | 같음 | 같음 |

**blob (첨부와 트리 파일)**

| 동작 | owner·admin·member | guest | external |
|---|---|---|---|
| 트리 파일 읽기 | 현행(resolver) | 공유 범위 | ⛔ |
| 첨부 읽기 | 현행(vault 전체 읽기 또는 참조하는 읽기 가능 노트) | 참조하는 노트가 공유 범위에 있을 때만. vault 전체 읽기 경로는 없다 | ⛔ |
| 목록 | 현행 | 위 읽기 규칙으로 거른 것만 | ⛔ |
| 올리기·교체 | 현행 | 편집 공유 범위의 노트 첨부와 편집 공유 폴더 안의 파일만 | ⛔ |
| 삭제 | 현행 | 자기가 올렸고 편집 공유 범위일 때만 | ⛔ |
| 발급된 다운로드 URL | TTL(기본 300초, `S/blobs/config.ts:225`) 동안 유효. 엄격한 회수는 `S3_PROXY_DOWNLOADS` | 같다. 게스트 회수 문서에 이 한계를 적는다 | — |

**history (노트 버전, vault 체크포인트, 복구, AI 변경 기록)**

| 동작 | owner·admin | member | guest | external |
|---|---|---|---|---|
| 노트 버전 목록·내용 | 현행(읽기 권한) | 현행 | 공유 범위 노트만. 작성자 이름은 자기 것 외에는 "다른 사용자"로 바꾼다(§10 Q5) | ⛔ |
| 노트 되돌리기 | 현행(편집 권한) | 현행 | 편집 공유 범위 | ⛔ |
| vault 체크포인트 목록 | ✅ | ✅ 현행 | ⛔(vault 전체 노트 수와 작성자 이름을 담는다) | ⛔ |
| 체크포인트 만들기·삭제·되돌리기, 복구 적용 | ✅ | ⛔ | ⛔ | ⛔ |
| AI 변경 기록 | 현행(문서 읽기 권한) | 현행 | 공유 범위 문서만 | ⛔ |

**trash**

| 동작 | owner·admin | member | guest | external |
|---|---|---|---|---|
| 목록 | 현행(읽을 수 있었던 것만) | 현행 | 공유 범위였던 것만. 지운 사람 이름은 자기 것 외에는 숨긴다 | ⛔ |
| 내용 보기 | 현행 | 현행 | 공유 범위였던 것만 | ⛔ |
| 복원 | 현행 | 현행(편집 권한) | 편집 공유 범위였고 원래 폴더가 범위 안에 있을 때만. **범위 밖 폴더를 새로 만들어 복원하지 않는다** | ⛔ |
| 오프라인 변경을 휴지통 문서에 반영(보존 기간 안) | 현행(`S/trash/access.ts:36-46`) | 현행 | 공유 범위였던 것만 | ⛔ |

**invite (초대, 참가 코드, 합류)**

| 동작 | owner | admin | member | guest | external |
|---|---|---|---|---|---|
| member·admin 초대 | ✅ | ✅(admin 초대 포함, 현행) | ⛔ | ⛔ | ⛔ |
| guest 초대 | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| 대기 중 초대 목록(초대받은 사람 이메일) | ✅ | ✅ | 현행(§10 Q6) | ⛔ | ⛔ |
| 참가 코드 보기·재발급·만료 설정 | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| 참가 코드 사용 | — | — | — | 이미 참여 중이라 아무것도 바뀌지 않는다. **member로 승격하지 않는다** | member로 합류한다. 같은 이메일로 살아 있는 guest 초대가 있으면 거부하고 초대 링크로 안내한다 |
| 초대 수락 | — | — | — | — | 초대에 적힌 역할로 합류한다 |
| 초대 미리보기(`/invitations/:id/preview`) | 초대 ID를 아는 누구나 볼 수 있다(현행). guest 초대에서는 vault 이름과 초대한 사람 이름만 보여 준다(§10 Q4) | | | | |

**audit (통합 감사 로그, A1 신규)**

| 동작 | owner | admin | member | guest | external |
|---|---|---|---|---|---|
| 조회·내보내기 | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| 보존 기간 설정 | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| 기록 쓰기 | 서버만 쓴다. API로 쓰거나 지울 수 없다 | | | | |

**외부 AI 연결(MCP)**

| 동작 | owner·admin | member | guest | external |
|---|---|---|---|---|
| 토큰·OAuth 연결 만들기 | 현행(`access:manage`는 owner/admin만) | 현행 | **A1에서는 ⛔(fail closed)**. 허용 여부는 §10 Q7 | ⛔ |
| 도구 결과 | 현행 | 현행 | 허용한다면 공유 범위만. `list_vaults`, `list_folders`도 R4를 따른다 | — |

### 3.3 외부 공유 정책과의 관계 (PRD F4)
- 정책 값: `off`(끔) / `domains`(허용한 도메인만) / `on`(허용).
- **`off`:** guest 초대, guest 대상 공유, 익명 공개 링크를 모두 거부한다.
- **`domains`:** guest 초대와 수락 때 이메일 도메인을 확인한다. 익명 공개 링크는 만들 수 없다(방문자의 도메인을 확인할 수 없기 때문이다).
- **`on`:** 모두 허용한다.
- **기본값:** 기존 vault는 `on`, 새 vault도 `on`으로 시작한다. 이유는 §6.4.
- 우선순위는 PRD F1.4의 순서를 따른다: 외부 공유 정책 → 신원 확인 → 승인 대기 → 역할 부여.

## 4. D6 경로 체크리스트

각 표의 "테스트" 열은 A1에서 추가할 통합 테스트의 파일과 이름이다. 모든 게스트 테스트는 같은 고정 시나리오(§4.0)를 쓴다.

### 4.0 고정 시나리오 (모든 게스트 테스트 공통)
vault 하나(posture Shared, `join_default='open'`), 폴더 `Clients/Acme/Shared`와 `Clients/Beta`, 루트 노트 1개를 둔다. member A가 `Clients/Beta/b.md`를 만든다. guest G는 `Clients/Acme/Shared`에 개인 편집 공유를 받는다. external X는 계정만 있다. 기대값은 다음과 같다.
- G는 `Shared` 아래만 읽고 쓴다.
- G는 `Clients`, `Acme`, `Beta`의 이름을 받지 않는다.
- G는 A의 이름과 이메일을 받지 않는다.
- X는 모든 경로에서 거부된다.

### 4.1 권한 판정 (resolver)

| # | 경로 | 현재 판정 | 게스트 추가 시 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-01 | `S/permissions/resolver.ts` `effectivePermissionInner`:1246 | §2.1. 역할은 `role !== null` 여부와 owner/admin 일치만 본다(1306, 1380, 1386, 1394) | 관계 판정(R1)을 맨 앞에 둔다. guest면 개인 vault 수준, snapshot, posture, 역할 지름길, 만든 사람 규칙을 건너뛰고 `grant(false, false)`(개인 행만)를 쓴다. deny와 lock은 그대로 둔다 | `T/guest-resolver.test.ts` "guest gets only per-user folder/file grants", "guest ignores org posture, join snapshot and org item shares", "guest keeps no creator edit after moving a note out of scope", "external with a per-user share resolves none" |
| D6-02 | 같은 파일 `sharePermission`:894, `rowsGrant`:561 | 개인 행은 멤버십 없이 반영한다(910-912). 조직 행은 `isMember`일 때만 반영한다(918-924) | 호출자가 R1·R2로 막는다. 함수 안에서는 `isMember`를 "팀 역할"로 바꾼다 | 위 파일 "per-user rows never apply without an active relation" |
| D6-03 | 같은 파일 `membershipFacts`:1134, `createResolverCache`:184 | 역할·snapshot·posture를 한 번에 읽는다 | 역할 문자열을 그대로 둔다. 해석은 공통 함수 `isTeamRole`/`isActiveRole`로 모은다(신규 `S/permissions/roles.ts`) | `T/resolver-cache-drift.test.ts`에 guest 행을 추가한다("cache and reference agree for a guest") |
| D6-04 | 같은 파일 `loadAccessIndex`:376, `resolveAccessForUser`:1514 | 조직 전체 행을 읽어 사람별로 판정한다. 역할 분기는 `effectivePermission`과 같다(1619-1648) | D6-01과 같은 분기를 넣는다. 접근 요약과 Members 화면이 이 함수를 쓴다 | `T/resolver-prefetch-drift.test.ts` "index resolve agrees for guest" |
| D6-05 | `M/032_member_access_defaults.sql:33-70` trigger | owner를 뺀 모든 새 member에 snapshot을 쓴다(43). **재현 P4** | migration에서 trigger 함수를 다시 만들어 guest를 제외한다. member→guest 강등 때 snapshot을 지운다 | `T/guest-migration.test.ts` "inserting a guest member writes no join snapshot" |

### 4.2 읽기 가능 목록과 폴더 트리

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-06 | `S/permissions/vault-docs.ts` `vaultAccess`:50 | `role !== null`이면 조직 vault 공유로 `vaultWide`가 된다(73) | guest는 `vaultWide=false`, 개인 vault 행도 무시한다 | `T/guest-listings.test.ts` "guest is never vault-wide" |
| D6-07 | 같은 파일 `listDocsInVault`:266 (`listReadableDocsInVault`:543, `listDeletedReadableDocsInVault`:579) | `isMember = role !== null`(297)로 만든 사람 분기와 조직 분기를 연다(409). snapshot을 합친다(462) | guest는 `isMember=false`, `creatorCounts=false`, snapshot 없음으로 판정한다. 휴지통 쪽도 같다 | 같은 파일 "readable set equals resolver for every doc (guest)", "deleted readable set for guest only covers shared scope" |
| D6-08 | 같은 파일 `listVisibleFolders`:610 | 보이는 항목의 **조상 폴더를 이름째 넣는다**(주석 604-608, 쿼리 705-711) | guest에게는 조상을 넣지 않는다. 공유된 폴더를 진입점으로 준다. 경로 표현은 §10 Q3을 따른다 | 같은 파일 "guest folder tree omits ancestor names" |
| D6-09 | `S/permissions/readable-cache.ts` (TTL 10초, 36) | Activity의 휴지통·shrink 목록에만 쓴다. 무효화는 이 인스턴스에서만 한다(112) | 바꿀 것은 없다. 다만 게스트 회수 테스트에서 이 캐시를 켜고 확인한다 | `T/guest-revocation.test.ts` "revoked guest share disappears from activity listings within TTL" |

### 4.3 HTTP gate

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-10 | `S/permissions/http-gates.ts` `canEditFolder`:106 | 비멤버는 거부한다(138). 그 밖에는 owner/admin(187), 만든 사람(188), snapshot·posture를 본다 | guest는 개인 폴더 공유만 본다. 만든 사람 분기는 없다 | `T/guest-http-gates.test.ts` "guest edits only per-user shared folders" |
| D6-11 | 같은 파일 `canCreateIn`:393, `vaultRootWritable`:430 | 루트는 member면 되고(405), posture가 view나 sealed가 아니면 쓸 수 있다(446) | guest는 루트에 쓸 수 없다. `GET /notes`의 `canCreateRoot`도 guest에게 false다 | 같은 파일 "guest cannot create at the vault root" |
| D6-12 | 같은 파일 `canDeleteItem`:616 | owner/admin(630), 그 밖에는 만든 사람만(633-673) | guest는 만든 사람이면서 편집 공유 범위일 때만 지울 수 있다 | 같은 파일 "guest deletes only own items inside scope" |
| D6-13 | 같은 파일 `canWriteAttachment`:478, `editsSomethingInVault`:505 | 멤버면서 루트에 쓸 수 있거나 vault 안 어딘가를 편집할 수 있으면 첨부를 쓸 수 있다. 조직 편집 공유도 센다(518) | guest는 대상 노트나 폴더의 편집 권한으로만 판정한다 | `T/guest-blobs.test.ts` "guest uploads only to notes it can edit" |

### 4.4 문서 동기화 (Hocuspocus)

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-14 | `S/http/routes/sync-token.ts` `POST /sync-token`:78 | **멤버 검사 없이** `syncPermission`만 본다(105-109). **재현 P1, P3** | R1을 먼저 확인한다. 활성 관계가 없으면 403 | `T/guest-sync.test.ts` "external with a per-user share cannot mint a sync token", "removed creator cannot regain a token by self-sharing" |
| D6-15 | `S/sync/hocuspocus.ts` `onAuthenticate`:228 | 토큰을 검증하고 DB의 `syncPermission`으로 다시 판정한다(274-294). 판정을 못 하면 닫는다(288) | resolver를 고치면 함께 따라온다. 연결 뒤 재검사는 없고, 회수는 소켓을 닫아 처리한다(440-493) | 같은 파일 "guest edit socket is rejected after share revoke" |
| D6-16 | `S/trash/access.ts` `syncPermission`:36, `trashedNotePermission`:49 | 살아 있는 문서의 판정이 `none`이고 보존 기간 안이면 삭제된 문서로 다시 판정한다(43-45) | resolver를 따른다 | `T/guest-history-trash.test.ts` "guest can push into a trashed shared note within the window only" |
| D6-17 | 소켓 종료 `disconnectDoc`(`S/index.ts:320`) | **이 인스턴스의 Hocuspocus만** 닫는다. Redis 확장(`S/sync/redis-extension.ts:15-26`)이 다른 인스턴스의 연결까지 닫는지는 **미검증** | 다중 인스턴스에서 회수를 전파한다. pubsub으로 "문서 연결 종료"를 알리거나, 연결마다 짧은 주기로 다시 판정한다(§9 A1-7) | `T/guest-revocation.test.ts` "share revoke closes sockets on every instance" (두 인스턴스 하네스 필요) |

### 4.5 vault 채널 (`S/sync/vault-channel.ts`, `D/lib/sync/vaultProtocol.ts`)

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-18 | `S/http/routes/vault-token.ts`:15-38 | member 행이 있으면 발급한다(33-34). TTL 600초(`S/config.ts:83`) | guest 발급을 허용한다. 접속 후 판정은 readable set이 맡는다 | `T/guest-vault-channel.test.ts` "guest receives only shared docs in ready/empty/behind/tombstones" |
| D6-19 | `onText`:604 → readable set(636), `ready` 프레임(762-776) | JWT만 검증하고 readable set으로 거른다 | D6-07이 맞으면 따라온다. `covered`·`tombstones`도 같은 집합에서 나온다 | 같은 파일 "guest tombstones never name out-of-scope docs" |
| D6-20 | `onPubsub` `member-joined`:1132-1137 | 이름(없으면 이메일, `S/auth/auth.ts:408`, `S/http/routes/orgs.ts:616`)을 **모든 구독자에게** 보낸다 | guest 연결에는 보내지 않는다. guest가 합류할 때는 팀에게 "게스트 1명 합류"로 보낸다(이름 표시 여부는 §10 Q5) | 같은 파일 "guest connection never receives member names" |
| D6-21 | `org-changed`:1138, `appearance-changed`:1143 | vault 이름과 모양을 모두에게 보낸다 | guest에게는 표시 이름만 보낸다(§10 Q4) | 같은 파일 "guest receives vault display name only" |
| D6-22 | `presence`:1148-1154, 연결 종료 broadcast(1516-1522) | `docId === null`이면 항상 통과한다. 프레임에 `userId`, `name`, `color`, `status`가 있다(`S/sync/vault-protocol.ts:94-97`) | guest에게는 공유 범위 문서의 presence만 보낸다. 이름은 R4에 따라 바꾼다. `docId: null` 프레임은 guest가 이미 본 사용자에 대해서만 보낸다 | 같은 파일 "guest presence frames are scoped and anonymized" |
| D6-23 | `voice`:1158-1180 | 팀 전체에 보내고, 첫 조각에 말한 사람 이름을 싣는다(925) | guest에게는 보내지 않고, guest는 보낼 수도 없다 | 같은 파일 "voice never reaches or comes from a guest" |
| D6-24 | `acl-changed` → `refreshAcl`:1195-1274 | 빠진 문서에 `revoked`/`drop`, `reauth`, 25개 이상 늘면 `bootstrap`을 보낸다 | 바꿀 것은 없다. guest 회수 경로에서 확인한다 | `T/guest-revocation.test.ts` "guest share revoke emits revoked for exactly the lost docs" |

### 4.6 bootstrap과 registry

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-25 | `S/http/routes/bootstrap.ts` gate:36-45 → `S/yjs/bootstrap.ts` `createBootstrapSession`:97 | readable set을 **세션을 만들 때 한 번만** 계산한다(108). 세션은 24시간 유지된다(`S/config.ts:280`). 페이지를 읽을 때 권한을 다시 보지 않는다(242-250). 경로(`relPath`, 314)에 폴더 이름이 들어간다 | 페이지마다 readable set과 교집합을 구한다. 회수 때 그 사용자의 bootstrap 세션을 지운다. guest 경로 표현은 §10 Q3 | `T/guest-sync.test.ts` "bootstrap pages drop docs revoked mid-session" |
| D6-26 | `S/http/routes/registry.ts` `GET /vaults`:314-326 | member 행만 조인해 조직의 **모든 note collection 이름**을 준다 | guest에게는 공유 범위가 있는 collection만 주고, 이름은 §10 Q4를 따른다 | `T/guest-listings.test.ts` "GET /vaults hides collections without guest scope" |
| D6-27 | 같은 파일 `GET /folders`:637, `GET /files`:699, `GET /notes`:951 | 각각 `listVisibleFolders`와 readable set으로 거른다. `/notes`는 `created_by`와 `last_edited_by_name`을 준다(973-975) | guest에게는 다른 사람의 ID와 이름을 가린다 | 같은 파일 "notes listing redacts other people for guest" |
| D6-28 | 같은 파일 `POST /folders`:591, `POST /notes`:877, `POST /files`:1192 → `canCreateIn` | 같은 경로에 이미 있으면 그 항목을 쓴다(adopt). 읽을 수 없으면 `NOT_READABLE` 409를 낸다(`S/registry/batch-ops.ts:191`). 이 409로 그 경로에 무언가 있다는 사실이 드러난다 | 이 동작은 member에게도 같으므로 유지한다. guest는 편집 공유 범위 밖에서 만들 수 없어 범위 밖 경로를 탐색하지 못한다 | `T/registry-not-readable.test.ts`에 guest 사례를 추가한다 |
| D6-29 | 같은 파일 `access-tree`:375, `access-board`:397, `PATCH /vaults/:id`:335 | owner/admin만 쓸 수 있다 | 바꿀 것은 없다(guest ⛔) | `T/guest-http-gates.test.ts` "guest is refused every management route" (표 방식으로 경로 전체를 돈다) |
| D6-30 | `S/http/routes/bulk.ts` gate:142, 각 batch 경로 | member면 들어간다(150-151). 이후 경로마다 판정한다. `notes/delete-batch`는 관리자가 아니면 만든 사람만 지운다(861) | 개별 판정을 따른다. 지우기는 D6-12를 따른다 | `T/guest-http-gates.test.ts` "bulk batches agree with single-item gates for guest" |

### 4.7 첨부 (`S/http/routes/blobs.ts`)

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-31 | `S/permissions/http-gates.ts` `canReadAttachment`:250, `filterReadableBlobs`:296 | 트리 파일은 resolver로 판정한다(257-258). 그 밖에는 vault 전체 읽기면 통과하고(262), 아니면 읽을 수 있는 노트가 참조할 때 통과한다(265-274) | guest는 vault 전체 읽기 경로가 없다(D6-06). 참조하는 노트로만 판정한다 | `T/guest-blobs.test.ts` "guest reads only attachments of shared notes", "orphan attachments are invisible to guest" |
| D6-32 | `authorizeDownload`:1936 (`GET /blobs/:id`, `/url`, `HEAD`) | member 확인(1959) 뒤 `canReadAttachment`(1970)로 판정한다 | 바꿀 것은 없다. 발급된 S3 URL은 TTL 동안 유효하다(`S/blobs/s3-store.ts:170-189`) | 같은 파일 "revoked guest is refused new download URLs" |
| D6-33 | `canWriteBlob`(`http-gates.ts:560`): 업로드(414), intent(936), complete(1561), text(1733), delete(2128) | 트리 파일은 편집 권한, 그 밖에는 `canWriteAttachment`로 판정한다 | D6-13을 따른다. 삭제할 때의 409 응답 `referencedBy`(`S/blobs/refs.ts:182`)를 guest의 읽기 가능 문서로 거른다 | 같은 파일 "delete conflict lists only readable referrers for guest" |
| D6-34 | `GET /vaults/:id/storage`:2227, `GET /vaults/:id/file-tombstones`:1853 | member면 볼 수 있다 | storage는 guest ⛔. file-tombstones는 readable set으로 거른다 | `T/guest-listings.test.ts` "guest cannot read vault storage usage" |

### 4.8 MCP

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-35 | `S/http/routes/mcp.ts` `POST /mcp/tokens`:277 | member면 기본 scope로 발급한다(282-285). `access:manage`는 owner/admin만 받는다(289) | A1에서 guest는 403이다(§10 Q7) | `T/guest-mcp.test.ts` "guest cannot mint an MCP token" |
| D6-36 | `S/mcp/tokens.ts` `verifyMcpToken`:148 | 요청마다 멤버십을 다시 확인한다(168-169). 역할에 맞지 않는 `access:manage`를 뺀다(180) | member→guest로 강등되면 토큰을 거부한다(guest MCP를 허용하지 않는 동안) | 같은 파일 "token of a member demoted to guest stops working" |
| D6-37 | `S/mcp/oauth.ts` `resolveOAuthMcpAuth`:80, `S/http/routes/oauth-connect.ts` consent:139-253 | 동의 화면이 사용자가 속한 조직 이름과 역할을 모두 보여 준다(170-176) | guest 조직은 연결 대상에서 뺀다 | 같은 파일 "OAuth consent does not offer guest vaults" |
| D6-38 | `S/mcp/service.ts` `listVaults`:281, `listFolders`:289 | 조직의 모든 collection과 폴더를 **권한으로 거르지 않고** 준다 | guest를 허용하게 되면 readable set과 visible folders로 거른다. member의 `listFolders`가 비공개 폴더 이름을 주는 현재 동작은 §5 M6에 적는다 | `T/mcp-access-surface.test.ts`에 사례를 추가한다 |
| D6-39 | 같은 파일 `createFolder`:332 adopt(359-368), `createNote`:668 adopt(702-737) | 편집할 수 있는 부모 아래에서는 같은 경로의 기존 항목 ID, 이름, 경로를 **읽기 권한을 확인하지 않고** 돌려준다 | HTTP처럼 읽을 수 없으면 `NOT_READABLE`로 바꾼다(§5 M5) | `T/mcp.test.ts` "create_note adopt refuses an unreadable existing note" |
| D6-40 | 같은 파일 접근 관리 도구(140-214) | `requireAccessManager`로 owner/admin만 쓸 수 있다 | 바꿀 것은 없다 | — |

### 4.9 멤버, 초대, 합류

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-41 | `S/http/routes/members.ts` `GET /orgs/:orgId/members/overview`:79 | member면 볼 수 있다(85-86). 모든 사람의 이름·이메일·사진·역할·마지막 접속·초대한 사람과 **대기 중 초대 이메일**을 준다(100-121, 161-182) | guest에게는 자기 행만 준다 | `T/guest-membership.test.ts` "guest overview shows only self" |
| D6-42 | 같은 파일 `GET /orgs/:orgId/members/:userId/activity`:240 | 자기 자신이거나 owner/admin이면 볼 수 있다(246-251). 문서는 readable set으로 거르지만, `by`에 권한을 준 사람의 이름과 이메일이 들어간다(338) | guest에게는 `by`를 가린다 | 같은 파일 "guest activity hides granters" |
| D6-43 | 같은 파일 `POST /orgs/:orgId/invitations`:403 | owner/admin만 쓸 수 있다(408-411). 역할은 member/admin만 받는다(425-428). `access`(open/readonly/private)를 `invitation_access`에 저장한다 | `role: "guest"`를 받는다. guest 초대에는 공유 대상(폴더·노트 ID와 view/edit)을 함께 받고, `access`는 받지 않는다. 외부 공유 정책을 확인한다 | `T/guest-membership.test.ts` "admin invites a guest with explicit targets", "guest invite rejects vault-wide access modes", "policy off refuses guest invites" |
| D6-44 | `S/members/invitation-access.ts` `applyInvitationAccess`:30 | 수락할 때 vault 전체 개인 수준(open/readonly/private)을 bulk access로 적용한다 | guest 초대는 이 경로를 쓰지 않고, 초대에 저장한 개인 폴더·노트 공유를 적용한다 | 같은 파일 "accepting a guest invite writes only its item shares" |
| D6-45 | `S/auth/auth.ts` Better Auth `organization`:246 (hook 325-418) | 역할 목록이 기본값(owner/admin/member)이다. Better Auth 1.6.23은 정의되지 않은 역할로 초대하면 `ROLE_NOT_FOUND`로 거부한다(`better-auth/dist/plugins/organization/routes/crud-invites.mjs:101-122`) | `roles`에 guest를 정의하고 권한을 비운다(초대·멤버·조직 수정 없음). `beforeCreateInvitation`에서 guest 초대에 외부 공유 정책과 도메인 검사를 적용한다 | `T/guest-membership.test.ts` "Better Auth invite-member accepts guest only for owner/admin" |
| D6-46 | `/api/auth/*` 전체 위임(`S/http/app.ts:322`) | Better Auth의 `list-members`, `get-full-organization`, `list-invitations`, `leave`, `remove-member` 등이 그대로 열려 있다. 각 엔드포인트의 역할 제한은 **미검증**이다 | guest의 `list-members`와 `get-full-organization`을 막거나 결과를 줄인다(app.ts에서 경로별로 가로챈다). `leave`가 `revokeMembership`의 정리(공유 행 삭제, 소켓 종료)를 거치는지도 확인한다 | 같은 파일 "Better Auth org endpoints never list members to a guest" |
| D6-47 | `S/http/routes/orgs.ts` `POST /orgs/join`:523 | 이미 멤버면 아무것도 하지 않는다(540-542). 살아 있는 초대가 있으면 admin 외에는 모두 member가 된다(559-560) | 살아 있는 guest 초대가 있으면 거부하고 초대 링크로 안내한다(`guest_invite_pending`). 만료와 시도 제한은 §9 A1-4 | `T/join-code-lifecycle.test.ts` "a pending guest invite cannot be redeemed through the join code" |
| D6-48 | 같은 파일 `PATCH /orgs/:orgId/members/:userId`:929 | owner/admin만 바꿀 수 있고, 역할은 member/admin만 받는다(956). 바꾼 뒤 소켓을 닫는다 | guest↔member 전환을 받는다(§10 Q8). 강등할 때 snapshot과 개인 vault 수준 행을 지우고, 조직 단위로 받던 권한이 사라진다는 확인 문구를 보여 준다 | `T/guest-membership.test.ts` "demoting to guest drops snapshot and personal vault level" |
| D6-49 | `S/permissions/access-management.ts` `canManageMemberAccess`:58 | admin은 member/admin/자기 자신만 관리할 수 있다(64) | admin도 guest를 관리할 수 있게 한다 | `T/member-access-manager.test.ts`에 guest 사례를 추가한다 |
| D6-50 | `S/http/routes/invitations.ts` `GET /invitations/:id/preview`:114 | **인증이 없다.** 초대받는 사람 이메일, 조직 이름, 초대한 사람 이름을 준다(`S/registry/invitations.ts:69-82`) | guest 초대도 같은 형식을 쓴다. vault 이름 노출은 §10 Q4 | `T/invitations.test.ts`에 guest 사례를 추가한다 |

### 4.10 공유와 공개 링크

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-51 | `S/http/routes/shares.ts` `canManage`:242 | owner/admin이거나 리소스를 만든 사람이면 통과한다. 만든 사람 경로에 멤버 확인이 없다(263-267). **재현 P3** | 만든 사람 경로는 팀 역할(R2)일 때만 연다. guest는 항상 거부한다 | `T/guest-shares.test.ts` "guest creator cannot manage shares", "removed creator cannot manage shares" |
| D6-52 | 같은 파일 `POST /shares`:472 | 대상 사용자의 멤버십을 확인하지 않는다. admin이 owner를 대상으로 할 때만 막는다(530-540). **재현 P2** | §7의 V1~V8 | `T/shares-target-validation.test.ts` (§7.2) |
| D6-53 | 같은 파일 `GET /resolve-access`:966 | `canManage`를 통과하면 모든 멤버의 이름·이메일·권한을 준다(982-1006) | D6-51로 guest를 막는다. 목록에 guest를 "게스트"로 표시한다 | `T/guest-shares.test.ts` "resolve-access lists guests with their scope" |
| D6-54 | 같은 파일 `GET /vaults/:vaultId/locks`:674 | member면 볼 수 있다(686). 조직 행은 모두 주고, 개인 행은 자기 것만 준다 | guest에게는 공유 범위의 lock과 deny만 준다(범위 밖 폴더 ID를 드러내지 않는다) | `T/guest-listings.test.ts` "locks endpoint is scoped for guest" |
| D6-55 | 같은 파일 접근 요약 `prepareSummary`:367 | 선택한 사람이 멤버여야 하고, 리소스는 같은 조직이어야 한다(395-404) | guest도 멤버로 센다. 요약에 guest 권한을 R3으로 보여 준다 | `T/access-board.test.ts`에 guest 사례를 추가한다 |
| D6-56 | `S/http/routes/public-links.ts` `gate`:106 | owner/admin이거나 만든 사람이고, 판정 결과가 `none`이 아니면 통과한다(115-121). 만든 사람 경로에 멤버 확인이 없다 | guest ⛔, 정책이 `domains`나 `off`이면 ⛔. 정책을 `off`로 바꿀 때 기존 링크 처리는 §10 Q9 | `T/guest-public-links.test.ts` "guest cannot mint a public link", "domains policy refuses anonymous links" |

### 4.11 검색, 그래프, 버전, 휴지통, 체크포인트

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-57 | `S/http/routes/graph.ts` `gateVaultMember`:27, `/graph`:43, `/search`:108 | member면 들어간다(33). readable set과 `vaultWideReader`로 거른다(64-65, 124-139) | D6-06/07을 따른다. 링크 대상 제목(존재하지 않는 노트 제목)도 guest의 공유 범위 노트에서 나온 것만 준다 | `T/guest-listings.test.ts` "graph and search never surface out-of-scope titles or snippets" |
| D6-58 | `S/http/routes/versions.ts` 목록:140, 내용:163 | 읽기 권한으로 판정하고 `author_name`을 준다(150-153, 177) | guest에게는 작성자 이름을 가린다(§10 Q5) | `T/guest-history-trash.test.ts` "versions redact other authors for guest" |
| D6-59 | 같은 파일 `GET /vaults/:vaultId/checkpoints`:400 | member면 볼 수 있다(404-407). 작성자 이름, 라벨, 노트 수를 준다(`S/versions/checkpoints.ts:626`) | guest ⛔ | 같은 파일 "guest cannot list vault checkpoints" |
| D6-60 | `S/trash/service.ts` `listTrash`:50, `restoreNote`:222, `ensureFolderChain`:181 | 읽을 수 있었던 것만 보여 주고, `deleted_by_name`을 준다(85-88). 복원할 때 없는 부모 폴더를 복원하는 사람 이름으로 다시 만든다 | 이름을 가린다. guest가 범위 밖 폴더를 다시 만들게 하지 않는다(범위 밖이면 409) | 같은 파일 "guest restore never recreates folders outside scope" |
| D6-61 | `S/http/routes/versions.ts` `shrink-events`:322 | member면 들어가고 읽을 수 있는 것으로 거른다(328, 349-353) | readable set을 따른다 | 같은 파일 "shrink events are scoped for guest" |
| D6-62 | `S/ai-changes/service.ts` `requireVault`:36, `getAiChange`:43 | member 확인 뒤 휴지통을 포함한 문서 읽기 권한으로 판정한다 | resolver를 따른다 | `T/ai-changes.test.ts`에 guest 사례를 추가한다 |

### 4.12 캐시, 다중 인스턴스, 요금

| # | 경로 | 현재 판정 | 바꿀 점 | 테스트 |
|---|---|---|---|---|
| D6-63 | `S/sync/pubsub.ts` (Redis가 있으면 Redis, 없으면 메모리, 32, 73) | `acl-changed`와 `member-removed`는 모든 인스턴스의 vault 채널에 간다 | 감사 로그 기록과 회수 신호를 같은 commit 뒤에 보낸다. 일괄 회수(A1-7)는 진행 상태를 남긴다 | `T/guest-revocation.test.ts` "bulk external revoke reaches every instance" |
| D6-64 | 결제 좌석 계산(`S/billing/plan.ts:222, 271`, `S/billing/entitlements.ts:156`) | `member` 행을 모두 센다. guest도 좌석으로 셀 것이다 | guest를 좌석에 셀지 정한다(§10 Q10) | `T/guest-billing.test.ts` (결정 후) |

## 5. 현재 코드와 기대 표의 불일치

### 5.1 게스트와 무관하게 지금 존재하는 결함

| ID | 심각도 | 내용 | 근거 | 처리 |
|---|---|---|---|---|
| M1 | 높음 | 제거된 멤버가 자기가 만든 노트에 자기 공유를 만들고 편집 sync 토큰을 다시 받는다 | 재현 P3. `S/http/routes/shares.ts:263-267`, `S/http/routes/sync-token.ts:105-109`, `S/permissions/resolver.ts:910-912` | A1-1에서 고친다 |
| M2 | 높음 | member 행이 없는 사용자도 개인 공유만 있으면 문서 sync 토큰을 받는다. vault 채널 토큰은 거부되므로 두 경로가 서로 다르다 | 재현 P1. `S/http/routes/sync-token.ts:78-111` vs `S/http/routes/vault-token.ts:33-34` | A1-1에서 R1을 적용한다. 이미 저장된 행의 처리는 §10 Q1 |
| M3 | 중간 | `POST /shares`가 비멤버와 존재하지 않는 사용자 ID에도 공유를 저장한다 | 재현 P2. `S/http/routes/shares.ts:523-597` | A1-2 |
| M4 | 중간 | 공개 링크 gate의 만든 사람 경로에 멤버 확인이 없다. M1과 겹치면 제거된 작성자가 공개 링크를 만들 수 있다(코드에서 추론, **미검증**) | `S/http/routes/public-links.ts:115-121` | A1-1 |
| M5 | 중간 | MCP `create_note`와 `create_folder`의 adopt 경로가 읽을 수 없는 기존 항목의 ID, 이름, 경로를 돌려준다. HTTP는 `NOT_READABLE`로 거부한다 | `S/mcp/service.ts:359-368, 702-737` vs `S/registry/batch-ops.ts:191` | A1-1 |
| M6 | 중간 | MCP `list_folders`가 권한으로 거르지 않고 모든 폴더 이름과 경로를 준다. 비공개 폴더 이름이 member에게 보인다 | `S/mcp/service.ts:289-300` | A1-1 |
| M7 | 중간 | bootstrap 세션이 만들 때의 readable set으로 24시간 동안 페이지를 준다. 회수가 반영되지 않는다 | `S/yjs/bootstrap.ts:108, 242-250`, `S/config.ts:280` | A1-5(게스트)에서 고치고, member에게도 같이 적용한다 |
| M8 | 확인 필요 | 공유 회수 때 Hocuspocus 소켓을 이 인스턴스에서만 닫는다. 다른 인스턴스의 연결이 닫히는지 **미검증**이다 | `S/index.ts:320`, `S/sync/redis-extension.ts:15-26` | A1-7에서 검증하고 고친다 |
| M9 | 확인 필요 | Better Auth 자체 조직 엔드포인트가 모두 열려 있다. `leave`가 우리 쪽 정리(`revokeMembership`)를 거치지 않을 수 있다(**미검증**) | `S/http/app.ts:322`, `S/http/routes/orgs.ts:142-201` | A1-5에서 검증한다 |

### 5.2 게스트를 도입하면 생기는 불일치 (지금 코드에 guest 행을 넣었을 때)

| ID | 기대(§3) | 현재 코드가 주는 것 | 근거 | 경로 |
|---|---|---|---|---|
| G1 | snapshot 없음 | 조직 `join_default`로 snapshot이 생긴다. `open`이면 가입 전 내용 전체를 편집할 수 있다 | 재현 P4. `M/032_member_access_defaults.sql:43` | D6-05 |
| G2 | 조직 공유 없음 | `role !== null`이라 조직 vault 공유와 조직 항목 공유를 받는다 | `S/permissions/resolver.ts:918-924, 1394`, `S/permissions/vault-docs.ts:73, 297` | D6-01, 02, 06, 07 |
| G3 | 만든 사람 규칙 없음 | 자기가 만든 노트를 범위 밖으로 옮겨도 편집할 수 있다 | `S/permissions/resolver.ts:1386-1392`, `S/permissions/vault-docs.ts:409`, `S/permissions/http-gates.ts:188` | D6-01, 07, 10 |
| G4 | 루트 쓰기 없음 | Shared이거나 한 번도 공유하지 않은 vault의 루트에 쓸 수 있다 | `S/permissions/http-gates.ts:405, 446` | D6-11 |
| G5 | 범위 밖 첨부 없음 | vault 전체 읽기로 모든 첨부(주인 없는 첨부 포함)를 읽는다 | `S/permissions/http-gates.ts:262` | D6-31 |
| G6 | 조상 폴더 이름 없음 | 트리와 경로에 조상 폴더 이름이 들어간다 | `S/permissions/vault-docs.ts:604-608`, `S/yjs/bootstrap.ts:314` | D6-08, 25 |
| G7 | 다른 사람 정보 없음 | Members 화면, 활동의 `by`, 노트 목록의 `last_edited_by_name`, 버전의 `author_name`, 휴지통의 `deleted_by_name`, 체크포인트, vault 채널의 member·presence·voice에서 이름과 이메일을 받는다 | D6-20~23, 27, 41, 42, 58~60의 근거 | 각 경로 |
| G8 | 다른 collection 이름 없음 | `GET /vaults`와 MCP `list_vaults`가 조직의 모든 collection 이름을 준다 | `S/http/routes/registry.ts:314-326`, `S/mcp/service.ts:281-287` | D6-26, 38 |
| G9 | 관리 기능 없음 | 자기가 만든 항목의 공유를 관리하고, `/resolve-access`로 전원의 이름과 이메일을 받고, 공개 링크를 만든다 | `S/http/routes/shares.ts:263-267, 982-1006`, `S/http/routes/public-links.ts:115-117` | D6-51, 53, 56 |
| G10 | MCP 없음(A1) | 기본 scope로 MCP 토큰을 받는다 | `S/http/routes/mcp.ts:282-289` | D6-35 |
| G11 | 참가 코드로 승격 없음 | 살아 있는 guest 초대가 있는 사람이 코드를 쓰면 member가 된다 | `S/http/routes/orgs.ts:559-560` | D6-47 |
| G12 | admin이 guest를 관리 | admin은 guest의 접근을 바꿀 수 없다(owner만 가능) | `S/permissions/access-management.ts:64` | D6-49 |
| G13 | guest 초대 가능 | 우리 API(425-428)와 Better Auth(`ROLE_NOT_FOUND`) 모두 guest 역할을 거부한다 | D6-43, 45의 근거 | D6-43, 45 |
| G14 | vault 통계 없음 | 저장 공간 사용량과 체크포인트 노트 수를 받는다 | `S/http/routes/blobs.ts:2227-2236`, `S/http/routes/versions.ts:404-407` | D6-34, 59 |
| G15 | 좌석 정책에 따름 | 좌석으로 센다 | `S/billing/plan.ts:222, 271` | D6-64 |

## 6. 기존 데이터 migration 기본값 [PRD F2, #22]

### 6.1 원칙
- **기존 행의 역할은 하나도 바꾸지 않는다.** migration이 끝난 직후 모든 vault의 guest 수는 0이다.
- 기존 (사용자, 문서) 쌍의 판정 결과는 바뀌지 않는다. 예외는 §5.1의 결함을 고친 부분(M1, M2)이며, 이 차이는 의도한 변경으로 테스트에 고정한다.
- 기존 행은 지우지 않는다. 쓸모없어진 행도 남기고, 개수를 감사 로그에 기록한다(삭제·회수·복구 가드를 지킨다).

### 6.2 항목별 기본값

| 대상 | migration 후 상태 | 근거·이유 |
|---|---|---|
| `member.role` (owner/admin/member) | 그대로다 | 컬럼에 CHECK가 없다(`M/001_better_auth.sql:16`). guest 추가에 스키마 변경이 필요 없다 |
| `member_access_snapshots` | 그대로다. trigger 함수만 교체해 **새로 들어오는 guest**를 제외한다 | `M/032_member_access_defaults.sql:43`. 기존 snapshot은 기존 member의 권한 근거다 |
| `organization_access_settings.join_default` | 그대로다 | guest에게는 적용하지 않는다(R2) |
| `shares` (활성 관계가 있는 사람의 행) | 그대로다 | 판정 결과가 같다 |
| `shares` (활성 관계가 없는 사람의 개인 행) | **지우지 않는다.** migration이 개수를 조직별로 감사 로그(`action='migration.orphan_user_shares'`)에 남긴다. R1이 들어가면 이 행은 권한을 주지 않는다 | 재현 P1, P2. 처리 방식은 §10 Q1 |
| `invitation` (대기 중) | 그대로다. `role`이 null이면 지금처럼 member로 본다 | `S/registry/invitations.ts:73` |
| `invitation_access` | 그대로다. guest 초대에는 만들지 않는다 | D6-44 |
| `org_join_codes` | 코드는 그대로 둔다. `expires_at`은 **배포 시점 + 30일**로 채운다. 관리자 화면에 만료일을 보여 준다 | 지금은 만료가 없다(`M/005_join_codes_and_index.sql`, `S/http/routes/orgs.ts:523-542`). 바로 막으면 쓰고 있던 팀의 합류가 끊긴다. 값은 §10 Q2 |
| 외부 공유 정책(신규) | 기존 vault와 새 vault 모두 `on` | 지금 동작과 같다(공개 링크 허용, guest 없음). 값은 §10 Q12 |
| `audit_log`(신규) | 빈 상태로 시작한다. 과거 기록을 채우지 않는다 | 기존 기록(AI 변경, 버전 작성자, 멤버 활동)은 제자리에 남는다(§9 A1-3) |
| `mcp_tokens`, `public_links` | 그대로다 | guest가 없으므로 영향이 없다 |

### 6.3 호환성과 롤백
- **롤백 순서가 중요하다.** 구버전 서버는 guest 행을 member로 판정한다(§5.2 G1~G15). 서버를 되돌리기 전에 guest 멤버를 모두 제거해야 한다(A1-7 일괄 회수로 할 수 있다). 운영 문서(`docs/DEPLOY.md`)에 이 순서를 적는다.
- migration은 앞으로만 진행한다. trigger를 되돌릴 때도 새 migration으로 원래 함수를 다시 만든다.
- 구버전 데스크톱이 `role: "guest"`를 받으면 member처럼 보여 줄 수 있다. 서버가 거부하므로 권한이 새지는 않지만, 버튼이 실패로 끝나는 화면이 생긴다. 최소 클라이언트 버전 처리(`S/http/client-version.ts`)로 guest 계정에 업데이트를 요구할지는 A1-5에서 정한다(**미검증**: 구버전 데스크톱의 역할 문자열 처리).

### 6.4 migration 테스트 (`T/guest-migration.test.ts`)
- "existing owner/admin/member permissions are unchanged across 061-065": 고정 시나리오 전체의 판정을 migration 전후로 비교한다.
- "join snapshot rows are untouched and new members still get one"
- "a guest insert writes no join snapshot"
- "pending invitations keep their role and access mode"
- "seeded join code expiry is deployment time plus 30 days and the code still redeems"
- "orphan per-user shares are kept and counted in the audit log"
- 기존 `T/renumbered-migrations.test.ts`, `T/join-default-seed.test.ts`, `T/member-access-defaults.test.ts`가 계속 통과해야 한다.

## 7. `POST /shares` 대상 검증 규칙 [PRD F2, F01]

### 7.1 규칙

| ID | 규칙 | 실패 응답 |
|---|---|---|
| V1 | 호출자는 `canManage`를 통과해야 한다. 만든 사람 경로는 **팀 역할**일 때만 연다(A1-1). guest는 항상 실패한다 | 403 `Not allowed to manage shares here`(현행 문구) |
| V2 | `principalType='user'`면 `principalId`가 **리소스가 속한 조직**(`gate.organizationId`)에 활성 관계(owner/admin/member/guest)로 있어야 한다. `view`, `edit`, `locked`, `denied` 모두에 적용한다 | 400 `share_target_not_member` |
| V3 | 대상이 guest면 `resourceType`은 `folder`나 `file`이어야 한다. 개인 vault 수준(`vault`)은 만들 수 없다 | 400 `guest_vault_level_not_allowed` |
| V4 | 대상이 guest면 현재 외부 공유 정책을 다시 확인한다. `off`면 거부하고, `domains`면 guest 이메일 도메인이 허용 목록에 있어야 한다 | 403 `external_sharing_blocked` |
| V5 | guest를 대상으로 공유할 수 있는 사람은 owner/admin이다. 만든 사람인 member가 guest에게 공유할 수 있는지는 §10 Q13 | 403 `access_manager_required` |
| V6 | `principalType='org'`면 지금처럼 `principalId`를 조직 ID로 강제한다(`S/http/routes/shares.ts:523-524`). 조직 행은 guest에게 닿지 않는다(R2) | — |
| V7 | 멤버십 확인과 INSERT를 한 트랜잭션 안에서 한다. 대상 member 행은 `FOR SHARE`로 잠근다. 동시에 일어나는 제거(`revokeMembership`, `S/http/routes/orgs.ts:165-187`)와 순서가 정해져 주인 없는 행이 남지 않는다 | — |
| V8 | 같은 규칙을 모든 공유 쓰기 경로에 적용한다: `applyBulkAccess`(`S/permissions/access-management.ts:259`, 대상 검증은 157-182에 이미 있다), `PUT /orgs/:orgId/team-access`, guest 초대 수락 때 적용하는 항목 공유(D6-44), MCP 접근 관리 도구(`S/mcp/service.ts:140-214`) | 각 경로의 기존 오류 형식 |
| V9 | 허용한 쓰기와 거부한 쓰기를 모두 감사 로그에 남긴다(이전 권한, 이후 권한, 결과). A1-3 | — |

화면 문구는 PRD §0.1을 따른다. 예를 들어 V2는 "이 사람은 아직 이 vault에 들어오지 않았습니다. 먼저 초대해 주세요."로, V4는 "이 vault는 외부 사람과 공유할 수 없게 설정되어 있습니다. 관리자에게 문의하세요."로 쓴다.

### 7.2 테스트 (`T/shares-target-validation.test.ts`)
- "rejects a principal that is not a member of the resource's vault" (재현 P2를 회귀 테스트로 옮긴다)
- "rejects a principal id that does not exist"
- "rejects a member of a different vault even when the caller's active vault matches"
- "rejects a vault-level row for a guest"
- "re-checks the external sharing policy for guest targets"
- "a member creator cannot share with a guest unless allowed (Q13)"
- "removed creator cannot share at all" (재현 P3)
- "concurrent removal and share leave no orphan row"
- "bulk access, team-access and MCP access tools apply the same rules"
- "every accepted and refused share write is audited"

## 8. 메일 기능이 없는 자체 설치 환경 [PRD §9 A0, F02, S05]

### 8.1 현재 동작 (확인)
- `EMAIL_FROM`과 전송 수단이 없으면 메일이 꺼진다. 반쯤 설정한 경우에는 시작할 때 실패한다(`S/config.ts:165-179`, `S/email/mailer.ts:81`).
- 인증 메일 설정은 메일이 켜졌을 때만 들어간다(`S/auth/auth.ts:161-175`). `requireEmailVerification: false`(136)라서 비밀번호로 가입한 계정은 `emailVerified = false`로 남는다(189행 주석). Google 로그인은 확인된 이메일을 준다(`trustedProviders`).
- 초대는 만들어지지만 메일은 가지 않는다(`S/http/routes/members.ts:434, 456`). 데스크톱은 링크를 보여 준다(`D/components/InvitePeopleDialog.tsx:248-252`). `POST /invitations/:id/send`는 400 `email_not_configured`로 답한다(`S/http/routes/invitations.ts:70-75`).
- 비밀번호 재설정은 400으로 거부한다(`S/http/routes/password-reset.ts:62-68`).
- 초대 수락은 초대 이메일과 세션 이메일이 같은지만 본다(`S/http/routes/invitations.ts:31-32` 주석, Better Auth). 그래서 메일이 없으면 **초대 링크를 가진 사람은 누구나 그 이메일로 가입해 수락할 수 있다.**

### 8.2 기대 동작

| ID | 상황 | 동작 |
|---|---|---|
| E1 | guest 초대를 만들 때 | 링크와 QR을 보여 준다. 문구: "이 서버는 메일을 보내지 않습니다. 아래 링크를 초대할 사람에게 직접 전해 주세요. 링크를 가진 사람은 누구나 이 주소로 들어올 수 있으니 공개된 곳에 올리지 마세요." |
| E2 | guest 초대 만료 | 메일 유무와 관계없이 기존 초대 만료(기본 7일, `S/config.ts:97`)를 쓴다. 만료되거나 취소된 초대는 이유와 함께 거부한다(PRD F1 완료 기준) |
| E3 | guest가 수락했을 때 | A1에서는 승인 대기열 없이 바로 들어온다. Members 화면과 감사 로그에 "누가 어떤 초대로 들어왔는지"를 남기고, 바로 내보낼 수 있게 한다. A2의 승인 대기열이 생기면, 메일 없는 서버의 guest 수락에 승인을 기본으로 요구할 수 있다(§10 Q14) |
| E4 | 외부 공유 정책이 `domains`일 때 | **서버가 확인한 이메일(`emailVerified = true`)만** 인정한다(PRD F1.4). 메일이 없는 서버에서는 Google 로그인 계정만 이 조건을 통과한다. 그래서 설정 화면에 "이 서버는 메일 확인을 할 수 없어, 허용한 도메인의 Google 계정으로만 게스트가 들어올 수 있습니다."라고 알린다(§10 Q15) |
| E5 | 감사 로그, 일괄 회수 | 메일 없이도 그대로 동작한다. 나가기·제거 알림 메일은 보내지 않고 앱 안 알림만 쓴다 |
| E6 | guest가 비밀번호를 잊었을 때 | 재설정할 수 없다(현행). 관리자가 내보낸 뒤 다시 초대한다. 이 한계를 관리자용 도움말에 적는다 |
| E7 | 초대 미리보기 | 지금처럼 초대 ID만으로 열 수 있다. 보여 주는 정보는 §3.2 invite 표를 따른다 |

### 8.3 테스트 (`T/guest-no-email.test.ts`, 메일 끈 설정으로 실행)
- "guest invite without email returns a shareable link and emailed=false"
- "send endpoint answers email_not_configured for a guest invite"
- "domains policy refuses an unverified account"
- "domains policy accepts a verified account from an allowed domain"
- "expired guest invitation is refused with a reason"

## 9. A1 구현 작업 분해

### 9.1 의존 순서

```
A1-1 선행 보안 수정 ─┬─> A1-2 POST /shares 대상 검증 ─┐
                     └─> A1-3 감사 로그 최소판 ───────┼─> A1-4 참가 코드 만료·재발급
                                                      └─> A1-5 허브 게스트 ─> A1-6 외부 공유 정책 ─> A1-7 외부 접근 일괄 회수
```

- A1-1의 R1(관계 판정)은 §10 Q1이 결정된 뒤에 넣는다. 나머지 A1-1 수정은 결정 없이 진행할 수 있다.
- A1-3을 A1-4보다 먼저 하는 이유는, 그 뒤 조각들이 모두 감사 로그에 기록해야 하기 때문이다.
- migration 번호는 main의 061(`M/061_mcp_oauth_audience.sql`) 다음인 062부터 쓴다. 기존 계획의 061~065는 062~066으로 정정한다.

### 9.2 조각별 내용

**A1-1 선행 보안 수정 (migration 없음)**
- 변경 파일:
  - 신규 `S/permissions/roles.ts`: `isTeamRole`, `isActiveRole`, `isManagerRole`. `S/permissions/http-gates.ts:596`의 `isManagerRole`을 옮긴다.
  - `S/http/routes/shares.ts` `canManage`: 만든 사람 경로는 팀 역할일 때만 연다(M1).
  - `S/http/routes/public-links.ts` `gate`: 같은 규칙을 적용한다(M4).
  - `S/mcp/service.ts`: adopt 경로를 `NOT_READABLE`로 바꾸고(M5), `listFolders`를 `listVisibleFolders`로 거른다(M6).
  - (Q1 결정 후) `S/http/routes/sync-token.ts`, `S/permissions/resolver.ts`, `S/permissions/vault-docs.ts`에 R1을 넣는다(M2).
- 테스트:
  - `T/removed-creator-regrant.test.ts` "removed creator cannot manage shares", "removed creator cannot mint a public link"
  - `T/mcp.test.ts` "create_note adopt refuses an unreadable existing note", "list_folders hides private folders"
  - (Q1 후) `T/sync-token.test.ts` "external with a per-user share is refused". `T/vault-docs.test.ts:129-153`의 기대값을 결정에 맞게 바꾼다.
- commit:
  1. `refactor(server): centralize role predicates`
  2. `fix(server): require team membership for creator share management`
  3. `fix(server): refuse unreadable adopts and unfiltered folder lists over MCP`
  4. (Q1 후) `fix(server): require an active vault relation for every grant`

**A1-2 `POST /shares` 대상 검증 (migration 없음)**
- 2026-10-17 결정: V4의 off/domains 정책 재검사는 해당 스키마가 생기는 A1-6으로 옮긴다. 이 조각은 멤버십, guest 대상 제한, 트랜잭션 검증을 적용한다.
- 변경 파일: `S/http/routes/shares.ts`(§7 V1~V7), `S/permissions/access-management.ts`(V3/V4를 bulk access와 team-access에 적용), `S/mcp/service.ts`(V8). 데스크톱에서는 `D/components/` 공유 화면에 오류 문구를 연결한다.
- 테스트: §7.2 전체.
- commit:
  1. `fix(server): validate share targets against vault membership`
  2. `feat(desktop): explain refused share targets`

**A1-3 통합 감사 로그 최소판 (`M/062_audit_log.sql`)**
- 스키마: `audit_log(id bigserial, organization_id, actor_user_id, actor_kind('user'|'system'|'mcp'), action, target_type, target_id, before jsonb, after jsonb, result('ok'|'refused'|'failed'), request_id, created_at)`, 인덱스 `(organization_id, created_at DESC)`. 보존 기간은 `organization_access_settings.audit_retention_days`(기본값은 §10 Q11)로 둔다.
- 변경 파일:
  - 신규 `S/audit/log.ts`: `recordAudit(client, entry)`. 권한 변경과 같은 트랜잭션 안에서 부른다. AI 변경 기록이 Yjs 업데이트와 같은 트랜잭션에 들어가는 것과 같은 원칙이다.
  - 신규 `S/http/routes/audit.ts`: `GET /orgs/:orgId/audit`(owner/admin, 페이지 단위).
  - 요청 상관 ID 미들웨어(`S/http/app.ts`). 서버 코드(`S/`) 전체에서 요청 ID 처리를 찾지 못했다.
  - 기록 지점: 공유 생성·삭제, team-access, bulk access, 멤버 공유 초기화, 역할 변경, 제거·나가기, 초대 생성·취소·수락, 참가 코드 재발급·사용, 공개 링크 생성·삭제, MCP 토큰 생성·삭제. 이후 조각의 정책 변경과 일괄 회수도 여기에 기록한다.
  - 보존 기간이 지난 행 정리: 기존 정리 작업(`S/invitations/sweep.ts`와 같은 방식)에 붙인다.
- 기존 기록과의 관계: AI 변경 기록(`ai_change_ledger`)은 문서 내용 변경, 버전 작성자(`note_versions`)는 편집 이력, 멤버 활동 피드(`S/http/routes/members.ts:240`)는 공유 행에서 만든 화면용 요약이다. 감사 로그는 **멤버·공유·정책·연결의 변경만** 기록하고 내용 변경은 기록하지 않는다. 각 행에 관련 기록 ID(예: `ai_change_ledger.id`)를 둘 수 있는 `refs jsonb`를 둔다.
- 데스크톱: 설정 → "보안 기록" 화면(관리자만). 기술 용어 없이 "누가 · 무엇을 · 언제 · 결과"로 보여 준다.
- 테스트: `T/audit-log.test.ts` "share write and audit row commit together", "a refused share write is audited", "members and guests cannot read the audit log", "retention sweep deletes only expired rows".
- commit:
  1. `feat(server): add audit log table and writer`
  2. `feat(server): audit membership, share and invitation changes`
  3. `feat(server): audit log listing and retention`
  4. `feat(desktop): security log view for admins`

**A1-4 참가 코드 만료·재발급·시도 제한 (`M/063_join_code_lifecycle.sql`)**
- 스키마: `org_join_codes`에 `expires_at`, `rotated_at`, `created_by`를 더한다(기존 행은 §6.2). 시도 기록 테이블 `join_code_attempts(user_id, attempted_at, ok)`를 둔다. 로그인 시도 제한(`S/auth/signin-throttle.ts`, migration 036)과 같은 방식이다.
- 변경 파일: `S/http/routes/orgs.ts`
  - `GET /orgs/join-code`는 `expiresAt`을 함께 준다.
  - 신규 `POST /orgs/join-code/rotate`(owner/admin): 이전 코드를 즉시 무효로 한다.
  - `POST /orgs/join`: 만료면 410 `join_code_expired`, 시도 초과면 429 `join_code_rate_limited`, 살아 있는 guest 초대가 있으면 409 `guest_invite_pending`(D6-47). 역할은 지금처럼 member/admin만 준다.
- 데스크톱: `D/components/InvitePeopleDialog.tsx`에 만료일과 "새 코드 만들기"를 넣는다. 참가 화면에 만료·시도 초과 이유를 한 문장으로 보여 준다.
- 테스트: `T/join-code-lifecycle.test.ts` "expired code is refused with a reason", "rotation invalidates the previous code", "attempts beyond the limit are refused", "a pending guest invite cannot be redeemed through the join code", "redeeming never promotes a guest".
- commit:
  1. `feat(server): join code expiry and rotation`
  2. `feat(server): rate-limit join code redemption`
  3. `feat(desktop): show join code expiry and regenerate`

**A1-5 허브 게스트 (`M/064_guest_role.sql`)**
- 스키마:
  - trigger 함수를 다시 만들어 guest를 제외한다.
  - guest 초대의 공유 대상을 저장할 `invitation_shares(invitation_id, resource_type, resource_id, permission)`를 둔다.
  - 역할 강등 때 snapshot과 개인 vault 수준 행을 정리하는 것은 코드에서 처리한다.
- 변경 파일(§4의 D6 경로 전체):
  - Better Auth 역할 정의: `S/auth/auth.ts`
  - 판정: `S/permissions/resolver.ts`, `vault-docs.ts`, `http-gates.ts`, `access-management.ts`
  - 신규 이름 가리기 도우미: `S/permissions/redact.ts`
  - 경로: `S/http/routes/{members,registry,versions,blobs,graph,bulk,shares,public-links,mcp,oauth-connect,orgs,invitations,bootstrap}.ts`, `S/trash/service.ts`, `S/sync/vault-channel.ts`, `S/yjs/bootstrap.ts`(페이지마다 재확인, M7), `S/http/app.ts`(Better Auth 조직 엔드포인트 가로채기, D6-46)
  - 데스크톱: 역할 표시 "게스트", 관리 버튼 숨김, 초대 화면의 "게스트로 초대"(폴더·노트 선택), 게스트가 보는 빈 상태 문구.
- 테스트: §4의 `T/guest-*.test.ts` 전체. 출시 조건은 표의 모든 기대 거부가 통과하는 것이다(PRD F2, §11).
- commit:
  1. `feat(server): guest role definition and snapshot trigger`
  2. `feat(server): resolve guest access from per-user grants only`
  3. `feat(server): scope HTTP gates and listings for guests`
  4. `feat(server): scope sync, bootstrap and vault channel for guests`
  5. `feat(server): redact people and vault metadata for guests`
  6. `feat(server): guest invitations with explicit targets`
  7. `feat(desktop): guest invite flow and guest view`
  8. `test(server): D6 guest matrix`

**A1-6 외부 공유 정책 (`M/065_external_sharing_policy.sql`)**
- 스키마: `organization_access_settings`에 `external_sharing`(`off`|`domains`|`on`, 기본 `on`)과 `external_domains text[]`을 더한다.
- 변경 파일:
  - 신규 경로 `GET/PUT /orgs/:orgId/external-sharing`(owner/admin. owner만 바꿀 수 있게 할지는 §10 Q12)
  - 적용 지점: guest 초대 생성·수락(`S/auth/auth.ts` hook 325, 348), `POST /shares`(V4), 공개 링크 생성(`S/http/routes/public-links.ts`), 공개 링크 열람(`GET /p/:token`, §10 Q9)
  - 우선순위는 PRD F1.4의 순서로 하나의 함수에 둔다.
- 데스크톱: 설정 → "외부 공유" 세 가지 선택과 도메인 목록. `domains`에서 공개 링크 버튼을 끄고 이유를 보여 준다.
- 테스트: `T/external-sharing-policy.test.ts` "off refuses guest invites, guest shares and public links", "domains accepts only verified allowed domains", "domains refuses anonymous public links", "policy precedence is identical on every join path".
- commit:
  1. `feat(server): external sharing policy`
  2. `feat(desktop): external sharing settings`

**A1-7 외부 접근 일괄 회수 (`M/066_external_revocations.sql`)**
- 스키마: `external_revocations(id, organization_id, actor_user_id, status, counts jsonb, errors jsonb, started_at, finished_at)`.
- 변경 파일:
  - 신규 경로 `POST /orgs/:orgId/external-access/revoke`와 `GET .../revoke/:id`(owner/admin).
  - 한 번에 처리하는 것: guest 제거(`revokeMembership` 재사용), 대기 중 guest 초대 취소, 공개 링크 삭제, guest의 MCP 토큰·OAuth 연결 삭제, guest bootstrap 세션 삭제.
  - 다중 인스턴스 전파: `acl-changed`와 `member-removed`는 이미 pubsub으로 간다. Hocuspocus 소켓 종료도 pubsub으로 모든 인스턴스에 알린다(M8).
  - 같은 요청을 다시 보내도 결과가 같아야 한다. 부분 실패는 `errors`에 항목별로 남기고, 화면에 "완료 / 일부 실패(다시 시도)"로 보여 준다.
  - 단계마다 감사 로그에 기록한다.
- 데스크톱: 설정 → "외부 접근 모두 끊기". 끊기 전에 대상 수(게스트 ○명, 공개 링크 ○개, AI 연결 ○개)와 "이미 받은 내용은 회수할 수 없습니다. 발급된 다운로드 링크는 최대 5분 동안 열릴 수 있습니다."를 보여 준다(`S/blobs/config.ts:225`).
- 테스트: `T/external-revoke.test.ts` "revokes guests, invites, public links and guest MCP tokens", "re-running is idempotent", "partial failure is reported per item", "revocation reaches sockets on another instance"(두 인스턴스 하네스, M8).
- commit:
  1. `feat(server): bulk external access revocation`
  2. `fix(server): close document sockets on every instance`
  3. `feat(desktop): revoke all external access`

### 9.3 A1 2차 구현 진행 기록 (2026-10-17)

- A1-3~A1-7 구현: 감사 행/쓰기 트리거/거부 기록/보존/관리 화면, 참가 코드 만료·교체·사용자별 제한, 개인 항목 공유만 받는 guest, 외부 공유 정책과 V4 재검사, 진행 상태와 재시도가 있는 외부 접근 일괄 회수. 실제 migration은 062~066이며 061 OAuth는 그대로다.
- Q3 결정: coordinator 승인에 따라 공유 루트를 가상 루트로 투영하고 조상 이름을 숨기는 최소 지원을 구현한다. guest의 rename/move/폴더 생성·삭제는 제한한다. 노트·파일 단건 생성과 일괄 등록은 기존 편집 가능 공유 폴더로만 역변환한다. 원래의 전체 디스크 경로·첨부 상대 경로·폴더 구조 쓰기 역변환 계약은 2~4일 추정의 후속 조각으로 이월한다.
- M9 확인: Better Auth 1.6.23의 자체 `listMembers`는 guest에게 전체 사람 목록을 반환했다(회귀 테스트가 원래 동작을 재현). HTTP는 자기 행만 반환하고 full-organization/list-invitations는 거부한다. 자체 leave는 공유/연결 정리가 없으므로 공통 `revokeMembership`으로 보낸다. 조직 목록은 guest 조직의 ID·표시 이름만 반환한다.
- M8 확인: 설치된 Hocuspocus Redis 확장은 변경/awareness를 미러링하며 `closeConnections` 제어 전파가 없다. `sync/doc-revocations.ts`가 commit 뒤 pubsub 종료 신호를 보내며 별도 Redis 연결을 쓰는 두 실제 Hocuspocus 서버의 guest 연결 종료를 회귀 검사한다.
- Q10은 보류: 좌석 계산 코드는 바꾸지 않는다. 현행 guest 포함 계산을 회귀 검사한다.
- 조각별 명령·결과, D6 매핑과 미검증/후속 범위는 `docs/reports/IMPL-REPORT-A1-part2.md`에 기록한다.


## 10. 미해결 결정 (사용자 승인 필요)

2026-10-17 사용자 결정: **Q1~Q9, Q11~Q15는 각 권장안을 승인했다. Q10(guest 결제 좌석)은 보류한다.** Q1은 비멤버 개인 공유 행을 보존하고 권한만 끊으며, Q13은 owner/admin만 guest에게 공유할 수 있다. 아래 표는 승인된 권장안과 Q10의 선택지를 기록한다.

| ID | 질문 | 선택지 | 권장 | 영향 |
|---|---|---|---|---|
| Q1 | member 행이 없는 사람에게 이미 저장된 개인 공유를 어떻게 처리할까 | (a) R1을 적용해 권한을 끊고 행은 보존한다 (b) 지금처럼 문서 동기화만 허용한다 | (a). 지금은 문서 토큰은 허용하고 vault 채널은 거부해 동작이 서로 다르다(M2). `T/vault-docs.test.ts:129-153`의 기대를 바꾼다 | A1-1 |
| Q2 | 기존 참가 코드의 만료 | (a) 배포 후 30일 (b) 바로 만료 (c) 만료 없음 유지 | (a). 새 코드의 기본 만료는 7일로 하고 관리자가 바꿀 수 있게 한다 | A1-4, §6.2 |
| Q3 | guest에게 공유 폴더의 경로를 어떻게 보여 줄까 | (a) 공유된 폴더를 진입점으로 경로를 다시 잡는다(조상 이름 없음) (b) 조상 이름 노출을 허용하고 문서에 적는다 | (a)가 PRD F2를 충족한다. 다만 디스크 경로(`rel_path`)와 registry 계약이 guest에게 따로 생겨 비용이 크다. 비용 추정은 A1-5 착수 전에 한다 | D6-08, D6-25, A1-5 |
| Q4 | guest에게 vault(조직) 이름을 보여 줄까 | (a) 표시 이름만 보여 주고 다른 note collection 이름은 숨긴다 (b) 모두 숨긴다 | (a). 초대 미리보기에서 이미 이름이 보이고, 이름이 없으면 사용자가 어떤 vault인지 알 수 없다 | D6-21, 26, 50 |
| Q5 | 공유 노트 안에서 다른 사람의 이름(버전 작성자, presence, 합류 알림) | (a) "다른 사용자"로 가린다 (b) 같은 노트를 편집하는 사람의 표시 이름만 보여 준다 | (a). 협업이 불편하면 (b)를 정책 옵션으로 둔다 | D6-20, 22, 58 |
| Q6 | member가 보는 대기 중 초대 이메일 | (a) 지금처럼 보여 준다 (b) owner/admin만 본다 | (b). guest 이메일은 외부 사람의 개인정보다 | D6-41 |
| Q7 | guest의 외부 AI(MCP) 연결 | (a) A1에서는 금지 (b) 공유 범위만 읽기 허용 | (a). MCP 경로의 guest 필터는 별도 조각으로 뒤에 둔다 | D6-35~39 |
| Q8 | member를 guest로 강등하는 기능 | (a) 허용한다(snapshot과 개인 vault 수준 정리, 확인 화면) (b) 내보낸 뒤 다시 초대하게 한다 | (a). 감사 로그에 남긴다 | D6-48 |
| Q9 | 정책을 `off`나 `domains`로 바꿀 때 기존 공개 링크 | (a) 바로 열람을 막는다 (b) 그대로 두고 일괄 회수로 지우게 한다 | (a). 정책 이름과 실제 동작을 일치시킨다(S07) | A1-6 |
| Q10 | guest를 결제 좌석으로 셀까 | (a) 세지 않되 vault당 상한을 둔다 (b) member와 같이 센다 | 결정 필요(요금 정책). 기술적으로는 둘 다 가능하다 | D6-64 |
| Q11 | 감사 로그 기본 보존 기간 | 90일 / 1년 / 무기한 | 1년. PRD §6.2의 보존 표에 함께 적는다 | A1-3 |
| Q12 | 외부 공유 정책의 기본값과 변경 권한 | 새 vault `on` 또는 `off`. 변경은 owner만 또는 owner/admin | 기존·새 vault 모두 `on`, 변경은 owner/admin. 작은 팀의 초대 흐름을 막지 않는다(PRD §0.1) | A1-6 |
| Q13 | 만든 사람인 member가 자기 노트를 guest에게 공유할 수 있을까 | (a) owner/admin만 가능 (b) 만든 사람도 가능 | (a). 외부 노출은 관리 결정이다 | V5 |
| Q14 | 메일 없는 서버에서 guest 수락에 승인을 요구할까 | (a) A1은 바로 합류, A2 승인 대기열이 생기면 기본 요구 (b) A1부터 수락을 막고 관리자가 직접 추가 | (a) | E3 |
| Q15 | 메일 없는 서버의 `domains` 정책 | (a) 확인된 이메일(Google 로그인)만 인정 (b) 입력한 이메일 도메인을 인정하고 경고만 표시 | (a). PRD F1.4의 "서버가 확인한 현재 이메일 인증 상태만" 규칙과 같다 | E4 |

## 11. 검증 기록
명령, 결과, 미검증 항목, 커밋 목록은 `docs/reports/IMPL-REPORT-A0.md`에 있다. 이 문서는 코드를 바꾸지 않는다. §1.3의 probe 테스트는 실행 후 지웠다.
