<!-- SPDX-License-Identifier: Apache-2.0 -->
# E1 — Rust host와 Mojo AIR의 제출 비용 연구

2026-10-20, Apple M5 / 24GB / macOS 27.0.1. **격리된 연구 프로토타입이며 앱에 통합하지 않았다.** [공통 방법론](ENGINE-LAB-METHODOLOGY.md)을 따른다. 독립 프로세스 5회 반복 연구를 완료했으며, 아래 기존 탐색·trace 수치와 구분한다.

## Abstract

Mojo GPU 커널을 AIR로 AOT 컴파일하고 Metal 라이브러리로 링크한 뒤, Rust `objc2-metal` host에서 EmbeddingGemma 2의 전체 forward pass를 하나의 command buffer와 serial compute encoder에 담는 프로토타입을 구현했다. 기존 `verify.py`의 20개 입력·혼합 배치·입력 거절·큰 배치 이후 작은 입력 검증을 통과했다. 공통 native 하네스의 독립 프로세스 5회×30회 연구에서 SingleStream p50은 Q8 15.875ms 대비 11.087ms로 30.2% 낮았고, 최고 Offline 처리량은 Q8 103.965±4.903문단/초 대비 128.436±6.836문단/초였다. 프로세스 중앙값의 95% bootstrap 구간은 겹치지 않아 사전 성능 조건을 충족했다. 17개 비교의 Holm 보정 p는 모두 0.134921이므로 다중 검정 유의성을 주장하지 않으며, 제품 채택·앱 통합 검증은 남았다.

## Introduction / Question

**H1, 첫 GPU 측정 전 등록:** 동일 Mojo FP16 커널을 Rust host에서 문단당 command buffer 하나로 제출하면, 20개 cosine ≥0.999를 유지하면서 같은 세션 llama.cpp Q8_0보다 SingleStream 지연이 낮고 Offline 처리량이 높다. 둘 중 한 속도 조건이라도 충족하지 못하면 결합 주장을 기각한다. 논문 수준 채택은 공통 방법론의 독립 프로세스 5회 및 신뢰구간 기준까지 요구한다.

출발 관측은 기존 Mojo의 문단당 425 command buffers 대 llama.cpp의 3개다. 언어 일반의 우열이 아니라 **커널 / host / 제출 전략 / 데이터 이동**의 조합을 검증한다. Rust host가 Mojo 코드를 CPU FFI로 호출하여 기존 런타임에 다시 제출하는 방식은 이 질문의 답이 아니므로, 실제 AIR를 Metal API로 직접 로드했다.

## Method

### 측정 전 예측과 작업량

`T = T_host + N_cb*t_submit + ΣT_kernel + T_gap + T_readback`에서 N_cb를 425→1로 줄인다. 기존 로그 23.57ms의 20~35%가 host 제출·틈이라고 가정했다. 제거 가능한 시간은 4.7~8.2ms, 제거 가능한 직렬 임계경로 비율이라는 가정 아래 Amdahl 민감도 상한은 1.25~1.54배이며 **사전 예측은 15.4~18.9ms**였다. 예측 구간과 가정은 첫 진단 실행 전에 이 보고서에 기록했다. 이 비율은 실측 원인 분해가 아니며 사후에 맞춰 고친 값도 아니다.

82토큰 GEMM은 146개, 정확한 합산 연산량은 **22,356,426,752 FLOP**, FP16 dense weight payload는 **273,416,192 bytes**다. 각 GEMM의 최소 bytes는 `2*M*K + 2*N*K + 4*M*N`, FLOP은 `2*M*N*K`이며 최소 bytes 합은 364,189,696이다. 캐시 재읽기·attention·row kernel은 별도다. embedding gather는 선택된 token 행만 읽으므로 vocabulary 전체를 매 문단 읽는다고 계산하지 않았다. [계산 CSV](../../app/apps/desktop/dev/engine-lab/rust-metal/results/analytic-gemm.csv), [재생성 코드](../../app/apps/desktop/dev/engine-lab/rust-metal/analyze_work.py).

