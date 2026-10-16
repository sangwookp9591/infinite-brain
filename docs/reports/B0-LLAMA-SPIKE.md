# B0-a llama.cpp 내장 실험 보고서

2026-10-16 · 브랜치 `iron/spike-b0-llama` · 기준 문서: PRD v2 §5.8 F8.1~F8.3, §9 B0 행, §12 Q2 (`docs/superpowers/specs/2026-10-15-team-second-brain-prd.md`)

## 1. 결론 (한 문단)

**조건부 채택을 권고한다.** Rust에서 llama.cpp를 앱 바이너리에 정적으로 넣어 EmbeddingGemma 2(GGUF)를 별도 런타임 없이 실행할 수 있음을 macOS(M5)에서 확인했다. 이 기기에서는 Metal로 문단 1개를 약 15ms, 100개를 약 1~2초에 처리한다. 바이너리 증가는 Metal 포함 약 9.0MiB, CPU 전용 약 3.7MiB다. 단, 지금 crates.io의 `llama-cpp-2 0.1.160`에 들어 있는 llama.cpp는 EmbeddingGemma 2 구조(`gemma-embedding2`)를 모른다. 이 실험은 llama.cpp를 최신 태그로 바꿔 끼운 사본으로 통과시켰다. B1은 이 문제를 해결하는 것(핀 고정한 git 의존성 또는 포크)에서 시작해야 한다. Windows·Linux, 디스크 cold 상태, 배터리는 측정하지 못했다.

## 2. 환경과 가정

| 항목 | 값 |
|---|---|
| 기기 | Apple M5, 10코어(성능 4 + 효율 6, `sysctl hw.perflevel*`), 메모리 24GB |
| OS / 도구 | macOS (Darwin 27.0.0), rustc/cargo 1.94.0, clang(Xcode), cmake 4.4.4(pip, 저장소 밖 venv) |
| 래퍼 | `llama-cpp-2 =0.1.160`(2026-10-15 게시), 한 줄 패치 사본 |
| llama.cpp | 태그 `v0.7.0` = `620d2225cc436ab0b001e3200e590e3b286ef9ab`(2026-10-15)로 교체 |
| 스레드 | 기본 4(성능 코어 수). 6·10도 시험 |
| 컨텍스트 | n_ctx = n_batch = n_ubatch = 4096, Mean 풀링, 임베딩 모드 |
| 입력 | 모델 카드의 prefix 규칙을 따랐다. 문서 `title: none \| text: …`, 검색어 `task: search result \| query: …`, 문장 유사도 `task: sentence similarity \| query: …` |
| 말뭉치 | 이 실험을 위해 새로 쓴 합성 글. 12개 주제를 한국어·영어로 각각 쓴 문단 24개와 주제별 짧은 검색어 24개(`src/corpus.rs`). 문단 평균 약 77토큰(prefix 포함, 100문단 합계 7,660토큰). 실제 사용자 노트는 쓰지 않았다 |

**가정.** (a) "EmbeddingGemma 2 GGUF"는 Unsloth 배포본을 쓴다. 공식 모델명이 존재해서 대체 모델은 쓰지 않았다. (b) 앱 호환을 보려는 것이 아니라 실행 가능성과 비용을 보는 spike이므로 `src-tauri`에는 연결하지 않았다(의존성도 건드리지 않음). (c) Windows·Linux는 이 기기에서 잴 수 없어 B1 확인 항목으로 넘긴다.

**측정 신뢰도에 관한 주의.** 측정 중 이 기기에서 다른 워커와 OrbStack이 함께 돌아 load average가 7~89까지 흔들렸다. **Metal 수치는 GPU 위주라 비교적 안정적이지만, CPU 수치는 부하에 크게 흔들린다.** 아래 표의 CPU 값은 "load 14~22 구간의 첫 행렬 실행"이고, 같은 설정을 더 바쁜 시간에 다시 돌리면 2배 안팎(6스레드는 20배)까지 느려졌다(§4.3). 절대값이 아니라 자릿수와 상대 비교로 읽어야 한다.

