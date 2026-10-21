# 임베딩 엔진 실험 방법론

2026-10-20. EmbeddingGemma 2를 기기 안에서 돌리는 엔진 후보(Mojo, Rust, Zig+C, Core ML, Go)를 같은 틀로 비교하기 위한 방법론이다. 각 실험 보고서(`ENGINE-LAB-E*.md`)는 이 문서의 모델, 인터페이스, 측정 파이프라인, 실험 설계를 따른다.

## 1. 연구 질문

- **RQ1.** 문단 하나(82토큰) 처리 시간에서 llama.cpp Q8_0 Metal보다 빠른 엔진이 있는가? 있다면 어느 층(커널, 호스트, 런타임)의 차이 때문인가?
- **RQ2.** 묶음 처리량에서 같은 질문.
- **RQ3.** 앱에 넣을 때의 비용(빌드, 서명, 크기, 유지보수, Windows)까지 따지면 어느 조합을 채택하는가?

출발점이 된 관측: 같은 모델에서 Mojo는 문단당 명령 버퍼 425개(계산 417, 복사·동기화 8), llama.cpp는 3개를 쓴다. 비임베딩 행렬 payload는 FP16 273,416,192 bytes, 실제 Q8_0 artifact 151,150,592 bytes다. 초기 145.3MB는 모든 행렬을 균일 Q8로 가정한 근삿값이며 실제 artifact는 PLE projection을 BF16으로 유지한다. 두 payload 차이를 초기 추정 대역폭 153GB/s로 나누면 약 0.80ms이고, 관측된 지연 차이는 약 6ms다. 이 대역폭은 아래 공통 마이크로벤치로 다시 잰 값과 구별한다(`MOJO-ENGINE-OPTIMIZATION.md`, `MOJO-LATENCY-RESEARCH.md`).

## 2. 분석 모델 (측정 전에 예측한다)

### 2.1 지연 분해

문단 하나의 처리 시간을 임계 경로의 **서로 겹치지 않는 구간**으로 나누면 다음 식을 쓸 수 있다.

```
T_single = T_host + N_cb · t_submit + Σ_k T_kernel(k) + T_gap + T_readback
T_kernel(k) = max( bytes_k / BW , flops_k / P_peak ) / η_k
```

CPU 명령 기록·제출과 GPU 실행은 겹칠 수 있다. 트레이스의 CPU encode wall, GPU busy union, queue gap을 위 식에 그대로 더하면 중복 계산한다. 구간을 배타적으로 분해할 수 없으면 겹침을 명시한 임계 경로 모델을 쓰고, 독립적인 CPU 제출 비용과 GPU 계산 envelope는 우선 `max(T_submit, T_gpu)`로 비교한다. 실효 BW와 MPS GEMM 최고치를 이용한 aggregate 값은 다른 커널에도 성립하는 엄밀한 하한이 아니라 조건부 경험적 envelope다. 누락한 host/gap/readback와 η 가정을 함께 표시한다.

