# IMPL-REPORT: T8 디자인 방향 시안 3개 + 아바타 시안

작성: 2026-10-17 · 워커 design · 브랜치 `sangwookpark/ib-design-directions` · 제품 코드(`src/`) 변경 없음

## 변경
- `app/apps/desktop/dev/design-lab/`: `directions.html` + `directions/`(tokens, icons, screens, css, main), `avatars.html` + `avatars/`(generators, grid), `fonts/`(Fraunces·Geist·Geist Mono·Instrument Serif latin woff2 + OFL 문서), `vitest.config.ts`(lab 전용).
- `docs/superpowers/specs/2026-10-17-identity-redesign-directions.md`: 조사(라이선스 확인), 방향 3개(Orbit/Synapse/Folio), 아바타 3시안, 비교표, 추천(Orbit, 아바타는 Neuron), 구현 단계.

## 검증 (실제 실행)
- `cd app/apps/desktop && NODE_OPTIONS=--no-experimental-webstorage npx vitest run --config dev/design-lab/vitest.config.ts` → 2 files, **27 tests passed** (생성기: 결정성, 500 seed 중 >=495 고유, 24 grid seed 전부 고유, 외부참조 없음, 좌표 범위, 팔레트 4.5:1; 방향 토큰: 3방향×light/dark 텍스트 대비 4.5:1).
- 별도 tsconfig로 `dev/design-lab/{avatars,directions}` `tsc --noEmit` → 오류 없음. (제품 tsconfig는 `src`만 포함하므로 제품 tsc는 lab을 검사하지 않음; `npx tsc --noEmit -p .` 출력 없음.)
- `npx vite --port 4401` + playwright-core(chromium)로 스크린샷 생성 후 일부(orbit main-dark, synapse main-light/settings-dark, folio main-light/welcome-720, orbit share-light, avatars grid-light)를 육안 확인.

## 스크린샷 (총 50장, `/private/tmp/ib-design/`)
- `<방향>` = `orbit` | `synapse` | `folio`. 파일명: `<screen>-<light|dark>-<1440|720>.png`, screen = `welcome`(웰컴/vault 선택), `main`(사이드바+파일트리+에디터), `settings`, `share`.
  - 예: `/private/tmp/ib-design/orbit/main-dark-1440.png`, `/private/tmp/ib-design/folio/welcome-light-720.png` (1440×900, 720×900; 3×4×2×2 = 48장)
- 아바타 24 seed 그리드(3시안 모두 한 장, 64/24/16px): `/private/tmp/ib-design/avatars/grid-light.png`, `/private/tmp/ib-design/avatars/grid-dark.png`
- 스크립트: `/private/tmp/ib-design/shot.mjs`, `shot-av.mjs` (저장소 밖).

## 미검증 / 한계
- 48장 중 육안 확인은 위 일부뿐. 나머지(특히 720px dark, synapse welcome)는 레이아웃 깨짐 미확인. 확인한 범위에서 synapse 사이드바의 "AI edit" 칩이 224px에서 살짝 잘림.
- 폰트는 라틴 서브셋만 번들, 한글은 시스템 폴백(한글 디스플레이 서체 미결정).
- Aceternity UI 라이선스는 접근 실패로 미확인. Raycast/Arc/Reflect/Tana는 직접 열람하지 않은 일반 지식 기반 메모(문서에 명시).
- 색약 시뮬레이션 필터 비교, 패키지 앱 CSP에서의 폰트 로딩, `backdrop-filter` 성능은 미검증. 목업은 정적이며 실제 kit/에디터 컴포넌트를 쓰지 않음.
- 아바타 16px 구별력은 육안 평가(Neuron > Constellation > Orbit).

## 남은 일
- 사용자 결정: 방향 1개, 아바타 기본, 한글 서체, backdrop-filter 허용(문서 §6 Q1–Q5).
- 결정 후 문서 §7의 P2.5–P7, A1 단계 착수. 기존 lab의 `fonts.tsx`(Google Fonts 링크)는 이번 범위 밖이라 그대로 둠.

## 커밋
- feat(desktop): add design-lab avatar generators and OFL fonts
- feat(desktop): add three identity direction mockups and avatar grid to design-lab
- docs: add identity redesign directions spec
- docs: report design directions implementation (이 보고서)