첫 진단 이후 초기 예비 하네스가 얻은 보정치는 stream **109.18GB/s**, FP16 MPS GEMM 최대 **14.80TFLOP/s**, 이미 기록된 command buffer의 CPU commit **11.354µs**다. 이 값을 각 GEMM에 적용한 `Σmax(bytes/BW, FLOP/P)`는 **3.336ms**다. η=1이며 attention·row 연산·배리어·host·readback을 생략한 조건부 낙관적 참고치다. 유한 microbench에서 얻은 BW/compute envelope는 입증된 하한이 아니며 실제 지연 예측을 대신하지 않는다. commit 1회의 시간과 submit→complete roundtrip 759.208µs도 서로 다른 수치다. [원본 보정 CSV](../../app/apps/desktop/dev/engine-lab/rust-metal/results/full/microbench.csv), [조건부 근사 계산](../../app/apps/desktop/dev/engine-lab/rust-metal/results/rust-roofline-floor.json).

### 환경과 통제

| 항목 | 확인한 값 |
| --- | --- |
| 장치 / OS | Apple M5, 24GB, macOS 27.0.1, build 26A434 |
| Rust / Metal bindings | rustc 1.94.0; objc2 0.6.5; objc2-metal 0.3.2 |
| Mojo / Xcode | Mojo 1.2.0rc2 (`2016d0cd`); Xcode 27.0 / 27A266a |
| 전원 | AC 연결, 배터리 100% |
| 입력 | 기존 `mojo-engine/inputs.json`의 20개 영문·한글 fixture와 동일 token IDs; 첫 입력 82토큰 |
| BF16 GGUF SHA-256 | `f315cbbb30dd487e44d501c8902abe88808755e43753a96beed1964f0a48aa4f` |
| Q8_0 GGUF SHA-256 | `6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc` |
| llama.cpp binding | 앱과 같은 llama-cpp-rs `cb98c630d0fec934a8a379db4fd63cd3622f6984` |
| GPU 통제 | 모든 기준선·검증·보정·GPU 타이밍을 mkdir 방식 `/private/tmp/ib-gpu-bench.lock`으로 직렬화; 다른 worker의 lock을 지우지 않음 |
| 통제하지 못한 부하 | 다른 앱, WindowServer, 병렬 CPU 빌드, 전력·열·OS scheduling 변화 |

모델은 지정된 두 GGUF만 사용했다. Rust는 기존 BF16 변환 파일 `weights.bin`을 읽으며 tokenizer·reference vector·gate를 바꾸지 않았다. 모델 초기화·토큰화는 warm latency에서 제외한다. 진단 `verify.py`의 첫 timing 30회는 정확도 실행 뒤에 오며, 별도 10회 discarded warmup은 공통 native 하네스에서 수행한다. 진단 throughput은 기존 검증기의 100문단 warm batch 3회 중앙값이고, 공통 하네스의 독립 프로세스 평균±SD와 혼동하지 않는다.

### 실제 만든 것

`mojo build engine_gpu.mojo --target-accelerator apple-m5 --emit air`는 실제로 성공했다. 원래 19개 AIR 중 i64 offset 특수화 두 개를 제외한 **17개 사용 커널**을 `xcrun metallib`로 링크해 Rust에서 로드했다. 병렬 E0 작업으로 추가된 `residual_prepare` 두 특수화는 명시적으로 제외하여 E1의 기존 연산 그래프를 유지했다. [컴파일 입력과 AIR SHA-256](../../app/apps/desktop/dev/engine-lab/rust-metal/results/aot-manifest.json), [실제 CLI emit 도움말](../../app/apps/desktop/dev/engine-lab/rust-metal/results/mojo-build-help.txt).

전체 흐름은 gather → PLE projection/norm → 24개 attention/GeGLU/PLE 층 → final norm → sequence mean → 768-d projection → L2 normalization이다. local/full attention, GQA, split-half RoPE, residual norm/scale를 기존 구현대로 유지했다. 독립 문단마다 attention 범위·position·pooling을 분리한다. FP16 operands/weights와 FP32 accumulation을 사용하며 norm·attention·잔차·최종 출력은 FP32다. 공개 Modular 소스의 split-K 휴리스틱을 Rust에서 재현했다. 실제 counter는 기본 417 dispatch 외에 FFN down reduction 24회와 full-attention output reduction 4회가 추가된 **445 dispatch**다. 최초 421개 예측은 FFN down 24회를 빠뜨렸으며 trace 실행의 counter로 정정했다. 설치된 Mojo host의 실행 그래프와 동일한 routing이라고 단정하지 않는다.

