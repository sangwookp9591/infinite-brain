---
type: handoff
product: Infinite Brain
date: 2026-10-16
tags: [handoff, roadmap, team-second-brain]
---

# 다음 작업 (2026-10-16 인수인계)

다른 PC에서 이 문서만 읽고 이어서 할 수 있게 정리했다. 기준 문서는 [팀 세컨드 브레인 PRD v2](superpowers/specs/2026-10-15-team-second-brain-prd.md)이고, 최우선 원칙은 §0.1 "개발을 모르는 사람도 쓸 수 있어야 한다"이다. 작업 규칙은 루트 [`CLAUDE.md`](../CLAUDE.md)를 따른다.

## 1. 지금 상태

### `main`에 들어간 것 (2026-10-16)

| 항목 | 산출물 | 검증 |
|---|---|---|
| PRD v2 + 비개발자 원칙 | `docs/superpowers/specs/2026-10-15-team-second-brain-prd.md` | Astra 리뷰 반영 |
| A0 허브 권한 설계 | `docs/superpowers/specs/2026-10-16-a0-authorization-design.md` | Opus 검증 "수정 후 승인" → 반영 완료 (`docs/reports/A0-VERIFY-opus.md`) |
| B0-a llama.cpp 내장 실험 | `app/apps/desktop/spikes/b0-llama/`, `docs/reports/B0-LLAMA-SPIKE.md` | Opus 검증 → 반영 완료 (`docs/reports/B0-LLAMA-VERIFY-opus.md`) |
| B0-b 첫 실행 "스마트 검색" 시안 | `app/apps/desktop/dev/design-lab/smartSearchScene.tsx`, `docs/reports/B0-FIRST-RUN-MOCK.md` | Sonnet 리뷰 "수정 후 승인" → 반영 완료 |
| Kit `ActivityHeatmap` | `app/apps/desktop/src/components/kit/ActivityHeatmap.*` | Sonnet 리뷰, 결함 12건 수정. **앱에는 붙이지 않음(쓸 곳이 생기면 사용)** |
| Kit `ToolCallCard` · `ToolCallGroup` | `app/apps/desktop/src/components/kit/ToolCallCard.*` | Sonnet 리뷰, 테스트 29개. 앱 연결은 아래 T2 |
| README 갱신 | `README.md` (Design, Roadmap 섹션) | 링크 전수 확인 |

### 아직 브랜치에만 있는 것

| 브랜치 | 내용 | 상태 |
|---|---|---|
| `iron/docs-c0-p2p` | C0 P2P 설계 r4 (`docs/superpowers/specs/2026-10-16-c0-p2p-design.md`)와 검증 보고서 5개 | 4차 확인 결과 "수정 필요" (`docs/reports/C0-REVERIFY3-opus.md`, `e4fd2e1`). 규칙 문장 4곳만 고치면 된다. → T3 |

나머지 `iron/*` 브랜치(`docs-a0-authz`, `spike-b0-llama`, `feat-b0-first-run`, `feat-b0-capacity-q8`, `feat-kit-heatmap`, `feat-kit-toolcall`)는 모두 `main`에 머지됐으므로 지워도 된다.

> **다른 PC에서 이어가려면** `main`과 `iron/docs-c0-p2p`가 원격에 있어야 한다. 이 문서를 쓴 시점에는 둘 다 push하지 않았다.

### 알려진 기존 결함 (A0에서 발견, 코드 미수정)

| ID | 심각도 | 내용 | 위치 |
|---|---|---|---|
| (a) | 높음 | 내보낸 멤버가 자기가 만든 노트에 `POST /shares`로 자기 공유를 다시 걸어 sync token과 공개 링크를 얻는다. 사용자 단위 공유가 멤버십을 보지 않고, `canManage`가 만든 사람이면 역할 없이 통과시킨다 | `server/src/permissions/resolver.ts:574-585`, `http/routes/shares.ts:259-268, 524-540`, `http/routes/sync-token.ts:105-116` |
| (b) | 중간 (a와 결합 시 높음) | 멤버 제거 hook과 `/organization/leave`가 사용자 단위 공유를 남긴다 | `server/src/auth/auth.ts:386-391` |
| (c) | 중간 | MCP `listFolders`가 ACL 없이 vault의 모든 폴더 이름을 돌려준다 | `server/src/mcp/service.ts:289-306` |

정적 분석으로 확정했고 DB 테스트로 재현하지는 않았다. 세부는 A0 설계 §0, §3, §9.

## 2. 다음 작업

권장 순서: **T1 → T2**, T3·T4는 독립이라 아무 때나 병렬.
모델 배치는 사용자의 model-routing 규칙(Codex=실행, Claude=판단, 구현자와 검증자 분리)을 따른다. 배치는 실행 전에 사용자 승인을 받는다.

### T1. A1-0: 기존 권한 구멍 3개 수정 (최우선)

