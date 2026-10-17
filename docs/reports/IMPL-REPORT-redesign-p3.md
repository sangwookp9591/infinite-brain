# IMPL-REPORT — 리디자인 P3 (셸 · 사이드바 · 내비게이션 + Welcome/vault picker)

브랜치 `sangwookpark/ib-redesign-p3`(main 551f2a7에서 분기한 전용 worktree `ib-redesign-p3`). 동작·props·IPC·권한 판단은 바꾸지 않았다.

## 0. 선행 확인: 라이트 에디터 본문이 비어 보인 건
**촬영 타이밍이며 회귀가 아니다.** simulator에서 에디터(CodeMirror)는 지연 로딩이라 페이지 로드 1.5초 시점엔 `.cm-content`가 없고(light/dark 동일), 6초 시점엔 light/dark 모두 본문 8줄이 렌더된다. 이때 light `.cm-line` 색은 `rgb(20, 22, 43)`(= `--text-primary #14162b`), dark는 `rgb(233, 235, 249)`로 토큰과 일치했다. 그래서 fix commit과 `tokens.css` 수정은 없다. 이후 촬영 스크립트는 main 화면에서 6.5초를 기다린다.

## 1. 변경
- **Orbit 셸** (`App.css` 셸 섹션, `App.tsx`):
  - 아이콘 레일: 64px 고정 island(`.rail`)를 grid 첫 열에 추가하고 브랜드 마크를 둔다. 기존 `SidebarToggle`(사이드바 토글·검색·그래프) 버튼은 새로 만들지 않고 같은 컴포넌트를 레일 안에 세로로 배치했다. 핸들러가 같아서 단축키·동작은 그대로다. 현재 열려 있는 항목은 `aria-pressed`/`aria-expanded`로 accent-soft 강조한다. macOS에서는 신호등(traffic lights) 아래에서 시작한다.
  - 플로팅 사이드바: `.sidebar`를 둥근 island(`--radius-island`, 테두리, 부드러운 그림자, `--bg-subtle`)로 바꿨다. 헤더의 신호등 여백(`--titlebar-inset`)은 레일로 옮겨 제거했고, 리사이저 위치는 레일 폭을 더해 계산한다.
  - 720px 좁은 창: 820px 이하에서 사이드바 폭을 최대 208px로 제한하고, 헤더가 600px 이하이면 동기화 배지는 글자를 접고 점만 남긴다. 네 가지 조합 모두 `scrollWidth == clientWidth`다.
  - 파일트리·탭 선택 상태: 선택 행·열린 탭은 `--accent-soft` 배경 + accent를 본문 색 쪽으로 30% 섞은 텍스트색을 쓴다(커스텀 accent에서도 4.5:1 아래로 떨어지지 않게). 행 radius는 `--radius-lg`로 맞췄다.
- **탭바 ↔ breadcrumb 절충안**: `Breadcrumb`(vault / 폴더 / 노트, 읽기 전용)을 헤더 왼쪽에 추가하고 Orbit 스타일 탭(`--radius-md`, accent-soft 활성)을 바로 옆에 유지했다. **근거**: 탭은 다중 노트 열기, 중클릭·우클릭 일괄 닫기, 가상 탭(리뷰·대시보드 등)을 담당한다. breadcrumb만 남기면 이 기능이 사라지고, 가상 탭용 대체 UI는 정해진 것이 없다. 헤더 컨테이너가 900px 이하이면 breadcrumb는 숨고 탭이 우선한다. 노트가 하나뿐인 경우는 breadcrumb와 탭이 같은 이름을 보여 중복되지만 정보 손실보다 낫다고 판단했다(후속: 탭이 1개일 때 접는 안).
- **vault 아이콘 생성기**: `src/lib/avatar/vaultMark.ts`. Neuron과 같은 시각 문법(둥근 허브, 한쪽으로 휘는 팔 3–5개, 끝 구슬, 굵은 팔 1개)을 둥근 사각형 타일에 그린다. preset 이름을 시드로 결정적이며 id·`url()`이 없다. 타일은 기존 `ITEM_COLORS`의 fill/value를 쓰고, 대비가 3:1 미만이면 mark만 어둡게 한다. 와이어 포맷(`preset:<icon>:<color>`)과 `VAULT_ICON_NAMES`는 그대로라서 서버 검증·기존 vault 설정은 영향이 없다. `VaultIconSvg`는 생성기를 호출하고 `svgIds.ts`(DiceBear 마스크 id 전용)는 삭제했다.
- **@dicebear 완전 제거**: `pnpm remove @dicebear/core @dicebear/collection`(lockfile에서 33개 패키지 감소). 코드·주석의 언급도 정리해 `grep -rniI dicebear app`(node_modules·dist 제외)이 **0건**이다.
- **Welcome/vault picker**: 워드마크를 SVG 이미지에서 Fraunces 라이브 텍스트로 바꾸고(`aria-label` 유지, 기존 `wordmark-ink/silver.svg` 삭제), 최근 vault 카드를 3D 폴더 카드에서 생성 마크 + 이름·경로·상태 가로 카드(`--radius-island`, hover 시 accent 테두리)로 바꿨다. 카드를 여는 컨트롤은 기존 `recent-open` 버튼 하나다(폴더 미리보기의 중복 클릭 영역은 제거). 모바일 폭에서는 1열.
- **하네스**: `dev/window-simulator/preview.ts`에 `?welcome=1`(열린 vault 없음)을 추가했다. 기존 파라미터 동작은 같다.