Mojo AIR의 pointer 인자는 bare data buffer가 아니라 GPU address를 담은 8-byte wrapper를 받는다. row-major TileTensor는 `{gpu_ptr, rows, cols, row_stride}` 32 bytes다. 생성된 LLVM IR에서 이 ABI를 확인하고 Rust가 argument arena를 만든다. 간접 참조 data buffer는 `useResource`로 등록하고 dependent dispatch 사이에 buffer barrier를 둔다. CPU가 shared metadata를 채우며, forward 중 commit과 completion wait는 각각 한 번이다. argument/data buffer는 completion까지 유지한다.

가중치는 한 번 업로드하고 FP16 사본을 만든다. 입력 크기가 커지면 workspace를 확장하며 active length만 사용한다. 고정 tensor 413개의 차원·extent·contiguity와 token/sequence 범위를 검사한다. FFI는 기존 검증기 호환 `ib_mojo_gpu_*` 및 공통 `ib_engine_*`를 제공한다. 앱 manifest에는 dependency를 추가하지 않았다. [Rust 코드와 재현 안내](../../app/apps/desktop/dev/engine-lab/rust-metal/README.md). 최종 측정용 read-only snapshot은 `/private/tmp/ib-engine-e1/frozen-20261020-a`이며 dylib·metallib·kernel-name JSON·가중치 경로와 SHA-256을 [manifest](../../app/apps/desktop/dev/engine-lab/rust-metal/results/frozen-manifest.json)에 고정했다. 실행 시 `E1_OUT`도 이 snapshot을 가리킨다.

## Results

### 탐색 실행 — 최종 반복 연구 아님

| 실행 순서 | cosine 최소 / 평균 | 82토큰 median ms | 100문단 처리량 /s | 비고 |
| --- | --- | ---: | ---: | --- |
| llama.cpp Q8_0, 앞 기준선 | reference | 39.286 | 73.17 | 최고 batch 24; 이전 진단 lock, 첫 forward 실패 직전 |
| Rust + Mojo AIR FP16 | 0.999708434 / 0.999928371 | **12.481** | **105.69** | 30 singles; packed100 warm 3회 중앙값 |
| llama.cpp Q8_0, 뒤 기준선 | reference | 20.352 | 94.50 | 최고 batch 24; 성공한 Rust 검증 직후, 같은 lock 안에서 실행 |

혼합 20문단 cosine 최소 **0.999700407**, 최종 정규화 768-d vector 최대 절대 오차 **0.002856224**다. 100문단 각 결과의 single 일치와 확장 workspace 이후 single 재사용도 통과했다. 기존 `gate.py`는 앞 reference 파일을 기준으로 세 조건을 모두 통과했다. 다만 이 앞 측정 뒤 첫 forward가 실패했고, 수정·재빌드 후 새 lock에서 Rust 검증과 뒤 Q8 측정을 연속 실행했다. 따라서 성공 실행의 직접 paired 기준선은 뒤 Q8이며, 앞 측정은 같은 전체 세션의 이전 진단으로만 취급한다. 단, 앞뒤 Q8 latency 자체가 39.29→20.35ms로 변했으므로 이 단일 pair의 `adopt: true`를 논문 수준의 채택으로 해석하지 않는다.

[원본 Rust 검증 JSON](../../app/apps/desktop/dev/engine-lab/rust-metal/results/diagnostic/quick-verify-fixed.json), [앞 Q8](../../app/apps/desktop/dev/engine-lab/rust-metal/results/diagnostic/quick-q8.json), [뒤 Q8](../../app/apps/desktop/dev/engine-lab/rust-metal/results/diagnostic/quick-q8-after.json), [기존 게이트의 실제 출력](../../app/apps/desktop/dev/engine-lab/rust-metal/results/diagnostic/gate.json).

### 최종 공통 하네스 반복 연구 — 완료

2026-10-20 17:30~18:16 KST에 frozen closure로 A/B/A/B 순서를 실행했다. 엔진마다 독립 프로세스 5개에서 workload당 예열 10회 후 30회를 측정했다. 모든 프로세스가 정상 종료했고 10개 실행, 5,100개 원본 행, 단일/혼합 정확도 게이트, 일곱 Offline 수준, 아홉 Server 수준, 실행 전후 모델 해시와 여섯 외부 artifact 해시를 검증했다. 측정 시작 당시 source SHA와 종료 시 source SHA도 일치했다. [고정 config](../../app/apps/desktop/dev/engine-lab/evidence/e1-final-20261020-173052/config.json), [전체 실행 순서](../../app/apps/desktop/dev/engine-lab/evidence/e1-final-20261020-173052/order.json), [전체 표](../../app/apps/desktop/dev/engine-lab/evidence/e1-final-20261020-173052/tables.md), [기계 판독 통계](../../app/apps/desktop/dev/engine-lab/evidence/e1-final-20261020-173052/summary.json).