- **목표:** 위 (a)(b)(c)를 막는다. 게스트 기능(A1 나머지)을 기다리지 않고 따로 출시할 수 있다.
- **입력:** A0 설계 §3.1(resolver), §3.7(MCP), §5(`POST /shares` 대상 검증 규칙), §8(경로별 통합 테스트 목록), §9(A1 작업 분해 중 A1-0 항목), 부록 A, 끝의 "검증 반영 기록".
- **범위:**
  - 사용자 단위 공유 판정에 활성 멤버십 확인을 넣는다. 공유 행만으로 권한이 되살아나지 않게 한다.
  - `POST /shares`는 대상이 그 조직의 활성 멤버일 때만 받는다. 만든 사람 예외가 제거된 멤버에게 적용되지 않게 한다.
  - 멤버 제거와 `/organization/leave` 둘 다 그 사람의 사용자 단위 공유를 정리한다(같은 트랜잭션). 기존 세션·sync token 처리도 A0 §3.11 기준으로 맞춘다.
  - MCP `listFolders`를 데스크톱 폴더 트리와 같은 읽기 가능 필터로 거른다.
  - A0 §3.1의 `role !== null` 관련 A1-0 항목도 함께 처리한다.
- **완료 기준:** 세 구멍 각각의 거부 케이스 통합 테스트가 실패 → 수정 후 통과. 기존 서버 테스트 전부 통과. 권한 판정이 resolver·읽기 목록·HTTP·sync·MCP에서 일치(CLAUDE.md 불변식).
- **검증 명령:** `app/apps/server`에서 `pnpm test` (**전용 일회용 DB**의 `DATABASE_URL`로. 공유 `context` DB 금지). 데스크톱 영향이 있으면 `app/apps/desktop`에서 `NODE_OPTIONS=--no-experimental-webstorage pnpm test`.
- **배치 제안:** 구현 Codex Sol / high, 독립 검증 Claude Opus / high.

### T2. AI 도구 호출 기록 확장 + ToolCallCard 연결

사용자 결정(2026-10-16): **AI 변경 기록 화면에 붙이고, 기록 계약도 확장한다.** T1이 서버 권한 코드를 건드리므로 T1 뒤에 시작한다.

- **배경:** 지금 원장(`ai_change_ledger`, 마이그레이션 057, 계약 [`AI-CHANGES.md`](AI-CHANGES.md))은 노트를 실제로 바꾼 성공 호출만 기록한다. 호출 입력, 실패, 걸린 시간이 없다. 데스크톱 `AiChange` 타입에는 서버의 `tool` 필드도 빠져 있다.
- **설계(T2-a)에서 정할 것:**
  1. 새 테이블(예: `mcp_tool_calls`, 마이그레이션 060): 조직·vault·연결·실행 사용자, 도구 이름, 입력(크기 상한, 비밀값 가리기), 상태(success/error), 오류 코드·메시지, 걸린 시간, 시각, 연결된 원장 행 ID(nullable).
  2. **기록 대상:** 쓰기 도구만(권장) 또는 읽기 도구 포함. 사용자 미결정. 권장안은 쓰기 도구만이다(읽기까지 남기면 기록이 폭증).
  3. 원장과의 관계: 성공한 쓰기 호출은 원장 행과 같은 트랜잭션에서 호출 행을 남기고 서로 연결한다. 실패한 호출은 호출 행만 남는다.
  4. 보존 90일, 정리 작업은 기존 원장 정리와 같은 방식. vault 삭제 CASCADE.
  5. 조회 권한은 기존 AI 변경 API와 같은 규칙. 문서 읽기 권한이 없으면 입력에 담긴 본문도 내보내지 않는다.
  6. API: 기존 `GET /api/vaults/:vaultId/ai-changes` 응답에 호출 정보를 붙일지, 별도 목록 경로를 둘지.
- **구현(T2-b) 범위:** 서버 마이그레이션, MCP 호출 기록, API, `docs/AI-CHANGES.md` 계약 갱신, 데스크톱 `src/lib/aiChanges.ts` 타입(`tool` 포함), `src/components/AiChanges.tsx`를 `ToolCallCard`/`ToolCallGroup`으로 표시(연결별 그룹, 실패는 오류와 함께, 되돌리기는 기존 동작 유지).
- **필드 대응(이미 조사됨):**

| 카드 | 데이터 |
|---|---|
| `name` | 호출 기록의 도구 이름 (원장의 `tool`) |
| `summary` | `op` + `after_path`/`after_title` + `connection_label` |
| `args` | 새 호출 기록의 입력 (상한·가리기 적용) |
| `result` | 성공: 원장 상세의 전후 diff, 실패: 오류 |
| `status` | 새 호출 기록의 상태. 되돌린 항목은 `reverted_at`으로 표시 |
| `duration` | 새 호출 기록의 걸린 시간 |

  `ActivityFeed.tsx`의 실패 행은 노트 동기화 실패이므로 도구 호출로 재해석하지 않는다.
