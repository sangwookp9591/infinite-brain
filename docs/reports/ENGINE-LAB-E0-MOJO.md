# E0: Mojo 커널의 제출 비용과 fusion 실험

2026-10-20. **구현 인계 완료 / 전체 실험은 진행 중**.
코디네이터 지시로 최종 strict 8-cell 연구의 측정·분석 소유권을 별도 후속
작업으로 이전했다. 이번 전달은 최종 실험 완료나 채택 판정이 아니다. 공통 하네스의 최종 5×30 반복과 비교 통계는 아직
실행하지 않았다. 앱 코드·버전·INDEX_VERSION·설치기·배포는 변경하지 않는다.
측정 방법은 [ENGINE-LAB-METHODOLOGY.md](ENGINE-LAB-METHODOLOGY.md)를 따른다.

## Abstract

EmbeddingGemma 2의 FP16 Mojo 엔진은 초기 FP32 spike보다 빨라졌지만, 초기
비계측 비교에서는 llama.cpp Q8보다 느렸다. 82토큰을 대상으로 한 Metal
System Trace에서 Mojo는 425개 command buffer, llama.cpp는 3개를 제출했다.
동일 추적의 요청당 GPU busy 평균은 9.069 대 13.254 ms였지만, 대상 큐의
작업 사이 빈 시간은 21.970 대 1.074 ms였다. 본 실험은 계산 자체보다 제출
경로가 단일 요청을 제한한다는 가설을 검증한다. 추가 fusion, 주기적 완료
대기, 런타임 coalescing 설정을 공통 ABI로 제공했다. 최종 채택 판단은 보류한다.

## Introduction / Question

질문은 두 가지다. 첫째, Mojo DeviceContext를 유지하면서 제출 수 또는 큐
압력을 줄여 단일 문단 지연을 낮출 수 있는가? 둘째, 그 변경이 100문단 Offline
처리량과 수치 정확도를 함께 보존하는가? 구현 언어 자체의 우열을 추정하지
않고 커널·호스트·정밀도·제출·batch 요인을 구분한다.

## Method

### 장비와 입력

Apple M5, 24 GiB, macOS 27.0.1(26A434), Xcode 27.0(27A266a),
Mojo 1.2.0rc2(2016d0cd), MAX/Modular 26.7.0rc2다. 현재 AC 전원, 배터리
100% 충전 상태를 확인했다. 다른 앱과 다른 작업자의 CPU 빌드는 통제하지
못한다. 모든 새 GPU/ANE 시간 측정은 `/private/tmp/ib-gpu-bench.lock` 안에서만
실행한다. GPU 잠금 규칙 이전에 끝난 추적과 초기 탐색은 별도로 표시한다.

공통 20개 문서/검색어 입력과 llama.cpp의 동일 token ID를 사용한다. 단일
측정은 BOS 포함 82토큰이다. 실제 파일을 다시 해시했다. Q8 GGUF는 309,855,520바이트,
SHA-256 `6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc`다.
변환 FP32 가중치는 1,084,026,976바이트,
SHA-256 `edbf9720b35ccbe13dbea1e74da31d7057ea497e9b3b98ed1944462517009f34`다.
공통 하네스도 실행별 환경 기록에 해시를 남긴다. 현재 smoke 확인의 대상은 아래 불변 artifact다.

- Core: `/private/tmp/ib-mojo-opt/immutable/e0-e8a1f7aebf2bab0c/libe0_core.dylib`
- SHA-256: `e8a1f7aebf2bab0c02d51173fc6a772ccb3b024e73856faac8b0bf00e368b93d`
- 모델: `/private/tmp/ib-mojo-spike/weights.bin`
- 변형·모델 대응·core 경로: 같은 디렉터리의 `manifest.json`

### 가설과 사전 예측