| 엔진 | 평균 ms | 호출 p50 / p90 ms | 호출 IQR ms | 프로세스 중앙값 ms | 프로세스 중앙값의 95% CI ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| llama.cpp Q8_0 Metal | 16.236 | 15.875 / 18.706 | 1.993 | 15.909 | 14.755–18.756 |
| Rust + Mojo AIR FP16 | 11.465 | 11.087 / 12.797 | 1.342 | 11.738 | 10.615–12.171 |

호출 quantile은 엔진별 150회 기술 통계다. CI는 독립 프로세스 중앙값 5개를 단위로 seed 20261020, 10,000회 percentile bootstrap을 수행한 값이므로 호출 p50과 CI의 추정량은 구분한다. p50 감소는 **30.2%**, 속도비는 **1.432배**다. 모든 프로세스의 Rust 단일/혼합 최소 cosine은 각각 **0.999708434 / 0.999700407**, 최대 절대 오차는 **0.002856224**였다.

| 프로세스 | Q8 median ms | Rust+AIR median ms |
| --- | ---: | ---: |
| 0 | 18.756479 | 11.816333 |
| 1 | 15.844313 | 10.614791 |
| 2 | 14.754687 | 10.753688 |
| 3 | 15.908542 | 12.171229 |
| 4 | 16.842896 | 11.737938 |

Offline 한 표본은 독립 문단 100개와 마지막 나머지 그룹을 포함한다. 아래 평균±SD는 프로세스별 처리량 평균 5개 사이의 통계다.

| 묶음 | Q8 문단/초 | Rust+AIR 문단/초 |
| --- | ---: | ---: |
| 1 | 56.301 ± 1.706 | 83.585 ± 5.341 |
| 4 | 95.078 ± 7.766 | 122.397 ± 7.728 |
| 8 | 103.965 ± 4.903 | 126.175 ± 7.509 |
| 16 | 101.040 ± 3.310 | 128.436 ± 6.836 |
| 32 | 97.997 ± 6.354 | 125.429 ± 7.663 |
| 64 | 89.547 ± 6.896 | 123.099 ± 7.911 |
| 100 | 82.513 ± 4.926 | 122.896 ± 9.629 |

기준선 최고는 batch8의 **103.965±4.903/s**, 후보 최고는 batch16의 **128.436±6.836/s**로 관측 평균이 **23.5%** 높다. 정확도 통과, SingleStream CI 비중첩, 기준선 최고 묶음보다 높은 Offline 평균이라는 사전 성능 조건은 충족했다. 각 묶음의 비교는 같은 batch 수준끼리 수행했으며 서로 다른 최적 batch 선택을 별도의 사전 검정으로 가장하지 않았다.

프로세스 중앙값 기반 Mann–Whitney U의 원 p는 SingleStream 및 일곱 Offline 비교에서 0.00793651, Cliff's δ는 −1.000이었다. 전체 17개 시나리오/수준 비교를 한 family로 Holm 보정하면 **p=0.134921**이다. 따라서 bootstrap 성능 조건 충족과 다중 검정 유의성 부재를 함께 보고한다. 작은 n=5의 p 해상도와 선택된 최고 묶음의 불확실성을 숨기지 않는다.

Server는 예정 포아송 도착부터 완료까지의 지연이다. 후보는 시험한 수준 중 최대 40QPS에서 p99 **41.513ms**를 관측했고, 기준선에는 p99≤50ms를 충족한 시험 수준이 없었다. 다만 후보의 5QPS p99는 53.421ms, 30QPS는 51.915ms로 실패했으므로 결과가 단조롭지 않다. QPS당 150요청의 **관측한 최대 통과 수준**이며 지속 가능한 서버 용량으로 해석하지 않는다. [SingleStream CDF](../../app/apps/desktop/dev/engine-lab/evidence/e1-final-20261020-173052/latency-cdf-singlestream.png), [Server CDF](../../app/apps/desktop/dev/engine-lab/evidence/e1-final-20261020-173052/latency-cdf-server.png).

