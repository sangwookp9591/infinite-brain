# A0 허브 권한 설계 보고서

2026-10-17 · 브랜치 `sangwookpark/ib-hub-a0` · 시작 HEAD `c10a7ea` · 워커 a0 · 모델 claude-opus-5-5.

PRD v2 §9 A0의 설계 문서 [`docs/superpowers/specs/2026-10-17-hub-a0-authorization-design.md`](../superpowers/specs/2026-10-17-hub-a0-authorization-design.md)를 작성했다. 코드는 바꾸지 않았다.

## 변경

- **§3 기대 권한 표:** 역할 5개(owner/admin/member/guest/external, 익명 포함) × 리소스(vault, folder, note, blob, history, trash, invite, audit, MCP) × 동작. 판정 계약은 R1~R5다. R1은 활성 관계가 없으면 어떤 공유로도 접근할 수 없다는 규칙, R2는 조직 단위 권한을 팀 역할에만 준다는 규칙, R3은 guest가 자기 개인 공유에서만 권한을 얻는다는 규칙이다.
- **§4 D6 경로 체크리스트:** 64개 경로(D6-01~64). 각 행에 파일·함수·줄, 현재 판정, 게스트 추가 시 바꿀 점, 통합 테스트 이름을 적었다. 공통 고정 시나리오는 §4.0에 있다.
- **§5 불일치 목록:** 게스트와 무관하게 지금 있는 결함 M1~M9, 게스트 도입 시 생기는 불일치 G1~G15.
- **§6 기존 데이터 migration 기본값, §7 `POST /shares` 대상 검증(V1~V9), §8 메일 없는 자체 설치 환경(E1~E7).**
- **§9 A1 작업 분해:** 7개 조각, 의존 순서, migration 061~065, 테스트 이름, commit 단위.
- **§10 미해결 결정:** Q1~Q15. 아래에 다시 적었다.

## 주요 발견 (일회용 DB에서 재현)

| ID | 내용 | 결과 |
|---|---|---|
| P1 | member 행이 없는 사용자에게 파일 단위 개인 공유가 있으면 `POST /api/sync-token`이 통과한다 | 200, `permission: "edit"`. vault 채널 토큰은 403이라 두 경로의 판정이 다르다 |
| P2 | `POST /shares`가 비멤버 ID와 존재하지 않는 ID를 받는다 | 둘 다 201 |
| P3 | **제거된 멤버가 자기가 만든 노트에 자기 공유를 만들면 편집 sync 토큰을 다시 받는다** | 403 → 자기 공유 201 → 200 |
| P4 | `role='guest'` member 행에 join snapshot이 생긴다 | `mode: private` 행 생성 |

P3은 지금 운영 중인 서버에도 있는 권한 우회다. 설계 문서는 이것을 A1-1의 첫 조각(결정 없이 진행 가능)으로 두었다. P1과 P3은 토큰 발급까지만 확인했다. Hocuspocus 연결 단계는 같은 판정 함수를 다시 부르므로 허용될 것으로 보지만, 이 부분은 미검증이다.

## 검증 명령과 결과

`app/`에서 `pnpm install --frozen-lockfile`을 실행했다(성공). 서버 테스트는 이 워커 전용 일회용 Postgres에서 돌렸다.

- DB: `docker run -d --name ib-test-a0 -e POSTGRES_USER=ibtest -e POSTGRES_PASSWORD=ibtest -e POSTGRES_DB=ibtest_a0 -p 127.0.0.1:55451:5432 postgres:16-alpine`
  - 작업 지시에 포트가 적혀 있지 않아서, 사용 중이 아닌 55451을 골랐다.
  - 공유 `context` DB는 쓰지 않았다.
- `app/apps/server/`에서 `DATABASE_URL=postgres://ibtest:ibtest@127.0.0.1:55451/ibtest_a0 npx vitest run` 실행. 대상은 다음 20개 파일이다: `tests/permissions.test.ts`, `vault-docs`, `shares`, `http-authz-gates`, `sync-token`, `member-access-defaults`, `join-default-seed`, `orgs`, `invitations`, `invitations-access`, `mcp-access-surface`, `resolve-access`, `person-vault-level`, `member-access-manager`, `members-overview`, `vault-channel-member-removed`, `blob-visibility`, `public-links`, `team-access`, `access-deny`.
  - 결과: **20개 파일, 208개 테스트 통과**(453초).
- probe 테스트 `app/apps/server/tests/zz-a0-probe.test.ts`(P1~P4)를 같은 DB에서 `--reporter=verbose`로 실행했다.
  - 4개 통과. 위 결과는 콘솔 출력에서 읽었다.
  - 이 파일은 실행 후 지웠고 커밋하지 않았다.
