# Kit ActivityHeatmap 리뷰 (Sonnet)

- 대상: `bac475d` (iron/feat-kit-heatmap), 원본 `heatmap-src.tsx`(705줄)
- 방법: 원본과 코드 대조 + 디자인 랩(vite)에서 실제 브라우저로 측정
- **판정: 수정 후 승인** — 명백한 결함은 `de4cc17`에서 직접 고쳤다. 아래 "판단 필요"가 남아 있다.

## 1. 직접 고친 결함 (`de4cc17`)

| # | 결함 | 확인 |
|---|---|---|
| 1 | **범위를 한 번 바꾸면 범례 강조(dim)가 영구히 죽음.** sweep 애니메이션이 `fill-mode: both`인데 `data-direction`이 해제되지 않아 `opacity: 1`로 고정됨 | 브라우저: 범위 전환 후 강조 시 레벨1 셀 opacity `1`(기대 `.3`) → 수정 후 `.3` |
| 2 | 같은 방향 범위 전환은 sweep이 다시 재생되지 않음 (속성 값이 안 바뀜) | 1번 수정(1.1초 뒤 direction 해제)으로 같이 해결 |
| 3 | **툴팁 위치**: `58 + row*…` 매직 오프셋 + 말풍선에 `translateY(-100%)` 없음 → 셀을 덮음. `actions` 버튼으로 헤더가 높아지면 더 어긋남 | 측정: 말풍선 top이 셀 top보다 위 8px(겹침) → 수정 후 셀 위 8px 간격, 중심 오차 0 |
| 4 | **첫 툴팁이 (0,0)에 뜸.** `AnimatePresence`로 새로 mount된 motion 요소가 직후의 MotionValue 변경을 반영하지 않음 | 측정: 첫 표시 dx −154 / 이후 정상 → 항상 mount 유지 + 첫 표시는 `jump`, 이후 glide로 수정 |
| 5 | **roving tabindex 소실**: 포커스/선택 인덱스가 범위 밖이 되면 `tabIndex=0` 셀이 0개 → 키보드로 격자 진입 불가 (선택 인덱스 상한 검사 누락, `focusIndex` 상한 검사 누락) | 측정: 최근 1년에서 350번 포커스 후 "올해" 전환 → tabbable 0 → 수정 후 1 |
| 6 | `count`가 NaN이면 total·threshold·레벨 전체 오염 | `buildModel`에서 비유한 값은 0 처리 + 테스트 |
| 7 | reduced-motion에서 `animation-delay`(최대 420ms)가 남아 셀이 그동안 투명 | `animation-delay: 0` 추가 |
| 8 | 스크린리더 설명 중복: `levelDescription(ranges)` 뒤에 `ranges.join`을 한 번 더 붙임 | 기본 문구에 "단계: …"를 넣고 중복 제거 |
| 9 | 포인터가 셀을 떠나면 키보드 포커스 중인 셀의 툴팁까지 닫힘 (원본은 복원) | `:focus-visible` 셀이면 유지 |
| 10 | `ranges[0]`이 `noActivityLabel` prop을 무시, 숫자 로케일 포맷 없음 | 반영 |
| 11 | 성능: 셀 371개가 호버/범례 상태마다 재생성, `Intl.DateTimeFormat` 7개를 렌더마다 생성, `fmtCount` 매번 새 함수 | `cells`·`weekdays`·`fmtCount` `useMemo` |
| 12 | 요일 라벨 `9px` 하드코딩 → `var(--fs-xs)`; 선택 링 이동 transition 추가 | — |

테스트: 5개 추가(중복 날짜 합산·정렬 무관, 음수/NaN/잘못된 날짜, 기본 threshold, `weekStartsOn` 0/1 lead·weeks, 레벨별 일수·월 라벨). 기존 2개와 합쳐 `buildModel` 경계를 덮는다.
디자인 랩 라이트/다크 캡처는 툴팁 위치가 보이도록 갱신했다.

## 2. 원본 동작 보존 점검

보존: 웨이브 등장(420ms 대각선), 키보드 ↑↓←→/Home/End/Enter/Space/Escape, 범례 미리보기·고정(`aria-pressed`)·화살표 이동, 선택 링, 툴팁 글라이드·스크롤 추적(스크롤 시 재배치), reduced-motion(`useSpring`→`INSTANT` + CSS).

**원본 CSS 모듈이 없어** 웨이브/sweep 키프레임의 세부 값은 대조하지 못했다(원본 파일 머리 주석이 명시). 재현이 아니라 "비슷한 근사"다.

## 3. 판단 필요 (수정하지 않음)

