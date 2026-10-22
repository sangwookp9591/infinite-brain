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


## 14. SAS commit-reveal 구현 계약 (2026-10-21)

이 절은 위 §6의 단순 nonce 교환을 보완하는 **실제 SAS v1 계약**이다. 문서 09 §5의 권고를 합류자 커밋 → 허브 nonce → 합류자 공개 순서로 구체화했다. 양 nonce를 먼저 공개한 후 짧은 해시를 비교하는 방식은 허용하지 않는다. Migration 068은 기존 미완료 pairing을 취소해 SAS 없는 세션의 승인을 막는다. 이미 승인된 기기·계정·권한은 바꾸지 않는다.

### 메시지와 서버 상태

| 순서 / API | 전송 값 | 검증·효과 |
| --- | --- | --- |
| 1. `POST /office/pairing/challenge` | 일회 초대, 프로필, 기기 공개키, TLS로 확인한 허브 지문. nonce는 금지 | 허브가 무작위 세션 ID, 5분 만료, capability와 고정 context 발급. `prepared`. 허브 nonce는 아직 만들지 않음 |
| 2. `POST /office/pairing/:id/commit` | capability, `SHA256(encode(commit-domain, context, clientNonce))`, 그 커밋의 Ed25519 기기 서명 | `prepared`에서 커밋 하나만 수락. DB transaction으로 고정한 후 허브가 CSPRNG 32-byte nonce를 만들어 응답. `committed` |
| 3. `POST /office/pairing/:id/reveal` | capability, 합류자 nonce | 저장된 context로 커밋을 재계산하고 상수 시간 비교. 불일치 거절. `revealed`로 단회 전이하며 허브 SAS를 저장하고 기존 서명 challenge 반환. 허브 nonce 원문은 DB에서 제거 |
| 4. `POST /office/pairing/:id/proof` | capability, 양 nonce, 기기 challenge 서명 | 기존 device/account/person/alias/audience/generation/expiry binding 검증. `revealed` 이전 proof는 거절 |
| 5. `POST /office/pairing/:id/sas-confirm` | 요청자 capability, boolean `matches` | `proof_verified` 상태에서 일치 확인을 단회 기록. 불일치 보고는 실패 집계·승인 보호. 숫자는 Rust가 자체 파생 |
| 6. `POST /office/pairing/:id/request` | capability, 요청자 기존 계정 인증 | 요청자 SAS 확인 필수. 기존 사람·계정 조건을 확인하고 `pending_approval`로 이동. 기존 정책대로 승인 대기 TTL 24시간 |
| 7. 관리자 requests / `sas-confirm` | 인증된 관리자가 신청 정보·SAS 조회 후 boolean `matches` 제출 | 일치한 관리자 ID 단회 기록. `false`도 서버 호출하며 실패 집계·승인 보호. 본인 확인 금지 |
| 8. 관리자 `decision` | 기존 승인/거절/취소 API | 양쪽 SAS 확인과 **그 확인을 한 관리자**의 현재 권한이 없으면 승인 거절. 기존 member/계정 연결/본인 승인 금지/일회 결정/감사 transaction 유지 |

`context` 순서는 `sessionId, serverId, organizationId, hostGeneration, observedFingerprint, hubFingerprint, clientPublicKey, hubPublicKey`이다. `observedFingerprint`는 native TLS 검증기가 실제 연결에서 검증한 인증서 SHA-256이고 `hubFingerprint`는 허브 자신의 설정된 인증서 SHA-256이다. 둘이 다르면 시작하지 않는다. `clientPublicKey`는 설치 기기의 Ed25519 SPKI(base64url), `hubPublicKey`는 허브 프로세스가 생성한 Ed25519 pairing 공개키(SPKI)이며 pinned TLS로 인증된다. 허브의 안정된 신원은 인증서 pin이며, 이 프로세스 공개키를 별도 장기 기기 자격으로 사용하지 않는다.

