# IMPL-REPORT — 리디자인 최종 일관성 검토와 마무리 수정

브랜치 `sangwookpark/ib-redesign-p25`(main 7d42a2d에서 이어서 작업). 시각·문구 변경만 했고 동작·props·IPC·권한 판단은 그대로다. 화면 감사표는 `docs/reports/redesign-final-audit.md`.

## 1. 화면 감사
12개 장면군을 light/dark × 1440/720으로 촬영했다(136장): 웰컴, 메인, 검색, vault switcher, 활동 패널, 계정 설정 8탭, vault 설정 9탭, 공유, 멤버 목록·권한 메뉴·프로필·권한 보드, 초대, 외부 공유 정책·회수·보안 기록, 빌링·업그레이드, 확인 다이얼로그, 토스트성 오류, Home 대시보드, 그래프. 경로: `/private/tmp/ib-redesign/final/<장면>-<light|dark>-<1440|720>.png`. 모든 촬영에서 가로 넘침 0, 페이지 오류 0. 화면별 판정은 감사 문서에 있다.

## 2. 수정 (영역 경계에서 어긋난 것 포함)
- **`.main` 헤더 승격(P3/P4 조율 항목)**: 헤더(breadcrumb·탭·컨트롤)를 캔버스 위로 올리고 시트는 `.editor-wrap`(`--radius-sheet`)으로 옮겼다. 버전 패널 등 `.main` 기준 절대 배치는 유지된다.
- **버튼 위계**: `button.primary.danger`를 전역 정의로 올려 파괴적 확인이 어디서나 danger 색이다(회수 확인이 보라였음).
- **select**: 대화상자 밖의 기본 `<select>`에 Orbit 웰 스타일.
- **Baalda/zinc 흔적**: Appearance의 검은 "Ink" 기본 견본을 Orbit 보라 견본("Orbit")으로(저장 값 `ink`는 와이어 계약이라 그대로, 색만 `--accent-default`), 쓰이지 않던 `--brand-green*` 제거와 `--brand-tile/ink`를 Orbit night 값으로, `DESIGN-BRIEF.md`를 Orbit 기준으로 재작성, tokens 주석의 zinc 제거.
- **언어 일관성**: AI changes 패널 한국어 20개 문자열과 vault 설정 탭 이름("AI 연결")을 영어로. 이 문자열을 참조하는 테스트는 없다.
- **rebrand**: `--dry-run`이 0이 되도록 directions 스펙(원 요청 인용문 포함)을 `scripts/rebrand.mjs` 제외 목록과 CLAUDE.md의 설명에 추가했다. `rebrand.test.mjs` 6개 통과. 서버 Dockerfile 머리 주석의 "Baalda server"는 "Infinite Brain server"로 바꿨다.

## 3. 토큰 승격
각 영역 보고서의 후보를 `tokens.css`로 올리고 국소 정의를 지웠다.
- P3: `--rail-w`(64px), `--rail-top`(기본 16px, macOS는 `--chrome-row-h` + 4px — macOS 블록으로 이동). `.app`의 국소 변수 제거.
- P5: `--p5-inner-radius` → `--radius-inner`(22px). `.settings-content`가 사용.
- 추가: `--accent-default`(Orbit 기본 보라, 커스텀 accent에도 불변; light `#4a3fd4` / dark `#a29bff`, 두 dark 블록 모두에 있어 동기화 테스트 통과).
- 확인: CSS의 `--p4*`/`--p6*`/`--p7*` 국소 변수는 없다(`grep -rhoE '^\s*--(p[0-9]+|rail|orbit)[a-z0-9-]*:'`가 위 항목만 찾았고 모두 처리).

## 4. 하드코딩 색 (M6 S7 방식)
측정: `src/`의 CSS·TS/TSX(테스트·`tokens.css` 제외, 주석 줄 제외)에서 `#rgb`(문자 포함 또는 반복 숫자)/`#rrggbb`/`#rrggbbaa`/`rgb(a)`/`hsl(a)` 리터럴 개수(`git ls-tree` 대비). 스크립트는 수치 재현용으로만 썼고 커밋하지 않았다.

| 시점 | CSS | TS/TSX | 합계 |
|---|---|---|---|
| M6 스펙 §2.1 기록(리디자인 전) | 114 (그래프 제외 81) | — | — |
| 리디자인 직전(62061ec) | 23 | 199 | 222 |
| 지금 | **25** (graph.css 24 + App.css 1) | 212 | 237 |

