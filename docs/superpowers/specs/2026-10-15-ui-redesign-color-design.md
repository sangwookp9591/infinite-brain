# UI 리디자인 + 컬러 커스터마이즈 설계 (2026-10-15)

- 상태: 초안 (설계 문서, 제품 코드 변경 없음)
- 범위 결정(사용자): "전체 UI 리디자인 + 컬러"
- 이 문서가 다루는 것: 전체 리디자인의 분해(sub-project와 빌드 순서), 그리고 **P1(컬러 커스터마이즈 + 토큰 정비)의 상세 설계**만. P2 이후는 각각 별도의 spec → plan → 구현 사이클을 거친다.
- 근거: 아래 수치는 2026-10-15 `main` 작업 트리를 직접 grep/측정한 값이다(§2.1 측정 방법 참고).

---

## 1. 목표 / 비목표 / 성공 기준

### 1.1 목표

1. 사용자가 앱의 강조색(accent)을 **프리셋 또는 임의 hex**로 바꿀 수 있다. 개인 설정(Account Settings → Appearance)과 vault 기본값(Vault Settings → Appearance) 모두에서 가능하고, 기존 규칙 `personal override ?? vault default ?? app default`를 그대로 따른다.
2. seed 색 하나에서 light/dark 두 테마의 accent 계열 토큰 전체(hover, soft, soft-hover, gradient, focus ring, selection, hover/active 배경)가 **자동 파생**되고, 어떤 seed를 골라도 가독성 하한을 지킨다.
3. 리디자인 전체를 **독립적으로 배포 가능한 sub-project**로 나누고, 각 영역의 하드코딩 색을 토큰으로 수렴시킨다.

### 1.2 비목표 (P1 기준, YAGNI)

- 배경/뉴트럴 톤 커스터마이즈, 테마별(light/dark) 개별 accent, 전체 테마 프리셋("Nord" 같은 팔레트 묶음), 사용자 CSS 주입. → §5 열린 질문으로만 남긴다.
- 그래프 뷰의 "항상 어두운 우주" 콘셉트 변경 (`components/graph.css`, `lib/graph/galaxy*`). P1은 그래프 안의 accent **리터럴**만 토큰으로 바꾼다.
- 브랜드 고정색(`--brand-green*`, `--brand-ink`, `--brand-tile`, `--brand-violet*`)을 accent에 연동하는 일. 로고와 브랜드 정체성은 고정이다.
- 링크색 `--link`, 하이라이트 `--highlight-bg`, 시맨틱색(`--danger`/`--success`/`--warning`), 파일/폴더 색 팔레트(`lib/appearance.ts` `ITEM_COLORS`), 아바타·프레즌스 색(`lib/presence/color.ts`). 이 색들은 accent와 의도적으로 분리되어 있다(tokens.css 주석 참고).
- 컴포넌트 동작, props, IPC 변경. `DESIGN-BRIEF.md`의 hard rule 3("reskin, not refactor")은 P1에서도 유지한다.

### 1.3 성공 기준

| # | 기준 | 측정 방법 |
|---|---|---|
| S1 | `accent` 키가 없거나 기본값과 같으면 **현재 화면과 시각 차이 0** | 기본 경로는 기존 tokens.css 리터럴을 그대로 쓴다(§3.4). light/dark 수동 비교, `data-accent` 속성이 없는지 확인 |
| S2 | 기본값이 아닌 유효한 모든 seed에서(기본값 처리는 §5.2 Q1), 두 테마 모두 `--text-on-accent` 대 `--accent` 대비가 4.5:1 이상 | `lib/__tests__/accent.test.ts`: 프리셋 + 극단 seed(`#ffffff`, `#000000`, `#ffff00`, `#777777`) + 무작위 seed 200개 |
| S3 | 기본값이 아닌 유효한 모든 seed에서 `--accent` 대 `--bg-surface` 대비가 3:1 이상 (WCAG 1.4.11 비텍스트) | 같은 테스트 |
| S4 | 콜드 스타트 첫 프레임부터 올바른 테마와 accent로 그려진다(보라색이 잠깐 보이는 깜빡임 없음) | 수동: 커스텀 accent + light/dark/system 각각 재시작해 화면 녹화로 확인 |
| S5 | 데스크톱과 서버가 같은 값을 받아들이고 같은 값을 거부한다 | 데스크톱 `appearanceSettings.test.ts`와 서버 `schema.test.ts`에 같은 표 기반 케이스를 둔다 |
| S6 | tokens.css 밖의 accent 리터럴이 0 (테스트 fixture와 `GraphView.tsx`의 `FALLBACK_ACCENT` 상수 제외) | `grep -rnE -i "7f73ff\|127, ?115, ?255\|143, ?132, ?255" src --include='*.css' --include='*.tsx'` 결과가 `FALLBACK_ACCENT` 상수 1줄뿐 (현재 graph.css 5건 + 그 상수) |
| S7 | 리디자인 전체 완료 시점에 CSS의 하드코딩 색이 문서화된 예외 목록으로만 남는다 | §2.1 grep. 현재 CSS 114건(그래프 제외 81건) |
| S8 | packaged app에서 CSP 위반 콘솔 오류 0 | `pnpm tauri build --bundles app ...`로 빌드한 앱에서 devtools 콘솔 확인 |

---

## 2. 분해: sub-project와 빌드 순서

### 2.1 현재 인벤토리

측정 방법(작업 디렉터리 `app/apps/desktop/src`):

- CSS 줄 수: `wc -l`. `App.css`(10,820줄)는 섹션 헤더 주석 기준으로 영역에 나눴다(줄 범위는 아래 표).
- 하드코딩 색: `#[0-9a-fA-F]{3,8}`, `rgb(a)(`, `hsl(a)(` 출현 수. `tokens.css`는 정의 파일이라 집계에서 제외했다.
- 컴포넌트: `components/*.tsx` 109개 + `components/properties/` 2개 + `components/viewers/` 9개 = TSX 120개(테스트 제외). CSS 파일은 `App.css`, `components/*.css` 12개, `styles/*.css` 2개이며 총 15,943줄이다.