이 연구의 실제 보정치는 stream **118.872GB/s**, FP16 MPS 최고 median **14.755TFLOP/s**, CPU commit **3.312µs**, depth1 tiny-kernel completion **415.062µs**다. 기존 예비 보정과 별개다. 공통 envelope는 후보의 미제공 kernel-level 예측을 `unknown`으로 남겼으며, 앞서 등록한 15.4–18.9ms 예측은 사후에 맞추지 않았다. 실제 p50 11.087ms는 이 구간 하단보다 28.0% 낮다. 별도 trace의 한 버퍼·445 dispatch·GPU Active와 설치 runtime의 routing 차이는 진단 근거이며, 겹치는 CPU/GPU 구간을 합쳐 제거된 host 시간의 인과적 수치로 만들지 않는다.

전 과정 ProcessInfo thermal state는 시작/종료 모두 0(nominal)이었고 AC 전원을 사용했다. 시스템 swap used는 첫 실행 전 13,839.56M에서 마지막 종료 후 12,152.88M(sysctl 표시 단위)였다. 이 값만으로 active thrashing을 입증할 수 없으며 공유 host 부하를 통제한 연구로 주장하지 않는다. 하드웨어 Serial/UUID/UDID는 원본 환경 기록에서 제외했다.

과거 worker의 [부분 raw 디렉터리](../../app/apps/desktop/dev/engine-lab/rust-metal/results/full/)는 예정된 전체 비교를 마치지 못했으므로 이 최종 연구와 합치지 않았다.

### Metal System Trace

**Metal System Trace에서 40개 문단에 대한 distinct command buffer ID 40개와 encoder ID 40개를 관측했다: 문단당 각각 1개다.** 별도 FP16 가중치 초기화 buffer는 제외했다. 10 warmup 후 3초 settle, 30회 측정하며 frozen closure를 사용했다. trace duration은 11.754157초, target exit status는 0이었다. dispatch **445개**는 native host counter의 실측이며 encoder 표가 개별 dispatch를 관측했다고 주장하지 않는다.

| 마지막 30회 traced calls | 중앙값 ms | 증거와 범위 |
| --- | ---: | --- |
| CPU compute encoder 기록 | 1.136 | Metal Application encoder interval |
| encoder 종료 → 첫 GPU Active | 0.639 | 같은 command buffer ID의 시간 차이 |
| GPU Active 합 | 9.262 | GPU interval; shader sampling 아님 |
| encoder 생성 → 마지막 GPU 종료 | 11.642 | 같은 호출의 연결된 관측 구간 |
| native wall latency | 14.205 | trace-e1의 별도 타이머 |

구간 중앙값끼리는 합산하지 않았다. GPU는 한 buffer의 기록 종료 뒤 시작하므로 위 encoder·대기·GPU 구간은 해당 buffer 안에서 직렬이지만, callback/wakeup·encoder 전 metadata·최종 readback까지 포함한 wall 전체 분해는 아직 아니다. 본 template의 Shader Timeline은 disabled이며 kernel별 shader time을 측정한 것으로 해석하지 않는다. [실제 encoder XML](../../app/apps/desktop/dev/engine-lab/rust-metal/results/trace/trace-encoders.xml), [호출별 구간 CSV](../../app/apps/desktop/dev/engine-lab/rust-metal/results/trace/counts.csv), [count와 구간 통계](../../app/apps/desktop/dev/engine-lab/rust-metal/results/trace/counts.json). 원본 Instruments bundle은 `/private/tmp/ib-engine-e1/rust-one.trace`에 유지한다.

## Ablations

요인 수준은 **A=Mojo AIR, B=Rust objc2-metal, C=FP16/FP32 accumulation, D=문단당 1 buffer, E=1~100개 문단**이다. E0의 새 fusion kernel은 사용하지 않았다. 이 연구 단독으로 B와 D의 독립 주효과·상호작용은 식별할 수 없다. 기존 Mojo host와의 시간 차이를 Rust 언어 자체의 효과로 주장하지 않는다. 특히 Rust의 split-K 선택으로 dispatch 445개가 되어 역사적 Mojo 417개와 실행 그래프도 완전히 같지 않다. 같은 커널의 operation-per-buffer Rust host, weight-only Q8 in-kernel dequant, MSL 구현은 이번 측정에 포함하지 않았다.

