# IMPL-REPORT: T10 자체 Neuron 아바타로 DiceBear 교체

## 변경
- `app/apps/desktop/src/lib/avatar/neuron.ts` (신규): 의존성 없는 결정적 SVG 생성기. 세포체 r4.4, 가지 3~5개(선 1.8, 끝 구 r2.1), 굵은 축삭 1개(선 2.2, 끝 구 r3), 가지 하나에 포크. 모든 가지는 같은 방향으로 살짝 휘어 단정하게 보이도록 했다. 시안의 거친 획·큰 세포체(물감 얼룩 인상)를 줄였다.
- 라벤더 타일(light `#ebe8fa` / dark `#2b2850`) + Okabe-Ito 계열 8색(테마별 조정, 타일 대비 ≥ 4.5:1). 색만이 아니라 형태(가지 수, 축삭 방향, 포크 위치, 휘어짐)로도 구별된다.
- `src/lib/avatar/useAvatarTheme.ts` (신규): `<html data-theme>` → 없으면 OS 설정을 읽는 훅(MutationObserver). 테마가 바뀌면 SVG를 다시 그린다.
- `components/Avatar.tsx`: DiceBear 제거, `characterSvg(seed, theme="light")`는 `neuronSvg` 위임. 사진 우선 → 실패 시 생성 아바타 경로는 그대로. `scopeSvgIds` 호출 제거(생성 SVG에 id가 없음).
- `components/Face.tsx`: lazy/Suspense/모노그램 제거, 이름(`Face`, `LazyAvatar`)과 props는 유지한 얇은 래퍼. `lib/prefetch.ts`의 Avatar 선행 로드 제거.
- `dev/design-lab/neuron-final.html` + `avatars/neuron-final.tsx`: 제품 생성기로 24-seed 그리드를 보는 하네스.
- 테스트: `src/lib/avatar/neuron.test.ts`(신규), `components/__tests__/avatarIdentity.test.ts` 수정(아바타에 id 없음, 볼트 아이콘 id 격리는 유지).
- 프레즌스 색(`lib/presence/color.ts`)은 건드리지 않았다. 다른 화면 CSS도 변경 없음.

## LAZY 경계 재평가 (기록)
이전 이유는 `@dicebear/collection` ~300 KB였다. 새 생성기는 압축 전 약 4 KB이고 의존성이 없다. 따라서 eager 사용을 허용하고 Face/LazyAvatar의 지연 로딩을 걷었다(첫 화면의 모노그램 → 얼굴 교체 깜빡임도 사라진다).

## 번들 크기 (`vite build`, 전/후)
- 전체 JS: 8,515,218 → 8,142,875 bytes (−372,343, −4.4%).
- `Avatar-*.js` 청크 374,133 bytes 제거(청크 98 → 96개).
- `VaultIconSvg` 청크 99,686 → 107,083 bytes(+7.4 KB): DiceBear core가 이 청크로 옮겨 갔다.

## 결정 필요 / 남은 일
- **`@dicebear/*`를 package.json에서 완전히 제거하지 못했다.** `components/VaultIconSvg.tsx`(볼트 프리셋 아이콘 40여 개)가 DiceBear `icons` 스타일(Bootstrap Icons)을 쓰며, 이는 이번 Target 밖이다. 완전 제거하려면 볼트 아이콘 글리프를 직접 그리거나 Bootstrap Icons(MIT) SVG를 번들하는 별도 작업이 필요하다. 지금은 `VaultIconSvg` 지연 청크에서만 쓰이고 `scopeSvgIds`도 이 용도로 유지한다. 별도 작업으로 분리할지 coordinator 판단 필요.
- 기존 사용자의 생성 아바타가 DiceBear 캐릭터에서 Neuron으로 바뀐다(`character:<seed>`로 고른 값은 seed만 유지되고 모양은 새로 그려진다). 공지 여부는 사용자 결정(spec Q5).
- 공유 다이얼로그의 멤버 목록·프레즌스 스택 화면은 시뮬레이터 fixture에서 열리지 않아 실제 화면 스크린샷을 찍지 못했다(미검증). 같은 `FaceSvg`/`Avatar`를 쓰며 단위 테스트(`avatarIdentity.test.ts`)로 같은 seed 규칙을 확인했다.
- 패키지 앱 빌드는 하지 않았다(미검증).

## 검증
- `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=2` (desktop 전체): 336 파일 통과, 1 실패 — `src/lib/editor/livePreviewMedia.test.ts`(video embed). 시스템 부하에서만 실패했고 단독 재실행에서는 변경 전/후 모두 7/7 통과(아바타와 무관, flaky로 판단).
- 신규 `neuron.test.ts`: 결정성, 대소문자 구분, 서로 다른 seed 100개 → SVG 100개(light/dark 모두), 색을 지워도 100개(형태로 구별), id/url/script 없음, 모든 마크가 원형 타일 안, 팔레트 전 색 사용, 두 테마 모두 대비 ≥ 4.5:1.
- `npx tsc --noEmit`: 오류 없음. `npx eslint`(변경한 파일·`dev/design-lab/avatars`): 오류 없음.
- 스크린샷 `/private/tmp/ib-redesign/avatar-neuron/`:
  - `grid-light.png`, `grid-dark.png`: 24-seed × 64/24/16px.
  - `main-{light,dark}-{1440,720}.png`, `sidebar-account-{light,dark}-{1440,720}.png`, `share-{light,dark}-{1440,720}.png`: window-simulator 실제 화면. 육안 확인한 것은 grid-light, main-light-1440, sidebar-account-dark-1440, share-dark-1440(다이얼로그에 아바타 없음). 나머지는 촬영만 했다.
- 16px에서 형태가 구별되는지는 그리드로 육안 확인했으나, 색약 시뮬레이션 도구로는 검증하지 않았다(미검증).

## 커밋
- `feat(desktop): replace DiceBear avatars with in-house Neuron generator`
- `docs: report avatar neuron implementation` (이 보고서)