## 3. 조사 결과

### 3.1 Rust 바인딩 후보

| 후보 | 상태 (2026-10-16 조회) | 판단 |
|---|---|---|
| **`llama-cpp-2`** + `llama-cpp-sys-2` (utilityai/llama-cpp-rs) | 0.1.160 (2026-10-15), 같은 날 main에서 0.1.161 올림. 직전 릴리스가 10-07·09-30·09-22로 주 단위 갱신. 누적 다운로드 약 162만, 최근 약 79만. GitHub 별 657, 열린 이슈 51. 라이선스 `MIT OR Apache-2.0` | **채택 후보 1순위.** 유지가 가장 활발하다 |
| `llama_cpp` (edgenai) | 0.3.2, 2024-04-29 이후 갱신 없음 | 사실상 중단 |
| `llama-cpp-rs` (mdrokz) | 0.3.0, 2023-10-12 이후 갱신 없음, 라이선스 표기 non-standard | 제외 |
| `candle-core` (Hugging Face) | 0.11.0 (2026-06-26) | 이번엔 평가하지 않았다. `gemma-embedding2`를 지원하는지 확인하지 않았다 |

- **정적 링크:** 가능하다. 기본이 정적이다(`llama-cpp-sys-2` `build.rs:484-488`에서 `dynamic-link` feature나 `LLAMA_BUILD_SHARED_LIBS=1`일 때만 공유 라이브러리). 실제로 `otool -L target/metal/release/bench`에 `libllama`·`libggml` 같은 동적 라이브러리가 없고 시스템 프레임워크(Foundation, Metal, MetalKit, Accelerate)와 `libc++`만 나온다.
- **CPU 명령어 최적화:** `GGML_NATIVE`는 `target-cpu=native`를 줄 때만 켜진다(`build.rs:808-816`). 기본은 꺼져 있어 빌드한 기기에 묶이지 않는다.
- **Metal:** macOS에서는 `metal` feature와 상관없이 **항상 켜진다.** `build.rs:894`는 watchOS에서만 끄고, `build.rs:1519-1521`은 watchOS가 아니면 Metal·MetalKit 프레임워크를 링크한다. 그래서 "CPU 전용" 비교용으로는 사본의 `build.rs`에 환경변수 `B0_NO_METAL=1` 스위치를 넣었다(`scripts/vendor-llama.sh`). 실행 때는 `n_gpu_layers`(0 또는 99)로 CPU/GPU를 고른다.
- **기타 feature:** `vulkan`, `cuda`, `opencl`, `webgpu`, `openmp` 등이 있다(`llama-cpp-2` Cargo.toml). Windows·Linux GPU는 Vulkan이 후보이나 이번에는 확인하지 못했다.
- **막힌 점 (중요):** 0.1.160이 번들한 llama.cpp는 `d81235049384534c167caea52b85a694f6103d14`(2026-10-05)다. 이 시점에는 `LLM_ARCH_GEMMA_EMBEDDING`(1세대)만 있고 `gemma-embedding2`가 없다. 모델 파일의 `general.architecture`는 `gemma-embedding2`다. 지원 커밋은 `4fbc76dec5`(2026-10-06, "model: support embeddinggemma2"). 현재 `llama-cpp-rs` main의 서브모듈도 같은 `d81235049…`이어서 **아직 릴리스된 crate로는 이 모델을 못 돌린다.**
- **우회 (이번 실험에서 쓴 방법):** `scripts/vendor-llama.sh`가 `llama-cpp-sys-2`를 복사해 `llama.cpp`만 `v0.7.0`으로 바꾸고, 래퍼 `llama-cpp-2`도 복사해 새 C 구조체의 필드 추가에 맞게 한 곳(`src/timing.rs`의 `llama_perf_context_data`에 `n_reallocs_diff`, `n_reallocs_same` 0으로 추가)만 고친다. `Cargo.toml`의 `[patch.crates-io]`가 이 사본을 가리킨다. 사본(약 180MB)은 `.gitignore`로 막았다. 다른 호환 문제는 이 모델에서는 나오지 않았다.