저장된 기존 Mojo FP16 출력과 새 Rust 출력의 CPU 비교는 20개 cosine 최소 0.999999846, 최대 절대 오차 0.000069503이었다. 수학적 호환성의 보조 증거이며 bitwise 동일성이나 같은 세션의 host ablation은 아니다. [비교 결과](../../app/apps/desktop/dev/engine-lab/rust-metal/results/historical-fp16-vector-comparison.json).

## Discussion

**증거:** Mojo AIR의 독립 host 로드가 이 toolchain에서 가능했고, Mojo runtime 없이 전체 모델의 수치 게이트가 통과했다. `otool -L`에서 Rust 라이브러리는 macOS 시스템 framework/library만 참조하며 Modular runtime dylib를 요구하지 않는다. 이 구현 조합의 탐색 지연은 기존 로그의 23.57ms에서 크게 낮아졌다.

**추론:** 12.48ms는 사전 구간 중간값 17.15ms보다 약 27% 낮다. 제거 가능한 직렬 비중의 20~35% 가정이 작았을 수 있고, shared-memory metadata/readback·split-K routing·동시 부하도 원인 후보다. trace에서는 여전히 GPU Active가 약 9.26ms로 큰 비중을 차지한다. 조건부 GEMM 근사 3.336ms와의 차이를 전부 제출 비용이라 부를 수 없다. 작은 GEMM shape의 효율, attention·row kernel, barrier/dispatch 비용도 들어간다. trace로 한 buffer와 직렬 구간은 확인했지만 kernel별 η 및 wall 전체 원인 분해는 남았다. 기존 Mojo의 동일 trace와 pair하지 않았으므로 제거된 host 시간의 인과적 수치로 11ms를 확정하지 않는다.

### Tauri 앱에 넣는 비용

| 항목 | 확인한 것 / 남은 비용 |
| --- | --- |
| 추가 실행 artifact | relocated Rust dylib 532,384 bytes + metallib 112,307 bytes, 합계 약 630KiB; kernel-name JSON 별도 |
| 런타임 의존 | Python/Mojo runtime을 dylib에 링크하지 않음; 연구 build 단계에는 Mojo nightly와 Metal toolchain 필요 |
| 모델·메모리 | 변환 FP32 파일 1,084,026,976 bytes; GPU FP32+FP16 가중치 사본만 약 1.626GB, workspace 별도; 현 상태는 저장/상주 비용이 큼 |
| 서명 실험 | 복사본 `@rpath` 수정, ad-hoc 서명, `codesign --verify --strict`, 빈 환경 dlopen/name lookup 통과 |
| 미검증 서명 | Developer ID, hardened runtime, notarization, 실제 Tauri bundle 로드, relocated GPU inference 미실행 |
| 호환성 | M5 명시적 guard; Mach-O minos 11.0은 M1–M4 실행 증거가 아님; Windows/Linux 경로 없음 |
| 유지보수 | nightly AIR ABI·mangled names·행렬곱 launch heuristic에 의존; compiler 변경 시 재생성·게이트 필요; upstream notices/라이선스 유지 |
| 앱 계약 | typed engine thread, 취소·shutdown·실패 fallback, pinned model/hash/cache, `INDEX_VERSION` 변경과 재색인 검증이 추가로 필요 |

[패키징 검증 기록](../../app/apps/desktop/dev/engine-lab/rust-metal/results/packaging.json), [출처·라이선스](../../app/apps/desktop/dev/engine-lab/rust-metal/NOTICE.md). Modular matrix kernels는 Apache-2.0 with LLVM Exceptions이며 ggml/MLX MSL 코드를 복사하지 않았다. 이 표는 release license audit 또는 앱 통합 완료 증거가 아니다.

### 실패와 수정

