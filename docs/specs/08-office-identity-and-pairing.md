---
type: architecture-proposal
status: proposed-draft
product: Infinite Brain
date: 2026-10-21
---

# 08 · 사내 사람 신원과 기기 페어링

**상태: 구현 전 설계안.** 06 PRD와 07 사내 협업 아키텍처의 신원·초대 흐름을 Better Auth 및 현재 서버 migration/audit 계약에 연결한다. 현재 migration 마지막 번호는 **066**(`066_external_revocations.sql`)이므로 신규 변경 후보 번호는 **067**이다. 이 문서는 코드나 DB를 변경하지 않았으며, 구현 시 migration 목록 및 배포 브랜치의 마지막 번호를 다시 확인한다.

## 1. 확정할 신원 분리

세 가지를 서로 다른 식별자로 둔다.

| 식별자 | 의미 | 발급/사용 |
|---|---|---|
| `person_id` | 한 사람의 불변 ID (UUID) | 앱의 로컬 프로필에서 생성. alias 변경과 무관 |
| `device_id` | 설치별 불변 ID (UUID) | OS keychain에 보관하는 키와 결합. 기기 재설치/키 교체는 새 device |
| `user.id` | 기존 Better Auth 계정 ID (TEXT) | 이메일/기존 인증 또는 별도 승인된 계정 연결 후에만 존재 |

`person_id`는 표시 이름이나 이메일에서 파생하지 않는다. 한 사람은 여러 기기를 가질 수 있고 한 기기는 한 시점에 하나의 person에만 연결된다. `person_id`와 Better Auth `user.id`의 연결은 선택적·명시적이며, 연결되면 그 계정이 해당 사람의 canonical server identity가 된다. `member.organizationId`는 사내 회사/organization 가입을 나타낸다. `vaultId`는 실제 note collection이며 항상 명시적으로 연결한다. `organizationId = vaultId`라는 가정을 두지 않는다.

별명(alias)은 로컬에서 즉시 사용할 수 있는 표시 정보다. 인증·권한·감사 주체가 아니며, 같은 alias를 쓰는 사람을 합치지 않는다. 감사/문서 이력은 `person_id`와 연결된 경우 `user.id`, `device_id`를 안정 주체로 기록하고 당시 `alias_snapshot`을 화면 표시용으로만 저장한다.

## 2. Better Auth 이메일 필수 모델과의 공존

현재 `001_better_auth.sql`은 `"user".email TEXT NOT NULL UNIQUE`, `"user".name TEXT NOT NULL`이고 `"member"`는 `userId`를 요구한다. `"invitation"`도 email이 필수다. 따라서 기기 전용 프로필/대기 페어링을 Better Auth user나 member로 가장하지 않는다.

규칙:

1. 별명만 만든 기기에는 로컬 `person_id`, `device_id`, 공개키가 있고 서버 계정·organization membership은 없다. 가짜 이메일, 예측 가능한 placeholder 이메일, 별명 기반 이메일을 만들지 않는다.
2. pairing challenge 및 승인 대기 레코드는 별도 identity 테이블에 저장한다. 대기 상태로는 Better Auth session, member, vault 접근 권한, 문서/폴더 목록을 발급하지 않는다.
3. 서버 자원 접근을 승인하려면 기존 이메일 계정으로 인증해 `person_id`에 연결하거나, 이메일 없는 신규 계정을 지원하도록 Better Auth 설정/schema와 모든 이메일 기반 로그인·unique·초대 경로를 별도 migration gate에서 바꿔야 한다. 승인만으로 가짜 user를 만들지 않는다.
4. 첫 구현은 3번의 기존 계정 연결을 요구하는 안전한 경로를 기본값으로 한다. 이메일 없는 완전한 server membership은 별도 설계/ADR과 Better Auth 호환성 검증 전까지 미지원이다. device-only 프로필은 로컬 개인 작업과 pairing 신청 UI에만 유효하다.
5. 기존 이메일 초대는 현 `invitation` 흐름을 유지한다. 별도 초대 링크는 email 초대와 구분되며 두 방식을 자동 변환하지 않는다.

## 3. 표시 alias와 동명이인 표식

