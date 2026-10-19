# B0-a llama.cpp 실험 독립 검증 (Opus)

2026-10-16 · 브랜치 `iron/spike-b0-llama` · 대상: `docs/reports/B0-LLAMA-SPIKE.md`(170e819), `app/apps/desktop/spikes/b0-llama/`(a150598) · 기준: PRD v2 §5.8 F8.1~F8.4, §9 B0, §11 색인·검색 성능

검증자는 이 실험에 참여하지 않았다. 확인 방법은 세 가지다. Hugging Face·GitHub·crates.io API와 공식 페이지를 조회했고, 남아 있는 원자료(`~/.cache/infinite-brain-b0/matrix.out`, `dumps/`)를 보고서 수치와 대조했고, 이미 빌드된 바이너리로 짧은 재실행을 한 번 했다. 모델은 다시 받지 않았고 장시간 벤치도 돌리지 않았다.

## 1. 판정: **수정 후 승인**

- 외부 사실(revision, 파일 크기, SHA-256, 태그, 커밋, crate 상태)은 거의 모두 맞다. 보고서의 측정 수치도 원자료와 일치한다.
- 다만 아래 문제가 있다.
  - 원자료와 맞지 않는 수치가 1건 있다(10스레드 "168초").
  - 원자료가 남아 있지 않은 재실행 수치가 여러 개다.
  - 사용 정책의 출처를 잘못 적었다.
  - B1 권고에 빠진 위험이 크다. 특히 Windows·Linux CPU 빌드가 AVX 없이 나가는 문제와 Vulkan 로더 의존이 빠졌다.
- **"조건부 채택"은 macOS(Apple silicon)에 한해서만 근거가 있다.** PRD §9의 B0 출시 조건은 "OS별 CPU·메모리·속도·앱 크기 측정"이므로 B0는 아직 끝나지 않았다. §12 Q2의 LiteRT-LM 재검토 여부도 지금 결론 낼 수 없다.

## 2. 확인된 주장

