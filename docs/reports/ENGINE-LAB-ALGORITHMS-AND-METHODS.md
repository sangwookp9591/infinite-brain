<!-- SPDX-License-Identifier: Apache-2.0 -->
# 임베딩 엔진의 속도 최적화: 정의와 선택 근거

2026-10-20. 현재 코드와 실험 기록으로 추적할 수 있는 최적화를 정의한다. 여기서 **유지·채택은 연구 프로토타입의 구현 선택**을 뜻한다. 앱 엔진 교체는 독립 재측정과 제품 비용 검토가 남아 있다. 측정 규칙은 [방법론](ENGINE-LAB-METHODOLOGY.md), 완료한 E1 수치는 [Rust 보고서](ENGINE-LAB-E1-RUST.md)가 기준이다.

## 1. 최근 E1 개선의 핵심: 의존성을 보존하는 GPU 명령 일괄 제출

**정의:** 모델의 전체 순전파 연산을 하나의 Metal command buffer/compute encoder에 기록하고, 필요한 데이터 의존성 배리어를 넣은 뒤 한 번 제출한다. CPU는 마지막 결과가 필요할 때 완료를 기다린다. 계산 수식을 바꾸는 최적화가 아니라 실행·스케줄링 비용을 줄이는 시스템 최적화다.

```text
기존 Mojo 경로: 연산 기록 → 버퍼 제출을 반복 (기존 trace: 문단당 425개)
E1 Rust 경로:  전체 연산 기록 + 의존성 배리어 → 제출 1회 → 완료 대기 1회
```

계산 kernel을 하나로 합친다는 뜻은 아니다. E1은 문단당 host dispatch counter가 445개이며, 실제 Metal trace에서 40개 문단 각각 command buffer 1개와 encoder 1개를 확인했다. 가중치 초기화는 warm forward와 별도다. 배리어와 GPU buffer 수명을 completion까지 보존하므로 이전 연산의 출력을 다음 연산이 읽는 순서가 유지된다.

**선택 이유:** 기존 trace가 425 대 3의 버퍼 차이를 보였다. 연산 수를 줄이기 전에 CPU의 기록·제출, runtime 객체 관리, queue gap을 줄일 실험이 필요했다. Mojo 커널을 AIR로 AOT 컴파일하고 Rust에서 직접 Metal로 제출해 기존 DeviceContext host 경로를 우회했다. 이 선택의 직접 근거는 논문 이름보다 [Apple Metal Command Buffers 지침](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/MTLBestPracticesGuide/CommandBuffers.html)과 현장 trace다. Apple 지침의 GPU starvation과 제출 비용 간 균형을 이 순전파에 적용했다. 모든 workload에서 버퍼 하나가 최적이라는 일반 법칙은 아니다.

**코드:** [Rust host](../../app/apps/desktop/dev/engine-lab/rust-metal/lib.rs)의 encoder 기록, `memoryBarrierWithScope`, `commit`, `waitUntilCompleted`.

**확인 범위:** 버퍼 수 감소는 trace로 확인했다. 지연 개선 전체를 제출 비용 하나의 인과 효과로 분리하지는 못했다. host와 제출 전략이 함께 바뀌었고 split-K routing도 달라졌다. GPU graph replay는 이 구현에 사용하지 않았다.

## 2. 공유 커널층: 온라인 softmax attention

**정의:** 각 query가 key/value를 순회하며 현재 최대 score `m`, 정규화 합 `l`, 가중 value 합 `o`를 갱신한다. 최종 출력은 `o/l`이다. 현재 모델이 정한 attention score와 masking을 유지한다.

```text
새 score s, 새 value v를 만났을 때:
m' = max(m, s)
a  = exp(m - m')
b  = exp(s - m')
l' = a*l + b
o' = a*o + b*v
출력 = o/l
```

예를 들어 score가 1000과 1001이면 거대한 exp 값을 직접 계산하는 대신 최대값을 빼서 `exp(-1)`과 `exp(0)`을 사용한다. 두 value의 최종 가중치는 약 0.269와 0.731이다. 구현은 query/head별 SIMD group에서 이 계산을 수행하며 큰 score/probability 행렬을 전역 메모리에 저장하지 않는다.

**선택 이유:** QK 계산, softmax, V 가중합 사이의 전역 중간 결과와 kernel 경계를 줄이기 위해서다. attention 수학의 연산량은 여전히 대략 O(N²d)이지만 N×N 중간 attention 행렬의 저장을 피한다. 토큰이나 attention 연결을 생략해 속도를 얻는 방식이 아니다.