`person_identity`에는 `display_alias` 원문을 보관하고, 표시 시 trim 후 NFC 정규화한다. 빈 값은 거부하고 제어문자 제거, 길이 1–40 Unicode grapheme 제한, 양끝 공백 제거를 적용한다. alias는 회사/organization 전체에서 unique하지 않다. 검색·인증 키로도 사용하지 않는다.

승인된 같은 `organizationId` 안에서 정규화된 alias가 중복될 때만 구별 표식을 붙인다. 기본 표식은 해당 person의 고정된 `person_id`에서 만든 **Crockford Base32 4자리** 코드다. 표시는 `민수 · 7K2P` 형식으로 만들고, 충돌 시 5자리, 그 다음 길이를 늘려 조직 내 고유해질 때까지 사용한다. 생성은 키 생성 시 한 번 고정해 `alias_disambiguator`로 저장하고 alias 변경에도 유지한다. 조직 내 충돌 확인은 case-fold + NFC 정규화 기준으로 하되 한국어는 locale별 의미 변환을 하지 않는다. 코드는 비밀·인증 수단이 아니며 필요 시 전체 코드 대신 화면에만 표시할 수 있다.

승인 대기 화면에서는 조직 명단을 조회해 중복 여부를 계산하지 않는다. 신청 alias가 중복이더라도 관리자의 기존 directory 정보가 공개되기 전까지 코드나 다른 사람의 존재를 노출하지 않는다. 관리 승인 후 정식 디렉터리 표시를 계산한다. 기기 자체 이름은 별도 `device_label`이며 alias와 구분한다.

## 4. 권장 데이터 모델

신규 테이블은 모두 UUID/text ID의 기존 서버 규약에 맞추고 `organization_id`가 필요한 레코드는 실제 `organization.id`를 참조한다. key/hash/token 원문은 저장하지 않는다.

### `person_identity`

- `id UUID PRIMARY KEY` (`person_id`)
- `display_alias TEXT NOT NULL`, `alias_normalized TEXT NOT NULL`
- `alias_disambiguator TEXT NOT NULL` (stable 4+ Base32 표식)
- `linked_user_id TEXT NULL REFERENCES "user"("id") ON DELETE RESTRICT`
- `created_at`, `updated_at`, `disabled_at TIMESTAMPTZ`
- 부분 unique index `linked_user_id WHERE linked_user_id IS NOT NULL` (한 user가 중복 person으로 연결되지 않도록)
- 서버는 alias만으로 조회/로그인/권한 부여하지 않는다.

### `person_device`

- `id UUID PRIMARY KEY` (`device_id`), `person_id UUID NULL REFERENCES person_identity(id)`
- `public_key BYTEA NOT NULL`, `key_algorithm TEXT NOT NULL` (지원 알고리즘 allowlist)
- `key_fingerprint BYTEA NOT NULL UNIQUE`, `device_label TEXT`, `platform TEXT`
- `status TEXT NOT NULL CHECK (status IN ('unpaired','pending','approved','rejected','revoked'))`
- `created_at`, `last_seen_at`, `approved_at`, `revoked_at`
- private key는 OS keychain 밖으로 내보내지 않는다. DB와 로그에는 private key를 절대 기록하지 않는다.

### `office_person_membership`

- `person_id UUID REFERENCES person_identity(id)`, `organization_id TEXT REFERENCES organization(id)` 복합 PK
- `user_id TEXT NOT NULL REFERENCES "user"("id")`, `status TEXT CHECK (status IN ('active','suspended','revoked'))`
- `created_at`, `approved_by_user_id TEXT REFERENCES "user"("id")`, `updated_at`
- 생성 시 `person_identity.linked_user_id = user_id` 일치 확인. 기존 권한 resolver에 연결할 때도 실제 Better Auth `member`가 활성인지 재검사한다.
- 이는 `member` 대체물이 아니며 별명/기기 연결 보조 테이블이다. 역할은 복제하지 않는다.

### `pairing_session`