인코딩은 고정 순서 UTF-8 각 필드 앞의 **u32 big-endian 바이트 길이**다. nonce는 CSPRNG 32 bytes의 canonical unpadded base64url이다. 커밋 domain은 `infinite-brain/office-sas/commit/v1`, 최종 transcript domain은 `infinite-brain/office-sas/transcript/v1`이다. 최종 transcript는 domain, context, clientNonce, serverNonce 순서다. SHA-256(transcript || counter-u32-BE)의 첫 u32가 `4,294,000,000` 미만일 때만 `% 1,000,000`을 취하고 0을 채워 6자리로 표시한다. 거절 영역이면 counter를 증가시킨다. 따라서 단순 modulo 편향이 없다. TS/Rust golden vector와 거절 영역 fixture가 같은 결과를 검증한다.

### 제한과 native 경계

- 유효 capability 또는 현재 관리자 권한이 있는 확인 요청에 대해 서명/nonce 공개/숫자 확인 실패를 세션과 기기 키 지문별로 저장한다. 세션 첫 실패 뒤 1초, 두 번째 뒤 2초 지연, **세 번째 실패 때 즉시 세션 폐기·기기 회수 및 5분 잠금**이다. 이는 09의 이전 ‘네 번째 실패’ 초안보다 엄격한 구현 계약이다. 이미 소비된 초대는 재사용할 수 없다. malformed/다른 capability로 다른 사람의 실패 횟수를 올리지는 못한다. 전역 분당 요청 상한·조직 초대/대기 상한도 유지한다.
- `office_pairing_begin`은 독립적으로 전달된 초대 pin으로 실제 HTTPS를 검증하고, Rust 안에서 CSPRNG/commit/reveal/서명/숫자 파생을 수행한다. WebView에는 `{sessionId,sas,expiresAt}`만 반환한다. `office_pairing_confirm`은 확인을 한 번 소비하고, 같다고 확인한 경우에만 참여 요청을 보내며 상태 조회용 capability는 native에 유지한다. 다르면 보고 후 취소한다. nonce·개인키·지문은 신규 IPC 응답에 없다. SAS 대기는 5분, 요청 후 native 대기는 최대 10분이며 다음 시작 때 만료된 값이 제거된다. 앱 종료 시 모두 사라진다.
- 허브는 공개 뒤 raw nonce를 보존하지 않는다(기존 proof 검증에는 해시 사용). 종결 시 보관된 SAS/커밋을 지우며 일반 로그·감사에는 nonce·secret·서명·키·숫자를 기록하지 않는다. 감사의 성공/거절과 상태 변경은 기존 AuditClient transaction 규약을 따른다.

### 보안 한계와 미완료 범위

여섯 자리 SAS는 대면/전화 등 **독립된 두 화면 비교**의 보조 수단이다. 같은 화면에서 전달된 숫자 둘을 비교하거나 사람이 무조건 ‘같아요’를 누르면 보호하지 못한다. 정상 세션 사이 숫자 우연 충돌 가능성은 약 백만 분의 일이며, commit-reveal은 nonce를 안 뒤 약 백만 번 해시해 일치시키는 사후 선택을 막는다. 공격자가 키를 계속 새로 만드는 Sybil·분산/서비스 거부를 기기별 잠금만으로 완전히 막지는 못한다. 별명은 직장 신원이나 계정 소유 증거가 아니며 관리자 실물 확인·기존 인증·ACL이 여전히 필요하다.

이 IPC는 최초 discovery 후보를 자동 신뢰하지 않는다. 독립적으로 전달한 초대 pin으로 TLS를 검증하고, 양쪽 SAS 확인 및 서버 승인 확인 이후 pin을 저장한다(§15). 기존 pin이 다르면 덮어쓰지 않는다. pin 회전, 직원 화면과 실서버 adapter 통합, 실제 회사 자료 동기화, Windows/macOS native keychain·방화벽·별도 두 PC 동작은 이 프로토콜 단위 검증만으로 완료되지 않는다. 임시 loopback HTTP 데모/DB 테스트는 개발 fixture이며 제품 native 경로는 HTTPS만 허용한다.