- **완료 기준:** 서버 통합 테스트(성공·실패·권한 없음·보존 정리·상한 초과), 데스크톱 테스트, `pnpm lint` 오류 0, 디자인 랩 또는 시뮬레이터 스크린샷.
- **배치 제안:** 설계 Claude Opus / high → 구현 Codex Sol / high → 독립 검증 Claude Opus / high.

### T3. C0 마무리 → C1 LAN 실험

- **4차 확인 결과(2026-10-16, `docs/reports/C0-REVERIFY3-opus.md`):** 수정 필요. N14 닫힘, N15·N16 부분, 새 높음 N17 1건.
  - N15: 복구 직후의 복구 키 교체(RR)는 §4.5.1-5-a 조건 때문에 언제나 단독이 되어, 복구에 쓴 코드의 사본이 영구 동결 스위치로 남는다.
  - N16: 스냅샷 본문의 pending struct/delete set이 상태 해시 D_c에 잡히지 않은 채 새 기기 live doc에 들어가고, 삭제 단위의 origin이 D에 없다(yjs 13.6.31 소스로 확인).
  - N17: 5-a의 "인수로 생긴 권한 기기" 조건이 권한을 한 번 넘기는 세탁으로 우회되어, 복구에 쓴 코드 사본이 정당한 복구를 이긴다. 평가 순서 ① 안에 고정점 비결정성도 생긴다.
- **할 일(r5):** 보고서가 제시한 규칙 문장 4곳만 고친다(Opus / high, `iron/docs-c0-p2p`에서).
  1. 두 자격(공동 서명자, 인수 기기)을 계보로 판정한다.
  2. 복구로 은퇴한 세대에 대한 주장을 좁힌다.
  3. pending이 남은 스냅샷은 거부하고, 재인코딩한 상태를 채택한다.
  4. 삭제 단위 origin을 D에 넣는다.
- **그다음:** 이 항목만 별도 Opus 세션에서 다시 확인한다. "C1 진행 가능"이 나오면 `iron/docs-c0-p2p`를 `main`에 머지하고 README Roadmap의 C 행을 갱신한다. 지금까지 1차 → 재검증 → 3차 → 4차로 범위가 계속 좁아졌다(높음: 4 → 2 → 3 → 2+1).
- **알아둘 것:** 분기 규칙, 키 확인값, 복구 키 감싸기, checkpoint, 상태 해시 D는 표준이 아닌 직접 구성이다. 형식 검증은 하지 않았고 C1 속성 기반 테스트와 C2 외부 보안 리뷰로 넘겼다. 재생 비용(중)은 범위 밖으로 남아 있다. OpenMLS를 C2에서 대안으로 검토한다.
- **C1 계획:** C0 설계 문서의 C1 절(범위: 텍스트 전용 새 vault, 같은 망 2~3대, 성공 기준과 측정).

### T4. B1 착수 준비 (기기 안 스마트 검색)

`docs/reports/B0-LLAMA-SPIKE.md`의 "B1 착수 전 처리 목록"을 그대로 따른다. 요점:
- `llama-cpp-2`(0.1.160)의 번들 llama.cpp는 EmbeddingGemma 2(`gemma-embedding2`)를 모른다. git 버전 고정으로는 안 되고 **포크**가 필요하다.
- 기본 모델은 **Q8_0(약 310MB)**, 저사양은 Q4_K_XL(약 180MB). Q4는 상위 3개 순위가 BF16과 18~19/24만 일치하므로 B1 검색 평가로 품질 기준을 정한다.
- 미측정: Windows, Linux, Intel Mac, 디스크 cold, 배터리. x86 AVX, Vulkan 로더, CRT, CI 빌드 시간, in-process abort 처리.
- 모델 카드의 사용·배포 조건 법무 확인 5건.
- 시안 화면은 해요체, 위험 버튼은 `--text-on-danger` 토큰이 필요(`docs/reports/B0-FIRST-RUN-MOCK.md`).

## 3. 이어서 작업하는 방법

1. `git pull`로 `main`과 `iron/docs-c0-p2p`를 받는다.
2. 루트 `CLAUDE.md`, 이 문서, PRD §0.1·§9를 읽는다.
3. 위 T1~T4 중 고른 작업의 배치를 사용자에게 제안하고 승인받는다.
4. 작업은 `main`에서 갈라진 브랜치에서 하고, 독립 검증을 통과한 뒤 `main`에 머지한다. push는 사용자가 요청할 때만 한다.
5. 끝나면 이 문서의 "지금 상태"와 README Roadmap을 갱신한다.

**환경 메모:** Node 25에서는 데스크톱 테스트에 `NODE_OPTIONS=--no-experimental-webstorage`가 필요하다. Codex CLI가 `chatgpt.com`에 연결되지 않으면 TUI 시작에서 `account/read failed`로 바로 꺼진다(2026-10-16에 한 번 발생했다가 회복). 그때는 같은 작업을 Claude Sonnet으로 대체했다.