- `id UUID PRIMARY KEY`, `organization_id TEXT NOT NULL REFERENCES organization(id)`
- `device_id UUID NOT NULL REFERENCES person_device(id)`, `person_id UUID NULL REFERENCES person_identity(id)`
- `challenge_hash BYTEA NOT NULL`, `nonce_hash BYTEA NOT NULL`, `server_nonce_hash BYTEA NOT NULL`
- `protocol_version INTEGER NOT NULL`, `audience TEXT NOT NULL`, `host_generation BIGINT NOT NULL`
- `state TEXT NOT NULL CHECK (state IN ('challenge_issued','proof_verified','pending_approval','approved','rejected','cancelled','expired'))`
- `created_at`, `expires_at`, `updated_at`, `decided_at`, `decided_by_user_id TEXT REFERENCES "user"("id")`
- `decision_reason_code TEXT NULL` (bounded enum, free-form note excluded)
- `organization_id` alone does not grant vault access; approved session still requires explicit organization membership and separately resolved vault permission.

### `pairing_vault_grant` (only if approval must assign vaults atomically)

- `pairing_session_id UUID REFERENCES pairing_session(id)`, `vault_id TEXT NOT NULL REFERENCES vaults(id)` (use actual table/key after verifying schema; if vault is represented by organization-scoped tables, use its actual FK)
- `grant_mode TEXT CHECK (grant_mode IN ('existing_membership_only'))`
- V1 pairing approval must not create broad grants. Existing user/member and resolver rules decide access; vaults are selected only through a separate authorized assignment operation.

`pairing_vault_grant`는 승인 직후에 접근할 vault를 명시적으로 부여하는 요구가 확정될 때만 추가한다. 067의 필수 범위는 identity/device/session 테이블과 인덱스이며, 미확정 vault 테이블 명을 추정해 FK를 넣지 않는다. 실제 스키마를 읽고 FK target을 확정하는 것이 migration 구현 전 조건이다.

## 5. Migration 067 후보 순서

`067_office_identity_pairing.sql` 한 파일로 신규 테이블·제약·인덱스를 추가한다. 기존 `user.email` nullability는 변경하지 않는다. 새 테이블에는 `created_at/updated_at` 기본값과 상태 CHECK, FK의 delete 동작을 명시한다. 조직/계정 삭제 cascade로 audit 증거가 지워지지 않도록 승인/거절 기록은 아래 audit에 남기고 person/device는 revoke/disabled 처리 후 삭제 정책을 적용한다.

이 migration은 기존 계정에 person 행을 자동 생성하거나 alias를 추론하지 않는다. backfill은 사용자 대면 별명과 동일인 판정을 요구하므로 별도 명시적 linking 흐름에서 수행한다. migration test에 파일 순서/번호 검사, 빈 DB 적용, 기존 DB upgrade, FK/unique/check 동작을 포함한다. migration 이후 신규 identity writes는 `AuditClient`를 사용하는 server pool에서만 수행하고 Better Auth 전용 pool 직접 쓰기는 기존 Better Auth 표 변경에 한정한다.

## 6. Pairing 및 초대 challenge 프로토콜

전송은 TLS와 검토된 서명 라이브러리를 사용한다. 자체 암호 알고리즘, 자체 PAKE, 공개키를 alias/QR에서 신뢰하는 방식은 만들지 않는다. 앱은 설치 시 device key pair를 OS keychain에 생성한다. pairing challenge는 아래 값에 모두 서명해 다른 서버·세션·세대에 재사용할 수 없게 한다.

```text
domain = "infinite-brain/office-pairing/v1"
message = canonical_encode(
  domain, server_id, organization_id, pairing_session_id,
  device_id, device_public_key_fingerprint,
  client_nonce, server_nonce, audience, host_generation,
  protocol_version, expires_at
)
proof = Sign(device_private_key, SHA-256(message))
```

`canonical_encode`는 명시된 필드 순서·길이 구분 인코딩이어야 하고 문자열 연결 모호성을 허용하지 않는다. 서버는 TLS endpoint를 초대/신뢰 화면의 서버 공개키 pin과 대조한 뒤 challenge 서명을 검증한다. 초대에는 짧은 유효기간, 무작위 단회 secret의 hash, 허브 공개키 fingerprint, server identity 및 연결 정보를 포함한다. secret은 서버 DB에는 hash만 저장하고 사용·취소·만료 후 재사용을 거절한다. 초대 URL을 로그, 분석 이벤트, clipboard history 진단에 기록하지 않는다.

