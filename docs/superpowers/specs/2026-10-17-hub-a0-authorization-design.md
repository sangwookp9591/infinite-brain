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
| 역할 변경, 내보내기 | ✅ 현행 | 현행(member만) | ⛔ | ⛔ | ⛔ |
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
