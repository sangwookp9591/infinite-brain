# IMPL-REPORT — 리디자인 P2.5 (토큰·서체·아이콘 기반)

브랜치 `sangwookpark/ib-redesign-p25`. 시각 변경만 수행했고 컴포넌트 props·IPC·권한 로직은 건드리지 않았다.

## 변경
- **tokens.css**: design-lab Orbit `tokens.ts` 값을 light/dark 기본값으로 이전(bg `#f1f2f9`/`#080a16`, surface `#fff`/`#141830`, accent `#4a3fd4`/`#a29bff`, danger `#b3261e`/`#ff8f87` 등). 기존 토큰 이름은 모두 유지하고 값만 교체했다. 선택·링크·그림자·모달 배경도 Orbit 계열로 바꿨다. 명시 dark와 pre-hydration fallback 블록은 같은 값으로 동기화했다.
- **신규 토큰**: `--radius-island`(20), `--radius-sheet`(26), `--t-slow`, `--ease-orbit`, `--icon-stroke`(1.5), `--font-ko`. 그림자는 보라 틴트(light), 헤어라인+깊은 그림자(dark). `--display-tracking`을 -0.015em으로 완화.
- **모션**: `prefers-reduced-motion: reduce`에서 `--t-fast/med/slow`를 1ms로 줄인다.
- **서체**: `--font-body` Geist→Pretendard, `--font-display` Fraunces→Pretendard, `--font-mono` Geist Mono. 모두 로컬 woff2이며 `assets/fonts/fonts.css`가 `@font-face`를 선언한다. OFL 라이선스 파일(Pretendard/Fraunces/Geist) 동봉. Open Sauce Two와 `main.tsx`의 `@fontsource` import 제거(패키지 의존성은 design-lab `preview.tsx`가 아직 쓰므로 남겨 둠).
- **Pretendard**: 공식 가변 woff2(2.06 MB)를 KS X 1001 음절 + Latin/문장부호로 서브셋하고 wght 400–700으로 고정해 **421,504 B**로 줄였다. 서브셋 밖의 희귀 한글은 시스템 서체로 대체된다.
- **번들 폰트 증가분**: 이전 236,360 B(Open Sauce Two 6파일 136,236 + Radio Canada Big 400/600/700 · JetBrains Mono 400의 @fontsource 100,124) → 현재 510,652 B(Pretendard 421,504 + Fraunces 36,620 + Geist 29,400 + Geist Mono 23,128). **+274,292 B(약 268 KB)**. `vite build` 산출물에서 네 파일 크기를 확인했다.
- **App.css 1–216**: 기본 primary 버튼 hover 그림자, `.icon-btn` 배경 hover·radius, 스크롤바 corner, 헤더 주석. 입력/select는 새 토큰을 그대로 소비한다. 전역 규칙 `svg[fill=none][stroke=currentColor][stroke-width="2"]`로 기존 인라인 아이콘 36개 파일을 수정하지 않고 1.5px 라운드 스트로크로 통일했다(CSS 선언이 presentation attribute보다 우선).
- **아이콘**: `components/icons/OrbitIcon.tsx`(design-lab의 1.5px 라인 경로 16종, 새 의존성 없음), `MenuIcon` 스트로크 1.5.
- **accent 계약**: `lib/accent.ts`의 `DARK_SURFACE`를 `#141830`으로 맞췄다. personal ?? vault ?? default 구조·파생 토큰은 그대로다.

## 검증 (모두 `app/apps/desktop`)
| 명령 | 결과 |
|---|---|
| `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lib/editor src/styles src/lib/__tests__/accessBoardPerf.test.ts --maxWorkers=1` | 371 통과 |
| 전체 `npx vitest run --maxWorkers=2` (1차) | 4 실패 → 대비 계약 2건은 dark 텍스트/선택 값을 올려 수정. `accessBoardPerf`(타이밍)·`folding`·`livePreviewMedia`는 부하 의존으로 보이며 단독 재실행에서 통과 |
| `npx tsc --noEmit -p .` | 오류 0 |
| `npx eslint src` | 오류 0, 경고 35(기존) |
| `npx vite build` | 성공, 폰트 4종이 `assets/`에 해시 파일로 출력 |

추가한 테스트: `tokensSync.test.ts`(light/dark/pre-hydration 텍스트 4.5:1, accent·danger·link 대비, Orbit 값 일치, 로컬 폰트·OFL 파일·reduced-motion), `OrbitIcon.test.ts`. `accent.test.ts`는 dark 표면을 `#141830`으로 갱신.

스크린샷(window-simulator, light/dark × 1440/720, 메인·설정): `/private/tmp/ib-redesign/p25/{main,settings}-{light,dark}-{1440,720}.png`. 네 조합 모두 `scrollWidth == clientWidth`(가로 넘침 없음)를 확인했다.

## 미검증
- 패키지 앱 빌드·실행: 하지 않았다. 폰트는 `font-src 'self'` 안의 로컬 해시 자산이라 CSP 위반 요인은 없지만 패키지 CSP에서의 로드는 직접 확인하지 못했다.
- Pretendard 한글 글리프 렌더링: 시뮬레이터 화면에 한글이 없어 눈으로 확인하지 못했다(`@font-face` 선언과 번들 출력만 확인).
- 전체 vitest 재실행에서 위 3건 불안정 테스트가 모두 통과하는지는 단독 실행으로만 확인했다.

## 남은 일
- App.css 217행 이후(switch, 컨텍스트 메뉴 등)와 다이얼로그 CSS는 소유 범위 밖이라 그대로 두었다. 토큰 값 변경으로 자동 반영되지만 radius/그림자 세부는 P3–P5에서 다듬어야 한다.
- `--text-faint`가 dark에서 대비 계약(4.5:1) 때문에 tertiary와 거의 같아졌다. 문법 기호를 더 흐리게 하려면 `theme.test.ts` 계약을 먼저 논의해야 한다.
- 개별 컴포넌트의 인라인 아이콘을 `OrbitIcon`으로 점진 교체하는 작업은 각 영역 워커 몫이다. `src/styles/DESIGN-BRIEF.md`는 아직 zinc/ink 서술이다.
- design-lab `preview.tsx`가 쓰는 `@fontsource/*` 의존성 정리는 별도로 한다.

## 커밋
- feat(desktop): bundle Orbit typefaces (Pretendard subset, Fraunces, Geist, Geist Mono)
- feat(desktop): switch design tokens to Orbit palette, radii, shadows and motion
- feat(desktop): Orbit 1.5px line icon set and base primitives
- fix(desktop): raise dark Orbit text tiers for editor contrast contracts
- docs: report redesign P2.5 implementation