H1: 직접 제출 경로가 큐 깊이의 영향을 받으면 3개 레이어마다 완료를 기다려
지연을 줄일 수 있다. 마지막 레이어를 제외한 7개 fence는 제출 수를 줄이지
않는다. 기본 425 CB 대신 약 432 CB를 예측한다. 첫 구간은 metadata/setup을
포함해 약 61개, 이후에는 51개 compute dispatch로 나뉜다. 지연과 처리량의
반복 통계가 개선되지 않으면 이 장치에서의 채택 근거로 삼지 않는다.

H2: `MODULAR_METAL_MAX_OPS_PER_COMMAND_BUFFER=64`가 이 버전의 직접
DeviceContext 경로에 작동한다면 CB 수 또는 지연이 줄어든다. 환경 변수
이름을 읽었다는 이유로 활성화를 추정하지 않고 실제 trace와 반복 결과로
확인한다. 공식 API의 DeviceGraph는 현재 Metal context에서 실제로 거부됐다.

H3: residual, 다음 RMSNorm 또는 단순 cast를 합치면 동일 FP16/FP32 계산
경계에서 dispatch를 417→346으로 줄일 수 있다. 예측 CB는 354이며,
prepare+sync3은 약 361이다. fusion×sync 조합으로 상호작용도 관측한다.

공통 하네스 smoke의 완결된 microbench CSV 7,800행에서 가져온 사전
calibration은 복사 BW 111.796 GB/s, MPS FP16 GEMM 최대 median
7.29679 TFLOP/s, native Metal commit 6.4795 µs, depth-1 tiny-kernel 완료
147.9165 µs다. vendor peak나 외부 M4 수치를 사용하지 않았다. 이 calibration은
Mojo API 비용 자체를 측정한 것이 아니므로 commit 비용은 proxy다.

| 조건 | N_cb 예측 | dispatch 예측 | eta=1 조건부 compute envelope ms | native commit proxy ms | 조건부 합 envelope ms | 직렬 proxy 가정의 Amdahl 감도 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 425 | 417 | 3.170 | 2.754 | 5.923 | 1.869× |
| sync3 | 432 | 417 | 3.170 | 2.799 | 5.969 | 1.883× |
| prepare | 354 | 346 | 3.170 | 2.294 | 5.463 | 1.724× |
| prepare+sync3 | 361 | 346 | 3.170 | 2.339 | 5.509 | 1.738× |

원본: `/private/tmp/ib-mojo-opt/e0-prediction-before-shared.json`.
표의 Amdahl proxy는 native commit을 제거 가능한 직렬 임계 경로라고
가정한 감도 분석이다. 겹치는 CPU encoding에서 관측 p를 얻었다는 뜻이 아니다.
행렬 payload는 FP16 273,416,192바이트, Q8 파일의 대응 행렬은
151,150,592바이트다(PLE 투사가 BF16으로 남아 있다). 투사 GEMM은 약
22.3564 GFLOP, canonical QK/PV는 약 0.7712 GFLOP다. norm·RoPE·online
softmax의 추가 연산은 이 aggregate envelope에 포함하지 않았다. M=82는
64행 타일 두 개를 쓰므로 유효 행 비율은 64.0625%다. 이를 실측 occupancy로
부르지 않는다. eta=1과 native commit의 aggregate 값은 다른 커널에도 성립하는 엄밀한
하한이 아니라 조건부 경험적 envelope이며, 20% 이상 오차가 나면 누락된 호스트/API/효율 항을 설명한다.

CPU encoding, GPU 실행, target-queue gap은 겹친다. trace에서 셋을 더하면
54.802 ms지만 실제 평균은 33.425 ms다. 겹치지 않는 임계 경로 항 또는
`max(host submit, GPU work)`를 사용해야 한다. 추적 내 gap 비율 65.7%를
모두 없앤다는 낙관적 Amdahl 상한은 약 2.92배다. 제출 71/425 감소만의
기여는 같은 가정에서 전체 시간 약 11%여서 fusion 단독보다 조합을 검증한다.

### 요인과 공통 ABI