| 주장 | 확인 결과 | 출처 (조회 2026-10-16 KST) |
|---|---|---|
| `llama-cpp-2` 0.1.160 게시 2026-10-15, 직전 10-07·09-30·09-22, `MIT OR Apache-2.0`, 누적 1,618,691 / 최근 793,892 | 일치 | crates.io API `/api/v1/crates/llama-cpp-2` |
| main에서 같은 날 0.1.161 올림 | 일치(`d4c557f6c1` 10-15T21:30Z, 머지 `224a1a3412`). crates.io 최신은 아직 0.1.160 | GitHub API `utilityai/llama-cpp-rs/commits` |
| 별 657, 열린 이슈 51, 보관(archived) 아님 | 일치. 단 51은 GitHub `open_issues_count`라 PR을 포함한다. 저장소 루트에 `LICENSE-APACHE`·`LICENSE-MIT`가 있다 | GitHub API |
| 0.1.160 번들 llama.cpp = `d81235049…`(10-05) | 일치. 이 커밋은 **태그 `v0.6.0`**("bump version to 0.6.0")이다. crate의 `.cargo_vcs_info.json` sha1 `0dd5814c9b`에서도, 현재 main에서도 서브모듈이 같다 | GitHub API contents `llama-cpp-sys-2/llama.cpp` |
| 번들 llama.cpp가 `gemma-embedding2`를 모름 | 일치. registry 사본 `llama-arch.h:67`에는 `LLM_ARCH_GEMMA_EMBEDDING`만 있다. vendor 사본(v0.7.0) `llama-arch.cpp:64`에는 `"gemma-embedding2"`가 있다 | 로컬 소스 |
| 지원 커밋 `4fbc76dec5`(10-06, "model: support embeddinggemma2") | 일치(`4fbc76dec51d…`, 메시지 "(text+vision+audio) (#30054)"). v0.6.0보다 23커밋 뒤, v0.7.0은 그보다 217커밋 뒤 | GitHub API commits/compare |
| `v0.7.0` = `620d2225…`(10-15) | 일치. annotated tag 객체 `757cad02…`, 릴리스 게시 10-15T17:13Z. llama.cpp 라이선스 MIT | GitHub API |
| crate 0.1.160 대비 vendor 패치 범위 | 일치. `build.rs` 2곳(`B0_NO_METAL`), `timing.rs` 필드 2개만 다르다(`diff -r`) | 로컬 diff |
| `build.rs` 줄 번호(484-488, 808-816, 894, 1519-1521) | 모두 맞다 | 로컬 registry 소스 |
| Unsloth revision `031f0d4…`(10-07), 4개 파일 크기·SHA-256, Q5/Q6 XL 크기, `apache-2.0` | 모두 일치. 로컬 파일 `shasum -a 256`도 일치 | HF API `/api/models/unsloth/embeddinggemma-2-GGUF?blobs=true` |
| ggml-org revision `bfcd298…`, BF16·Q8_0만 있음 | 일치. `.src_sha`는 `PRIMARY=914f7f89…`(공식 revision)이다. 이 repo의 BF16·Q8 파일은 Unsloth 파일과 크기·해시가 다르다 | HF API |
| 공식 `google/embeddinggemma-2` revision `914f7f89…`(10-06), `apache-2.0` | 일치. 공식 sentence-transformers 구성은 Transformer → Pooling(mean, 768, `include_prompt: true`) → Normalize다 | HF API, `modules.json` |
| 모델 차원 512 → 출력 768, 텍스트 파라미터 약 271M, 문맥 8K, MRL 128/256/512/768, MTEB 다국어 61.36/61.17/60.41/57.89 | 일치(카드 표, `config.json` `hidden_size=512`, `embedding_dim=768`) | 공식 모델 카드 README |
| prefix 규칙 | 일치(`config_sentence_transformers.json`의 `query`·`document`·`STS`) | 공식 repo |
| 라이선스 링크 `gemma_4_license` = "Apache License 2.0" 전문 | 일치(페이지 제목 "Apache License 2.0 \| Gemma", 마지막 갱신 2026-04-01) | https://ai.google.dev/gemma/docs/gemma_4_license |
| 보고서 §4 수치 전부(로드, 첫 임베딩, 중앙값, 100문단, RSS, footprint, 노름, smoke) | `matrix.out`과 일치(10스레드 1건 제외, §3) | `~/.cache/infinite-brain-b0/matrix.out` |
| 양자화 코사인 표 | 일치. `cmpdump`로 다시 계산해 같은 값을 얻었다 | `dumps/*.txt` |
| 바이너리 크기 333,376 / 4,244,048 / 9,736,080 | 일치 | `target/{cpu,metal}/release/` |
| Metal 수치 재현 | 대체로 재현됐다. Q4 Metal을 load 13~17에서 1회 실행했다. 첫 준비 0.95초, 문단 1개 13.3/17.5ms, 100문단 순차 2.14초(46.6/s), 묶음 1.42초(70.3/s), RSS 489MB. smoke 값은 동일했다. 11초 첫 실행은 재현되지 않았다 | 이번 재실행 |

## 3. 틀린 사실과 정정