### 3.2 모델 배포본

- 공식 모델: `google/embeddinggemma-2`, revision `914f7f89142e33e77833254d9c9b90c3cef7303b`(2026-10-06 수정), 라이선스 메타데이터 `apache-2.0`.
- **사용한 GGUF:** `unsloth/embeddinggemma-2-GGUF`, revision `031f0d4b35536f69ab3509d4893c923264fcf253`(2026-10-07). 라이선스 메타데이터 `apache-2.0`. 파일 안의 `general.architecture`는 `gemma-embedding2`, 파라미터 271,002,648개(텍스트 모델만. 비전·오디오는 별도 `mmproj-*.gguf`이고 쓰지 않음), 출력 차원 768(`embedding_length_out`), 풀링 Mean, 학습 컨텍스트 262144(공식 카드는 8K를 안내).
- 같은 시기에 `ggml-org/embeddinggemma-2-GGUF`(revision `bfcd298762cc34d0357ece5ebdd31791a3a374d8`)에도 BF16·Q8_0만 있다. Q4 계열이 없어서 Unsloth를 택했다.

| 파일 (Unsloth, revision `031f0d4…`) | 양자화 | 크기(바이트) | SHA-256 |
|---|---|---|---|
| `embeddinggemma-2-UD-Q4_K_XL.gguf` | Q4_K_XL (Unsloth Dynamic) | 175,673,856 (약 168MiB) | `ea905fd08e8061db77a0031cbb5096d459d7cfd2bdd0ad2ba66e483f16719493` |
| `embeddinggemma-2-Q8_0.gguf` | Q8_0 | 309,855,520 (약 296MiB) | `6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc` |
| `embeddinggemma-2-BF16.gguf` | BF16 (기준) | 557,950,240 (약 532MiB) | `f315cbbb30dd487e44d501c8902abe88808755e43753a96beed1964f0a48aa4f` |
| `embeddinggemma-2-F16.gguf` | F16 | 557,950,240 | `0d4350867eddbb94af485501a3d07e9374c47779d88f8a39cd1abd6a8e2d0901` |

받은 파일의 SHA-256은 허브 API가 주는 값과 모두 일치했다. 같은 repo에 `UD-Q5_K_XL`(210,055,680)·`UD-Q6_K_XL`(248,812,032)도 있으나 측정하지 않았다. 모델은 `~/.cache/infinite-brain-b0/models/`에 있고 저장소에는 없다(`*.gguf` 무시 규칙 포함).

**라이선스.** 공식 카드는 라이선스를 "Apache 2.0"으로 쓰고 링크가 `ai.google.dev/gemma/docs/gemma_4_license`(제목 "Apache License 2.0")를 가리킨다. 그 페이지는 EmbeddingGemma 2를 따로 언급하지 않고, 별도 "Prohibited use"(금지된 사용) 정책 링크가 있다. 두 HF repo 모두 파일 목록에 `LICENSE`·`NOTICE` 파일이 없다. 래퍼 crate는 `MIT OR Apache-2.0`, llama.cpp는 MIT(`LICENSE` 첫 줄 "MIT License … The ggml authors"). **B1 전에 법무 확인 항목:** 금지 사용 정책이 앱 배포 조건에 영향을 주는지, 앱에 Apache 2.0 전문과 모델·llama.cpp 고지를 어디에 넣을지.

## 4. 측정 결과

각 설정은 별도 프로세스로 한 번씩 돌렸다(최대 RSS는 `/usr/bin/time -l`의 `maximum resident set size`). 표는 `scripts/matrix.sh` 결과다.

### 4.1 바이너리 크기 (release, 앱과 같은 프로파일: `opt-level=3`, `lto="thin"`, `codegen-units=1`, `strip=true` — `src-tauri/Cargo.toml:139-145`)