**논문 근거:** [FlashAttention, Dao 외, 2022](https://arxiv.org/abs/2205.14135)의 exact attention·IO 절감 원리를 참고했다. [FlashAttention-2, Dao, 2023](https://arxiv.org/abs/2307.08691)는 병렬 작업 분할·shared-memory 통신 비용을 검토한 근거다. 현재 커널은 이들 CUDA 구현 전체나 FA2의 타일링·스케줄링을 재현한 구현이 아니다. 논문에서 보고한 GPU와 배속을 우리 M5 결과로 옮겨 적지 않는다.

**코드:** [gpu_ops.mojo](../../app/apps/desktop/dev/mojo-engine/gpu_ops.mojo)의 `attention`: `peak`, `denom`, `accum`, `correction` 갱신. E1도 이 공유 커널을 AIR로 로드한다.

## 3. FP16 입력·가중치와 FP32 누산을 사용하는 tiled GEMM

**정의:** 행렬곱 C=A×B를 작은 출력 tile로 나누어 GPU의 행렬 연산 경로에 배치한다. 곱셈 입력과 가중치는 FP16, 곱의 누적 합은 FP32다. norm·attention·잔차·최종 출력의 필요한 FP32 경로를 유지한다.

```text
C_fp32 += A_fp16 × B_fp16
```

예를 들어 N이 작은 82-token 행렬은 큰 정사각형 GEMM과 점유율이 다르다. 출력 tile 수가 적고 K가 길면 K 구간을 나누어 partial product를 병렬 계산한 뒤 합치는 **split-K**를 조건부로 사용한다. 병렬성이 늘지만 별도 reduction과 메모리 접근도 생긴다.

**선택 이유:** 현재 M5에서 실행 가능한 최적화된 행렬곱을 재사용하고, FP32 전체 경로보다 데이터 이동과 연산 비용을 줄이면서 누산 오차를 억제하기 위해서다. 정확도는 가정하지 않고 원래 20개 fixture와 혼합·성장 게이트로 검사한다.

**직접 구현 근거:** 설치된 Modular Apple GEMM과 [공개 소스의 고정 조사 commit](https://github.com/modular/modular/blob/6a2c21ffdf56a2bd57b32dea319c9c5f8ab9bdd2/max/kernels/src/linalg/matmul/gpu/apple/matmul_kernel.mojo). 공개 commit과 설치 wheel이 동일하다고 주장하지 않는다. 실제 E1 입력 소스/AIR hash는 E1 보고서의 AOT manifest에 고정했다. 특정 mixed-precision 학습 논문의 loss scaling을 적용한 실험은 아니다.

**코드:** [engine_gpu.mojo](../../app/apps/desktop/dev/mojo-engine/engine_gpu.mojo)의 `mm_half`와 `enqueue_apple_matmul`; [Rust host](../../app/apps/desktop/dev/engine-lab/rust-metal/lib.rs)의 `mm`과 split partial/reduce 분기.

**한계:** E1의 split-K 선택 때문에 dispatch가 기존 Mojo 417개와 달리 445개다. 두 구현이 완전히 같은 실행 그래프라는 가정은 성립하지 않는다. E1에서 Q8 전용 kernel을 새로 구현한 것은 아니다.

## 4. 커널 결합과 작업 메모리 재사용

**커널 결합 정의:** 함께 수행해도 수학적 의존성이 유지되는 연산을 한 kernel 또는 큰 GEMM으로 묶는다. Q/K/V projection을 묶고, gate/up projection을 묶으며, norm·RoPE·cast 또는 잔차·scale 같은 후처리를 결합한다. 중간 tensor의 쓰기·재읽기와 작은 kernel 실행 경계를 줄인다.

**예:** `정규화 → FP16 변환`을 따로 실행하면 중간 값을 한 번 저장하고 다음 kernel이 다시 읽는다. 정규화 결과를 바로 FP16으로 저장하면 이 중간 왕복을 줄일 수 있다.

**메모리 재사용 정의:** 가중치와 주요 workspace를 유지하고 입력이 기존 capacity를 넘을 때 확장한다. 82토큰 요청을 반복할 때 주요 GPU 작업 버퍼를 매번 다시 만들지 않는다. 모든 allocation이나 입력 복사를 제거했다는 의미는 아니다.

**선택 이유:** 짧은 encoder에서는 작은 연산의 실행 경계와 할당 비용이 전체 지연에서 무시되지 않기 때문이다. [FlashAttention의 IO 관점](https://arxiv.org/abs/2205.14135), Modular/MLX의 공식 kernel 구현을 참고했으며, 실제 유지·기각 이력은 [최적화 로그](MOJO-ENGINE-OPTIMIZATION.md)에 있다. FP16+재사용 및 여러 fusion은 결합 실험이므로 각각의 독립 개선율을 만들지 않는다. E0의 추가 `residual_prepare` 변형은 이번 E1 측정에서 제외했다.

## 5. 왜 이 방법론으로 검증했는가

| 참고 방법론·원문 | 이 연구에서의 사용 | 선택 이유와 적용 한계 |
|---|---|---|
| [Roofline — Williams·Waterman·Patterson, 2009](https://escholarship.org/uc/item/5tz795vq) | 실제 M5에서 잰 BW·GEMM envelope와 FLOP/byte 비교 | 메모리 이동, 계산, 실행 오버헤드 중 우선 볼 병목을 가리기 위해 사용. blit BW나 정사각형 MPS peak가 모든 작은 kernel의 엄밀한 상한이라는 보장은 없음 |
| [Amdahl — 1967 원문](https://www.cs.cmu.edu/~18742/papers/Amdahl1967.pdf) | 제거 가능한 직렬 임계경로 비율의 개선 상한·감도 분석 | 손댈 부분의 가능한 이득이 목표에 도달하는지 먼저 판단. 겹치는 CPU/GPU 시간을 더해 제거 가능한 비율로 만들지 않음 |
| [MLPerf Inference — Reddi 외, ISCA 2020](https://arxiv.org/abs/1911.02549) | SingleStream, Offline, Poisson Server의 시나리오 구분 | 검색어 한 번의 지연, 대량 색인 처리량, 요청 대기 포함 tail latency를 각각 보기 위해 사용 |
| Bootstrap CI, Mann–Whitney U, Cliff's δ, Holm | 독립 프로세스 중앙값 5개, bootstrap 10,000회, 분포·효과 크기·다중 비교 확인 | 한 프로세스의 150개 호출을 150개의 독립 실험처럼 취급하지 않고, 우연한 승리를 과장하지 않기 위해 사용 |

Roofline의 기본 관계는 `P ≈ min(P_compute, BW × arithmetic_intensity)`다. 여기서는 조건부 경험적 envelope로 사용한다. 가령 20ms 중 제거 가능한 직렬 시간이 5ms라면 그것을 완전히 없애도 지연은 15ms, 개선 상한은 20/15≈1.33배다. 이것은 설명 예제이며 E1에서 제거된 host 시간을 5ms로 측정했다는 뜻은 아니다.

MLPerf에서는 시나리오 생성 원리를 가져왔다. 공식 LoadGen·모델·요청 수·최소 실행시간·인증 절차를 그대로 따른 결과가 아니므로 **MLPerf-inspired 로컬 연구**다. 우리 p50/p90, 100문단 Offline, QPS당 150개 Server 표본과 50ms 기준은 이 연구의 설정이다. MLPerf 공인 점수나 지속 서비스 용량으로 부르지 않는다.

## 6. 현재 증거로 말할 수 있는 것

E1의 완료된 공통 연구는 같은 세션 Q8 대비 단일 p50 **15.875→11.087ms**, 최고 Offline 평균 **103.965→128.436문단/초**였다. 10개 native 프로세스와 5,100행을 코디네이터가 별도로 검사·재집계했다. 각 엔진은 독립 프로세스 5회이며 단일·혼합 정확도 게이트를 모두 통과했다.

이는 **해당 커널·host·정밀도·제출 전략 조합의 관측 결과**다. Rust 언어만의 효과, FlashAttention만의 개선율, 배포된 앱의 속도를 입증한 결과는 아니다. 17개 비교의 Holm 보정 p=0.134921이므로 다중 검정 유의성을 확보했다고 말하지 않는다. 자세한 process CI, trace 및 제품 비용은 [E1 보고서](ENGINE-LAB-E1-RUST.md)를 따른다.

독립 재측정, 실제 검색 품질, M1–M4/Windows/구형 OS, 설치·서명·공증·앱 통합은 미완료다.