1. **10스레드 "168초"는 100문단 시간이 아니다.** `matrix.out`에서 168,499ms는 `total_wall_ms`(프로세스 전체 시간)다. 이 실행의 100문단 값은 순차 54.3초(1.8/s), 묶음 11.7초(8.6/s)다. 6스레드 "187초(0.5/s), load 89", Q4 재실행 "19.1초", "9.8/s 재현"은 남은 원자료에 없다. `matrix.out`의 6스레드 값은 16.2초(6.2/s)다. "6스레드는 20배"라는 서술은 지금은 검증할 수 없다.
2. **사용 정책은 라이선스 페이지의 링크가 아니라 모델 카드 본문에 있다.** Google 카드와 Unsloth 카드가 모두 "Deployments must adhere to the Gemma Prohibited Use Policy"라고 쓴다. 정책 페이지의 마지막 수정일은 2024-02-21이고, "Gemma 또는 Model Derivatives"의 사용을 금지 항목으로 제한한다. PRD F8.1의 "사용 정책 안내"를 단순한 링크가 아니라 **배포 조건 문구**로 다뤄야 한다.
3. **float16 경고의 출처는 Google 공식 카드다**("Run inference in bfloat16 or float32. Do not use float16"). Unsloth 카드는 이를 그대로 옮겼다. 이 경고는 **활성값 범위**에 관한 것이다. F16 **가중치** GGUF가 정상이었다는 결과가 이 경고를 반박하지는 않는다. 백엔드가 활성값을 F16으로 계산하는 경로가 생기면 다시 확인해야 한다.
4. **"핀 고정한 git 의존성"만으로는 해결되지 않는다.** `llama-cpp-rs` main(`224a1a3`, 0.1.161)의 서브모듈도 `d812350`(v0.6.0)이다. 이 모델을 돌리는 경로는 지금 포크(서브모듈 교체와 `timing.rs` 패치)뿐이다. 업스트림 서브모듈이 올라간 뒤에야 git rev 핀으로 바꿀 수 있다. 관련 이슈는 검색되지 않았다(`gh search issues` 결과 0건).
5. **"약 170~300MB" 안내는 Q8을 과소 표기한다.** Q8_0은 309,855,520바이트로, 10진 310MB이고 296MiB다. 보고서는 MiB와 MB를 섞어 쓴다. 사용자 안내는 10진 MB로 통일해 "약 180MB"(Q4), "약 310MB"(Q8)로 쓰는 편이 맞다(macOS Finder 기준).
6. **"실행 가능성과 비용이 예산 안"이라는 판단에는 기준이 없다.** PRD §11은 목표 수치를 "B0 기준선 측정 후에 정한다"고 한다. 예산이 정의되지 않았으니 이 문장은 "macOS M5에서 자릿수상 수용 가능"으로 낮춰야 한다.

## 4. 방법상 문제