- accelerator 없이 `--emit air`는 host target에서 거절됐다. 오래된 문서 예시의 `metal:4` alias도 설치 버전에서는 거절됐으며 `--print-supported-accelerators`가 안내하는 `apple-m5`로 성공했다. 일반적인 “Mojo는 AIR export 불가”라는 결론은 틀리다.
- 첫 forward는 긴 심볼의 `Pointer` 일부가 `Pointe`로 축약된 것을 name parser가 처리하지 못해 실패했다. 실제 missing key panic 뒤 encoder 종료 누락에 따른 Metal assertion도 발생했다. name key 집합을 사전에 검증하고 encoder 종료를 RAII로 보장한 뒤 재검증을 통과했다. [실패 로그](../../app/apps/desktop/dev/engine-lab/rust-metal/results/diagnostic/quick-verify.log).
- 공유 소스에 병렬 E0 fusion 특수화가 추가되어 AIR 개수 고정 검사가 깨졌다. 필요한 원래 17개 kernel의 이름 집합·ABI를 명시적으로 고정하고 새 fusion을 제외했다. 사용한 AIR별 hash를 남겼다.
- 긴 공통 sweep은 GPU 공유 일정 변경으로 중단했다. 부분 실행을 5회 반복 성공으로 포장하지 않았다. Q8 in-kernel dequant는 구현·측정하지 않았다.

## Threats to validity

한 M5, 한 OS, warm 82토큰 중심이며 20 fixtures의 길이는 12~82토큰이다. 2048 한도, ±512 attention window의 실제 긴 입력, 큰 vocab의 모든 token, 장시간 연속 취소/복구를 검증한 것은 아니다. 다른 앱·CPU 빌드·열 상태를 완전히 통제하지 못했고 Q8 앞뒤 변동도 컸다. GPU lock은 다른 lab GPU 측정의 중복을 막지만 WindowServer나 외부 앱 부하를 차단하지 않는다.

진단은 Python ctypes loop이고 최종 요구는 native loop다. batch100 진단 중앙값을 process-level 처리량 평균으로 대체하지 않았다. 최종 768-d 오차는 검증했지만 layer별 중간 activation 오차, kernel별 GPU 시간·메모리 counter는 수집하지 않았다. 하네스 보정 MPS GEMM의 큰 정사각 shape를 얇은 82-row GEMM의 실효 성능으로 간주할 수 없다. 역사적 Mojo 수치·trace와 현 세션 paired 실험을 구분한다.

## Conclusion

**기술적 feasibility와 사전 성능 조건을 확인했다.** 독립 프로세스 5회 공통 연구에서 정확도 게이트를 통과했고, SingleStream p50은 30.2% 낮으며 95% bootstrap 구간은 비중첩, 최고 Offline 관측 평균은 23.5% 높았다. Holm 보정 유의성은 확보하지 못했고 Server 최대 통과 QPS는 비단조·소표본 관측이다. Metal System Trace의 문단당 1 command buffer는 별도 물리적 증거다. 독립 재측정과 제품 검토는 아직 남았다. 제품 채택에는 상주 메모리·패키징·M5 이외 경로·유지보수·앱 통합 검증과 담당자의 결정이 남았다. 앱·semantic index·배포·production에는 변경을 하지 않았다.

알고리즘과 방법론의 정의·논문·적용 범위는 [공통 해설](ENGINE-LAB-ALGORITHMS-AND-METHODS.md)에 정리했다.

## References

- [Mojo compilation targets / GPU sidecars / C ABI](https://mojolang.static.modular.com/docs/tools/compilation/): 공개 문서는 1.1.0이며 `--emit air` 지원의 직접 증거는 설치 1.2.0rc2 CLI 및 실제 생성 파일이다.
- [Modular Apple GPU compilation 설명](https://forum.modular.com/t/apple-silicon-gpu-support-in-mojo/2295): AIR→metallib→Metal command queue 구조. 과거 글의 지원 범위를 현재 제한으로 인용하지 않는다.
- [Modular Apple M5 matmul source](https://github.com/modular/modular/blob/main/max/kernels/src/linalg/matmul/gpu/apple/matmul_kernel.mojo): tile, Morton grid, split-K 구조와 라이선스. 설치 wheel과 public main을 동일 revision으로 단정하지 않는다.
- [objc2-metal bindings](https://docs.rs/objc2-metal/0.3.2/objc2_metal/), [Apple buffer barriers](https://developer.apple.com/documentation/metal/mtlcomputecommandencoder/memorybarrier(scope:)).
- [기존 최적화 기록](MOJO-ENGINE-OPTIMIZATION.md), [기존 지연 연구](MOJO-LATENCY-RESEARCH.md), [공통 방법론](ENGINE-LAB-METHODOLOGY.md).