Nonce는 CSPRNG로 최소 256 bit 생성, 세션별 단회 사용, DB unique/hash로 replay를 차단한다. challenge TTL 기본 5분, 승인 대기 기본 24시간(정책 범위 안에서 설정)을 제안한다. 만료는 요청 처리 시와 청소 작업에서 모두 판정한다. 시도 횟수/IP/기기 단위 속도 제한, 일정 실패 뒤 지연, 최대 pending 요청 수, body 크기 제한을 둔다. IP는 내부 운영 진단에서만 제한적으로 쓸 수 있고 직원에게 표시하거나 입력시키지 않는다.

### 상태 전이

| 현재 상태 | 이벤트 및 조건 | 다음 상태 | 효과 |
|---|---|---|---|
| 없음 | 초대/발견 후보를 사용자가 열고 endpoint pin 확인 | `challenge_issued` | 만료 nonce 생성, 접근권 없음 |
| `challenge_issued` | 유효 서명, key/device/session/audience/generation 일치, nonce 미사용 | `proof_verified` | 공개키 소유만 증명, 계정·자료 노출 없음 |
| `proof_verified` | 사용자가 참여 요청을 명시적으로 제출 | `pending_approval` | 최소 신청 정보만 승인 큐에 저장 |
| `pending_approval` | 현재 권한이 있는 관리자 승인 + person/account linking 조건 충족 | `approved` | device/person 연결 기록; 별도 member/vault ACL 조건 충족 후 제한 세션 발급 |
| `pending_approval` | 관리자 거절 | `rejected` | 이유 코드만 보존, 세션 발급 안 함 |
| 임의의 미종결 상태 | 요청자 취소, 관리자 취소, 초대 취소 | `cancelled` | 재사용 불가 |
| 임의의 미종결 상태 | `expires_at` 경과 | `expired` | 인증 및 승인 거절 |
| `approved` | 기기/person/org 회수 또는 키 폐기 | `cancelled` 또는 device `revoked` | 세션 폐기, 재인증 거절, 연결 종료/권한 재검사 |

DB transaction 안에서 상태 전이를 조건부 UPDATE로 수행한다 (`WHERE state = expected AND expires_at > now()`); 한 challenge의 동시 승인/거절은 한 결정만 성공한다. 승인 요청자는 승인자와 다른 사용자여야 한다. 본인 승인 금지이며 승인자는 활성 Better Auth session, 해당 organization의 `member` role, 기존 관리자 capability를 mutation 시점에 재검증한다. 승인 응답을 재시도하면 같은 결과를 반환하되 다른 payload/결정은 conflict로 거절한다.

승인 후에도 다음 부팅 순서를 지킨다: 인증 → 최신 membership/permission epoch → 완전한 readable listing 및 tombstone bootstrap → 서버 본문 pull → 로컬의 여전히 허용된 outbox 전송. 빈 로컬 vault seed 전에 서버 pull이 선행해야 한다. pairing은 bootstrap 누락을 삭제로 해석하거나 `.context/`를 전송하지 않는다.

## 7. 승인 전 최소 정보

신청자가 보는 정보: 일반적인 회사/vault display label(공개 동의된 경우), 허브 fingerprint의 짧은 비교 코드, 이 PC의 별명, 요청 만료 시각, 연결 상태. IP, 포트, 터미널 명령, DB 이름, 내부 네트워크 주소는 사용자 입력·일반 화면에 나타나지 않는다. 연결 실패는 “회사 작업 공간에 연결하지 못했어요. 초대 링크를 다시 열거나 관리자에게 초대 유효 여부를 확인해 달라고 해 주세요.”처럼 원인과 다음 행동을 쉬운 한국어로 설명한다.

승인자는 요청 alias, device_label, 플랫폼의 넓은 구분(예: Windows/macOS), 키 fingerprint short code, 요청 시각, challenge 검증 통과 여부, 기존 person 연결 유무만 본다. OS 사용자명, 이메일, IP/MAC 주소, 로컬 파일명/경로, vault 이름/폴더/문서 수, 문서 본문, 전체 회사 명단은 pairing 전·대기 중에 보여 주지 않는다. 다른 사용자 존재 여부를 암시하는 중복 alias 결과도 승인 전에는 공개하지 않는다.

발견 광고는 사용자 opt-in 상태에서 protocol version, ephemeral service instance, 연결 후보와 서버 fingerprint만 보낸다. alias/company/team 및 멤버 명단은 광고하지 않는다. discovery 응답만으로 신뢰 pin이나 회사 membership을 만들지 않는다. IP 주소가 UI/파일 이름/초대 텍스트에 노출되는 경로도 허용하지 않는다.