| 바이너리 | 크기(바이트) | 빈 `main`(333,376) 대비 증가 |
|---|---|---|
| 빈 `main` (`baseline`) | 333,376 | — |
| `bench`, CPU 전용(`GGML_METAL=OFF`) | 4,244,048 | +3,910,672 (약 3.7MiB) |
| `bench`, Metal 포함 | 9,736,080 | +9,402,704 (약 9.0MiB) |

증가분에는 `bench` 자체 코드(작음)가 섞여 있다. 모델 파일은 포함하지 않는다. 앱에 넣을 때는 `rusqlite`(bundled SQLite) 등과 합쳐 다시 재야 한다.

### 4.2 Metal (GPU 전 층, 스레드 4)

| 모델 | 로드(모델+컨텍스트) | 첫 임베딩 | 문단 1개 중앙값 (ko / en) | 100문단 순차 | 100문단 16개씩 묶음 | 최대 RSS |
|---|---|---|---|---|---|---|
| Q4_K_XL | 572 + 163ms | 1,234ms* | 14.6 / 15.1ms | 1.73초 (58/s, 4,423 tok/s) | 1.33초 (75/s) | 487MB |
| Q8_0 | 593 + 102ms | 223ms | 16.5 / 15.2ms | 1.74초 (58/s) | 0.89초 (112/s, 8,611 tok/s) | 668MB |
| BF16 | 676 + 209ms | 27ms | 18.7 / 18.6ms | 3.08초 (33/s) | 1.22초 (82/s) | 850MB |
| F16 | 691 + 180ms | 319ms | 17.5 / 17.6ms | 1.82초 (55/s) | 0.98초 (102/s) | 834MB |

\* 첫 Metal 실행에서만 프로세스 시작부터 첫 결과까지 11.4초(`first_load_to_ready_ms=11362`)가 걸렸다. 모델 로드는 0.57초였으므로 나머지 약 9~10초는 GPU 초기화(Metal 셰이더 컴파일로 추정되나 확인하지 않음)다. 그 직후 실행(Q8)은 같은 값이 0.98초였고, 나중에 같은 Q4 Metal을 load 약 14에서 다시 돌렸을 때도 1.09초(첫 임베딩 34ms, 문단 1개 15.6ms, 100문단 순차 1.64초·묶음 0.95초, RSS 479MB)로 11초가 재현되지 않았다. 첫 호출 때 한 번 있었던 지연이라 **부하 탓인지 최초 1회 비용(셰이더 컴파일 캐시 등)인지 구분하지 못했다.** 최초 1회 비용이면 첫 실행 안내 화면(F8.3a)에서 미리 데워 두는 단계가 필요하다.

### 4.3 CPU 전용 빌드 (스레드 4, 성능 코어 수)

| 모델 | 로드 | 첫 임베딩 | 문단 1개 중앙값 (ko / en) | 100문단 순차 | 묶음 16 | 최대 RSS | 시험 시 load average |
|---|---|---|---|---|---|---|---|
| Q4_K_XL | 650 + 52ms | 100ms | 104 / 78ms | 10.4초 (9.6/s, 735 tok/s) | 9.8초 (10.2/s) | 542MB | 약 14~22 |
| Q8_0 | 719 + 35ms | 173ms | 180 / 119ms | 17.3초 (5.8/s) | 15.1초 (6.6/s) | 707MB | 약 14~22 |
| F16 | 822 + 38ms | 106ms | 145 / 132ms | 19.9초 (5.0/s) | 11.6초 (8.6/s) | 790MB | 약 14~22 |
| BF16 | 735 + 35ms | 2,223ms | 2,425 / 1,730ms | 235초 (0.4/s) | 240초 (0.4/s) | 783MB | 약 14~22 |

