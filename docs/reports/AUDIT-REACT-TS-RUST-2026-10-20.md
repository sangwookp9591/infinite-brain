# React 19 · TypeScript 7 · Rust 최신 기능 활용 점검

2026-10-20. 범위: 데스크톱 앱(`app/apps/desktop`)과 서버(`app/apps/server`). 버전과 API는 Context7(`/react/react/v19.2.8`, `/microsoft/typescript/v7.0.2`, `/rust-lang/edition-guide`)와 npm·crates.io 조회로 확인했다. 수치는 이 날짜의 저장소 기준이다.

## 요약

| 영역 | 지금 | 최신 | 활용도 | 가장 큰 걸림돌 |
|---|---|---|---|---|
| React | 19.2.7 (`^19.1.0`) | 19.3.1 | 낮음. 19 신규 API 사용 0건 | 없음. 점진 도입 가능 |
| TypeScript | 5.8.3 (pnpm catalog `~5.8.3`) | 7.0.2 | 사용 안 함 | typescript-eslint가 `typescript <6.1`만 허용 |
| Rust | rustc 1.94.0, edition 2021 | stable 1.99.1, edition 2024 | 중간. 2024 문법 0건 | 의존성 196개 업데이트 가능, 주요 crate 메이저 뒤처짐 |

## React 19

**쓰지 않는 19 기능**(전수 검색 0건): `use()`, `useActionState`, `useOptimistic`, `useFormStatus`, form `action`, `useEffectEvent`, `<Activity>`.

**19 이전 방식이 남은 곳**
- `forwardRef` 2곳(`AsyncButton.tsx`). React 19는 `ref`를 일반 prop으로 받는다.
- `useContext` 4곳, `<Context.Provider>` 4곳. 19는 `use(Context)`와 `<Context>`를 쓴다.
- 수동 메모이제이션 121곳(`useMemo`/`useCallback`/`memo`), `exhaustive-deps` 끄기 18곳, `useEffect` 310곳.
- React Compiler를 켜지 않았다(`babel-plugin-react-compiler` 1.0.0 사용 가능).

**권고(순서대로)**
1. `forwardRef` → `ref` prop, `Context.Provider` → `<Context>`, `useContext` → `use`. 기계적 변경이고 위험이 낮다.
2. 비동기 버튼과 폼(`AsyncButton`, 설정 저장, 로그인)을 `useActionState`/`useFormStatus`로 옮긴다. 로딩·오류 상태 코드가 줄어든다.
3. React Compiler를 한 화면(예: 설정 탭)에서 먼저 켜고 렌더 수를 잰 뒤 넓힌다. 그 뒤 수동 메모이제이션을 걷어낸다.
4. `exhaustive-deps` 끄기 18곳은 `useEffectEvent`로 대부분 풀린다.

## TypeScript 7

- **지금:** 5.8.3. pnpm catalog가 `~5.8.3`으로 묶는다.
- **7.0.2로 시험 컴파일한 결과:** 서버는 오류 0. 데스크톱은 3개(`attachments.ts:33` Blob에 `Uint8Array<ArrayBufferLike>`, `:99` `crypto.subtle.digest`, `voice/playback.ts:176` `copyToChannel`의 Float32Array). 모두 7의 엄격해진 ArrayBuffer 타입 때문이다. 매개변수 타입만 좁히면 오류가 호출부로 옮겨 가므로, 호출부에서 `new Uint8Array(buf)`처럼 복사하거나 `ArrayBuffer` 기반으로 만들어야 한다.
- **속도:** 타입 검사가 데스크톱 24.0초 → 1.6초, 서버 5.2초 → 0.7초.
- **설정:** tsconfig에 7에서 제거된 옵션(baseUrl, ES5, AMD/UMD/System, Classic/node10, `esModuleInterop:false`, `allowSyntheticDefaultImports:false`, `downlevelIteration`, `alwaysStrict:false`)은 없다.
- **막는 것:** typescript-eslint가 peer로 `typescript >=4.8.4 <6.1.0`만 허용한다. 7의 네이티브 컴파일러는 JS API(`require('typescript')`)를 내보내지 않아(`./unstable/*`만 있음) lint 규칙이 타입 정보를 못 쓴다.

**권고:** 타입 검사(`tsc --noEmit`)만 7로 돌리는 스크립트를 CI에 추가하고, lint와 빌드는 5.8에 둔다. typescript-eslint가 7을 지원하면 전환한다. 그 전에 위 3개 오류를 고쳐 두면 전환 비용이 0이 된다.

## Rust

- **툴체인:** rustc 1.94.0. 최신 stable은 1.99.1. `rust-toolchain.toml`, `rust-version`, `[lints]`가 없어 개발자·CI마다 버전이 다를 수 있다.
- **edition 2021.** `-W rust-2024-compatibility`로 전체 검사한 결과 경고는 "relative drop order changing in Rust 2024" 5곳뿐이다: `oauth.rs:163`, `agent_runner.rs:564`, `attachments.rs:675`, `extract_worker.rs:156`, `tests/data_volume_bench.rs:369`. 모두 임시값이 들어간 `if let`/`match`의 drop 시점 문제이고, 각 자리에서 잠금이나 리소스가 블록 끝까지 살아야 하는지만 보면 된다.
- **2024 문법 활용:** let chains 0건, let-else 0건, `#[expect]` 0건(`#[allow]` 1건). `once_cell` 3곳은 std `LazyLock`/`OnceLock`으로 바꿀 수 있다.
- **의존성:** `cargo update`로 196개가 올라간다. 메이저가 뒤처진 직접 의존성: rusqlite 0.32 → 0.40.2, keyring 3 → 4.2, zip 2 → 9.0.5, quick-xml 0.37 → 0.42, sha2 0.10 → 0.11, tauri 2.11.5 → 2.12.4, uuid, tokio.
- **llama-cpp-2:** 스마트 검색 때문에 git rev(PR #1175)로 고정돼 있다. crates.io 릴리스가 나오면 옮긴다(`docs/SMART-SEARCH.md`).

**권고(순서대로)**
1. `rust-toolchain.toml`로 1.99를 고정하고 `Cargo.toml`에 `rust-version`과 `[lints]`(clippy 기본 + `unsafe_op_in_unsafe_fn`)를 둔다.
2. drop 순서 5곳을 확인한 뒤 edition 2024로 올린다(`cargo fix --edition`). 이후 let chains와 `LazyLock`으로 정리한다.
3. 의존성은 패치·마이너(`cargo update`)를 먼저 하고, 메이저는 rusqlite(인덱스 핵심)·keyring(로그인 토큰)·zip(가져오기) 순으로 하나씩, 각각 테스트와 함께 올린다.

## 다른 도구

vite 7.3.6 → 8.3.4, vitest 4.1.11 → 5.0.5, eslint 9.39.5 → 10.13.0. eslint 10은 typescript-eslint 지원 여부와 묶어서 함께 판단한다.

## 하지 않은 것

이 보고서는 점검만 했다. 코드와 의존성은 바꾸지 않았다. TypeScript 7 시험 컴파일과 Rust 2024 호환 검사는 저장소 밖 임시 경로에서 돌렸다.