### 이번 변경의 실제 검증

모든 서버 테스트/데모는 `demo-office-pairing.mjs`가 새로 `initdb`한 전용 임시 cluster에서 실행하고 종료 시 삭제했다. 기존 개발/공유 DB와 `.env`는 사용·변경하지 않았고 `office:prepare`는 실행하지 않았다.

| 명령 | 실제 결과 |
| --- | --- |
| `pnpm --dir app/apps/server run build` | 통과. 최종 서버 소스에서 재실행 통과 |
| `node app/scripts/demo-office-pairing.mjs --test-pairing` | 첫 실행 25/26 통과, 기존 계정 중복 테스트에서 신규 SAS 확인 단계 누락으로 1 실패. 보완 후 26/26, 최종 위협/거절 영역 fixture 추가 후 **28/28 통과(4 files)** |
| `node app/scripts/demo-office-pairing.mjs` | SAS commit/reveal·양쪽 확인·관리자 선승인 거절을 포함해 **9/9 PASS**, 최종 build에서 재실행도 9/9 |
| `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake cargo check` (`app/apps/desktop/src-tauri/`) | 첫 실제 컴파일은 신규 Rust 테스트의 쉼표 변수 선언 문법 오류로 실패. 수정 후 **통과**, 기존 `semantic_hits` dead_code 경고만. 이보다 앞선 저장소 루트 실행 1회는 Cargo.toml 없음으로 시작 실패 |
| 같은 CMAKE로 `cargo test` (동일 디렉터리, 직렬 실행) | **통과**, unit 364 passed / 10 ignored, integration 8+4 passed, data-volume 1 ignored. TS/Rust SAS golden·거절 영역 fixture 포함. 실제 keychain/두 PC 테스트는 포함하지 않음 |
| `pnpm exec tsc --noEmit` (`app/apps/desktop/`) | **통과**(최종 재실행도 exit 0) |
| `git diff --check` | 통과 |

새 위협 검증은 커밋 뒤 nonce 변경/두 번째 커밋 거절, 다른 실제 세션의 서명된 커밋을 옮겨도 reveal 거절, 지문 양 view·세션·키 binding, 중복 reveal/확인 거절, 3회 실패·지연·기기 잠금, 요청자/관리자 SAS 확인 없이 요청·승인 거절을 다룬다. 이 작업은 화면/CSS를 변경하지 않았으며 Windows/macOS UI 검토, native Windows, 실제 초대 전달·OS keychain·다른 PC 간 TLS pairing은 미검증이다. 신규 명령의 `lib.rs` 등록은 코디네이터가 수행했다.

## 15. 메신저 초대와 native 합류 어댑터 계약 (2026-10-22)

### 초대 코드/링크

관리자의 `POST /office/invitations`는 기존 응답에 `invitationCode`, `invitationLink`를 추가한다. 기본 초대는 계정 없는 로컬 프로필용이다. 기존 회사 계정과 연결하려는 초대는 관리자가 `linkAccount: true`를 명시한다. 초대 수명은 5분이고 DB에는 비밀의 SHA-256만 저장한다. 최초 challenge에서 초대를 원자적으로 소비하므로 사용·취소·만료 후 다시 사용할 수 없다. 초대가 포함한 서버·세대·TLS pin과 실제 허브가 다르면 중단한다.

복사할 한 줄은 `IB1.<payload-base64url>.<checksum-8hex>`다. 링크 형태는 `infinitebrain://office/join#IB1.…`이며 코드와 같은 내용이다. fragment를 쓰므로 비밀을 HTTP query로 전송하지 않는다. 이것은 붙여넣기 파서의 링크 형식이며 OS deep-link 등록·자동 실행을 구현했다는 의미는 아니다. 코드에는 IP·포트·지문이 평문으로 보이지 않는다. 보통 약 160–250자이며 사람이 수동 입력하기보다 메신저에서 한 번 복사·붙여넣기한다. UI는 코드 원문을 React/Zustand 상태·저장소·로그·오류에 넣지 않고 비제어 입력 DOM에서 읽어 native 호출 후 비운다. clipboard history 자체는 앱이 통제하지 못하므로 관리자는 비공개 채널로 전달한다.