- `git diff --check` 통과. 문서만 바뀌었으므로 tsc, cargo, desktop vitest는 실행하지 않았다.
- 정적 확인 범위: resolver, vault-docs, http-gates, shares, members, orgs, invitations, auth, sync-token, vault-token, Hocuspocus, vault channel, bootstrap, registry, blobs, MCP, public links, versions, trash, migration 001·002·005·032·033.
  - 보조 조사 에이전트 두 개가 MCP·첨부·공개 링크와 동기화·vault 채널·멤버 경로를 나눠 읽었다.
  - 문서에 쓴 줄 번호 가운데 핵심 30여 곳은 직접 다시 대조했다.
- Better Auth 1.6.23의 초대 역할 검증(`dist/plugins/organization/routes/crud-invites.mjs:101-122`)을 직접 읽었다.

## 미검증

- P1·P3의 Hocuspocus 연결 단계(토큰 발급까지만 재현)
- 공유 회수 때 다른 서버 인스턴스의 Hocuspocus 소켓이 닫히는지(`@hocuspocus/extension-redis` 동작, M8)
- Better Auth 자체 조직 엔드포인트(`list-members`, `get-full-organization`, `leave` 등)의 역할 제한과, `leave`가 우리 쪽 정리를 거치는지(M9)
- 공개 링크 gate와 M1의 결합(M4, 코드에서 추론)
- 구버전 데스크톱의 `role: "guest"` 처리
- Hocuspocus awareness에 실리는 사용자 이름(클라이언트가 정한다)

## 미해결 결정 (사용자 승인 필요)

설계 문서 §10에 선택지, 권장안, 영향을 함께 적었다. 권장안은 문서의 기본 가정이며, 승인 전에는 해당 조각을 진행하지 않는다.

1. **Q1** 비멤버에게 이미 저장된 개인 공유의 처리. 권장: 권한을 끊고 행은 보존한다.
2. **Q2** 기존 참가 코드의 만료. 권장: 배포 후 30일, 새 코드는 7일.
3. **Q3** guest의 폴더 경로 표시. 권장: 공유 폴더를 진입점으로 경로를 다시 잡는다(비용이 커서 착수 전 추정 필요).
4. **Q4** guest에게 vault 이름을 보여 줄지. 권장: 표시 이름만 보여 주고 다른 note collection 이름은 숨긴다.
5. **Q5** 공유 노트 안에서 다른 사람 이름. 권장: "다른 사용자"로 가린다.
6. **Q6** member가 대기 중 초대 이메일을 볼지. 권장: owner/admin만 본다.
7. **Q7** guest의 MCP 연결. 권장: A1에서는 금지한다.
8. **Q8** member→guest 강등. 권장: 허용하고 정리·확인·감사 기록을 남긴다.
9. **Q9** 정책을 바꿀 때 기존 공개 링크. 권장: 바로 열람을 막는다.
10. **Q10** guest의 결제 좌석 계산. 요금 정책 결정이 필요하다.
11. **Q11** 감사 로그 기본 보존 기간. 권장: 1년.
12. **Q12** 외부 공유 정책의 기본값과 변경 권한. 권장: 모두 `on`, owner/admin이 바꾼다.
13. **Q13** 만든 사람인 member가 guest에게 공유할 수 있을지. 권장: owner/admin만 가능.
14. **Q14** 메일 없는 서버의 guest 수락 승인. 권장: A1은 바로 합류, A2 승인 대기열이 생기면 기본으로 요구한다.
15. **Q15** 메일 없는 서버의 `domains` 정책. 권장: 확인된 이메일(Google 로그인)만 인정한다.

## 남은 일

- 설계 문서 승인(A0 출시 조건)과 위 결정
- A1-1 선행 보안 수정. 특히 P3은 운영 서버에도 있는 결함이므로 우선 처리를 권한다.
- A1 착수 전 Q3(경로 재기준)의 비용 추정
- 미검증 항목 M8, M9는 A1-5와 A1-7의 첫 작업으로 확인한다.

## 정리

- 일회용 컨테이너 `ib-test-a0`는 보고서 작성 후 제거했다(다른 컨테이너는 건드리지 않았다).
- `app/node_modules`는 이 worktree 안에 남아 있다(pnpm 저장소 링크).

## 커밋

- `6e89d1e` docs: draft A0 hub authorization matrix and D6 path checklist
- `24987fb` docs: add A0 migration defaults, share target rules, no-email behavior and A1 breakdown
- (이 보고서) docs: add A0 implementation report