1. **원본에서 빠진 모션**: `RollingNumber`(총합 자릿수 롤), `RiseText`(기간·캡션 전환), 툴팁 텍스트 롤/너비 morph, 범례 호버 90ms 지연(스와치 사이 깜빡임 방지), 터치 시 툴팁 2.4초 유지(현재는 터치 직후 사라짐), `useInView`로 화면에 보일 때 등장 시작(현재는 마운트 즉시). 의도적 축소면 문서에 명시하고, 아니면 후속으로 복원. 데스크톱(Tauri) 전용이면 터치 항목은 낮은 우선순위.
2. **SPDX 헤더 `Apache-2.0`**: 출처·라이선스 불명 코드를 개조했는데 Apache-2.0을 단정한다. 다른 kit 파일은 `… AND LicenseRef-ReactBits…`로 출처를 표시한다. 배포 전 법무가 출처 확인 후 정하거나 `LicenseRef-Unverified-Origin` 같은 임시 표기를 고려. (CLAUDE.md는 신규 파일에 Apache-2.0을 요구하므로 현행 유지.)
3. **한국어 문구**: 요약이 `편집 1,136회 최근 1년`으로 연결어가 없다(원본은 "N … in period"). `최근 1년 동안 편집 1,136회` 또는 `최근 1년 · 편집 1,136회`가 더 자연스럽다 — 기간 문구는 호출 측이 주므로 카피 결정 필요. `"편집 N회"` 단위·`회 이상`·`날짜 강조:` 접두는 하드코딩이라 prop(`formatCount`, `highlightLabel`)로 일부만 바꿀 수 있다 → 완전한 지역화가 목표면 `rangeLabels`/`highlightItemLabel` prop 필요.
4. `<section aria-label>`과 `role=grid aria-label`이 같은 문구라 스크린리더가 두 번 읽는다. 한쪽 제거 권장(코드 영향 작아 보류).
5. 방어: 한두 개의 극단적 과거 날짜(예: `0001-01-01`)가 섞이면 length가 수십만 일로 늘어 셀 수만 개를 렌더한다. 호출 측 검증 또는 상한 필요.
6. `tokensSync` 테스트를 완화(주석 제거 + kit CSS 내 지역 선언 허용)했는데, 지역 변수 집합이 파일 전체 합집합이라 다른 파일 변수와 오타가 겹치면 통과한다. 파일별 집합으로 좁히면 더 엄격.

## 4. kit 관례 (통과)

- 색: 하드코딩 없음. 레벨은 `color-mix(var(--accent) N%, var(--bg-surface))` 5단계(8/28/48/68/100%), 토큰만 사용(`--border`, `--focus-ring`, `--shadow-md`, `--sp-*`, `--fs-*`, `--ease`). 하드코딩 크기는 셀 `12px/4px`(로컬 변수)와 `border-radius: 3/4px`뿐.
- 모션: `kit/motion.ts`의 `SNAPPY`·`useSpring` 재사용, 인라인 spring 튜닝 없음.
- 대비: 다크(기본·노란 accent)와 라이트 노란 accent를 디자인 랩에서 확인 — 5단계가 구분되고 0단계는 `--border` 테두리로 윤곽 유지. 선택 링은 레벨4 셀(=accent 채움)에서도 `scale(1.28)`로 바깥에 보인다.
- 타이머/옵저버: reveal·direction 타이머는 cleanup 있음, 스크롤 리스너·진행 중 애니메이션 `stop` cleanup 있음. ResizeObserver는 사용하지 않음(원본의 RollingNumber 전용이었음).

## 5. NOTICE / LICENSE 표기

사실대로다. "사용자 제공 파일에서 개조, 원 출처·저자·라이선스 미확인, 배포 전 확인 필요"로 적었고 React Bits 라이선스를 이 컴포넌트에 씌우지 않았다(`LICENSE-react-bits.md` 하단 문단이 이를 명시). 파일명이 `LICENSE-react-bits.md`인 곳에 섞인 점만 어색하지만 내용은 정확하다. 배포 차단 항목으로 유지할 것.

## 6. 실행 결과

- `app/apps/desktop`: `NODE_OPTIONS=--no-experimental-webstorage pnpm test` → 336 파일 통과 / 2 skip, 3574 테스트 통과 / 12 skip
- `app/apps/desktop`: `npx tsc --noEmit -p .` → 오류 없음
- `app/`: `pnpm lint` → 0 errors, 45 warnings (히트맵 관련 경고 없음, 기존 경고)
- 브라우저 확인: 디자인 랩(vite) + Playwright, 위 표의 측정값
- push 안 함.