1. **원자료와 기기 부하를 기록하지 않았다.** `run-bench.sh`는 load average와 열 상태를 남기지 않는다. 보고서의 "load 14~22"는 출력 근거가 없는 기억값이다. 재실행 결과는 어디에도 남지 않았다(§3-1). 원자료는 `~/.cache`에만 있고 저장소에는 없다.
2. **CPU 수치는 설정마다 1회씩이고, 통제되지 않은 부하(load 7~89) 아래에서 쟀다.** Q4가 Q8보다 1.7배 빠르다는 비교는 서로 다른 시각에 한 번씩 돈 결과의 비율이다. 방향(Q4가 빠름)은 그럴듯하지만 배율은 신뢰하기 어렵다. Metal 수치는 이번 재실행에서 ±20% 안으로 재현됐다.
3. **`trunc*_norm_after=1.0000`은 증거가 아니다.** 정규화하면 항상 1이 되는 항등식이다. 또 `cos()`가 내부에서 다시 정규화하므로, smoke의 256d 결과는 재정규화를 하든 안 하든 같다. `truncate_norm` 구현(앞 d개를 자른 뒤 L2로 나눔)은 맞다. 다만 노름이 0이면 NaN이 나는데 이를 막는 장치가 없다. F8.4의 유한값 검증과 함께 앱 코드에서 막아야 한다. 앱이 내적으로 순위를 낸다면, 저장된 정규화 벡터로 내적 순위를 시험해야 한다.
4. **공식 구현과 결과를 비교하지 않았다.** 기준으로 쓴 BF16도 llama.cpp 경로를 거친 결과다. 그래서 확인한 것은 양자화 간 일관성뿐이고, 변환이나 실행이 맞는지는 확인하지 않았다. BOS/EOS 처리(`tokenize(..., true, ...)`), mean pooling의 prompt 포함 여부, 512→768 투영이 sentence-transformers float32 출력과 같은지 직접 비교하지 않았다. B1 첫 단계에서 입력 50개 정도로 코사인 0.99 이상인지 확인하기를 권한다.
5. **평균 코사인이 Q4의 순위 영향을 가린다.** 같은 dump로 다시 계산해 보니, BF16과 top-3 순서가 같은 질의는 Q4가 24개 중 19개(768d)와 18개(256d)였고, Q8은 23개와 24개였다. 작고 쉬운 말뭉치에서도 Q4는 순위를 바꾼다. 이 값은 "GPU 없는 기기는 Q4" 권고의 품질 비용으로 보고서에 적어야 한다.
6. **말뭉치가 처리량 추정을 낙관적으로 만든다.** 12개 글을 `(#i)`만 붙여 반복했고, 평균 길이는 77토큰이다. 실제 chunk(256~512토큰)에서는 문단당 시간이 크게 늘어난다. "만 개 문단 17~33분"은 77토큰 문단 기준의 하한이다. 추정은 tok/s와 실제 길이 분포로 다시 내야 한다. top-1 24/24는 상한에 붙어 있어 768d와 256d를 구분하지 못한다. 정답이 같은 주제의 ko·en 둘 중 하나라 쉬운 과제이고, 글쓴이와 평가자가 같은 사람이다. smoke로서 "망가지지 않았다"는 뜻만 있다. §11 검색 품질 지표(정답 없음, 코드, 정확한 이름, hit@5, nDCG)는 아직 하나도 측정하지 않았다.
7. **메모리.** Metal의 `peak memory footprint`(약 384MB)는 BF16(532MiB 모델)에서도 모델 크기보다 작다. mmap된 모델 페이지가 footprint에 잡히지 않는다는 뜻이므로, 예산 기준은 RSS가 맞다. 보고서도 결론에서는 RSS를 썼다. 계산용 버퍼는 `n_ubatch=4096`에 비례하는데, 이 값을 바꿔 보지 않았다. 메모리 예산은 chunk 상한과 함께 정해야 한다.
8. **cold와 첫 실행.** ggml의 `GGML_METAL_EMBED_LIBRARY` 기본값은 `${GGML_METAL}`(ON)이다(`ggml/CMakeLists.txt:242`). 그래서 셰이더 소스를 바이너리에 넣고 런타임에 `newLibraryWithSource`로 컴파일한다(`ggml-metal-device.m:353`). 보고서 §5-4의 미확인 질문에 대한 답은 이렇다. 빌드에 Xcode `metal` 도구는 필요 없고, 첫 실행 때 셰이더를 컴파일하며, 결과는 OS 셰이더 캐시에 남는다. 11초가 재현되지 않은 것도 이 캐시로 설명된다. 재부팅 직후나 캐시를 비운 뒤의 첫 실행을 따로 재야 한다. 디스크 cold 로드도 측정하지 않았다(보고서도 인정).
9. **vendor 사본 없이는 재현할 수 없고, 깨끗한 checkout에서는 절차가 막힌다.** 커밋된 트리를 새 디렉터리에 풀고 `cargo metadata --offline`을 돌리면 `failed to load source for dependency llama-cpp-2`로 실패한다. `[patch]` 경로인 `vendor/`가 없기 때문이다. 반대로 `vendor-llama.sh`는 `~/.cargo/registry/src`에 crate가 이미 풀려 있다고 가정한다. 처음 쓰는 기기에서는 순서가 꼬이고, README에 이를 푸는 단계가 없다. 또 스크립트는 tarball을 SHA-256 검증 없이 받는다. 태그는 옮길 수 있으므로 커밋 SHA로 고정해야 한다. 릴리스된 crate만으로 재현할 길은 없다(§3-4).
10. **스레드와 우선순위가 충돌할 수 있다.** macOS에서 낮은 QoS(background)는 효율 코어에만 배치된다. "성능 코어 수만큼 스레드"와 "낮은 우선순위"를 동시에 권하면 실제 처리량이 표와 크게 다를 수 있다. B1에서 QoS 등급별로 재야 한다.

