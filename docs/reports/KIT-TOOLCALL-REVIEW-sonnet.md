<!-- SPDX-License-Identifier: Apache-2.0 -->
# Kit ToolCallCard 리뷰 (Sonnet)

대상: `e32dfbe` (`ToolCallCard.tsx/.css`, 테스트, design-lab 장면, NOTICE, `LICENSE-tool-call.md`). 이식 작업자와 다른 리뷰어.
**판정: 수정 후 승인.** 명백한 결함은 `8c07a16`에서 직접 고쳤다. 남은 건 아래 "판단 필요"뿐이다.

## 검증 결과
- `NODE_OPTIONS=--no-experimental-webstorage pnpm test src/components/kit`: 12 파일 / 29 테스트 통과 (리뷰 전 11 / 15).
- `app/`에서 `pnpm lint`: 오류 0 (기존 경고 45건, ToolCallCard 관련 없음). desktop `tsc --noEmit`: 통과.
- 시각 확인은 기존 스크린샷(`docs/assets/ui/kit-tool-call-{light,dark}.png`, Ink·Green)만 봤다. 수정 후 화면은 **재촬영하지 않았다**.

## (1) 원본 동작 보존 — 코드 대조
보존됨: grid-rows 0fr→1fr(380ms)+opacity, 오류 시 자동 펼침/다음 실행 시 자동 접힘(수동 토글이 `autoOpened`를 해제해 존중), `useStopwatch`(100ms 간격, 정리 포함), 캡 `cap+24`·모두 보기, 복사 아이콘 전환, 다시 시도, 그룹 요약·최근 3개 아이콘 스택, `inert`/`aria-expanded`/`aria-controls`/`role=status`, reduced-motion(1ms). 원본 대비 개선: `copyText`의 `execCommand` 예외 처리.
렌더 테스트(`ToolCallCard.render.test.ts`)로 자동 펼침/접힘 5개 경로, 타이머·복사 timeout 해제, XSS 비주입, 그룹 요약을 고정했다.

## (2) kit 관례
- 사용 토큰 25종 모두 `tokens.css`에 정의돼 있고 하드코딩 색 없음. SPDX 헤더 있음.
- `kit/motion.ts`는 쓰지 않는다. 이 카드는 CSS 전환만 쓰고 motion/react 스프링을 쓰지 않으므로 해당 없음(타당). 다만 이징이 원본 `(0.22,1,0.36,1)`에서 `var(--ease)` `(0.2,0,0,1)`로 바뀐 점은 의도로 본다.
- 레벨 대비(WCAG, bg-subtle 기준, accentPalette 실제 값으로 계산): 기존 `key=var(--accent)`는 라이트에서 Coral 2.99, Violet 3.29, Blue 4.15, Green 4.10, 노랑 2.81로 4.5 미달 → **`--text-primary`로 수정**(원본도 key는 ink). str/lit/num은 라이트 ≥4.7, 다크 ≥7.0으로 통과.
- 포커스 링: 기존 `inset var(--focus-ring)`은 기본(Ink) 토큰이 2중 그림자라 바깥 4px 링이 카드 `overflow:hidden`에 잘리고 안쪽 2px는 `--bg-surface`색이라 헤더 키보드 포커스가 안 보였다 → 헤더는 accent 55% inset 링, 나머지 버튼은 `var(--focus-ring)`로 **수정**.
- shine: 원본의 `data-text` 오버레이가 빠지고 `--bg-surface`색 띠가 라벨을 가리는 방식이었다(hover 배경에서 띠가 보임) → `background-clip:text` 그라디언트로 **수정**, reduced-motion에서는 단색. (눈으로 검증 못 함)

## (3) 한국어
말투 혼용(`복사했어요` vs `없습니다/실패했습니다`)을 B0-b 시안과 같은 해요체로 통일(`도구 호출에 실패했어요.`, `입력 또는 결과가 없어요.`). 개별 도구의 aria 문구 `도구 사용 중` → `실행 중`. 맞춤법 오류 없음.