## 8. 계정 linking과 권한 연결

### 기존 계정에 새 기기 연결

1. 사용자는 기존 Better Auth 인증 절차를 통해 로그인한다. 기존 세션을 기기 key와 결합하는 challenge proof를 완료한다.
2. 서버는 세션의 `user.id`와 요청 `person_id`가 이미 같은 연결인지 확인한다. 미연결이면 사용자 재인증과 명시 확인 뒤 `person_identity.linked_user_id`를 원자적으로 설정한다.
3. 서버는 `member`에서 정확히 동일한 `organizationId + userId` membership이 유효한지 확인하고 `office_person_membership`만 기록한다.
4. 관리자가 기존에 그 user에 준 vault/folder grants를 그대로 적용한다. pairing은 user role이나 ACL을 높이지 않는다.

### 별명으로 시작한 사람을 기존 계정과 연결

기존 로그인 후 사용자가 pairing 대기 중 person을 직접 선택하고 양쪽 기기 서명 확인을 완료해야 한다. 관리자가 alias가 같다는 이유로 자동 연결하지 않는다. 한 `user.id`는 한 active `person_id`에만 연결한다. 충돌은 거절하고 이전 person을 명시적으로 merge하는 별도 audited 관리 흐름으로 보낸다. merge는 모든 기기·membership·audit 참조의 이동 계획/영향을 제시하며 일반 pairing API에서는 제공하지 않는다.

### 이메일 없는 신규 직원

이메일 없는 신규 직원은 초기 범위에서 독립된 device-only 로컬 person으로 남는다. server membership와 vault 자료를 받을 수 없다. 이메일이 없는 회사에서 이 흐름이 필수라면 Better Auth의 user identifier/auth provider, session issuance, organization plugin, invitation, unique constraints, account recovery, authorization resolver를 함께 바꾸는 ADR 및 위협 모델을 먼저 승인해야 한다. 빈 이메일/`<device>@local`/가짜 도메인을 넣어 기존 email schema를 통과시키지 않는다.

## 9. 세션·권한 계약

승인됐다는 상태 자체로 일반 Better Auth 세션을 발급하지 않는다. 승인된 device key proof와 linked `user.id`, 활성 `member(organizationId,userId)`, 현재 허용된 동작이 확인된 후 device-bound session을 발급한다. 기존 Better Auth session 모델을 쓸 경우 token은 random secret, DB에는 기존 규약에 맞게 저장하고 `session`에 device binding을 추가하는 별도 호환성 검토를 한다. 토큰이 유출돼도 재사용 기기를 식별·회수할 수 있게 `device_id`/key version을 검증한다.

세션 권한의 조직은 `member.organizationId`에서 얻는다. vault는 조직과 별개로 resolver가 확인한 `vaultId`다. 요청이 vault를 지정할 때 resolver가 `vaultId → owning organizationId` 관계를 실제 DB에서 확인하며 caller가 준 두 값을 신뢰하지 않는다. user/group/org grants, deny, lock, guest 제한, revocation epoch는 기존 한 resolver를 통해 동일 적용한다. UI 캐시, pairing approval, alias, group label은 권한 근거가 아니다.

기기/사람/계정/organization 회수 시 session token 폐기, 연결된 sync socket 종료, 후속 HTTP/sync/blob/MCP 권한 재검사를 수행한다. 이미 내려받은 평문은 원격 회수 불가하다는 제품 설명을 유지한다. 키 분실·교체는 이전 키를 자동 대체하지 않고 새 device pairing과 명시 승인으로 처리한다.

## 10. Migration 062 audit 정합

062 `record_access_mutation()` trigger는 현재 `shares`, `member`, `invitation`, `invitation_access`, `public_links`, `mcp_tokens`, `mcp_oauth_vault`, `org_join_codes`, `organization_access_settings`만 감시한다. 신규 office 테이블은 자동 감사되지 않는다. 067은 이 테이블들에 trigger를 추가하거나 해당 mutation을 하는 각 transaction에서 `recordAudit(client, entry)`를 명시 호출해야 한다. 권장안은 신규 테이블들에 062 함수를 무작정 적용하지 않고, application transaction에서 정형화된 이벤트를 `recordAudit`로 기록하며 중요한 상태 전이 누락 방지용 trigger를 설계 검토하는 것이다.