## 5. B1 권고 검토

| 권고 | 판단 | 근거와 보완 |
|---|---|---|
| 조건부 채택 | **macOS arm64 한정 타당** | Windows·Linux·Intel Mac(릴리스 매트릭스에 `x86_64-apple-darwin` 있음)을 측정하지 않았다. B0 출시 조건이 미충족이므로 "B0 완료"로 표기하면 안 된다 |
| 핀 고정 git 의존성 또는 포크 | **포크가 유일한 경로** | §3-4. 포크 서브모듈은 태그와 커밋 SHA로 고정하고, 래퍼 패치는 업스트림 PR로 돌려보낼 계획을 세운다 |
| Q8(GPU) / Q4_K_XL(CPU) 2종 manifest | **부분 동의** | Q8 근거는 충분하다(코사인 0.9998, Metal 속도 같거나 빠름). Q4는 순위 비용(§4-5)과 공급망 문제가 있다. `UD-Q4_K_XL`은 Unsloth 고유 레시피라 우리가 다시 만들 수 없다. ggml-org BF16으로 직접 `Q4_K_M`을 만들어 자체 manifest로 고정하는 안을 비교해야 한다(F8.1 "변환·양자화 결과물 고정"). 2종으로 가면 QA 매트릭스가 두 배가 되고, 같은 팀에서 Mac과 Windows 사용자의 결과가 달라진다 |
| 256 차원 | **재검토 권장** | 카드 기준 다국어 −0.95점이지만, 코드 MTEB는 −2.5점(78.68→76.18)이다. PRD §11에 코드 질의가 있다. 저장 절약도 작다. 1만 chunk 기준 float32로 768d는 30MB, 256d는 10MB다. **768d를 저장하고 검색 차원은 설정으로 두면** 나중에 차원을 바꿀 때 다시 임베딩하지 않아도 된다(MRL은 저장 후 절단 가능) |
| 앱이 L2 정규화 | 동의 | 노름 0에서 NaN이 나지 않게 막고 유한값을 검사하는 장치를 추가한다(§4-3) |
| 스레드 상한, 낮은 우선순위 | 동의, 단 측정 필요 | §4-10 |
| 색인 버전 묶음 | 동의, 항목 보강 | BOS/EOS 등 토큰화 규칙, llama.cpp **커밋 SHA**(태그만으로는 부족), chunk 상한과 `n_ubatch`를 넣는다 |
| 첫 실행 미리 데우기 | 동의 | 셰이더 런타임 컴파일 근거(§4-8) |

## 6. 누락된 위험