- `N_cb`: 명령 버퍼 수, `t_submit`: 버퍼당 제출·대기 비용(대기열 64개를 넘으면 커진다는 외부 보고가 있다, modular#6899).
- `BW`, `P_peak`: 이 기기에서 마이크로벤치로 직접 잰 값(스트림 복사 대역폭, FP16 행렬곱 최대치). 사양표 값은 쓰지 않는다.
- `η_k`: 커널 효율(측정값 ÷ 상한). 82행처럼 가는 행렬곱은 낮게 나온다.

실험마다 `N_cb`, 커널별 바이트·연산량을 먼저 계산해 `T_single`을 예측하고, 측정과 20% 넘게 어긋나면 어느 항이 틀렸는지 트레이스로 찾아 모델을 고친다.

### 2.2 Roofline

커널마다 연산 강도(연산/바이트)를 계산해, 잰 `BW`와 `P_peak`로 만든 roofline 위에 측정점을 찍는다. 대역폭에 막힌 커널은 양자화(Q8, Q4)가, 계산에 막힌 커널은 행렬곱 타일과 정밀도가, 둘 다 아닌데 느린 커널은 실행 비용이나 점유율이 원인 후보다.

### 2.3 Amdahl 상한

어떤 층을 고칠 때 얻을 수 있는 최대 개선은 그 층이 `T_single`의 배타적 임계 경로에서 차지하는 비율로 제한된다. 예를 들어 제거 가능한 직렬 제출 비용의 비율이 p라면, 그것을 0으로 만들어도 최대 속도 향상은 `1/(1-p)`다. 겹치는 CPU 제출 시간으로 p를 계산하면 이 상한을 주장할 수 없다. 미측정 p는 가정에 따른 감도 분석으로 표시한다. 실험을 시작하기 전에 이 상한과 가정을 적고, 상한이 목표(llama.cpp보다 빠름)에 못 미치는 실험은 우선순위를 내린다.

## 3. 층 구조와 공통 인터페이스

엔진을 네 층으로 나눈다: **커널**(GPU/ANE 연산) → **호스트**(명령 기록·제출, 버퍼) → **런타임**(묶음 구성, 스케줄링) → **서비스**(앱 또는 서버). 층을 바꿔 끼울 수 있어야 "Mojo 커널 + Rust 호스트"처럼 층별 효과를 분리해 잴 수 있다.

모든 엔진은 동적 라이브러리로 다음 C ABI를 내보낸다(기존 `dev/mojo-engine`의 `ib_mojo_*`를 일반화한 것).

```c
// SPDX-License-Identifier: Apache-2.0
// 성공 0, 실패는 음수. out은 호출자가 768 * nseq 개 float을 할당한다.
void *ib_engine_init(const char *model_path);
int   ib_engine_embed(void *e, const int32_t *tokens, size_t n, float *out);
int   ib_engine_embed_batch(void *e, const int32_t *tokens, const size_t *lens,
                            size_t nseq, float *out);   // 없으면 하네스가 embed를 반복
int   ib_engine_stats(void *e, uint32_t *command_buffers, uint32_t *dispatches); // 선택
void  ib_engine_free(void *e);
const char *ib_engine_name(void);   // "mojo-gpu-fp16", "rust-metal-mojoair" 같은 식별자
```

토큰화는 엔진 밖에서 한 번 하고(공통 `inputs.json`), 풀링·정규화는 엔진 안에서 한다. llama.cpp 기준선도 같은 ABI 어댑터로 감싼다.

## 4. 공통 측정 파이프라인

하나의 하네스가 모든 엔진을 같은 방식으로 잰다(`app/apps/desktop/dev/engine-lab/harness/`). 시간 측정 루프는 네이티브 코드로, 통계와 그래프는 분석 스크립트로 나눈다.

| 시나리오 (MLPerf Inference 방식) | 방법 | 보고값 | 제품에서의 의미 |
|---|---|---|---|
| SingleStream | 요청 하나씩, 앞 요청이 끝나면 다음 | p50, p90, 평균 지연 | 검색어 임베딩 |
| Offline | 100개 문단을 엔진이 원하는 묶음으로 | 문단/초 | 몰아서 하는 색인 |
| Server | 포아송 도착(목표 QPS 여러 단계) | p99 지연이 기준(예: 50ms) 안에 드는 최대 QPS | 동시 요청, 서버 |

모든 실행이 같은 순서로 지나간다.

1. **정확도 게이트:** 20개 입력의 코사인(최소·평균)과 풀링 벡터 최대 절대 오차. 최소 코사인이 0.999 미만이면 그 실행은 성능 표에 넣지 않는다.
2. **예열:** 호출 10회는 버린다.
3. **측정:** 엔진마다 독립 프로세스 5회 × 호출 30회. llama.cpp와 A/B/A/B로 번갈아 실행한다.
4. **잠금:** 모든 GPU/ANE 측정은 `/private/tmp/ib-gpu-bench.lock` 안에서만 한다.
5. **기록:** 원본 측정값 CSV(엔진, 요인 수준, 프로세스, 반복, 지연, 명령 버퍼 수), 환경(하드웨어, OS, 도구 버전, 모델 해시, 전원, 온도 상태).
6. **분석:** 중앙값, IQR, 95% 부트스트랩 신뢰구간(10,000회), 처리량 평균±표준편차. 엔진 간 비교는 Mann-Whitney U와 효과 크기(Cliff's δ), 비교가 여러 개이므로 Holm 보정. 예측(2장)과 측정을 나란히 놓은 표와 roofline 그림을 만든다.

## 5. 실험 설계

요인을 하나씩 바꾸면 요인끼리의 상호작용(예: Q8은 제출 비용이 클 때는 효과가 없다가 제출을 줄이면 드러남)을 놓친다. 그래서 요인 배치 설계를 쓴다.

| 요인 | 수준 |
|---|---|
| A 커널 출처 | Mojo(AIR) / MSL(직접 작성·ggml·MLX 계열) |
| B 호스트 | Mojo DeviceContext / Rust objc2-metal / Zig+C |
| C 정밀도 | FP16 / Q8 가중치(커널 안에서 풀기) |
| D 제출 전략 | 연산마다 버퍼 / 문단마다 버퍼 하나 |
| E 묶음 크기 | 1 / 16 (Offline은 추가로 4, 8, 32, 64, 100) |

모든 조합이 만들어지지는 않는다(예: Mojo DeviceContext 호스트는 버퍼 하나로 기록할 수 없다). 만들 수 있는 조합으로 2^(k-1) 부분 요인 배치를 짜고, 주효과와 2요인 상호작용을 추정한다. Core ML(E4)과 Go(E5)는 이 요인 공간 밖의 대안이라 같은 시나리오와 게이트로만 비교한다.

## 6. 임계 경로 분석

결과가 예측과 다르면 Xcode Metal System Trace로 CPU 명령 기록 → 제출 → GPU 실행 → 결과 읽기 중 어느 구간이 임계 경로인지 확인한다. 셰이더 시간은 샘플링 값이므로 인코더 단위 실측과 구분해 적는다.

## 7. 채택 기준

- **성능:** 같은 세션에서 SingleStream p50이 llama.cpp보다 낮고(95% 신뢰구간이 겹치지 않음), Offline 처리량이 llama.cpp 최고 묶음보다 높다. 정확도 게이트 통과는 전제다.
- **제품 비용:** 앱 크기 증가, 빌드 도구 추가, 코드 서명·공증 영향, Windows 경로, 유지보수 인력. 성능이 비슷하면 비용이 낮은 쪽을 고른다.

## 8. 타당성 위협

공유 Mac(다른 앱과 열 상태를 통제하지 못함), 한 기기(M5)만 측정, 82토큰 한 길이 중심, 외부 이슈의 수치(M4, M5 Max)는 우리 측정이 아님, 셰이더 시간의 샘플링 오차. 각 보고서는 자기 실험에 해당하는 위협을 추가로 적는다.

## 9. 역할

| 역할 | 담당 |
|---|---|
| 방법론, 분석 모델, 최종 판정 | Claude Opus (조정자) |
| 공통 하네스(ABI 로더, 세 시나리오, 통계·그림) | Codex Sol/high |
| E0 Mojo 제출 줄이기, E1 Rust 호스트, E3 Zig+C, E4 Core ML | Codex Sol/high |
| E5 Go | Codex Luna/high |
| 독립 재측정·검증 | Claude Opus/high (구현자와 분리) |
| 최종 비교 보고서 | Claude Sonnet/high |

Claude 세션의 크레딧 만료 후 기존 Run의 코디네이터는 Codex로 인계됐다. 위 표의 독립 검증·최종 보고서 역할은 실행되지 않았으며, 대체 모델로 완료했다고 간주하지 않는다. 공개 비교 보고서는 Codex 코디네이터가 작성한 근거 정리다. 현재 Task/Dispatch, 측정 순서와 검증 체크포인트는 [코디네이터 인계 기록](ENGINE-LAB-COORDINATION.md)을 따른다.