- **BF16은 CPU에서 쓸 수 없다**(문단 1개 2초 이상). 품질 기준(레퍼런스)으로만 썼다.
- **부하에 취약하다.** 같은 Q4 4스레드를 load average 약 14에서 시작해 다시 돌리면 순차 100문단이 10.4초 → 19.1초(5.2/s)로 느려졌고, 이어 돌린 6스레드는 load가 89까지 오른 상태에서 187초(0.5/s)였다. 10스레드(모든 코어)는 load 약 40 구간에서 168초(첫 임베딩 4.1초, 문단 1개 p95 13초)였다. 효율 코어를 포함해 코어 수만큼 스레드를 쓰면 느려진다. 성능 코어 수 이하로 제한하고 낮은 우선순위로 돌려야 한다(앱 편집 지연 방지, §11 측정 정의와도 연결).
- 표의 Q4 CPU 한 줄(9.6/s)은 load 약 14에서 한 번 더 재현됐다(9.8/s, 문단 1개 중앙값 133ms ko). 이 기기의 **가장 좋은 관측값**으로 본다. 사용자 기기가 바쁠 때의 하한은 5/s 안팎 또는 그 이하로 봐야 한다.

### 4.4 메모리 해석

최대 RSS는 mmap된 모델 파일 페이지를 포함한다. 메모리 풋프린트(`peak memory footprint`)는 Metal에서 383~394MB로 모델 크기와 거의 무관하고(모델이 통합 메모리에 올라가 RSS로는 잡히지만 프로세스 고유 사용량은 작음), CPU에서는 Q4 542MB, Q8 593MB다. 앱의 메모리 예산은 보수적으로 **Q4 약 0.5GB, Q8 약 0.7GB**(컨텍스트 4096 기준)로 잡고, 앱 자체 사용량과 합산해 B1에서 다시 잰다.

### 4.5 출력 차원과 Matryoshka

- 출력 차원 768, 모든 값 유한(NaN 없음). **llama.cpp의 출력은 정규화되어 있지 않다**(첫 문단 L2 노름 483.9). 공식 sentence-transformers에는 `2_Normalize` 단계가 있는데 llama.cpp 경로에는 없으므로 **앱이 직접 L2 정규화해야 한다.**
- 앞 128·256·512·768차원을 자른 뒤 다시 정규화하면 노름이 모두 1.0000이었다(`trunc*_norm_after`). 카드가 안내하는 MRL 차원은 128/256/512/768이다.
- 카드의 보고값(MTEB 다국어 v2): 768d 61.36, 512d 61.17, 256d 60.41, 128d 57.89. 이번 smoke에서는 256d와 768d의 검색 결과가 같았다(아래).

### 4.6 품질 smoke (한국어·영어)

모든 모델·빌드에서 결과가 사실상 같았다. 표는 Q4_K_XL 값이다(768d / 256d).

| 지표 | 768d | 256d |
|---|---|---|
| 문장 쌍 유사도, 같은 뜻 4쌍 평균(ko↔en) | 0.929 | 0.934 |
| 문장 쌍 유사도, 무관 4쌍 평균 | 0.720 | 0.721 |
| 차이(gap) | 0.209 | 0.213 |
| 한국어 문단 ↔ 같은 주제 영어 문단 평균 (12쌍) | 0.845 | 0.858 |
| 한국어 문단 ↔ 다른 주제 영어 문단 평균 (132쌍) | 0.590 | 0.611 |
| 짧은 검색어 24개 → 문단 24개, top-1 정답(같은 주제의 ko 또는 en) | 24/24 | 24/24 |

해석: 같은 뜻과 무관한 쌍이 분리되고 한·영 교차 검색이 된다. 다만 **무관한 쌍의 유사도도 0.72로 높다**(문장 유사도 prefix 사용). 임계값을 절대값으로 쓰지 말고 순위로만 써야 한다. 말뭉치가 작고(24문단) 주제가 뚜렷이 달라서 24/24는 변별력이 낮다. 양자화 간 품질 차이는 이 검색 smoke로는 구분되지 않아, 아래의 BF16 대비 벡터 코사인으로 비교했다.

