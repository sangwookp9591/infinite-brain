# 리디자인 최종 화면 감사 (Orbit)

기준: `/private/tmp/ib-design/orbit/` 시안과 directions 문서 §6–§7. 방법: window-simulator(macOS 모드, 합성 데이터)를 light/dark × 1440/720으로 촬영(136장, `/private/tmp/ib-redesign/final/`)하고 각 조합에서 `scrollWidth - clientWidth`(가로 넘침)와 페이지 오류를 기록했다. 결과: **모든 촬영에서 가로 넘침 0, 페이지 오류 0**. 판정: 통과 = 수정 없이 시안 문법에 부합, 수정 = 감사 중 고침, 남음 = 이번 범위에서 못 고침.

| 화면 | 파일 접두사 | 판정 | 내용 |
|---|---|---|---|
| 웰컴 / vault picker | `welcome-*` | 통과 | Fraunces 워드마크, 생성 마크 vault 카드 |
| 메인(셸 + 에디터 시트) | `main-*` | 수정 | 헤더가 시트 안에 있던 것을 캔버스로 올림(P3/P4 조율 항목). 시트는 `.editor-wrap`만 |
| 검색 | `search-*` | 통과 | |
| vault switcher | `switcher-*` | 통과 | |
| 활동 패널 | `panel-*` | 수정 | 기본 `<select>`가 OS 모양이던 것을 전역 select 스타일로, 한국어 문구를 영어로 |
| 계정 설정 8탭 | `account-*` | 수정 | Appearance 기본 색 견본이 검은 "Ink"였음 → Orbit 보라("Orbit") |
| vault 설정 9탭 | `vault-*` | 수정 | "AI 연결" 탭 이름을 "AI connections"로 |
| 공유 | `share-*` | 통과 | |
| 멤버 목록·권한 메뉴 | `vault-members-and-access-*`, `member-access-menu-*`, `member-actions-menu-*` | 통과 | |
| 멤버 프로필 / 권한 보드 | `member-profile-*`, `access-board-*` | 통과 | |
| 초대(게스트 포함) | `invite-*` | 통과 | |
| 외부 공유 정책 / 회수 / 보안 기록 | `vault-security-*`, `external-revoke-*` | 수정 | 회수 확인 버튼(`primary danger`)이 기본 보라였음 → 전역 danger pill |
| 빌링 / 업그레이드 | `vault-billing-*`, `account-plan-billing-*`, `upgrade-*` | 통과 | |
| 확인 다이얼로그 | `confirm-*` | 통과 | |
| 토스트·배너 | `toast-*` | 통과 | 합성 환경에서는 배너형 오류만 재현됨(아래 미검증) |
| 대시보드(Home) | `home-*` | 통과 | 템플릿 내부 색은 사용자 콘텐츠 미리보기라 자체 팔레트 유지 |
| 그래프 | `graph-*` | 통과 | 헤드리스 Chrome에서 GPU 없이 2D 폴백 |
| Health / Housekeeper | — | 미검증 | simulator에서 진입 경로가 없어 이번 촬영에 없음(P6+P7 보고서에 단독 촬영 기록) |

## 감사 중 발견한 어긋남과 조치
1. **헤더/시트 경계(P3·P4)**: 헤더와 breadcrumb·탭이 시트 안에 있어 시안(캔버스 위 헤더, 아래 시트)과 달랐다. `.main`을 투명 열로, 시트 스타일을 `.editor-wrap`으로 옮겼다. 배너·공지는 헤더와 시트 사이 캔버스에 놓인다.
2. **전역 `<select>`**: `.modal`/`.account-popover` 안에서만 스타일돼 활동 패널 등에서는 OS 기본이었다. 기본 select를 Orbit 웰로 통일했다.
3. **버튼 위계**: `button.primary.danger`가 `.confirm-actions` 안에서만 정의돼 다른 곳의 파괴적 확인이 보라였다. 전역으로 올렸다.
4. **Baalda/zinc 흔적**: 검은 "Ink" 기본 견본, 쓰이지 않는 `--brand-green` 토큰과 초록 브래킷 로고용 `--brand-tile/ink` 값, `DESIGN-BRIEF.md`의 zinc/ink 서술, tokens 주석의 "zinc".
5. **언어 일관성**: 활동 패널(AI changes) 20개 문자열과 vault 설정 탭 이름이 한국어였다(나머지는 영어). 영어로 통일했다. 동작·props는 그대로다.
