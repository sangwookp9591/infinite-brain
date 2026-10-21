# Mojo engine optimization log

2026-10-20, Apple M5 / 24 GiB, macOS 27.0.1. **No application integration or version change.**
This is a measured experiment for a possible 0.2.3 engine, not a shipping decision.

Acceptance requires both a lower warm median for the 82-token paragraph and higher
100-paragraph throughput than the best freshly measured llama.cpp Q8 Metal batch,
with every one of the 20 shared-token fixture cosines at least 0.999. Benchmark
processes run sequentially; the shared Mac's other applications and thermals are
not controlled. Profile-only stage fences perturb scheduling and are not the gate.

| Date / attempt | Change and primary source | Minimum cosine (20 singles / mixed batch) | Single median ms | Packed 100 paragraphs/s | Disposition |
| --- | --- | --- | ---: | ---: | --- |
| 2026-10-20 / original spike | FP32 M5 GEMM and serial row kernels; [spike](MOJO-ENGINE-SPIKE.md) | 0.9999997888 / 0.9999995655 | 112.05 | 46.71 | Historical reference; fails performance gate |
| 2026-10-20 / SIMD | Parallel row RMSNorm, head normalization/RoPE, and one SIMD group per QK dot; [Modular warp reductions](https://puzzles.modular.com/puzzle_24/warp_sum.html), [Apple SIMD rules](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf) | 0.9999993534 / 0.9999992933 | 144.03 | 28.75 | Reject per-dot SIMD dispatch: too many groups; retain row normalization |
| 2026-10-20 / online attention | One SIMD group per query/head, register Q/output, exact online softmax, independent sequence bounds; [FlashAttention](https://arxiv.org/html/2205.14135v2), [FlashAttention-2](https://arxiv.org/html/2307.08691v1), [MLX SDPA](https://github.com/ml-explore/mlx/blob/main/mlx/backend/metal/kernels/steel/attn/kernels/steel_attention.h) | 0.9999992645 / 0.9999994499 | 117.88 | 58.88 | Keep: removes global scores and reduces attention launches from three to one |
| 2026-10-20 / FP16 + reuse | FP16 weights/operands, FP32 MMA accumulation and norms; capacity-based persistent device buffers; [MAX M5 GEMM](https://github.com/modular/modular/blob/main/max/kernels/src/linalg/matmul/gpu/apple/matmul_kernel.mojo), [MLX steel GEMM](https://github.com/ml-explore/mlx/blob/main/mlx/backend/metal/kernels/steel/gemm/kernels/steel_gemm_fused.h), [DeviceBuffer](https://max.modular.com/api/mojo/max/gpu/host/device_context/DeviceBuffer/) | 0.9999995057 / 0.9999996296 | 23.55 | 104.18 | Keep; combined experiment, individual contributions not isolated |
| 2026-10-20 / projection + epilogue fusion | One QKV GEMM, one gate/up GEMM, fused QKV norm/RoPE scatter, GeGLU/cast, PLE gate/cast, post-norm/residual/scale; [model architecture](https://huggingface.co/google/embeddinggemma-2/raw/c3f2237ce16fe33d1bb9dab8692c29c79865bdeb/embedding_gemma2_documentation.md), [MAX M5 GEMM](https://github.com/modular/modular/blob/main/max/kernels/src/linalg/matmul/gpu/apple/matmul_kernel.mojo) | 0.9999994873 / 0.9999995225 | 38.86 | 119.42 | Keep provisionally for batch gain; noisy latency is not a win |
| 2026-10-20 / graph replay probe | Compile and execute the documented [DeviceGraphBuilder recording-context pattern](https://max.modular.com/api/mojo/max/gpu/host/device_graph/DeviceGraphBuilder/) | Not applicable | Not applicable | Not applicable | Runtime rejects `createGraphBuilder() not supported on this device context`; no graph path added |
| 2026-10-20 / shared SRAM attention | One threadgroup per query/head; parallel QK reduction, scores/probabilities in shared SRAM, one softmax per key; [FlashAttention IO principle](https://arxiv.org/html/2205.14135v2), [Modular barriers/shared memory](https://docs.modular.com/mojo/manual/gpu/block-and-warp.md) | 0.9999995223 / 0.9999997029 | 24.33 | 63.01 | Reverted: batch throughput regresses from 119.42/s; online attention retained |
| 2026-10-20 / macOS 11 marked strict Q8 comparison | Selected FP16/fused/online engine, aligned/contiguous weight validation, grown-workspace regression; [Apple deployment metadata](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf) | 0.9997018495 / 0.9997004069 (Q8 oracle) | 26.59 | 119.75 | **NO-GO:** throughput passes, single latency loses to fresh Q8 19.36 ms; vectors would require an INDEX_VERSION bump if adopted |
| 2026-10-20 / final sequential A/B | Rebuilt source after capacity-error safety fix, compile/checks complete before Q8 then Mojo run; same final Q8 oracle for all 20 fixtures | 0.9997018495 / 0.9997004069 (Q8 oracle) | 23.57 | 92.55 | **NO-GO:** loses both gates to fresh Q8 17.34 ms and best batch 105.72/s at 8/decode; no integration |

The final complete Q8 run measured **17.339292 ms**, 54.8029 sequential paragraphs/s;
its best batch was **105.7218 paragraphs/s** at 8 sequences/decode. An earlier fresh
run measured 19.360292 ms and 89.6484/s at 16/decode; the final gate uses the newer
paired run, without selecting the more favorable baseline. Batch sizes
4/8/16/24/32/64/100 were all tested, retrieving and validating every output. Context
and microbatch capacity must be divisible by sequence count: the inherited harness
aborted at 24 when a 2048 capacity was not divisible by 24. Using at least 256 slots
per sequence fixes the real assertion; no retry or assertion suppression is used.
Cosine validation is outside the timed Rust batch region, matching the Python gate.

Baseline profile, 100 paragraphs: attention 1407.93 ms; FFN 483.79 ms;
QKV 141.13 ms; head normalization/RoPE 120.77 ms; PLE 126.88 ms;
attention output 149.27 ms; embedding/PLE setup 109.57 ms; allocate/copy 5.51 ms.
After online attention + FP16/reuse: attention 219.00 ms, FFN 332.08 ms,
QKV 120.29 ms, head normalization/RoPE 107.92 ms, PLE 120.73 ms,
attention output 114.80 ms, embedding/PLE setup 22.45 ms, allocate/copy 4.51 ms.
These are means of three profile calls with explicit stage completion fences,
including host launch overhead, not hardware-counter-only GPU timings.

The original normal path already had no per-layer host synchronization or tensor
readback: six metadata uploads and one final output download surround the forward
pass, with one completion fence. The experimental profile export alone inserts
per-stage fences. GEGLU's gate*up product was already one kernel; combining its
projections and output cast is the new saving. Normalization is fused with operand
casting and residual epilogues; a full row RMS reduction inside the MMA prologue,
and a PLE projection plus whole-row norm in one GEMM dispatch, remain unimplemented.

Evidence and exact commands are being collected under `/private/tmp/ib-mojo-opt/`.
The task's external `REPORT.md` will include the final adoption verdict, reproducible
commands, source-to-experiment ledger, OS metadata, limitations and remaining work.


Final decision: **do not integrate**. The final gate exits 1 with cosine=true,
latency=false and throughput=false. Throughput varied from 92.55/s to 119.75/s
across the selected implementation's runs; the single-paragraph medians remained
above the fresh Q8 measurements. There is no performance justification to change
the shipped engine. Smart-search runtime code, INDEX_VERSION, application manifests,
installer scripts and app version remain untouched. The Q8 cosine minimum below
0.9999 means a future adoption would need an INDEX_VERSION bump, despite passing
the requested 0.999 numerical acceptance gate.

Minimum OS audit: native output declared 27.0; explicit target/linker flags produce
11.0 for the optimized GPU dylib, matching the runtime dependency floor. A diagnostic
10.15 link emits newer-object/runtime warnings and is not a viable lower dependency
closure. No old-OS compatibility claim follows: only M5/macOS 27.0.1 was executed.
The GPU math implementation still requires M5. No Developer ID signing or app
integration was attempted after the failed performance gate.


Final profile (three profile-only fenced calls, 100 sequences): QKV 118.123 ms,
head norm/RoPE 93.521 ms, attention 236.337 ms, attention-output 109.809 ms,
FFN 295.484 ms, PLE 100.690 ms, embedding/PLE setup 32.001 ms,
allocate/upload 4.458 ms and final pool/readback 2.127 ms. All 20 Rust FFI calls
also pass after relocation and ad-hoc signing, minimum Q8 cosine 0.9997018495.
The five-file runtime closure is 3,208,944 bytes, all minos 11.0. This is neither
Developer ID proof nor evidence of execution on an older OS. Source-level kernel
counts for the benchmark shapes are 607 originally and 417 now; warm calls reuse
device data buffers, while active-sized sub-buffer views still create host handles.

Remaining work is matrix-tiled attention, a coordinated matmul RMS prologue / PLE
row-norm epilogue, and lower submission overhead where the Metal API actually
supports it. The pinned runtime rejects device graph construction. Long-window
oracle cases, allocation-failure injection and hardware-counter GPU traces were
not run; the short 20-case corpus and fenced stage timings do not establish those.
The experiment must remain outside the application's production backend.

## E0 사전 가설과 반복 측정 계획 (2026-10-20, 측정 전 등록)

다음 실험은 앞의 탐색 측정과 구별한다. 사용자 요청에 따라 논문 형태의
방법론을 적용하며 Swift 호스트는 만들지 않는다. 모든 새 GPU 시간 측정은
`/private/tmp/ib-gpu-bench.lock`의 mkdir/rmdir 잠금을 보유한 동안만 실행한다.

- H1: 64개 이상의 미완료 제출로 큐 압력이 커진다면, 3개 레이어(약 51개
  compute dispatch)마다 완료를 기다리는 변형은 무동기화 기준보다 단일 문단
  지연을 줄인다. 지연 개선의 95% bootstrap CI가 0을 포함하거나 처리량이
  떨어지면 이 가설의 채택 근거로 삼지 않는다. 1/2/3/4 레이어 간격을 별도
  요인으로 비교하고, 각 변형의 20개 cosine >=0.999를 유지한다.
- H2: 현재 직접 DeviceContext 경로가 command-buffer coalescing 설정을
  처리한다면 `MODULAR_METAL_MAX_OPS_PER_COMMAND_BUFFER=64`는 기본값에 비해
  실제 제출 수나 지연을 줄인다. 환경 변수 이름만으로 활성화를 추정하지
  않는다. 실제 제출 수와 반복 지연이 그대로면 이 경로에서는 반증된 것으로
  기록한다.
- H3: 추가 norm/잔차/다음 투사 입력 준비 결합이 효과적이면 계산 정밀도를
  바꾸지 않고 dispatch 수와 지연이 함께 줄어든다. 각 fusion은 단독 ablation으로
  비교하며 작은 커널 microbenchmark가 아닌 전체 순전파로 판단한다.

각 조건은 독립 프로세스 5회 이상 × warm call 30회로 재고, 같은 세션의
llama.cpp Q8과 A/B/A/B로 교차한다. 단일 지연은 median/IQR/95% bootstrap CI,
100문단 처리량은 mean±sd를 보고한다. 각 회차의 20개 cosine min/mean과
최종 pooled+projected normalized 768-vector의 max absolute difference를 남긴다.
초기 탐색 값에는 이 반복 기준을 소급 적용하거나 CI를 꾸며 넣지 않는다.
전원 상태·모델 hash·도구 버전·실행 명령·CSV와 재생성 스크립트를 함께 남긴다.


## Single-paragraph pipeline, stage by stage

M5/macOS 27, 같은 82개 토큰, 13회 예열, 계측기 준비 3초 뒤 30개 요청을
Points of Interest signpost로 구분했다. Xcode Metal System Trace 원본과
`--toc`/`--xpath` XML은 `/private/tmp/ib-mojo-opt/{mojo,llama}-steady*`에 있다.
정상 경로에 레이어 fence를 넣지 않았다. 이 탐색 추적은 공유 GPU 잠금 규칙이
도입되기 전에 끝났다. 이후 E0 성능 측정은 모두 잠금을 쓴다.

아래 시간은 요청당 30회 평균이다. Mojo는 417개 compute encoder 각각이
한 dispatch여서, 고정 순서와 실제 command-buffer ID를 연결하여 단계를
구분했다. 분할·선점된 GPU 구간은 ID별 합집합으로 계산한다. llama.cpp는
두 compute encoder 안에 여러 노드를 묶으므로 이 trace만으로 QKV/FFN/PLE
GPU 시간을 정확히 분리할 수 없다. 해당 칸을 0이나 추정값으로 채우지 않았다.
CPU 인코딩은 API 구간의 벽시계 시간이며 CPU가 실제 실행한 cycle 시간과 다르다.

| 단계 | Mojo GPU busy ms | Mojo CPU encode ms | Mojo dispatch / CB | llama.cpp GPU busy ms | llama.cpp CPU encode ms / CB |
| --- | ---: | ---: | --- | --- | --- |
| 토큰/host prep | 계측 밖: 토큰화 재사용 | 0.007217 (host) | 0 / 0 | 토큰화 재사용 | 2.499967 (host) / 0 |
| Uploads/metadata | 0.000000 | 0.221336 | 0 / 6 | 공유 입력 준비: 분리 불가 | host/compute에 포함 |
| Embedding + PLE setup | 0.242810 | 0.220089 | 4 / 4 | 두 compute encoder 안에서 분리 불가 | 분리 불가 |
| QKV | 0.891411 | 1.296154 | 24 / 24 | 두 compute encoder 안에서 분리 불가 | 분리 불가 |
| Norm/RoPE | 0.516745 | 1.352418 | 24 / 24 | 두 compute encoder 안에서 분리 불가 | 분리 불가 |
| Attention | 1.396910 | 1.379520 | 24 / 24 | 두 compute encoder 안에서 분리 불가 | 분리 불가 |
| Attention-out | 0.917819 | 2.703751 | 48 / 48 | 두 compute encoder 안에서 분리 불가 | 분리 불가 |
| FFN | 3.107363 | 4.017641 | 72 / 72 | 두 compute encoder 안에서 분리 불가 | 분리 불가 |
| PLE | 0.916593 | 5.385062 | 96 / 96 | 두 compute encoder 안에서 분리 불가 | 분리 불가 |
| Residual/norm | 1.027427 | 6.883384 | 121 / 121 | 두 compute encoder 안에서 분리 불가 | 분리 불가 |
| Pooling/output | 0.052083 | 0.215742 | 4 / 4 | 두 compute encoder 안에서 분리 불가 | 분리 불가 |
| Download/completion | 0.000000 | 0.087675 | 0 / 2 | 0.001865 | 0.069326 / 1 |
| 전체 | 9.068713 | 23.762773 | 417 / 425 | 13.254126 | 3.488063 / 3 |

llama.cpp의 두 compute encoder 합은 GPU busy 13.252261 ms, CPU encoding
3.418736 ms다. 공유 입력 준비와 embedding부터 pooling까지가 여기에 포함된다.
마지막 blit encoder는 readback/completion이다. Mojo는 6개 metadata blit와
마지막 2개 readback/completion blit가 추가되며, 이 trace에서는 GPU 실행
구간이 관측되지 않았다(이는 CPU 공유메모리 복사 비용 0을 뜻하지 않는다).

관측된 큰 차이는 다음 세 가지다. 서로 겹치는 시간이므로 합산하지 않는다.

1. 제출 구조: Mojo 425 CB/425 encoder, llama.cpp 3 CB/3 encoder.
   CPU encode 평균은 23.762773 대 3.488063 ms, 차이는 +20.274710 ms다.
   CB당 평균은 55.912 대 1162.688 µs이지만 llama.cpp는 한 CB에 많은 노드를
   담으므로 이 평균만으로 엔진 효율을 비교하면 안 된다.
2. 대상 큐의 GPU 작업 사이 빈 구간은 요청당 21.970470 대 1.073806 ms다.
   차이는 +20.896665 ms다. 이는 전역 GPU idle이 아니다. 다른 앱의 GPU 작업이
   이 구간에 들어올 수 있고, CPU가 다음 제출을 준비하는 시간도 포함한다.
3. GPU busy는 오히려 Mojo 9.068713 대 llama.cpp 13.254126 ms다.
   Mojo의 GPU 계산 시간은 이 추적에서 4.185413 ms 짧지만, 제출/대기 경로가
   그 이점을 덮는다. 추적 p50 33.787271 대 17.336104 ms는 계측 오버헤드를
   포함하므로 비계측 채택 게이트의 23.569208 대 17.339292 ms와 섞지 않는다.

Mojo 내 CPU 제출 부담 상위 3개 묶음은 residual/norm(121개, 6.883384 ms),
PLE(96개, 5.385062 ms), FFN(72개, 4.017641 ms)이다. 다음 fusion은 이 묶음의
제출 수를 직접 줄인다. 레이어별 원본 합계는 `trace-*-steady-summary.csv`로
재생성할 수 있다. 셰이더 PC sampling에서는 llama.cpp의 `mul_mm_q8_0`,
`mul_mm_bf16`, `flash_attn_ext_f16_dk256_dv256`,
`flash_attn_ext_tensor_f16_dk512_dv512`, `rms_norm*`, `rope_neox`, `geglu`,
`cpy*`, `mul_mv_f32`를 확인했다. 하지만 샘플링 간격/커버리지가 달라 이 값으로
누락된 개별 dispatch나 세부 단계 시간을 만들어내지 않는다.

대역폭 가설의 실제 입력은 FP16 행렬 273,416,192바이트, Q8 파일의 대응
행렬 151,150,592바이트(1.8089배)다. PLE 투사가 BF16으로 남아 있어 모든
행렬을 Q8로 가정한 145.3MB 근사와 다르다. 이는 텐서 payload 계산이며 실제
DRAM traffic counter가 아니다. GPU busy가 이미 Mojo 쪽에서 짧으므로 이
차이만으로 전체 지연 격차를 설명할 수 없다는 것이 현재 관측이다.
M=82는 MAX의 M=64 타일 두 개(128행)를 사용하므로 유효 행 비율은 64.0625%다.
이는 형상에 따른 계산 낭비의 분석값이며 실측 occupancy/roofline 효율은 아니다.
외부 M4/M5 Max 보고의 6–17µs 제출 비용을 이 M5의 실측값으로 옮기지 않는다.


### E0 분석 예측과 요인 수준 (공통 하네스 측정 전)

상위 방법론은 [ENGINE-LAB-METHODOLOGY.md](ENGINE-LAB-METHODOLOGY.md)다. 앞의
단일 요인 사전 계획은 탐색 계획으로 남기고, 최종 통계는 공통 하네스로
재생성한다. E0는 A=Mojo AIR, B=Mojo DeviceContext, C=FP16/FP32 누적,
D=연산별 command buffer를 커버한다. E는 1/16 및 Offline의 4/8/32/64/100이다.
추가 요인은 sync 간격(0/1/2/3/4 레이어), residual 입력 준비 fusion(0/1),
coalescing cap(unset/64)다. prepare+sync3도 함께 제공해 상호작용을 관측한다.
Rust/Zig 호스트나 Q8 커널 효과를 E0 단독 실험에서 추정하지 않는다.

- 기준의 실제 N_cb는 425, dispatch는 417이다. sync3은 마지막 레이어를
  제외한 7개 경계에 fence를 추가하므로 command buffer는 감소하지 않는다
  (현재 Metal 구현의 sync blit까지 세면 약 432). 대신 첫 구간 61개 이하,
  이후 구간 51개 compute 수준으로 묶어 큐 압력 가설을 검사한다.
- 추가 fusion은 residual+다음 입력 준비를 합친다. attention 출력에서 24개,
  FFN 출력에서 24개, 레이어 사이에서 23개를 줄이면 dispatch는 346,
  기본 제출 수 예측은 354다. prepare+sync3 예측은 약 361이다. 이 수는
  source-audited 예측이며 실제 runtime counter로 기록하지 않는다.
- FP16 행렬 payload는 273,416,192바이트다. 82토큰 투사 GEMM은 약
  22.3564 GFLOP, canonical QK/PV attention은 약 0.7712 GFLOP다.
  online softmax 재스케일·norm·RoPE는 별도다. source bytes/flops와 공통
  microbench의 BW/P_peak로 kernel별 roofline 상한을 계산한다. 아직 받은
  로컬 BW/P_peak 없이 사양표나 외부 이슈 수치를 끼워 넣지 않는다.
- 단순 합 T_encode + T_gpu + T_gap은 추적에서 54.801956 ms로,
  실제 33.424861 ms보다 크다. CPU 기록과 GPU 실행이 겹치기 때문이다.
  임계 경로의 겹치지 않는 항 또는 max(host submit, GPU work)와 residual
  gap/readback으로 해석한다. 공통 하네스의 eta=1 aggregate floor는 낙관적
  하한이며, 20% 이상 차이가 나면 이 trace로 모델 오차 원인을 설명한다.
- 추적 내 target-queue gap 비율은 약 65.7%다. 전부 없앨 수 있다고 가정한
  Amdahl 상한은 약 2.92배다. 다른 앱의 점유까지 제거하는 낙관적 가정이다.
  제출 71/425 감소만의 기여는 같은 가정에서 전체 시간 약 11%여서,
  fusion 단독보다 queue/recording 경로와 결합을 우선 검증한다.

공통 ABI는 하네스 mojo_adapter.c를 재사용하는 e0_adapter.c로 제공한다.
build_e0.py가 변형별 dylib와 factors.json을 만든다. 실제 커널·호스트는
계속 Mojo다. 실제 제출 카운터를 제공하는 API가 없어 선택적 stats export는
생략한다. trace 예측을 가짜 runtime 카운터로 반환하지 않는다.

추가 residual-prepare fusion의 잠금 내 quick correctness check는 통과했다:
20개 cosine min 0.9996991605, mean 0.9999279238, max abs diff 0.0029360810;
혼합 batch min 0.9996997925, 큰 batch 뒤 단일 결과 cosine 1.0.
단일 p50 24.725 ms와 100문단/s 98.765는 한 프로세스의 탐색 값이다.
30개 호출에 12.3–232.4 ms 변동이 있어 이를 확증 통계나 채택 근거로 쓰지 않는다.
최종 5×30·interleaved 통계는 공통 하네스 준비 후 생성한다.


방법론 정정 반영: MPS GEMM과 복사 microbench로 만든 aggregate는 모든 커널에
성립하는 엄밀한 하한이 아니라 조건부 경험적 envelope다. 기존 JSON의
floor/proxy라는 필드명은 당시 기록으로 보존하지만 물리적 하한으로 해석하지
않는다. Amdahl의 p는 제거 가능한 배타적 직렬 임계 경로여야 한다. target-queue
gap 전체를 제거한다는 2.92배 계산이나 native-commit proxy의 수치는 이 조건을
가정한 감도 분석으로, 관측된 제거 가능 비율/검증된 상한을 뜻하지 않는다.