payload는 아래 순서의 binary이며 모든 숫자는 big-endian이다. base64url은 padding 없는 canonical 형식만 허용한다. 체크섬은 `SHA256(UTF8("infinite-brain/office-invitation/v1") || 0x00 || payload)` 앞 4 byte의 소문자 hex다. `0x00`은 NUL byte 하나다. 체크섬은 오타를 검출하는 수단이며 서명·인증 수단이 아니다. 코드 전체를 바꿀 수 있는 공격자는 체크섬도 다시 계산할 수 있다. 초대의 비밀 전달 경로, pinned TLS, commit-reveal SAS와 양쪽 사람 확인이 신뢰 경계를 이룬다.

| 순서 | binary 값 |
| --- | --- |
| 1 | version u8 = 1 |
| 2 | flags u8 = 0(기기만) 또는 1(기존 계정 연결 명시). 다른 bit 금지 |
| 3 | serverId byte 길이 u8(1–128), ASCII `[A-Za-z0-9_-]` serverId |
| 4 | 무작위 초대 비밀 32 bytes |
| 5 | TLS certificate SHA-256 32 bytes |
| 6 | host generation u64(1–999999999999999) |
| 7 | 만료 Unix seconds u64 |
| 8 | origin hint의 UTF-8 byte 길이 u16(0–256), origin bytes |

origin hint는 userinfo/path/query/fragment가 없는 canonical HTTPS origin만 허용한다. 개발 HTTP fixture에는 빈 hint를 넣으므로 native 제품 연결에 HTTP를 허용하지 않는다. 빈 hint이면 근처 후보를 선택해야 한다. 후보 ID는 Rust의 만료 가능한 발견 레코드로 해석하며 주소를 WebView로 돌려주지 않는다. 후보 `serverId`와 초대 `serverId`가 다르면 주소 연결·키체인 계정 읽기 전에 `hub_pin_mismatch`로 거절한다. 동일 ID를 사칭해도 초대의 pin·세대와 실제 TLS 허브 신원 검사를 통과해야 한다. 기존 `officeDiscoveryOpen`은 이미 승인된 pin의 재연결용 relay다. 최초 합류의 `officePairingBegin`은 같은 native `resolve_candidate`를 직접 사용하므로 relay URL/자격이 화면으로 돌아오지 않는다.

계정 연결 flag가 있을 때만 Rust가 기존 `session-v2:<origin>` 계정 키체인을 읽는다. 먼저 초대 pin으로 실제 TLS와 허브 신원을 검증하며, 선택 후보의 origin과 초대 hint의 origin이 정확히 같아야 한다. hint 부재/다른 origin/세션 부재는 `identity_link_required`로 실패하고 익명 요청으로 바꾸지 않는다. 계정 연결 flag가 없으면 계정 키체인을 읽지 않고 device-only 요청으로 진행한다. 이 기본 경로는 새 이메일 계정·일반 로그인 세션·자료 권한을 만들지 않으며 기존 §8의 승인 제한을 유지한다. 모든 신규 IPC는 main WebView만 호출할 수 있고 계정 토큰·초대 비밀·capability·원격 origin은 IPC 반환 타입에 없다.

### officeJoin.ts 포트와 이벤트

`createOfficeJoin(onEvent, ports?)`는 화면 없이 동작한다. 기본 포트는 typed IPC와 bounded discovery를 사용하고 테스트는 주입 포트를 쓴다. 공개 메서드는 `openDiscovery()`, `closeDiscovery()`, `begin(invitation, profile, candidateId?)`, `confirm(matches)`, `poll()`, `cancel()`, `close()`다. UI는 이 포트만 호출한다. `begin`은 초대 원문을 보관하지 않고 Rust에 전달한다. `confirm(true)`가 native SAS 확인과 `/request`를 순서대로 수행하며 native가 capability를 보유한 채 상태를 조회한다. `confirm(false)`도 불일치 보고를 전송한 뒤 취소하고 참여 요청은 보내지 않는다.