| 영역 | 주요 파일 (컴포넌트 / CSS) | CSS 줄 수(≈) | 하드코딩 색 |
|---|---|---:|---:|
| **토큰 / 기반** (버튼, 입력, 스크롤바) | `styles/tokens.css` 353 (정의); `App.css` 1–216 | 216 (+353 정의) | 0 |
| **공통 피드백 / 모션** (spinner, toast, banner, press 피드백, row ⋯ 메뉴) | `Spinner`, `AsyncButton`, `Toasts`, `Banner`, `*Banner`/`*Notice` 12개, `Switch`, `MenuSelect`, `RowActionsMenu`; `App.css` 6141–6170, 7031–7156, 7609–7796 | 344 | 1 |
| **Welcome / vault picker** | `VaultPicker`; `App.css` 217–717 | 501 | 1 |
| **셸 / 사이드바 / 내비게이션** (드래그 영역, rail, 검색, 파일 트리, 컨텍스트 메뉴, 스와치, 탭바, 사이드바 footer, vault switcher) | `SidebarHeader`, `SidebarResizer`, `SidebarToggle`, `FileTree`, `SearchPanel`, `TabBar`, `VaultSwitcher`, `AccountMenu`, `Identity`, `HomeNavigation`, `WindowsControls`, `ThemeToggle`, `GraphButton`, `TalkButton`; `App.css` 718–2420, 2793–2949, 3641–4313; `HomeNavigation.css` 65, `talk.css` 160 | 2,758 | 19 |
| **에디터 / 뷰어 / 패널** (메인 시트, 버전 히스토리, 미리보기·뷰어, backlinks, HTML 뷰, 오른쪽 패널) | `Editor`, `InlineTitle`, `EditorPlaceholders`, `properties/*`, `FilePreview`, `viewers/*`, `HtmlView`, `VersionPanel`, `RightPanel`, `ActivityFeed`, `BacklinksPanel`, `CompareTab`, `ReviewTab`, `AiChanges`, `VirtualTabHost`, `lib/editor/theme.ts`(CM6 테마, `var(--` 249회); `App.css` 2421–2792, 2950–3640, 5662–5702, 7797–8154; `editor.css` 680, `compare.css` 245, `aiChanges.css` 15 | 2,402 | 16 |
| **다이얼로그 / 설정 / 멤버 / 빌링** | `SettingsModal`, `AccountSettings`, `VaultSettingsDialog`, `AppearanceRows`, `AuthDialog`, `Members*`, `MemberProfilePage`, `MemberAccessBoard`, `ShareDialog`, `InvitePeopleDialog`, `ManageSeatsDialog`, `UpgradeDialog`, `Plan*`, `BugReportDialog`, `ConfirmDialog`, `VaultIconSettings`, `AiSettingsTab`, `Assistant*`; `App.css` 4314–5661, 5703–6140, 6171–7030, 7157–7608, 8155–10820 | 5,764 | 16 |
| **대시보드 / Health / Home / Housekeeper** | `Health*` 8개, `HomeDashboardDialog`, `Dashboard*`, `VaultDashboards*`, `RemoteDashboardView`, `HousekeeperPanel`; `health.css` 2,398, `HomeDashboardDialog.css` 314, `housekeeper.css` 135, `DashboardAgentRunner.css` 94, `styles/dashboard.css` 53, `DashboardTemplateGallery.css` 38, `VaultDashboardsTab.css` 10 | 3,042 | 28 |
| **그래프** (항상 다크) | `GraphView`, `GraphControls`, `lib/graph/*`; `graph.css` 563 | 563 | 33 |
| **합계** | | 15,590 (+353 정의) | 114 |

TS/TSX 쪽 색 리터럴: `lib/dashboard/importedTemplates.ts` 60, `lib/appearance.ts` 44(`ITEM_COLORS` 팔레트 데이터), `GraphView.tsx` 22, `lib/graph/graphColor.ts` 16, `lib/presence/color.ts` 13, `lib/dashboard/{templates,deployedTemplates}.ts` 각 9, `lib/celebrate/celebrate.ts` 6, `AuthDialog.tsx` 4, `galaxyRenderer.ts` 3, `VaultIconSvg.tsx` 2, `lib/editor/remoteCursors.ts` 1. 대부분 의도된 데이터 팔레트이며, 영역별 sub-project에서 "예외로 문서화"하거나 "토큰으로 이동" 중 하나로 정리한다.

### 2.2 Sub-project (빌드 순서)

각 sub-project는 앞 단계의 토큰과 공통 컴포넌트에만 의존한다. 하나가 끝나면 앱은 배포 가능한 상태여야 한다.

| 순서 | Sub-project | 범위 | 선행 조건 | 완료 기준 |
|---|---|---|---|---|
| **P1** | 컬러 커스터마이즈 + 토큰 정비 | §3 전체. accent 키, 파생 규칙, 첫 프레임, tokens.css dark/fallback 블록 동기화 테스트, graph.css accent 리터럴 제거 | 없음 | S1–S6, S8 |
| **P2** | 공통 컴포넌트(primitives) | 버튼, 입력, switch, range, select/menu, 스와치, 스크롤바, spinner/toast/banner, press 피드백. "토큰/기반"과 "공통 피드백/모션" 영역 | P1 | 모든 primitive가 토큰만 소비하고, 두 테마 스크린샷 체크리스트 통과 |
| **P3** | 셸 / 사이드바 / 내비게이션 | Welcome, 셸 영역 전체(표의 3·4행) | P2 | 해당 영역 하드코딩 색 20건 → 예외 목록만 남음 |
| **P4** | 에디터 / 뷰어 / 패널 | 표의 5행. CM6 테마(`lib/editor/theme.ts`) 포함 | P2 | 같은 방식, 16건 정리 |
| **P5** | 다이얼로그 / 설정 / 멤버 / 빌링 | 표의 6행. 가장 크다(5.7k줄). 필요하면 P5a(설정·Appearance) / P5b(멤버·공유·초대) / P5c(빌링·업그레이드)로 다시 나눈다 | P2 | 같은 방식, 16건 정리 |
| **P6** | 대시보드 / Health / Home | 표의 7행. 템플릿 TS 색은 사용자 콘텐츠 성격이라 예외 후보 | P2 | 28건 정리 또는 예외 문서화 |
| **P7** | 그래프 polish | 항상-다크 콘셉트 안에서의 정리. `graph.css` 33건은 전용 그래프 토큰으로 이동 | P1 | 그래프 전용 토큰 블록, 리터럴 0 |