1. **x86 CPU 빌드가 AVX 없이 나간다(높음).** `llama-cpp-sys-2`는 `GGML_NATIVE=OFF`이고 `CARGO_CFG_TARGET_FEATURE`로만 SIMD를 켠다(`build.rs:832-850`). `x86_64-pc-windows-msvc`의 기본 feature는 `sse`~`sse3`, `x86_64-apple-darwin`은 `sse4.1`까지다(`rustc --print cfg`). 그래서 Windows·Linux·Intel Mac 빌드에는 AVX2·FMA·F16C가 없고, CPU 처리량이 M5 수치보다 훨씬 낮을 수 있다. 앱 전체에 `+avx2`를 주면 구형 CPU에서 앱이 시작하자마자 `SIGILL`로 죽는다. 대안은 세 가지다: `GGML_CPU_ALL_VARIANTS`와 `GGML_BACKEND_DL`(DLL 동적 로딩이라 "정적 단일 바이너리"와 충돌), AVX2 sidecar와 기본 sidecar 두 개, 런타임 감지 후 비활성화. B1 전에 결정해야 한다.
2. **Vulkan을 켜면 앱 전체가 Vulkan 로더에 의존한다(높음).** `build.rs:1043`(Windows)는 `vulkan-1`을, `build.rs:1066`(Linux)은 `vulkan`을 링크한다. 정적으로 넣으면 로더가 없는 기기(VM, 원격 데스크톱, 일부 Windows on ARM)에서는 의미 검색만 꺼지는 것이 아니라 앱 자체가 시작하지 못할 수 있다. 빌드에는 `VULKAN_SDK`와 `glslc`도 필요하다.
3. **Windows CRT가 일치해야 한다.** `LLAMA_STATIC_CRT`·`config.static_crt`(`build.rs:501,917`)를 Tauri 앱의 CRT 설정과 맞추지 않으면 링크 오류(LNK2038)가 나거나 런타임이 섞인다.
4. **빌드 시간과 CI.** 릴리스 매트릭스는 4개(arm64·x86_64 macOS, ubuntu-22.04, windows)이고 한 번에 약 35~45분 걸린다(`release.yml` 주석). 여기에 대상마다 llama.cpp cmake 빌드와 bindgen(`libclang` 필요)이 더해진다. 러너에 cmake, libclang, (Vulkan을 쓰면) Vulkan SDK를 설치해야 하고 캐시도 커진다(이 spike의 `target/`만 513MB). 빌드 시간은 측정하지 않았다.
5. **코드 서명.** 정적 링크라 macOS에서 추가로 서명할 dylib는 없다(`otool -L` 확인). 반면 `GGML_BACKEND_DL`을 쓰면 DLL·dylib마다 서명과 공증이 필요하다. Windows는 지금 OS 서명이 없어(`release.yml` 주석) 네이티브 코드와 대용량 다운로드가 늘면 SmartScreen·백신 오탐 위험이 커진다.
6. **같은 프로세스 안에서 실행할 때의 안정성.** ggml은 `GGML_ASSERT`/`GGML_ABORT`에서 프로세스를 끝낸다. 긴 입력, 메모리 부족, 드라이버 오류가 나면 편집 중인 앱이 통째로 종료된다. 디스크 쓰기는 원자적이지만 저장 전 편집 상태를 잃을 수 있다. sidecar 프로세스로 분리하면 장애와 메모리를 격리하고 우선순위도 따로 줄 수 있다. B1 설계에서 비교해야 한다.
7. **GGUF 파서가 공격면이 된다.** F8.2의 폐쇄망 수동 설치는 서명 manifest를 거치지 않으므로 임의의 GGUF를 로드하게 된다. 수동 설치에도 SHA-256 허용 목록 검증을 의무화해야 한다.
8. **공급망.** `vendor-llama.sh`가 tarball을 검증 없이 받는다(§4-9). 모델 Q4 파일을 제3자(Unsloth)에 의존한다.
9. **라이선스 고지.**
   - llama.cpp/ggml(MIT)의 저작권 고지를 앱의 서드파티 고지에 넣어야 한다.
   - 모델은 Apache-2.0인데, 두 HF repo 모두 `LICENSE`·`NOTICE` 파일이 없다. 그래서 고지문을 우리가 직접 마련해야 한다.
   - 보고서가 권한 **자체 미러는 재배포**에 해당한다. 그러면 Apache-2.0 §4의 사본 동봉 의무가 생긴다.
10. **법무 확인 항목.**
    - Apache-2.0 모델에 카드가 붙인 "Prohibited Use Policy 준수" 요구가 법적 구속력을 갖는지, 앱 약관에서 사용자에게 이 의무를 넘겨야 하는지.
    - 자체 미러가 재배포 의무를 만드는지.
    - UI에서 "Gemma" 상표를 표기하는 방식.
    - 우리가 직접 양자화한 파생물을 배포할 때의 고지.
11. **§11에서 측정하지 않은 항목.** 최소 사양 기기(M5 24GB는 고사양), 배터리·발열, 편집 지연, CPU 사용률(처리량만 쟀음), 색인 디스크 크기, cold 상태.

## 7. 저장소 위생