CSS는 그래프를 제외하면 **1건**(`.html-frame`의 `background: #fff`)만 남았다. 증가분은 `graph.css` +2(Orbit 팔레트 정렬)와 Neuron 생성기(`neuron.ts` 18, DiceBear 제거로 대체됨)다.

**예외 목록(문서화된 의도적 리터럴)**
- `components/graph.css` 24, `components/GraphView.tsx` 18, `lib/graph/graphColor.ts` 16, `lib/graph/webglRenderer.ts` 3: 그래프는 라이트/다크와 무관한 "밤하늘" 스테이지라 자체 고정 팔레트를 쓴다(P6+P7 보고서).
- `lib/dashboard/importedTemplates.ts` 60, `deployedTemplates.ts` 9, `templates.ts` 9: 사용자 대시보드 템플릿(불투명한 사용자 콘텐츠)의 자체 팔레트.
- `lib/appearance.ts` 44, `components/AppearanceRows.tsx` 7, `lib/accent.ts` 4: 사용자가 고르는 색 견본/계산 시드(색 자체가 데이터).
- `lib/avatar/neuron.ts` 18, `lib/presence/color.ts` 13, `lib/editor/remoteCursors.ts` 1: 아바타·접속자·원격 커서 색(데이터 색, 대비 테스트로 보장).
- `lib/celebrate/celebrate.ts` 6: 장식 파티클.
- `components/AuthDialog.tsx` 4: Google 로고 브랜드 색.
- `App.css` 1: HTML 페이지 뷰의 샌드박스 프레임이 흰 문서를 가정한다.

### 'Baalda' 문자열
`grep -rniI baalda app`(node_modules·dist·target 제외)을 UI 문구·에셋 관점에서 검토했다. 사용자에게 보이는 문구와 시각 에셋에는 남은 것이 없다. 남은 것은 모두 호환 식별자라 바꾸지 않았다: 와이어 값 `character:baalda-N`(서버 검증·저장된 프로필), 환경 변수 `BAALDA_*`(배포 설정), 딥링크 스킴 `baalda`, 템플릿 메타 `baalda-template`(저장된 대시보드 HTML), localStorage 키 `baalda.onboarding-log.v1`, 워클릿/프로세서 이름, 서비스·이미지 이름 `baalda-server`(Railway/Docker), 테스트 픽스처 URL 경로 `/baalda`. 바꾸려면 마이그레이션이 필요하므로 별도 결정 사항이다.

## 5. 검증 (`app/apps/desktop`)
| 명령 | 결과 |
|---|---|
| `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=2` | 341 파일 통과 / 3596 테스트 통과 / 12 skip |
| `npx tsc --noEmit -p .` | 오류 0 |
| `npx eslint src` | 오류 0, 경고 40(기존 유형) |
| `node scripts/rebrand.mjs --dry-run` (저장소 루트) | `Would update 0 file(s).` |
| `node --test scripts/rebrand.test.mjs` | 6 통과 |

## 6. 미검증
- 패키지 앱 빌드·실행, 실제 macOS/Windows 창 크롬(신호등·캡션 버튼)과의 겹침은 확인하지 못했다(simulator는 OS 크롬을 그리지 않음).
- 헤더 승격 후 Windows 모드와 배너가 많이 쌓이는 상태(헤더와 시트 사이)는 촬영하지 못했다.
- 토스트 자체는 simulator에서 트리거하지 못해 오류 배너형만 확인했다. Health·Housekeeper 화면은 이번 촬영에 없다.
- Pretendard 한글 글리프 렌더링은 시뮬레이터 화면에 한글이 없어 눈으로 보지 못했다.

## 7. 남은 일
- 위 호환 식별자의 `baalda` 이름 정리는 마이그레이션 설계가 필요하다.
- 활동 패널의 합성 데이터에는 한국어 라벨("미리보기")이 있다. 하네스 데이터이며 앱 문구가 아니다.
- 그래프 팔레트를 토큰으로 수렴할지(밤하늘 고정 스테이지 vs. 테마 연동)는 시각 결정 사항이다.
- 오로라 blob은 default accent에서 거의 보이지 않는다(P3 보고서에서 이어진 사안).

## 8. 커밋
- fix(desktop): translate leftover Korean AI-change and settings tab strings to English
- fix(desktop): lift main header onto the canvas, style bare selects and danger pills, promote rail/inner radius tokens
- docs(desktop): rewrite design brief for Orbit, drop unused brand-green tokens
- chore: keep the identity-directions spec out of the rebrand map; name the server image header
- docs: add Orbit final screen audit
- docs: report redesign final polish