| 이벤트 | 화면에 허용하는 값 |
| --- | --- |
| `DISCOVERY_STARTED` | 없음 |
| `CANDIDATES_UPDATED` | `candidateId`, `displayName`, `trust: untrusted-candidate`만 |
| `CANDIDATE_SELECTED` | 선택한 opaque `candidateId` |
| `JOIN_STARTED` | 초대 힌트만으로 시작함. 후보 선택 없이 SAS 대기로 이어질 수 있음 |
| `SAS_RECEIVED` | native가 파생한 6자리 `sas` |
| `SAS_CONFIRMED` | boolean `matches` |
| `JOIN_REQUESTED` | 로컬 대기 종료시각 `approvalExpiresAt`(epoch ms) |
| `APPROVAL_GRANTED` | 승인 확인. 자료 저장 완료·vault 권한 부여를 뜻하지 않음 |
| `APPROVAL_REJECTED` / `APPROVAL_CANCELLED` / `APPROVAL_EXPIRED` | 종료 상태만 |
| `FAILED` | 제한된 `OfficeErrorCode`만. 원본 Error/cause/response 없음 |

승인 폴링은 3초 간격, 최대 200회/10분이며 서버 만료가 더 이르면 그 시각에 끝난다. 수동 `poll()`도 간격을 우회할 수 없다. `close()`는 timer/discovery를 중단하고 native 요청을 취소한다. 늦게 도착한 begin/confirm 결과는 취소하고 상태 응답은 무시한다. 로컬 10분 제한은 서버의 24시간 승인 대기 TTL과 별개이며, 제한이 끝나면 요청 취소를 시도하고 새 초대로 다시 시작하도록 한다. 취소 전송이 실패해도 로컬 capability는 제거한다. 원문 입력과 IPC 응답의 추가 필드는 이벤트로 복사하지 않는다.

`/status`는 거절을 `approval_rejected`(409), 취소를 `request_cancelled`(409), 만료를 `expired`(410)로 구별한다. native 어댑터가 이 코드를 고정 오류로 바꾸며 임의 서버 message는 사용하지 않는다. 이 작업은 직원 화면·i18n·officeFlow reducer를 편집하지 않으며 해당 화면 연결은 다음 작업이다.

### 관리자 불일치 보고 보호

`officeClient.confirmSas(false)`도 실제 `sas-confirm`을 호출한다. JSON boolean만 허용하고 문자열 `"false"`는 실패 횟수에 넣지 않는다. 유효 requester capability 또는 현재 관리자 권한·본인 확인 금지를 통과한 보고만 집계한다. 이미 같은 세션에서 관리자가 일치 확인을 했더라도 아직 승인 전이면 불일치를 보고할 수 있다.

Migration 069의 `sas_mismatched_at`은 첫 불일치 때 설정하며 양쪽 기존 확인을 지운다. 이 보호 표식은 재시도 지연이 끝나도 유지한다. 해당 세션의 추가 일치 확인·참여 요청·승인은 실패한다. 불일치 보고는 기존 1초·2초 backoff 이후 다시 집계할 수 있고 세 번째 실패에 세션 취소·기기 회수·키 fingerprint 5분 잠금을 적용한다. 일반 proof 실패 뒤 올바른 proof를 재시도하는 기존 계약은 유지한다. 임의 capability·일반 직원·malformed 입력으로 타인의 실패 횟수를 올릴 수 없다. 실패 변경은 기존 transaction으로 commit하고 refused audit는 별도 transaction에서 기록하며 비밀·숫자 원문은 감사에 넣지 않는다.

### §15 최종 검증 결과