**양자화 품질 (BF16 CPU 결과 대비 같은 입력 48개 벡터의 코사인)**

| 모델 | CPU 최소 / 평균 | Metal 최소 / 평균 |
|---|---|---|
| F16 | 0.99999 / 0.99999 | 0.99999 / 1.00000 |
| Q8_0 | 0.99971 / 0.99985 | 0.99985 / 0.99993 |
| Q4_K_XL | 0.97315 / 0.99343 | 0.97380 / 0.99383 |

Q8은 BF16과 거의 같다. Q4는 평균 0.993이지만 일부 벡터는 0.973까지 벗어났다. 검색 순위에 주는 영향은 실제 노트로 B1에서 재야 한다. Unsloth 카드가 "float16에서는 NaN이나 품질 저하가 난다"고 경고하지만, 이 llama.cpp(v0.7.0)에서는 CPU·Metal 모두 F16 GGUF가 정상(BF16과 코사인 0.99999)이었다. 그래도 F16은 크기 이점이 없어 쓰지 않는다.

## 5. 위험

1. **번들 llama.cpp가 모델보다 오래됐다.** 릴리스된 `llama-cpp-2`로는 이 모델이 로드되지 않는다. 우회는 사본 패치이고, llama.cpp는 거의 매일 갱신되며 C 구조체가 바뀌면 래퍼 빌드가 깨진다(이번에도 한 필드 때문에 깨졌다). 버전 핀과 업그레이드 절차가 필요하다.
2. **CPU 성능이 부하와 스레드 수에 매우 민감하다.** GPU가 없는 환경(또는 GPU 경로 실패)에서는 문단 5~10개/초 수준이고 기기가 바쁘면 더 떨어진다. 만 개 문단을 처음 색인하면 CPU로 약 17~33분 이상, Metal로 약 1.5~3분이다(위 처리량으로 계산한 추정). 작업 큐, backpressure, 스레드 상한, 낮은 우선순위가 필수다(F8.3).
3. **첫 실행 지연.** Metal 첫 실행에서 11초가 한 번 관측됐다(원인 미확정, §4.2).
4. **빌드 환경.** cmake와 C++ 툴체인이 있어야 한다. 이 기기에는 cmake가 없어 pip로 따로 받았다(앱 개발자·CI 요건). Metal 셰이더를 빌드 시 컴파일하는지, 런타임에 컴파일하는지(Xcode의 `metal` 도구가 빌드에 꼭 필요한지)는 확인하지 않았다.
5. **디스크 cold 로드 미측정.** `purge`에 sudo가 필요해 OS 페이지 캐시를 비우지 못했다. 로드 0.5~0.8초는 파일이 캐시에 있을 때의 값이다.
6. **라이선스·고지.** §3.2 끝에 적은 금지 사용 정책 확인과 고지문 배치. 두 HF repo에는 LICENSE 파일이 없다.
7. **입력 규칙.** 비대칭 prefix(검색어/문서)를 쓰는 모델이다. 색인 버전(F8.4)에 prefix 규칙을 포함해야 하고, 이번에는 prefix 유무 비교를 하지 않았다.
8. **긴 문단.** 이 모델은 비인과 어텐션이라 한 번에 넣는 토큰이 `n_ubatch` 이하여야 한다. 이번 말뭉치는 짧아(약 77토큰) 긴 문단·긴 노트 처리(chunker 상한)는 측정하지 못했다.

## 6. B1 권고