## 2. 검증 (모두 `app/apps/desktop`)
| 명령 | 결과 |
|---|---|
| `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=2` | 341 파일 통과 / 3595 테스트 통과 / 12 skip (파일트리 키보드·드래그·컨텍스트 메뉴, sidebarToggle, avatarIdentity 포함) |
| `npx tsc --noEmit -p .` | 오류 0 |
| `npx eslint src` | 오류 0, 경고 40(전부 `any`/hook deps 같은 기존 유형. 이번에 건드린 파일에서는 새 경고 없음) |
| `grep -rniI dicebear app` | 0건 |

추가 테스트: `vaultMark.test.ts`(결정성, id 없음, 모든 preset이 서로 다른 모양, None 타일 currentColor, 모든 타일 색 3:1). `avatarIdentity.test.ts`는 "vault 아이콘 id가 스코프됨" 대신 "모든 생성 마크에 id가 없음"으로 바꿨다.
(첫 vitest 실행에서 `accessBoardPerf` 타이밍 테스트가 한 번 실패했으나 부하 때문이었고 이후 전체 실행에서 통과했다.)

스크린샷(window-simulator, light/dark × 1440/720): `/private/tmp/ib-redesign/p3/{main,welcome,settings}-{light,dark}-{1440,720}.png`, 추가로 `search-*-1440.png`, `switcher-*-1440.png`. 12장 모두 가로 넘침 0.

## 3. 미검증
- 패키지 앱 빌드·실행: 하지 않았다. macOS 신호등/Windows 캡션 버튼과 레일의 실제 겹침은 simulator가 OS 크롬을 그리지 않아 확인하지 못했다(`--rail-top`·`--chrome-row-h`로 계산만 했다).
- 키보드 포커스 순서: 레일 버튼이 DOM상 사이드바보다 앞에 있다(기존 `titlebar-tools` 위치와 같은 순서). 스크린리더 실사용은 확인하지 못했다.
- 한글 vault 이름 렌더링과 긴 이름의 breadcrumb 말줄임은 시각 확인을 하지 않았다.

## 4. 남은 일 · 토큰 승격 후보
- `.main`(편집기 시트)은 P4 소유라 건드리지 않았다. 헤더는 아직 시트 안에 있고, 시안처럼 캔버스 위로 올리는 일은 P4와 조율이 필요하다.
- 레일 하단(시안의 계정 아바타 자리)은 비워 뒀다. 계정 메뉴는 사이드바 푸터에 그대로 있다.
- 토큰 승격 후보: `--rail-w`(64px), `--rail-top`, island 간격(`--sp-3` margin)은 지금 `.app`의 국소 변수다. `--radius-island` 등은 P2.5에서 이미 승격됐다.
- 오로라 blob(`.aurora-blob`)은 default accent에서 거의 보이지 않는다. 지금은 유지했고 제거 여부는 시각 결정 사항이다.
- 레일에 홈/그래프/멤버 같은 목적지를 늘리는 일은 라우팅 변경이라 이번 범위에서 뺐다.

## 5. 커밋
- feat(desktop): generate Orbit vault marks and drop @dicebear dependencies
- feat(desktop): Orbit shell with icon rail, floating sidebar island and breadcrumb beside tabs
- feat(desktop): Orbit welcome screen with generated vault marks and live wordmark
- docs: report redesign P3 implementation