## (4) 정리·안전·비용
- `setInterval`(cleanup), `ResizeObserver`(disconnect), `setTimeout`(cleanup) 모두 해제됨(테스트로 확인). `dangerouslySetInnerHTML` 없음, 토큰은 텍스트 자식으로만 렌더 → XSS 안전.
- 비용 결함 수정: 실행 중 100ms마다 카드가 리렌더되며 `JSON.stringify`+토큰 span 생성을 매번 반복(접힌 본문도 항상 렌더). `useMemo`로 캐시하고 2만 자 초과는 하이라이트 없이 평문으로 표시.

## (5) 테스트
추가: formatMs 999/999.6/1000/59,999/60,000 및 음수·live, toText(깨진 JSON, 앞뒤 공백, 원시 숫자, 순환, undefined, null, BigInt), 하이라이트(키/문자열/숫자/리터럴/이스케이프 따옴표/원문 보존/마크업 불활성). 한계: jsdom에는 레이아웃이 없어 캡·"모두 보기"는 자동 테스트 불가(ResizeObserver 스텁).
formatMs 수정: 999.5ms가 `1000ms`로 나오던 것과 음수 시간(`-0.1초`)을 막음.

## 판단 필요 (직접 고치지 않음)
1. **출처·라이선스 (릴리스 전 필수)**: `.tsx/.css`에 `Apache-2.0` SPDX를 붙였지만 원본 라이선스는 불명이다(CLAUDE.md는 새 파일에 Apache-2.0 헤더를 요구하므로 형식상 맞음). NOTICE·`LICENSE-tool-call.md`는 "출처 불명/확인 필요"로 사실대로 적었다. 두 가지 보정 권장: ① 원본 CSS는 붙여넣기에 없고(`const css = ""` + 레이아웃 메모뿐) CSS는 메모로 새로 작성했으므로 NOTICE의 "ToolCallCard.css adapted"는 과장일 수 있음, ② 소스 주석·`LICENSE-tool-call.md`에 임시 경로 `/private/tmp/...scratchpad/...`가 박혀 있어 사라질 경로이므로 원 작성자·URL 확인 후 교체. 작업 지시에 있던 `LICENSE-react-bits.md`는 변경되지 않았다(신규 파일로 분리한 것은 적절).
2. **`toText` 충실도**: JSON 문자열을 `parse→stringify`하므로 큰 정수 ID는 정밀도를 잃고, 순환 객체는 `[object Object]`로 나온다. 디버그 뷰어로 쓸 거라면 순환 안전 replacer와 원문 보존(파싱 실패/정밀도 손실 시)을 검토.
3. **접힌 카드의 렌더 비용**: 본문을 접힌 상태에서도 렌더한다(애니메이션 때문). 도구 호출이 수백 개인 대화에서는 첫 펼침 전까지 인자·결과를 지연 렌더하는 편이 안전하다.
4. **accent 글자 대비**: 실행 중 그룹 라벨(`color: var(--accent)`)은 라이트에서 Coral 3.28, Violet 3.62, 노랑 3.09로 4.5 미달. 아이콘 타일(accent on accent-soft)도 낮다. accent 팔레트 전반의 문제라 이 컴포넌트만 고치지 않았다.
5. **스크린샷 재촬영**: 커스텀 accent·reduced-motion·키보드 포커스·수정 후 shine이 캡처에 없다(현재 PNG는 Ink 라이트/Green 다크). 수정 반영 후 재촬영 필요.
6. design-lab 장면의 `onRetry`가 `window.alert`를 쓴다. 브라우저 자동화/스크린샷 중 눌리면 멈추므로 no-op 또는 토스트 권장.
7. `ToolCallGroup`은 자식의 `props.status/duration`을 직접 읽는다(원본과 동일). `ToolCallCard`를 감싼 래퍼 컴포넌트는 요약에서 누락됨 — 문서화만 필요.