| 항목 | 권고 | 근거 |
|---|---|---|
| 채택 여부 | **채택(조건부).** 실행 가능성과 비용이 예산 안으로 보인다. LiteRT-LM 재검토(§12 Q2)는 지금 필요 없다 | §4 |
| 바인딩 | `llama-cpp-2`. 릴리스에 `gemma-embedding2`가 들어올 때까지는 `llama-cpp-rs` git rev를 핀하거나 포크해 서브모듈을 `4fbc76dec5` 이후로 올린다. 이 spike의 vendor 방식은 임시다 | §3.1 |
| 양자화 | 2종 manifest. **GPU(Metal) 있는 기기는 Q8_0**(속도는 Q4와 같고 BF16과 코사인 0.9998), **GPU 없는 기기는 Q4_K_XL**(CPU에서 Q8보다 약 1.7배 빠르고 크기 168MiB). 사용자는 고르지 않고 앱이 사양을 보고 고른다(§0.1). Windows·Linux GPU 경로가 확인되기 전에는 Q4_K_XL을 기본으로 둔다 | §4.2, §4.3, §4.6 |
| 차원 | **256 (Matryoshka 절단 후 재정규화)** 기본. 저장은 float32 기준 1KB/문단. 카드 기준 768d 대비 MTEB 약 1점 손실, 이번 smoke는 동일 | §4.5 |
| 정규화 | llama.cpp 출력은 정규화되지 않으므로 앱이 자른 뒤 L2 정규화하고 유한값을 검증한다(F8.4) | §4.5 |
| 스레드 | 성능 코어 수 이하, 낮은 우선순위, 편집 중에는 일시 중지. 전체 코어 사용 금지 | §4.3 |
| 색인 버전 | 모델 revision(`031f0d4…`), 파일 SHA-256, llama.cpp 태그, prefix 규칙, 차원, 양자화를 함께 기록 | F8.4 |
| 내려받기 | manifest에 위 URL(`resolve/<revision>/…`), 크기, SHA-256을 넣는다. 허브 장애에 대비한 미러를 검토한다 | F8.2 |
| 첫 실행 안내 | "약 170~300MB 내려받기"로 안내하고, 켜는 시점에 모델 로드와 GPU 초기화를 미리 한 번 돌려 둔다 | §4.2 |

### Windows·Linux에서 확인할 것

1. 정적 링크 빌드가 되는지(MSVC + 정적 CRT, Linux는 `libstdc++` 동적 의존 문제: `build.rs`가 Linux에서 기본 `dylib=stdc++`로 링크함). 바이너리 증가분.
2. CPU 최소 사양: AVX2 유무(`GGML_NATIVE`가 꺼져 있어 기본 빌드가 어떤 명령어 집합으로 나가는지), 문단 처리량, 최대 메모리. 구형 CPU의 지원 하한.
3. GPU: Vulkan feature 빌드와 동작(Intel/AMD/NVIDIA 드라이버 유무), 실패 시 CPU로 자동 복귀하는지, 첫 실행 지연.
4. 메모리가 작은 기기(8GB 이하)에서 §4.4의 예산이 맞는지.
5. 백신·SmartScreen 등 OS 보안 도구와의 상호작용(모델 파일 mmap).
6. Tauri 앱에 실제로 링크했을 때의 충돌(`rusqlite` bundled SQLite와의 심볼, C++ 런타임). 이 spike는 앱과 분리되어 있어 확인하지 않았다.

### 이번에 하지 않은 것

`src-tauri` 연동, Windows·Linux, 디스크 cold 로드(`sudo purge` 후 `scripts/run-bench.sh` 재실행으로 가능), 배터리·발열, 긴 문단, prefix 유무 비교, 실제 노트 말뭉치와 BM25 혼합 순위(F8.6), 편집 중 동시 부하, Q5/Q6 XL 양자화, 조용한 기기에서의 CPU 재측정.

## 7. 재현 방법

`app/apps/desktop/spikes/b0-llama/README.md` 참고. 요약: 모델을 `~/.cache/infinite-brain-b0/models/`에 받고(위 표의 revision), cmake를 PATH에 두고 `scripts/vendor-llama.sh` → `B0_NO_METAL=1 cargo build --release --target-dir target/cpu` 및 `cargo build --release --target-dir target/metal` → `scripts/matrix.sh`. 양자화 품질은 `bench --dump`로 쓴 파일을 `cmpdump`로 비교한다. 새 소스 파일에는 Apache-2.0 SPDX 헤더를 넣었다.