| 검사 | 실제 결과 |
| --- | --- |
| `pnpm run build` (server) | 통과. mismatch audit 추가 뒤 최종 재실행 통과 |
| `node app/scripts/demo-office-pairing.mjs --test-pairing` | 최종 **6 files / 34 tests 통과**. `tests/office-pairing*`와 `src/office` protocol 테스트 전체 포함 |
| `node app/scripts/demo-office-pairing.mjs` | 최종 **11/11 PASS**. 초대 코드/링크·오타 검출·관리자 불일치 후 승인 차단 포함 |
| `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run` (desktop) | 최종 **361 passed / 2 skipped files, 3708 passed / 12 skipped tests**. 신규 officeJoin 13 tests 포함. 최초 실행의 미편집 memberProfilePage 2개 실패는 전체 재실행과 코디네이터 환경에서 재현되지 않았으며 일시적/간헐 가능성이 있음 |
| `pnpm exec tsc --noEmit` (desktop) | 최종 통과. 신규 테스트의 ES target 비호환 `Array.at`을 배열 인덱싱으로 수정 |
| `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake cargo check` | 1회 통과. 기존 semantic_hits dead_code 경고만 |
| 같은 CMAKE로 `cargo test` | check 종료 후 직렬 1회 통과. unit **366 passed / 10 ignored**, integration **8+4 passed**, data-volume 1 ignored |
| `git diff --check` | 통과 |

서버 두 차례 테스트와 두 차례 데모 각각은 runner가 새로 `initdb`한 disposable cluster만 사용하고 종료 시 정리했다. 공유 DB·기존 `.env`·office:prepare·커밋·푸시는 사용하지 않았다. UI/CSS/i18n/officeFlow는 변경하지 않았고 Windows/macOS 화면 연결은 다음 작업이다. 실제 두 대 PC, Windows/macOS OS keychain, 방화벽·실제 LAN의 TLS/SAS는 미검증이며 browser simulation이나 임시 HTTP DB 데모가 이를 대신하지 않는다.

## 16. 승인 후 세션과 vault 연결

2026-10-22 확정: 기존 `person_identity.linked_user_id`의 Better Auth user와 활성 team member만 기기 세션을 받을 수 있다. 별명이나 승인 상태 자체는 권한 주체가 아니다. 기본 정책은 **existing-membership-only**다. 승인 조직의 `vaults.organization_id`를 조회하여 실제 vault ID를 얻고, 기존 resolver/읽기 집합이 허용하는 자료만 접근한다. 신규 user/member/share/ACL을 만들지 않으며 organizationId와 vaultId를 동일시하지 않는다. 승인 조직 밖에는 같은 user의 별도 membership이 있어도 기기 세션을 사용할 수 없다.

계정이 없는 직원의 현재 절차: 허브에는 Better Auth의 `POST /api/auth/sign-up/email` 이메일·비밀번호 가입 경로가 실제로 있다. 같은 허브에서 실제 이메일로 계정을 만들고 관리자가 기존 membership을 부여한 뒤 `linkAccount=true` 초대를 다시 받아야 한다. 이는 가입 HTTP API의 존재 확인이다. office 합류 화면에서 pinned TLS 가입/로그인과 `session-v2:<origin>` 준비를 끝내는 bootstrap UI는 아직 연결되지 않았으며, 현재 native 합류는 해당 허브의 기존 계정 자격이 준비되어 있어야 한다. 이메일 없는 직원은 `account_required`로 거절하며 가짜 이메일을 생성하지 않는다. 이메일 없는 office user는 후속 과제다. `user.email` NULL 허용에 따른 Better Auth 로그인·초대·알림·MCP·감사 및 표시 계약의 호환성 검증이 필요하며 migration 070에는 포함하지 않는다.