A=Mojo AIR, B=Mojo DeviceContext, C=FP16 가중치/FP32 누적,
D=연산별 CB가 E0의 수준이다. E=1/16 및 Offline의 4/8/32/64/100을 공통
하네스가 측정한다. 추가 수준은 sync 0/1/2/3/4 레이어, prepare 0/1,
cap unset/64다. `build_e0.py`는 8개 공통 ABI 변형을 만들고 `factors.json`에
기록한다. `e0_adapter.c`는 하네스의 `mojo_adapter.c`를 재사용한다. 실제
커널·호스트를 C로 바꾼 것은 아니다. 런타임의 실제 제출 카운터가 없으므로
선택적 stats export는 생략하며 trace 예측을 카운터처럼 반환하지 않는다.

### 최종 반복과 통계

공통 하네스가 준비됐다고 확인하고 GPU 실행 순서를 배정받은 뒤 실행한다.
정확도 20개 cosine>=0.999를 먼저 통과한 엔진만 예열 10회, 독립 프로세스
5회×30호출을 측정한다. Q8과 A/B/A/B로 교차한다. SingleStream, Offline,
Server 결과는 서로 구분한다. median/IQR/10,000회 bootstrap 95% CI,
처리량 mean±sd, Mann–Whitney U, Cliff's delta, Holm 보정을 공통 분석기로
산출한다. 아직 이 통계를 얻지 않았으므로 아래 탐색 값에 CI를 꾸며 넣지 않는다.

## Results

### 확인된 정확도 smoke

prepare+sync3를 공통 size_t-length ABI로 호출한 결과 20개 single 및 혼합
batch가 통과했다. single cosine min 0.9996991605, mean 0.9999279238,
max absolute difference 0.0029360810, mixed cosine min 0.9996997925다.
이는 Q8의 최종 pooled/projected/L2-normalized 768-vector와 비교한 값이다.
raw 512차원 mean-pool 중간값 오차를 검증했다고 주장하지 않는다.

원본: `/private/tmp/ib-mojo-opt/e0-abi-check.json`.
이 검사는 `timed=false`이며 최종 성능 통계가 아니다. native prepare quick
check도 통과했지만 30호출에 12.3–232.4 ms 변동이 있어 채택 근거로 쓰지 않는다.

### 초기 trace와 탐색 성능