필수 audit action 예: `office.person.link`, `office.device.register`, `office.pairing.challenge`, `office.pairing.request`, `office.pairing.approve`, `office.pairing.reject`, `office.pairing.cancel`, `office.device.revoke`, `office.person.suspend`. `target_type`은 `person|device|pairing_session`, target ID는 안정 ID로 둔다. `before/after`에는 상태·alias snapshot 등 필요한 최소 정보만 기록한다. nonce, challenge, proof/signature, invite secret/hash, public key bytes, session token, IP, OS username, 문서·경로·본문은 넣지 않는다. 거절된/권한 없는 write는 rollback 후 별도 transaction에서 `result: "refused"`로 기록한다.

모든 HTTP/worker 요청은 `audit/http.ts` 규약에 따라 AsyncLocalStorage의 `requestId`, `actorUserId`, `organizationId`, `actorKind`를 설정한다. mutation은 기존 서버 `AuditClient`로 처리하고 transaction-local `set_config('infinite_brain.audit', ..., true)`가 적용되게 한다. 직접 `pg.Client`/Better Auth pool로 pairing mutation하지 않는다. 한 transaction 안에 상태 변경과 `recordAudit(client, ...)`를 넣어 함께 commit/rollback한다. system cleanup은 actorKind system으로 기록한다. `device_id`는 현 AuditContext에 없으므로 `recordAudit.refs` 또는 `after`에 device ID만 추가하거나 context 확장 ADR을 둔다. `actor_user_id` 칸에 person/device ID를 넣지 않는다. 365일 기본 retention 규칙을 따른다.

동일 mutation에 062 trigger가 이미 걸린 `member`를 변경하면 trigger audit와 명시적 office audit 모두 남을 수 있다. 중복은 사실을 숨기지 않는 수준의 서로 연결된 이벤트로 허용하고 `refs`에 pairing session ID를 둔다. trigger가 token/hash/key material을 필터링하는 목록을 믿고 민감 자료를 넣지 않는다. 기존 함수의 제외 목록은 완전한 비밀정보 필터가 아니므로 저장 단계부터 secret을 분리한다.

## 11. 오류·복구 동작

- 만료: “초대가 만료됐어요. 관리자에게 새 초대를 요청해 주세요.”
- 승인 거절: 이유 세부정보 대신 “이 기기의 참여가 승인되지 않았어요. 관리자에게 확인해 주세요.”
- 다른 서버/잘못된 pin: “확인한 회사 작업 공간과 연결 대상이 달라요. 연결을 중단하고 관리자에게 초대가 최신인지 확인해 주세요.”
- 이미 사용한 challenge: “요청을 다시 확인할 수 없어요. 초대 화면을 새로 열어 주세요.”
- 계정 연결 필요: “공유 자료를 열려면 회사에서 승인한 계정으로 연결해야 해요.”
- 권한 회수: “이 기기의 회사 접근이 해제됐어요. 변경 내용은 이 컴퓨터에 보관되어 있으니 관리자에게 복구 방법을 확인해 주세요.”

오류 화면은 내부 error code를 사용자용 원인·다음 행동으로 변환한다. 로그/진단 export에서 token, challenge, signature, invite URL/query, private path, note content를 제거한다. pairing 실패가 앱 로컬 메모 삭제/덮어쓰기로 이어지지 않게 한다.

## 12. 구현 및 테스트 계획

### Schema/migration

- 067 적용/rollback 정책 검토, fresh DB와 기존 migration 066 DB의 schema diff.
- `email NOT NULL` 유지, fake email 생성 경로 없음, 각 FK·unique·check·cascade/restrict 검증.
- 같은 user 중복 person linking, 같은 device key fingerprint 재등록, 중복 alias, 표시코드 충돌, 조직 간 같은 alias의 독립 처리를 검증.
- 조직/사용자 삭제와 audit 보존·retention 처리 검토. 서버 테스트는 전용 disposable DB에서만 실행하고 공유 `context` DB를 사용하지 않는다.

### Protocol/security