P3–P6은 P2 이후 서로 독립적이라 병렬 진행이 가능하다. 단, 같은 `App.css`를 건드리므로 동시에 진행할 때는 영역별 줄 범위를 소유권 경계로 삼는다. P2 이후의 시각 언어(Atomize PLUS 유지 여부)는 §5 Q8의 결정에 따른다.

---

## 3. P1 상세 설계: 컬러 커스터마이즈 + 토큰 정비

### 3.1 현재 구조 (확인한 사실)

- `styles/tokens.css`: light는 `:root`, dark는 `[data-theme="dark"]`, 그리고 첫 프레임용 `@media (prefers-color-scheme: dark) :root:not([data-theme=…])` fallback 블록이 dark 값을 **중복 정의**한다. accent 계열 값:
  - light: `--accent #7f73ff`, `--accent-hover #6a5cf5`, `--accent-soft #efedff`, `--accent-soft-hover #e4e0ff`, `--accent-gradient`(#9a8fff→#7f73ff), `--selection-bg #d8d3ff`, `--editor-selection-bg rgba(127,115,255,.28)`, `--focus-ring … rgba(127,115,255,.30)`. `--bg-hover`/`--bg-active`/`--members-row-hover`는 이미 `color-mix`로 accent에서 파생된다.
  - dark: `--accent #a69cff`, `--accent-hover #bbb4ff`, soft는 `rgba(127,115,255,.18/.26)`, `--bg-hover #29273d`/`--bg-active #343156`/`--members-row-hover #201f29`는 "accent 13%/24%/4% over --bg-surface"를 손으로 계산한 **고정 hex**다. dark selection(`#384f83`, navy overlay)은 대비 때문에 accent와 의도적으로 분리되어 있다.
  - `--text-on-accent`는 두 테마 모두 `#ffffff`(CSS 14곳에서 사용).
- `lib/appearanceSettings.ts`: 키 6개(`theme`, `autoColors`, `contentWidth`, `textSize`, `lineNumbers`, `properties`)와 `APPEARANCE_KEYS`, `APPEARANCE_DEFAULTS`, `validAppearanceValue`, `parseAppearanceSettings`, `effectiveAppearance`, `migrateStoredAppearance`.
- `store.ts`: `applyAppearance()`가 effective 값을 계산하고 `applyEffectiveTheme(eff.theme)` 등을 호출한다. `saveVaultAppearance`는 `APPEARANCE_KEYS`를 기준으로 PATCH하고, 실패하면 롤백한다. 그래서 새 키는 키 목록에 넣기만 하면 같은 경로를 탄다. `vaultAppearance`는 메모리에만 있고 시작 시 `{}`이다.
- `lib/prefs.ts`: 개인 override는 `localStorage["context.appearanceOverrides.v1"]`에 저장된다.
- `index.html` 첫 프레임 스크립트는 **`localStorage["cbk-theme"]`만 읽는다.** 하지만 지금은 테마 변경(`ThemeToggle` → `setAppearanceOverride("theme")`)이 `context.appearanceOverrides.v1`에만 기록되고 `cbk-theme`에는 아무도 쓰지 않는다(`setThemeMode`를 부르는 곳이 없다). 그래서 vault 기본값 도입 이후에 테마를 바꾼 사용자나 vault 기본 테마를 따르는 사용자는 첫 프레임이 다른 테마로 그려질 수 있다. **기존 버그**이며 P1의 첫 프레임 설계(§3.6)가 함께 고친다.
- 서버 `appearance/schema.ts`: `CHECKS` 표가 키마다 검증 함수를 두고, **모르는 키나 잘못된 값은 버리지 않고 400으로 거부**한다. 쓰기는 `http/routes/appearance.ts`에서 owner/admin만 가능하다(PUT은 전체 교체, PATCH는 병합). 변경은 vault 채널 `appearance-changed`로 설정 전체를 실어 fan-out되고, 데스크톱은 `parseVaultAppearanceSettings`로 다시 검증한다.
- `GraphView.tsx`는 `getComputedStyle(...).getPropertyValue("--accent")`로 accent를 읽어 canvas에 쓴다. `--accent`는 **canvas가 그대로 해석할 수 있는 hex로 유지**해야 한다.
- CSP(`tauri.conf.json`): `script-src 'self'; style-src 'self' 'unsafe-inline'`.
- `minimumSystemVersion: 10.15`. macOS 10.15의 WKWebView(Safari ≤15.x)는 `color-mix()`를 지원하지 않는다. 다만 tokens.css와 컴포넌트 CSS가 이미 `color-mix`를 112회 쓰고 있으므로 P1이 새로 만드는 제약은 아니다(§5 Q6).

### 3.2 사용자 옵션

- **Accent color** 행 하나를 추가한다.
  - 프리셋 스와치 8개. 기본값 Violet(`#7f73ff`)과 기존 `ITEM_COLORS`의 진한 톤을 재사용한다: Blue `#3b74d1`, Teal `#23877e`, Green `#3f8850`, Amber `#c98a12`, Coral `#dc6e52`, Rose `#d4567a`, Slate `#5f6b7a`. 스와치 스타일은 기존 `.swatch`(App.css 2384)를 재사용한다.
  - "Custom" 스와치를 누르면 네이티브 `<input type="color">`가 열린다. 별도 피커 라이브러리는 쓰지 않는다. 옆에 `#rrggbb` 텍스트 입력을 두어 붙여넣기를 지원하고, 잘못된 값은 저장하지 않으며 입력란에 오류 상태만 표시한다.
  - 파생 결과가 seed와 달라졌으면(대비 보정, §3.5) 행 아래 hint로 "가독성을 위해 약간 조정됨"을 표시한다.
- seed 하나로 두 테마를 모두 파생한다. 테마별 개별 지정은 하지 않는다(비목표).
- 위치: `AppearanceRows`의 Theme 행 바로 아래. 이 컴포넌트를 Account Settings와 Vault Settings가 공유하므로 두 화면에 동시에 나타난다.
  - personal 모드: 기존 `trailing(key)` 패턴 그대로 "Vault default" 태그나 "Reset to vault default" 링크를 붙인다.
  - vault 모드: `readOnly`면 비활성화한다. 서버가 owner/admin만 허용하며, UI 상태는 권한 판단에 쓰지 않는다.

### 3.3 데이터 모델과 검증

- 새 키는 `accent?: string`이고 정규형은 **소문자 `#rrggbb`**다.
  - 프리셋 id 대신 hex를 저장한다. 프리셋은 UI 상수일 뿐이라 키 하나에 정규식 하나로 끝나고, 커스텀과 프리셋을 구분할 필요가 없다.
  - 3자리 hex, 8자리(알파), 색 이름, `rgb()` 형식은 받지 않는다.
- 데스크톱(`lib/appearanceSettings.ts`):
  - `AppearanceSettings`에 `accent?: string`을 추가하고, `APPEARANCE_KEYS`에 `"accent"`를 7번째로 넣는다. `APPEARANCE_DEFAULTS.accent = "#7f73ff"`.
  - `validAppearanceValue("accent", v)`: `typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)`이면 `v.toLowerCase()`, 아니면 `undefined`.
  - `migrateStoredAppearance`: 레거시 키가 없으므로 변경할 필요가 없다. 기본값과 같은 저장값이 INHERIT가 되는 기존 규칙도 그대로 적용된다.
  - `store.applyAppearance`: `applyAccent(eff.accent)`를 호출하고(§3.4), patch에 `accentColor: eff.accent` 상태를 하나 추가해 UI가 구독하게 한다.
- 서버(`appearance/schema.ts`):
  - `VaultAppearance`에 `accent?: string`을 추가하고, `CHECKS.accent = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)`를 둔다.
  - 서버는 정규화하지 않고 받은 값을 저장하며, 데스크톱이 읽을 때 소문자로 정규화한다. 두 정규식이 받아들이는 집합은 같다(S5).
  - 권한은 기존 route의 owner/admin 검사를 그대로 쓴다. 새로 추가할 권한 로직은 없다.
- 호환성:
  - **구버전 데스크톱 + 신버전 서버**: `parseAppearanceSettings`가 모르는 키를 버리므로 accent를 무시하고 보라색으로 보인다. 안전하다.
  - **신버전 데스크톱 + 구버전 서버**: PATCH에 `accent`가 포함되면 400 `invalid_appearance key=accent`가 돌아오고, `saveVaultAppearance`의 기존 롤백이 동작한다. **서버를 먼저 배포**해야 하며, vault 행 저장이 실패하면 기존 오류 표시 경로를 그대로 쓴다.
  - 키가 없는 vault 행이나 개인 설정은 app default(`#7f73ff`)가 되므로 현재 보라색 그대로다(S1).
  - DB 마이그레이션은 필요 없다(`vault_appearance.settings`가 jsonb).

### 3.4 런타임 파생 (권장안 C: 하이브리드)

역할 분담:

- **JS** (`lib/accent.ts`, 순수 함수): seed 하나에서 **테마별 seed 3개**를 계산한다. 대상은 `accent`, `accent-hover`, `on-accent`이고, 이 셋에만 대비 판정과 OKLCH 밝기 보정이 필요하다. CSS로는 대비를 계산할 수 없다(`contrast-color()`는 지원 범위가 좁다).
- **CSS** (`tokens.css`): 나머지 accent 계열은 모두 위 seed에서 `color-mix`로 파생한다.

적용 방법은 inline custom property이며 `<style>` 주입은 쓰지 않는다:

```ts
// lib/theme.ts (applyEffectiveTheme 옆)
export function applyAccent(seed: string): void
// seed === APPEARANCE_DEFAULTS.accent → html의 data-accent 제거 + 아래 6개 속성 제거
// 그 외 → p = accentPalette(seed);
//   html.style.setProperty("--accent-custom-light", p.light.accent) … 6개
//   html.setAttribute("data-accent", "custom")
```

설정하는 변수는 `--accent-custom-{light|dark}`, `--accent-custom-{light|dark}-hover`, `--on-accent-custom-{light|dark}` 6개다. CSSOM `setProperty`는 CSP `style-src` 대상이 아니므로 packaged app에서도 안전하다. 테마 전환은 순수 CSS 선택자로 처리되므로 JS가 테마 변경을 다시 구독할 필요가 없다.

`tokens.css`에 추가할 블록(기본 경로는 건드리지 않는다. 그래서 S1이 성립한다):

```css
:root[data-accent="custom"] {
  --accent: var(--accent-custom-light);
  --accent-hover: var(--accent-custom-light-hover);
  --text-on-accent: var(--on-accent-custom-light);
  --accent-soft: color-mix(in oklab, var(--accent) 12%, var(--bg-surface));
  --accent-soft-hover: color-mix(in oklab, var(--accent) 18%, var(--bg-surface));
  --accent-gradient: linear-gradient(135deg, color-mix(in oklab, var(--accent) 78%, white) 0%, var(--accent) 100%);
  --selection-bg: color-mix(in oklab, var(--accent) 30%, var(--bg-surface));
  --editor-selection-bg: color-mix(in srgb, var(--accent) 28%, transparent);
  --editor-selection-bg-inactive: color-mix(in srgb, var(--accent) 28%, transparent);
  --focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent);
  /* --bg-hover / --bg-active / --members-row-hover: 이미 accent-soft 파생이라 그대로 따라온다 */
}
[data-theme="dark"][data-accent="custom"] {
  --accent: var(--accent-custom-dark);
  --accent-hover: var(--accent-custom-dark-hover);
  --text-on-accent: var(--on-accent-custom-dark);
  --accent-soft: color-mix(in srgb, var(--accent) 18%, transparent);
  --accent-soft-hover: color-mix(in srgb, var(--accent) 26%, transparent);
  --bg-hover: color-mix(in srgb, var(--accent) 13%, var(--bg-surface));      /* 기존 주석의 공식 그대로 */
  --bg-active: color-mix(in srgb, var(--accent) 24%, var(--bg-surface));
  --members-row-hover: color-mix(in srgb, var(--accent) 4%, var(--bg-surface));
  --focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent);
  /* --selection-bg / --editor-selection-bg*: dark는 navy 고정 유지 (대비 근거, 기존 주석) */
}
/* + prefers-color-scheme fallback 블록 안에 :root[data-accent="custom"]:not([data-theme="light"]):not([data-theme="dark"]) 로 dark 블록과 같은 내용 */
```

- 선택자 우선순위: `:root[data-accent="custom"]`(0,2,0)는 `[data-theme="dark"]`(0,1,0)보다 우선한다. 그래서 dark에서는 `[data-theme="dark"][data-accent="custom"]`(0,2,0)이 **뒤에 선언되어** 이겨야 한다. 블록 순서는 light-custom → dark → dark-custom → fallback 순으로 고정하고, 순서 의존성은 주석으로 남긴다.
- `--accent`는 항상 hex를 가리키는 `var()`이고, custom property의 computed value는 var를 치환한 결과다. 따라서 `GraphView`의 `getPropertyValue("--accent")`는 계속 hex를 받는다. 그래도 dark custom accent에서 canvas 색이 바뀌는지는 수동으로 확인한다. GraphView가 accent 변경 시 색을 다시 읽는지도 확인하고, 다시 읽지 않으면 `accentColor` 상태를 의존성으로 추가한다.
- graph.css의 accent 리터럴 5건(`rgba(127,115,255,…)`, `rgba(143,132,255,…)`)은 `color-mix(in srgb, var(--accent) N%, transparent)`로 바꾼다(S6). 그래프는 항상 어둡게 유지되므로, 그래프 안에서 light 테마의 accent가 보일 때의 대비는 P7에서 다룬다.

### 3.5 파생 규칙과 대비 가드 (`accentPalette`)

입력은 seed `#rrggbb`이고, 출력은 `{ light: {accent, hover, onAccent}, dark: {…} }`이며 모든 값은 `#rrggbb`이다. 계산은 OKLCH에서 하고(sRGB↔OKLab 변환 약 30줄, 의존성 없음), 색역을 벗어나면 chroma를 줄여 맞춘다.

| 단계 | light (surface `#ffffff`) | dark (surface `#1c1c20`) |
|---|---|---|
| 시작 L | `min(seedL, 0.90)` | `max(seedL, 0.76)` |
| 탐색 | 조건을 만족할 때까지 L을 0.01씩 **낮춘다** | 조건을 만족할 때까지 L을 0.01씩 **올린다** |
| 조건 | `contrast(accent, surface) ≥ 3` **그리고** `max(contrast(#fff, accent), contrast(#1a1a1e, accent)) ≥ 4.5` | 같은 조건 |
| hover | L −0.06 | L +0.06. 상한(L≈1)에 막혀 accent와 같아지면 −0.06 |
| onAccent | `contrast(#fff, accent) ≥ 4.5`이면 `#ffffff`, 아니면 `#1a1a1e`(`--text-primary` light) | 같은 규칙 |

탐색은 단조적이라 반드시 끝난다. light에서 L을 낮추면 결국 흰 글자가 4.5:1을 넘고, dark에서 올리면 검은 글자가 넘는다. 상한은 100 step이다.

스크래치 프로토타입으로 검증한 결과(위 규칙 그대로 구현):

| seed | light accent / on / 대비(on, surface) | dark accent / on / 대비(on, surface) |
|---|---|---|
| `#7f73ff` (기본) | `#7f73ff` / ink / 4.79, 3.62 | `#a6a6fe` / ink / 7.85, 7.69 |
| `#3b74d1` Blue | `#3b74d1` / white / 4.56, 4.56 | `#83b2fe` / ink / 8.07, 7.90 |
| `#23877e` Teal | `#1e847b` / white / 4.52, 4.52 (1 step 보정) | `#68c4ba` / ink / 8.42, 8.25 |
| `#d4567a` Rose | `#c6496e` / white / 4.59, 4.59 (4 step) | `#fe85a4` / ink / 7.52, 7.36 |
| `#ffff00` | `#999904` / ink / 5.71, 3.04 (24 step) | `#ffff00` / ink / 16.16, 15.82 |
| `#ffffff` | `#929292` / ink / 5.58, 3.11 | `#ffffff` / ink / 17.35, 16.99 |
| `#000000` | `#000000` / white / 21, 21 | `#b1b1b1` / ink / 8.09, 7.92 |

관찰:

1. **기본 violet도 이 가드를 적용하면 버튼 글자가 검정(ink)이 된다.** 현재 흰 글자 대비는 light 3.62:1(`#7f73ff`), dark 2.38:1(`#a69cff`)로 이미 4.5:1에 못 미친다. P1은 S1(기본 경로 무변경)을 지키기 위해 기본값에는 가드를 적용하지 않는다. 기본값 처리는 사용자가 결정한다(§5 Q1).
2. dark에서는 L ≥ 0.76 하한 때문에 모든 seed가 ink 글자가 된다. 현재 dark 기본(`#a69cff` 위 흰 글자)과는 다른 모습이다.
3. 기본 seed를 파생하면 `#a6a6fe`가 나와 손으로 조율한 `#a69cff`와 근접하다(hue만 약간 다름). 즉 커스텀 경로의 공식이 기본 디자인 의도와 크게 어긋나지 않는다.

### 3.6 첫 프레임 (pre-hydration)

목표는 S4다. 원칙은 **파생 로직을 inline 스크립트에 복제하지 않는 것**이다.

- `store.applyAppearance`가 적용할 때마다 마지막 effective 값을 `localStorage["context.appearancePaint.v1"] = { theme: ThemeMode, accentVars: Record<string,string> | null }`에 기록한다. `accentVars`는 §3.4의 6개 변수이며, 기본 accent면 `null`이다.
  - 이 캐시에는 **vault 기본값까지 반영된 effective 값**이 들어가므로, 지금은 메모리에만 있는 vault 기본 테마/accent도 첫 프레임에 반영된다.
  - 오프라인 상태에서 vault 기본값이 바뀌었다면, GET이 끝난 뒤 한 번 바뀐다. 이는 허용한다.
- `index.html` inline 스크립트 동작:
  1. `context.appearancePaint.v1`을 읽고, 없으면 기존 `cbk-theme`로 fallback한다(업그레이드 직후 첫 실행용).
  2. theme을 해석해(`system`이면 matchMedia) `data-theme`를 찍는다.
  3. `accentVars`의 각 키가 `/^--(on-)?accent-custom-(light|dark)(-hover)?$/`, 값이 `/^#[0-9a-f]{6}$/`를 만족하면 `setProperty`로 설정하고 `data-accent="custom"`을 찍는다. 하나라도 어긋나면 accent는 건너뛰고 기본 보라색으로 그린다.
- CSP: 기존 inline 스크립트가 packaged app에서 동작하고 있으므로 같은 메커니즘을 그대로 쓴다. 스크립트 내용이 바뀌므로 S8(packaged build 콘솔 CSP 오류 0)을 P1의 필수 확인 항목으로 둔다.
- `lib/theme.ts`의 `STORAGE_KEY="cbk-theme"` 읽기와 `setThemeMode`/`cycleThemeMode`는 이제 호출하는 곳이 없다. P1에서 fallback 읽기만 남기고 정리할지는 구현 plan에서 결정한다(동작 변화 없음).

### 3.7 토큰 정비 (P1에 포함하는 최소 범위)

- **dark 블록과 fallback 블록의 동기화 테스트**: tokens.css를 문자열로 읽어 `[data-theme="dark"]` 블록과 `prefers-color-scheme` fallback 블록이 정의하는 변수 이름 집합이 같은지 확인한다. 값이 달라도 되는 예외는 명시 목록으로 둔다. 테스트 하나로 이후 sub-project에서 토큰이 어긋나는 것을 막는다. 현재도 fallback에 `--accent-gradient`/`--decor-gradient`가 빠져 있다(light와 값이 같아 증상은 없음). 이 테스트가 바로 이런 경우를 잡는다.
- graph.css accent 리터럴 5건을 토큰 파생으로 바꾼다(§3.4).
- 그 밖의 하드코딩 색 정리는 각 영역의 sub-project(P2–P7)가 맡는다.

### 3.8 테스트 계획

| 종류 | 대상 | 내용 |
|---|---|---|
| 단위 (신규) | `lib/__tests__/accent.test.ts` | `accentPalette`: 출력이 항상 `#rrggbb`; S2·S3를 프리셋 8개 + 극단 seed 4개 + 고정 seed 무작위 200개에 대해 확인; 결정적(같은 입력이면 같은 출력); dark hover ≠ accent; 기본 seed 파생값 고정(회귀) |
| 단위 | `lib/__tests__/appearanceSettings.test.ts` | `validAppearanceValue("accent")`: 유효값, 대문자→소문자, `#fff`/`#12345678`/`red`/`rgb()`/숫자/`null` 거부; `effectiveAppearance` 우선순위; `APPEARANCE_KEYS`에 포함; `migrateStoredAppearance`가 기본값과 같은 accent를 INHERIT로 바꾸는지 |
| 단위 | 첫 프레임 캐시 writer | `applyAppearance` 뒤 `context.appearancePaint.v1` 내용(기본 accent면 `accentVars: null`) |
| 단위 (신규) | tokens.css 동기화 | §3.7 |
| 서버 | `appearance/schema.test.ts` | 같은 표 기반 케이스(S5) |
| 서버 | `appearance/routes.unit.test.ts` | admin PATCH `{accent}` 200 + `appearance-changed` 페이로드에 포함; member 403; 잘못된 값 400 `key: "accent"` |
| 수동 | light/dark/system × {기본, Blue, Rose, `#ffff00`, `#000000`} | 주요 화면 체크리스트: 사이드바 선택/hover, 기본·보조 버튼, 입력 focus, 에디터 선택, 탭, 설정 다이얼로그, 그래프. 콜드 스타트 깜빡임(S4); 개인 override ↔ vault default 전환과 "Reset to vault default"; 다른 기기에서 live 반영 |
| 수동 | packaged build | S8 |

명령:

- 데스크톱: `app/apps/desktop`에서 `NODE_OPTIONS=--no-experimental-webstorage pnpm test`
- 서버: **전용 일회용 DB**로 server 테스트 실행. 공유 `context` DB는 쓰지 않는다.

---

## 4. 검토한 접근법

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. 순수 CSS | JS는 seed 하나만 `setProperty`하고 나머지(dark 밝기 포함)는 `color-mix`나 relative color(`oklch(from …)`)로 파생 | JS 최소, 원칙상 가장 깔끔 | 대비 가드를 CSS로 구현할 수 없다(`contrast-color()` 미보급). relative color syntax는 지원 WebKit 범위가 좁다(10.15 하한). 밝은 노랑 같은 seed는 판정 없이 고정 공식으로 dark를 만들 수 없다. canvas가 미해석 함수 문자열을 받을 위험이 있다 |
| B. 순수 JS | 15개 안팎의 토큰을 모두 JS로 계산해 `setProperty` | 완전한 제어, 테스트 용이, 구형 WebKit에서도 동작 | tokens.css와 이중 정의가 생기고, 토큰을 추가할 때마다 JS도 고쳐야 한다. "tokens.css가 단일 출처"라는 원칙을 깬다 |
| **C. 하이브리드 (권장)** | JS는 테마별 3개 seed(accent, hover, on-accent)만 OKLCH와 대비 가드로 계산하고, 나머지는 tokens.css `color-mix` | 판정이 필요한 곳만 JS가 맡고, 파생 공식은 tokens.css에 남는다. `--accent`는 항상 hex라 canvas가 안전하다. 기본 경로는 그대로라 S1이 성립한다 | 변수 6개 + `data-accent` 게이트라는 간접층이 하나 생긴다. tokens.css에 custom 블록 3개(light, dark, fallback)가 늘어난다 → §3.7 동기화 테스트로 완화 |

권장은 **C**다. 판정이 필요한 3개 값만 JS로 계산하는 것이 대비 가드, canvas 호환, 기본값 무변경을 모두 만족하는 가장 작은 설계다.

---

## 5. 위험과 열린 질문

### 5.1 위험

| 위험 | 영향 | 완화 |
|---|---|---|
| 구버전 서버에 신버전 클라이언트가 vault accent를 저장 | 400, 저장 실패(롤백됨) | 서버 먼저 배포. 배포 순서를 릴리스 노트에 적는다 |
| 바뀐 inline 스크립트가 packaged CSP에서 막힘 | 첫 프레임 깜빡임 또는 테마 미적용 | S8 필수 확인. 막히면 동일 로직을 `'self'` 외부 스크립트 파일로 옮긴다 |
| custom 블록 선택자 순서 실수 | dark에서 light accent가 보임 | 블록 순서 고정 + 주석, 수동 체크리스트의 dark × custom |
| tokens.css 3중 블록(light/dark/fallback) 불일치 | 첫 프레임에 일부 토큰 누락 | §3.7 동기화 테스트 |
| 동시 작업(다른 worker의 ESLint 도입, `GraphView.tsx`/`graph.css` 미커밋 변경) | P1 구현 시 충돌 | 구현 plan을 시작할 때 `main` 기준으로 rebase하고 충돌 파일을 확인 |
| macOS 10.15 WebKit에서 `color-mix` 미지원 | custom 파생 토큰 무효화(이미 기존 112곳도 같음) | §5.2 Q6 결정 |

### 5.2 사용자 결정이 필요한 질문

1. **[결정 2026-10-15: 기본 accent를 무채색 잉크로 바꾸므로 해소. §6.2]** **기본 violet의 대비 미달을 어떻게 할까?** 현재 흰 글자는 light 3.62:1, dark 2.38:1이다. (a) 기본은 그대로 두고 커스텀에만 가드 적용(P1 권장, 시각 변화 0) (b) 기본에도 가드 적용(기본 버튼 글자가 검정이 됨) (c) 기본 accent 자체를 조정해 흰 글자 4.5:1 확보(예: light를 `#6a5cf5` 근처로, 그러면 브랜드 인상이 바뀐다).
2. **vault 기본 accent를 허용할까?** 제안은 기존 규칙(개인 override 우선)을 그대로 적용하는 것이다. 팀 색을 강제하는 잠금은 두지 않는다.
3. **프리셋 목록과 커스텀 hex**: 제안한 8색(Violet, Blue, Teal, Green, Amber, Coral, Rose, Slate)이면 충분한가? 임의 hex를 허용할까(제안: 허용, 가드로 보정)?
4. **배경/뉴트럴 틴트나 테마별 개별 accent가 필요한가?** 제안은 P1에서 제외하고, 필요하면 별도 sub-project로 두는 것이다.
5. **그래프 뷰가 사용자 accent를 따라야 할까?** 현재도 `--accent`를 읽으므로 기본 답은 "따른다"다. 항상-다크 공간에 고정색을 원하면 P7에서 분리한다.
6. **macOS 10.15 하한**: WKWebView가 `color-mix`를 지원하지 않아 이미 일부 hover 색이 깨지는 상태로 추정된다. `minimumSystemVersion`을 11(Safari 16.2+ 설치 가능)로 올릴까, 10.15 지원을 유지하며 fallback을 둘까?
7. **브랜드 violet 분리 확인**: `--brand-violet*`(5곳)과 로고는 accent를 따르지 않는 것이 맞는가?
8. **[결정 2026-10-15: 새 시각 언어. 기존 Atomize PLUS를 벗어난다. §6]** **P2 이후 시각 언어**: "전체 UI 리디자인"이 현재 Atomize PLUS 언어를 유지하는 정리·일관화(reskin)인가, 새로운 시각 언어(레이아웃·밀도·타이포 변경 포함)인가? `DESIGN-BRIEF.md` hard rule 3("reskin, not refactor")을 계속 유지할지에 따라 P2–P7의 범위와 크기가 크게 달라진다. 새 언어라면 참고 레퍼런스나 무드를 제공해 주면 좋다.

---

## 6. 새 시각 언어 (2026-10-15 결정)

### 6.1 사용자 결정

| 항목 | 결정 |
|---|---|
| 방향 | 기존 Atomize PLUS 언어를 벗어나 더 세련된 새 언어로 간다. `DESIGN-BRIEF.md` hard rule 3("reskin, not refactor")은 P2–P7에서 폐기하고, 새 brief로 교체한다 |
| 레퍼런스 | ReactBits micro/components: Folder, Jelly Radio, Swipe Row, Comet Dial, Wake Slider, Code Slots, Lattice Loader, Border Glow, Spring Check, Fuse Button |
| 기본 테마 | **라이트 우선 유지**. 같은 언어의 다크 테마를 함께 제공하고 System 모드는 그대로 둔다 |
| 강조색 | **무채색 잉크가 기본**(라이트: 거의 검정, 다크: 거의 흰색). P1의 커스텀 accent로 사용자가 색을 고른다 |
| 진행 | **디자인 랩 먼저**(§6.5). 승인 후 P2→P7 순서로 앱에 적용 |

레퍼런스 코드는 MIT + Commons Clause다. 코드를 복사하지 않고 동작과 인상을 참고해 이미 설치된 `motion`(v12)으로 직접 구현한다. 새 런타임 의존성은 추가하지 않는다.

### 6.2 토큰 (zinc 무채색 기반)

레퍼런스의 인상은 "무채색 면 + 흰/검 잉크 + 상태색만 채도"다. 색 자체보다 면 대비와 모션으로 위계를 만든다.

| 토큰 | 라이트 | 다크 | 비고 |
|---|---|---|---|
| `--bg-app` | `#fafafa` | `#111113` | 캔버스 |
| `--bg-surface` | `#ffffff` | `#18181b` | 카드, 에디터 시트, 다이얼로그 |
| `--bg-subtle` | `#f4f4f5` | `#1f1f23` | 입력 칸, 칩 기본 면 |
| `--bg-raised` (신규) | `#e4e4e7` | `#27272a` | 행 hover, 칩 hover, 슬라이더 트랙 |
| `--border` | `#e4e4e7` | `#27272a` | 꼭 필요한 곳만 |
| `--border-strong` | `#d4d4d8` | `#3f3f46` | 체크박스 테두리, 포커스 전 입력 |
| `--text-primary` | `#18181b` | `#f5f5f5` | |
| `--text-secondary` | `#52525b` | `#a1a1aa` | |
| `--text-tertiary` | `#a1a1aa` | `#71717a` | |
| `--accent` (기본 잉크) | `#18181b` | `#f5f5f5` | 선택 칩, 체크 채움, 슬라이더 채움, 다이얼 헤드 |
| `--text-on-accent` | `#fafafa` | `#18181b` | 대비: 라이트 17.0:1, 다크 16.3:1 |
| `--danger` | `#dc2626` | `#e5484d` | Fuse/Swipe 삭제, Code Slots 오류 |
| `--success` | `#16a34a` | `#22c55e` | Lattice 완료 |
| `--warning` | `#d97706` | `#f5a524` | Fuse 심지 |

- 커스텀 accent(P1)는 `--accent` 계열만 덮어쓴다. 무채색 기본에서는 `--accent-soft`가 `--bg-subtle`과 같아지므로, 선택·포커스 표시는 색이 아니라 **면 반전(잉크 채움)과 모션**으로 구분한다.
- 반경: 칩·버튼 `--radius-pill`, 행 16px, 카드 20px, 입력 12px, 코드 슬롯 14px.
- 그림자: 라이트는 아주 옅은 1겹(`0 1px 2px rgb(0 0 0 / .04)`), 다크는 그림자 대신 면 대비만 쓴다.
- 타이포: 본문 Open Sauce Two 유지. 제목은 큰 크기에 `letter-spacing: -0.03em`. 숫자·시간·코드는 `--font-mono`와 `font-variant-numeric: tabular-nums`. 디스플레이 폰트 교체는 §6.6 Q9.

### 6.3 모션 규칙

- 스프링 프리셋 2개만 둔다. `snappy`(stiffness 520, damping 34): 칩·체크·슬롯. `soft`(stiffness 260, damping 26): 행·카드·폴더.
- 움직이는 속성은 `transform`과 `opacity`만 쓴다. 레이아웃 이동은 `motion`의 `layout` 애니메이션으로 처리한다(Jelly Radio에서 이웃 칩 밀어내기).
- `prefers-reduced-motion: reduce`에서는 스프링을 끄고 즉시 최종 상태로 가거나, 120ms 이하의 opacity 전환만 쓴다. Wake Slider의 물결과 Comet 꼬리 같은 장식 모션은 끈다.
- 모든 컴포넌트는 키보드로 조작할 수 있어야 하고 네이티브와 같은 ARIA 역할을 가져야 한다: radiogroup/radio, slider, checkbox, button, OTP 입력은 `autocomplete="one-time-code"`.

### 6.4 컴포넌트 → 앱 적용 위치

| 컴포넌트 (kit 이름) | 레퍼런스 | 적용 위치 (sub-project) |
|---|---|---|
| `SegmentedChips` | Jelly Radio | Theme 선택, 속성 표시 모드, 그래프 범위, 정렬 (P2, P5) |
| `BarSlider` | Wake Slider | 본문 폭, 글자 크기, 그래프 힘 (P2, P7) |
| `ProgressDial` | Comet Dial | 동기화·업로드·재색인 진행률 (P3) |
| `CodeSlots` | Code Slots | 팀 참가 코드(`VaultPicker`), 이메일 인증 (P3, P5) |
| `ActivityLattice` | Lattice Loader | AI 에이전트 상태, 동기화 상태 줄, 대시보드 에이전트 러너 (P3, P6) |
| `SpringCheck` | Spring Check | 에디터 할 일 체크박스(CM6 위젯), 설정 체크박스 (P4, P5) |
| `FuseButton` | Fuse Button | 노트 삭제·보관, AI 변경 되돌리기. 확인 다이얼로그 대신 실행 후 되돌리기 퓨즈 (P3, P4) |
| `SwipeRow` | Swipe Row | 파일 트리·검색 결과·AI 변경 목록·멤버 행. 데스크톱에서는 hover 시 액션 서랍, 트랙패드 가로 스와이프도 지원 (P3, P5) |
| `GlowCard` | Border Glow | 대시보드 템플릿 카드, vault 카드, 주요 다이얼로그 (P5, P6) |
| `FolderCard` | Folder | vault 선택 화면, 빈 폴더 상태 (P3) |

- `FuseButton`으로 확인창을 대체하는 것은 **되돌릴 수 있는 동작에만** 적용한다. 영구 삭제, 권한 회수, vault 삭제처럼 되돌릴 수 없는 동작은 계속 확인 단계를 둔다. CLAUDE.md의 삭제·회수 가드는 그대로 유지한다.
- `SwipeRow`의 "끝까지 밀면 삭제"는 휴지통 이동처럼 되돌릴 수 있는 동작에만 연결한다.

### 6.5 디자인 랩 (첫 산출물)

- 위치: `app/apps/desktop/dev/design-lab/`. 기존 하네스처럼 `pnpm exec vite --mode simulator`로 연다. 프로덕션 번들에는 들어가지 않는다.
- 컴포넌트 구현: `app/apps/desktop/src/components/kit/`. 실제로 앱에 쓸 코드이지만, P2 전까지 앱 화면은 import하지 않는다.
- 새 토큰: `src/styles/tokens-next.css`. 랩에서만 로드하고, P2에서 `tokens.css`를 교체한다.
- 랩 화면: 라이트/다크 토글, accent 스와치(무채색 기본 + 프리셋 몇 개), 10개 컴포넌트 데모, 실제 앱 문맥을 흉내 낸 미니 장면 3개(설정 Appearance 패널, 사이드바 파일 행 목록, vault 선택 화면).
- WebMCP: 기존 `dev/webmcp.ts`로 `lab_state`, `set_theme`, `set_accent`를 등록해 에이전트가 스크린샷을 검증할 수 있게 한다.
- 테스트: 순수 로직만 단위 테스트한다(슬라이더 값↔위치 변환과 step 스냅, 다이얼 각도↔값, 코드 붙여넣기 파싱, 퓨즈 타이머·취소). 시각은 랩 스크린샷 체크리스트로 확인한다(두 테마, reduced motion).
- 완료 기준: 랩에서 10개 컴포넌트가 두 테마와 reduced motion에서 동작하고, 키보드만으로 조작할 수 있으며, lint·tsc·단위 테스트를 통과하고, 사용자가 랩을 보고 승인한다.

### 6.6 추가 열린 질문

9. **디스플레이 폰트**: 레퍼런스의 촘촘한 그로테스크 제목 인상을 내려면 Radio Canada Big을 바꾸는 것이 좋다. 후보는 Inter Display 또는 Geist이고, 둘 다 `@fontsource`로 오프라인 번들이 가능하다(새 의존성 1개). 랩에서 기존 폰트와 비교해 보여주고 결정한다.
10. **그래프 뷰**: 항상 다크인 우주 콘셉트는 새 언어와 잘 맞으므로 유지한다(P7은 토큰 정리만). 다른 생각이 있으면 알려 달라.