[단계별 표와 레이어별 CSV 생성](MOJO-ENGINE-OPTIMIZATION.md#single-paragraph-pipeline-stage-by-stage)에
실측 값이 있다. 초기 비계측 최종 쌍은 Mojo 23.569 ms/92.551문단/s,
Q8 17.339 ms/최고 105.722문단/s로 두 속도 게이트를 모두 놓쳤다. 이후
E0의 5-process 확증 결과는 아직 없다.

## Ablations

현재 제공한 조합은 base, sync1/2/3/4, cap64, prepare, prepare+sync3다.
각 조합의 확증 통계와 interaction 판단은 공통 하네스 결과를 받은 뒤 추가한다.
다른 호스트·Q8 커널 요인은 E1/E3 등과 함께 전체 부분 요인 배치에서만
추정할 수 있다. E0 안에서 언어·호스트·정밀도 효과를 분리했다고 주장하지 않는다.

## Discussion

현재 trace는 계산 커널보다 제출·대기 경로가 우선 개선 대상이라는 가설을
지지한다. 그러나 target-queue gap은 전역 GPU idle이 아니며 다른 앱의 작업도
포함한다. llama.cpp 두 compute encoder 안의 세부 단계 시간을 PC sampling만으로
정확히 복원할 수 없다. 불명확한 칸은 미확인으로 남겼다.

## Threats to validity

한 M5만 사용했고 다른 앱/CPU 빌드/메모리 압력을 통제하지 못했다. 초기
추적은 GPU 잠금 규칙 도입 전에 끝났다. shader-enabled trace는 비계측 게이트나
기본 trace와 섞지 않는다. PC shader time은 sampling이며 dispatch count가 아니다.
82토큰 중심의 짧은 20-case corpus는 모든 2,048토큰/긴 window 경계를 증명하지
않는다. 기존 BF16↔Mojo와 Q8↔Mojo 정확도는 비교 기준이 달라 별도로 표시한다.

## Conclusion

**현재 채택 보류.** 추가 fusion과 sync/cap 조합은 구현·정확도 확인 단계다.
공통 하네스의 CI가 겹치지 않는 single 개선과 최고 Q8 Offline 초과를 모두
보이기 전에는 앱에 연결하지 않는다. Q8 cosine min이 0.9999보다 낮아 향후
채택한다면 INDEX_VERSION 변경이 필요하다. 현재 앱 index와 버전은 그대로다.

## References

- [공통 방법론](ENGINE-LAB-METHODOLOGY.md)
- [실험 이력과 전체 source ledger](MOJO-ENGINE-OPTIMIZATION.md)
- [FlashAttention](https://arxiv.org/html/2205.14135v2), [FlashAttention-2](https://arxiv.org/html/2307.08691v1)
- [Apple MSL specification](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf)
- [Apple command-buffer guide](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/MTLBestPracticesGuide/CommandBuffers.html)
- [MAX M5 matmul](https://github.com/modular/modular/blob/main/max/kernels/src/linalg/matmul/gpu/apple/matmul_kernel.mojo)
- [MLX steel GEMM](https://github.com/ml-explore/mlx/blob/main/mlx/backend/metal/kernels/steel/gemm/kernels/steel_gemm_fused.h), [MLX SDPA](https://github.com/ml-explore/mlx/blob/main/mlx/backend/metal/kernels/steel/attn/kernels/steel_attention.h)
- [Modular launch/queue report #6899](https://github.com/modular/modular/issues/6899), [coalescing report #6943](https://github.com/modular/modular/issues/6943)


### 검토용 원본 자료

최종 하네스 결과와 구분한 탐색 CSV/JSON은
[dev/mojo-engine/results/e0-exploratory-20261020](../../app/apps/desktop/dev/mojo-engine/results/e0-exploratory-20261020)에 있다.
`trace_summary.py`로 trace XML에서 단계·레이어별 CSV를 다시 만든다.
`build_e0.py`로 공통 ABI 변형을 빌드한다. 실제 5-process 통계는 공통 하네스의
run.sh와 analyze.py로 생성하며, 준비 및 GPU 순서 확인 전에는 실행하지 않는다.
Raw trace의 shader-enabled/nonshader 구분과 바이너리·fixture 해시는 같은
디렉터리의 metadata.json에 적었다. 잠금 이전 탐색을 잠금 후 확증 결과로
표시하지 않는다.


## 인계와 미완료 항목

불변 바이너리 manifest와 모델 대응은
`/private/tmp/ib-mojo-opt/immutable/e0-e8a1f7aebf2bab0c/manifest.json`,
전달 전체의 환경·hash·소유권·미측정 목록은 `/private/tmp/ib-mojo-opt/E0-DELIVERY.json`이다.
코디네이터가 strict 8-cell 후속 작업을 별도로 추적한다. 현재 E0 GPU 작업은
실행/대기 중인 것이 없으며, frozen 바이너리나 소스는 변경하지 않는다.

아직 수행하지 않은 것은 최종 독립 프로세스 5회×30호출, 예열 10회,
동일 세션 Q8 A/B 교차, SingleStream/Offline/Server의 전체 셀, CI/IQR/처리량 sd,
Mann–Whitney/Cliff/Holm, 최종 roofline, 독립 검증이다. 이 항목들은 smoke나
부분 CSV로 대체하지 않는다. cap64와 sync 변형의 최종 성능 우열도 미확인이다.
구현자는 앱 채택·버전·INDEX_VERSION·설치/서명/공증·Windows 검증을 수행하지 않았다.