- 유효 proof, signature 변경, 잘못된 algorithm/key, 만료, 재사용 nonce, 다른 audience/session/server/generation, 중복 결정 및 동시 승인/거절.
- replay/초대 단회성, 취소 직후 재사용 거절, body/rate limit, timing 및 응답에서 계정/조직 존재 추측 방지.
- server key pin mismatch, TLS 실패, key rotation, device loss/revocation과 연결/socket/token 차단.
- secret이 DB/log/audit/diagnostics에 남지 않는 검증.

### Linking/authorization/audit

- 기존 계정으로 link/unlink conflict, 사용자 재인증, user당 person unique, 동일 alias 계정 자동 merge 금지.
- 기기 승인만으로 `member`나 vault ACL이 생기지 않음; active member 없는 경우, revoked member, 명시 vault permission, 다른 organization/vault ID mismatch 거절.
- resolver, readable listing, HTTP, sync, blob, MCP가 같은 권한을 적용하는 회귀 케이스.
- audit context가 user/system actor, requestId, organizationId로 전달되고 mutation/audit가 원자적이며 refused write가 rollback 후 기록되는지 검증.
- audit에 secret 및 문서 내용이 없고 062 trigger event와 pairing event의 참조가 유지되는지 확인.

### 제품 흐름/플랫폼

- 승인 전 노출 데이터 contract와 payload snapshot 테스트, IP/port/DB/터미널 용어가 직원 UI에 없음, 모든 오류 문구가 다음 행동을 안내함.
- 초대 링크/QR·자동 발견 opt-in/발견 거부·연결 실패·취소·만료 및 Windows/macOS UI 확인.
- 승인 후 pull-before-seed, 완전 bootstrap, tombstone, 미전송 outbox 보호, `.context/` 비동기화를 기존 regression suite에 연결.
- Windows, macOS Apple Silicon/Intel에서 keychain 생성·서명·회수와 packaged app 동작을 native 검증. 브라우저 시뮬레이터는 native keychain, 방화벽, TLS, sleep/wake 증거를 대체하지 않는다.

테스트 실행 시 server test DB가 실제로 disposable인지 확인하고 공유 DB에는 어떤 server test도 실행하지 않는다. 이 문서 작업에서는 테스트나 native 검증을 실행하지 않는다.

## 13. 구현 위험 및 선행 결정

1. **이메일 없는 정식 계정:** Better Auth 스키마뿐 아니라 이메일 중심 로그인·초대·계정 복구와 resolver를 바꾼다. 가짜 이메일 금지가 유지되는지 우선 product decision 필요.
2. **허브 키 신뢰 배포:** mDNS나 LAN은 신뢰 근거가 아니다. 별도 전달된 초대/양 화면 비교와 키 교체·분실 복구 설계가 필요하다.
3. **관리자 정의:** 기존 owner/admin 권한과 사내 pairing 승인 권한을 연결하되 모든 관리자에게 vault 내용 권한을 주지 않아야 한다.
4. **person merge:** 계정 linking 충돌과 퇴사/재가입 처리를 위한 audited merge/recovery UX가 필요하다. alias 중복을 merge 신호로 쓰면 안 된다.
5. **device-bound session:** Better Auth session 확장, native keychain과 refresh/revocation의 수명 주기를 검증해야 한다. 일반 browser bearer session만 발급하면 key binding 효과가 사라질 수 있다.
6. **vault schema 연결:** 현 실제 vault 식별 테이블을 검증한 뒤만 FK/승인 시 grant를 구현한다. organizationId와 vaultId 자동 동일시는 금지한다.
7. **AuditContext 확장:** device identity를 062 trigger와 일관되게 남기려면 refs 활용 또는 context schema 확장 선택이 필요하다. 알 수 없는 기기를 `actor_user_id`로 기록하지 않는다.
8. **취소·오프라인 변경:** 회수된 기기에서 이미 받은 plaintext와 미전송 편집은 서버에서 지울 수 없다. recovery copy와 승인 후 재전송 금지 정책이 동기화 경로에서 보장돼야 한다.

구현 전에 06/07의 미결정 G0와 이메일 없는 사용자 정책, 관리자 승인 capability, 허브 pin 전달 UX를 확정한다. migration 파일 작성 시 실제 `vault`/session schema, Better Auth 구성 및 현재 migration 끝 번호를 다시 확인한다.