기기 인증은 `POST /api/office/sessions/challenge`의 60초 무작위 challenge와 `POST /api/office/sessions`의 Ed25519 서명 교환이다. SHA-256 canonical transcript는 도메인 `IB-OFFICE-SESSION-1`, challenge ID, 기기 ID, 서버 ID, generation, audience, TLS fingerprint, nonce, 만료를 순서대로 UTF-8 byte length(u32 BE)와 값으로 인코딩한다. DB에는 nonce와 토큰의 SHA-256만 저장한다. challenge는 row lock 아래 단 한 번 소비하고 서명 실패도 소비한다. 발급·연결·HTTP마다 승인 pairing, person/device, office membership, 실제 member와 host identity를 재검사한다. 세션 TTL은 10분 이하, sync JWT는 이 세션 ID에 결합한다. 회수 뒤 기존 JWT 재연결도 거절한다.

회수는 DB commit 뒤 기존 PubSub와 같은 authorization topic 패턴으로 기기 세션의 문서/vault 소켓을 닫는다. 구독은 인증 검사 전에 걸어 연결 중 회수 경쟁도 닫는다. HTTP·연결 시 DB를 재조회하며 매 문서 메시지마다 DB를 조회하지 않는다. 기기 세션은 권한을 위임하는 MCP/OAuth/초대/계정 관리 경로를 사용할 수 없다. 별도 계정 인증은 기존 동작을 유지한다.

Rust는 pinned TLS 위에서 기기 키로 서명하고 `<app-id>.office-device.v1` 서비스의 `office-session-v1:<origin>`에 세션을 저장한다. 기존 계정의 `session-v2:<origin>`과 분리하며 generic keychain IPC로 읽을 수 없다. JS에는 토큰을 반환하지 않는다. office_link relay가 HTTP bearer를 대체하고 계정 cookie를 제거한다. JS의 ApiClient와 Yjs provider는 `openOfficeLink`가 반환한 동일 loopback base URL을 사용한다. relay capability와 실제 토큰은 영속 설정에 쓰지 않는다. 재연결 때 Rust가 새 challenge로 새 세션을 얻는다. 승인 이벤트는 세션 저장이 성공한 뒤에만 반환한다. 기존 startup pull-before-seed, 삭제/회수·bridge echo guards는 변경하지 않는다.

| 권한 경로 | 적용 근거 |
|---|---|
| resolver | 기기 인증이 기존 linked userId를 반환하고 기존 effectivePermission/syncPermission을 그대로 호출 |
| readable-set | 허브 조직에 속한 vault만 HTTP/WS 경계 통과, 기존 listReadableDocsInVault 사용 |
| HTTP/검색/graph/bootstrap | office HTTP 경계에서 조직·vault 검증 후 기존 routes와 resolver 실행 |
| Hocuspocus | JWT의 officeSessionId와 user/vault binding을 연결 때 검사, 회수 PubSub로 socket 종료 |
| vault-sync | 동일 binding 검사와 회수 구독 후 기존 readable-set/backfill/fanout |
| blobs | blob의 vault 조회로 허브 범위 확인 후 기존 blob ACL; 위임 presign 발급은 office에서 차단 |
| MCP/OAuth 및 토큰 발급 | office 인증으로 접근 명시 거절; 별도 기존 계정/MCP 인증만 지원 |
| 감사 | migration 062 AuditClient transaction 안에서 발급/실패 기록, 회수는 기존 pairing audit에 결합; 키·서명·nonce·토큰 원문 없음 |


§16 HTTP 경계 보강: content route는 prefix가 아닌 명시된 전체 경로 allowlist다. 공개 링크·초대·MCP/OAuth·멤버/권한·계정·결제 및 presigned blob intent는 device 인증에서 거절한다. path/query(중복 파라미터 포함)/body의 vaultId를 모두 검사하고 서로 다르면 같은 조직 안에서도 거절한다. organizationId도 모두 승인 조직과 일치해야 한다. 실제 item/blob가 가리키는 vault와 별도 주장이 다를 때도 거절한다. 허용 목록에는 기존 folders/notes/files 등록 batch, binary docs batch, delete batch와 bootstrap이 포함된다. ACL 판정과 삭제·회수 guard는 기존 handler를 통과한다.