- 모델(`*.gguf`), `vendor/`(180MB), `target/`(513MB)는 `app/apps/desktop/spikes/b0-llama/.gitignore`로 막혀 있고 추적되지 않는다(`git ls-files`, `git check-ignore` 확인). `matrix.out`과 dump도 저장소 밖에 있다.
- 커밋된 소스(`Cargo.toml`, `README.md`, `scripts/*.sh`, `src/**/*.rs`)는 모두 Apache-2.0 SPDX 헤더가 있다. `.gitignore`와 `Cargo.lock`은 소스가 아니어서 헤더가 없어도 된다.
- `src-tauri`와 앱 의존성은 바뀌지 않았다. crate는 `[workspace]`로 독립해 있다.
- 권장: 측정 원자료(`matrix.out`과 재실행 로그, 각 실행의 load average 포함)를 작은 텍스트로 `docs/reports/` 아래에 남긴다.

## 8. 보고서 작성자가 고칠 것

1. §4.3에서 10스레드 수치를 정정한다(순차 54.3초·1.8/s, 묶음 11.7초). 원자료가 없는 재실행 수치(187초, 19.1초, 9.8/s)는 근거를 첨부하거나 "기록 없음"으로 표시한다.
2. §3.2의 라이선스 문단: 금지 사용 정책이 모델 카드 본문의 배포 조건이라고 고친다. float16 경고의 출처는 Google 카드로, 경고 대상은 활성값으로 고친다.
3. §1·§6의 "예산 안", "LiteRT-LM 재검토 불필요"를 macOS 한정으로 낮추고, B0 미완 상태를 명시한다.
4. §6의 바인딩 권고: 지금은 포크만 가능하다고 쓴다.
5. §6의 첫 실행 용량 문구: 10진 MB로 "약 180MB / 310MB"로 고친다.
6. §4.6에 Q4의 top-3 순위 불일치(18~19/24)를 추가한다.
7. §5에 위 §6의 1~7번 위험을 추가한다. §5-4(Metal 셰이더)는 §4-8의 근거로 닫는다.
8. README에 깨끗한 checkout에서 쓸 수 있는 절차를 적는다(registry crate를 먼저 받는 방법). `vendor-llama.sh`는 커밋 SHA와 tarball 해시로 고정한다.

## 출처 (모두 2026-10-16 KST 조회)

- crates.io API: https://crates.io/api/v1/crates/llama-cpp-2 , `llama_cpp`, `llama-cpp-rs`, `candle-core`
- GitHub API: `repos/utilityai/llama-cpp-rs`(repo, commits, contents `llama-cpp-sys-2/llama.cpp` @ main·`0dd5814c`), `repos/ggml-org/llama.cpp`(tags, `git/ref/tags/v0.7.0`, commits `4fbc76dec5`·`d8123504`, compare, releases/latest)
- Hugging Face API: https://huggingface.co/api/models/unsloth/embeddinggemma-2-GGUF?blobs=true , `ggml-org/embeddinggemma-2-GGUF`, `google/embeddinggemma-2`
- 공식 모델 카드: https://huggingface.co/google/embeddinggemma-2/blob/914f7f89142e33e77833254d9c9b90c3cef7303b/README.md (License 줄, MRL 표, "Do not use float16", "Deployments must adhere…")
- Unsloth 카드: https://huggingface.co/unsloth/embeddinggemma-2-GGUF/blob/031f0d4b35536f69ab3509d4893c923264fcf253/README.md
- 라이선스: https://ai.google.dev/gemma/docs/gemma_4_license (Apache License 2.0, 마지막 갱신 2026-04-01)
- 사용 정책: https://ai.google.dev/gemma/prohibited_use_policy (Last modified 2024-02-21)
- 로컬: `~/.cargo/registry/src/*/llama-cpp-sys-2-0.1.160/build.rs`, vendor 사본 `ggml/CMakeLists.txt:242`, `ggml-metal-device.m:353`, `.github/workflows/release.yml`
