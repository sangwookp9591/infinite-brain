# Mojo EmbeddingGemma 2 단일 문단 지연 연구

작성일: 2026-10-20, Asia/Seoul. 대상: Apple M5 / 24 GiB / macOS 27.0.1, Mojo 1.2.0rc2·MAX 26.7.0rc2 실험. **연구 보고서이며 엔진 변경·성능 개선의 실행 증거가 아니다.**

## 초록

단일 82-token encoder의 Mojo 지연을 문헌·코드·기존 실행 자료로 분석했다. FP16/Q8 가중치 차이만으로 전체 격차를 설명하기 어렵고, 추가 trace의 425 대 3 command buffers와 CPU encoding/queue idle 차이가 더 직접적인 증거다. 권고는 Mojo kernel을 유지한 Rust Metal host의 제출 병합이며, AIR→metallib→독립 binding 검증이 선행 조건이다. 이번 작업은 연구만 수행했고 새 GPU benchmark·Swift host·제품 변경은 없다.

## 서론 / 연구 질문

추가 trace는 **Mojo의 op별 command-buffer/encoder 생성과 CPU encoding·GPU idle**을 첫 원인으로 지목한다. M=82 GEMM 효율과 FP16 traffic는 잔여 후보지만 기여율은 아직 분리되지 않았다. “언어 자체가 느리다” 또는 “weight bandwidth만 문제”라는 해석은 지지되지 않는다. 제출 구조를 바꾸는 통제 ablation 전까지 얻을 speedup은 확정하지 않는다.

이번 조사 중 [측정 로그](MOJO-ENGINE-OPTIMIZATION.md)에 마지막 순차 A/B가 추가되었다. 과제에 인용된 앞선 결과와 최신 결과를 섞어 채택 근거로 사용하면 안 된다.

| 동일 실행 묶음 | Mojo 단일 82토큰 | Q8 단일 82토큰 | Mojo packed 100문단 | Q8 최적 배치 | 판단 |
| --- | ---: | ---: | ---: | ---: | --- |
| 과제에 인용된 앞선 측정 | 26.59 ms | 19.36 ms | 119.75문단/s | 89.65문단/s, 16/decode | 단일 지연 실패, 배치 통과 |
| 로그의 마지막 순차 A/B | 23.57 ms | 17.34 ms | 92.55문단/s | 105.72문단/s, 8/decode | 두 속도 기준 모두 실패 |

앞선 단일 격차는 7.23 ms, Mojo 지연을 약 27.2% 줄여야 동률이다. 마지막 쌍은 약 6.23 ms, 약 26.4% 감소가 필요하다. 배치 우위는 재현이 필요한 관찰이며 현재의 확정적 제품 이점이 아니다. **당장의 권고는 기존 llama.cpp Q8 유지**다.

증거의 구분:

- **[관측]** 저장소 로그에 기록된 실행 결과. 이번 연구자가 새로 벤치마크한 수치는 아니다.
- **[코드]** 현재 엔진·변환 manifest·실제로 사용한 llama.cpp 소스의 읽기 전용 감사.
- **[외부]** 공식 문서·논문·개발자가 공개한 재현 코드/측정. 다른 GPU·모델에서의 결과를 M5 엔진의 측정으로 대체하지 않는다.
- **[추론]** 위 자료에서 도출한 원인·예상 이득. 아래 실험으로 반증 가능하게 기술한다.

읽은 로컬 기준 문서는 [optimization log](MOJO-ENGINE-OPTIMIZATION.md), [초기 spike](MOJO-ENGINE-SPIKE.md), [엔진 README](../../app/apps/desktop/dev/mojo-engine/README.md)다. 초기 spike의 112.05 ms와 FP32 상태 설명은 역사적 결과다. 현재 normal path에는 영속 GPU 버퍼, FP16 GEMM, QKV/gate-up fusion, online softmax가 있고, 층별 host fence는 없다. 프로파일 전용 stage fence를 정상 호출 비용으로 오인하지 않는다.

## 방법

### 연구 범위와 사전 등록 규약

이 보고서는 문헌 연구·소스 감사·기존 JSON/trace 결과의 재분석이다. 새 GPU 실험은 수행하지 않았다. 후속 engine lab의 측정 전에 다음 규약을 고정한다: GPU benchmark는 `/private/tmp/ib-gpu-bench.lock`의 mkdir/rmdir 잠금을 보유한 한 process만 실행하고, AC 전원·전력 모드·열 상태·동시 load를 기록한다. 이번 연구는 실제 AC/전력 모드를 확인하지 않았으며 기존 로그도 이를 통제하지 않았다. 초기 30 warm-call median을 아래 반복 기준으로 측정된 값처럼 소급 표기하지 않는다.

- 표본: 최소 **5개 독립 process run × 30 warm calls**. 각 process에서 단일 입력과 목표 batch shape를 각각 5회 warmup한 후 측정한다. 이는 앞으로 적용할 사전 규약이고 기존 측정의 warmup 수를 바꿔 적은 것이 아니다.
- 비교: 같은 세션·잠금에서 Q8/Mojo를 A/B/A/B로 교차. single latency의 median·IQR·process 단위 계층적 bootstrap 95% CI, throughput의 process별 평균 ± sample SD를 제시한다. bootstrap resample 단위와 seed·반복 수(예: 10,000)를 script에 고정한다. 150개 call을 독립 process 150개처럼 취급하지 않는다.
- 가설: H-submission은 수학·정밀도를 유지한 submit 감소가 single 지연을 줄인다는 것. CI가 개선 0을 포함하거나 두 speed gate 중 하나라도 실패하면 채택 근거가 아니다. H-weight는 같은 quantized weights의 packed/dequantized control 차이, H-tile은 precision 고정 시 tile/경로 차이로 각각 반증한다.
- 정확도: 20개 cosine 전부와 min/mean, normalized 768-vector max absolute difference를 남긴다. raw 512-d mean-pooled 값이 필요하면 별도 관측 지점을 추가해야 하며 현재 출력과 구별한다. mixed-length·sequence boundary·long window 회귀도 유지한다.
- 재현: 후속 구현 lane에서 하나의 script와 raw CSV에 engine/run/call/shape/precision/submit count/time/cosine/hash/전원·환경 metadata를 기록한다. 본 연구의 소유 범위는 이 Markdown 하나이므로 새 runner/CSV는 만들지 않았다. 아래 분석 코드로 기존 JSON과 계산값을 재생성할 수 있다.

정확한 실험 환경은 기존 README의 M5 24GiB·macOS 27.0.1(26A434)·Xcode 27.0(27A266a)·Metal Toolchain 27A266a·Mojo 1.2.0rc2(2016d0cd)·MAX 26.7.0rc2·Python 3.11.16을 따른다. BF16 GGUF SHA-256은 manifest에서 `f315cbbb30dd487e44d501c8902abe88808755e43753a96beed1964f0a48aa4f`를 확인했다. Q8 GGUF SHA-256은 이 연구에서 직접 계산한 `6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc`다. 입력은 기존 `inputs.json` 20개와 oracle JSON의 동일 token IDs이며 paragraph는 BOS 포함 82토큰이다.

### 표 재분석 코드

아래 하나의 Python script를 기존 실험 artifact가 있는 Mac에서 실행하면 이 보고서의 기존 gate·trace·정확도 인용값과 byte/dispatch 계산을 재생성할 수 있다. 새 benchmark를 돌리거나 raw CSV를 만들어 낸다는 뜻은 아니다. 최초 trace 수집·새 host 실험의 runner/CSV는 해당 engine lab의 산출물로 남겨야 한다. 과거 실행에 없는 IQR·CI는 이 코드도 출력하지 않는다. 외부 문헌의 측정은 각 URL 원문에 귀속된다.

```python
import hashlib
import json
import math
from pathlib import Path

root = Path('/private/tmp/ib-mojo-opt')
spike = Path('/private/tmp/ib-mojo-spike')
read = lambda path: json.loads(path.read_text())
q = read(root / 'q8-gate.json')
m = read(root / 'mojo-gate.json')
tensors = read(spike / 'weights.bin.json')['tensors']
params = sum(math.prod(t['shape']) for t in tensors
             if t['shape'][1] > 1 and t['name'] != 'token_embd.weight')
assert params == 136_708_096
print('active_dense_parameters', params)
for name, bytes_per_weight in [('FP16', 2), ('Q8_0', 34/32), ('Q4_0', 18/32)]:
    size = params * bytes_per_weight
    print(name, 'bytes', size, 'MiB', size / 2**20,
          'ms_at_153GBs', size / 153e9 * 1000)
delta = params * (2 - 34/32)
print('weight_delta_ms_at_153GBs', delta / 153e9 * 1000)
print('required_GBs_for_7.23ms', delta / 0.00723 / 1e9)
print('dense_GFLOP', (2*82*(params-393216)+2*393216) / 1e9)
print('tile_valid_fraction', 82/128, 82/96)
print('gather_bytes', 82*512*4)
print('attention_GFLOP', (20*4*4*82**2*256+4*4*4*82**2*512)/1e9)
print('dispatches', 4 + 24*17 + 5)
for us in [3, 6, 10, 17]:
    print('assumed_boundary_us', us, 'total_ms', 417*us/1000,
          'percent_of_26.59ms', 100*(417*us/1000)/26.59)
print('queue_depth_example_ms', (64*6.5+353*15.5)/1000)
print('single_needed_reduction', (26.59-19.36)/26.59,
      (m['median_ms']-q['median_ms'])/m['median_ms'])
print('Q8_gate', q['median_ms'], max(q['batch_100'],
      key=lambda b: b['paragraphs_per_second']))
print('Mojo_gate', m['median_ms'], m['batch_100_paragraphs_per_second'])
cosines = []
for i, (ref, vec) in enumerate(zip(q['rows'], m['vectors']), 1):
    a = ref['vector']
    cosine = sum(x*y for x,y in zip(a,vec)) / math.sqrt(
        sum(x*x for x in a) * sum(y*y for y in vec))
    cosines.append(cosine)
    assert cosine >= 0.999
    print('cosine', i, f'{cosine:.12f}')
print('cosine_min_mean', min(cosines), sum(cosines)/len(cosines))
print('final_768_vector_max_abs', max(abs(x-y)
      for row, vec in zip(q['rows'], m['vectors'])
      for x,y in zip(row['vector'], vec)))
for engine in ['mojo', 'llama']:
    p = root / f'trace-{engine}-final-summary.json'
    data = read(p)
    print('trace_source', engine, hashlib.sha256(p.read_bytes()).hexdigest())
    print(json.dumps(data, ensure_ascii=False, indent=2))
# 과제에 인용된 더 이른 26.59/19.36 ms 및 119.75/89.65/s 쌍은
# 덮어쓴 최신 gate JSON이 아니라 optimization log의 역사적 행에서 인용한다.
```

### 모델과 실행 단위

### 2.1 단일 시퀀스는 단일 토큰 GEMV가 아니다

이 encoder는 문단의 82토큰을 한 번에 처리한다. 일반적인 층의 곱은 `A[82,K] × W[N,K]^T`이며 **M=82의 skinny GEMM**이다. 자가회귀 생성에서 `A[1,K]`인 B=1 decode와 다르다. 마지막 mean pooling 뒤 `1×512 → 1×768`만 실제 GEMV에 해당한다.

[MLX quantized dispatcher][S4]는 하드웨어와 K/N에 따라 qmv/qmv_wide와 qmm을 구분한다. 조사 시점 코드의 vector limit는 대략 6–33 범위다. 그러므로 “M≤128이면 전부 GEMV로 바꾼다”는 결론은 근거가 부족하다. 82개 행을 별도 GEMV로 처리하면 가중치를 반복 읽고 MMA의 행간 재사용을 잃을 수 있다. [FlashDecoding++][S9]의 flat-GEMM 문제는 관련 있지만 해당 논문의 NVIDIA/AMD 속도 배수를 그대로 적용할 수 없다.

### 2.2 140M급 테이블 용량과 한 forward의 읽기량을 구분한다

읽은 변환 manifest `/private/tmp/ib-mojo-spike/weights.bin.json`과 `convert.py`·`engine_gpu.mojo`의 현재 계약은 다음과 같다.

| 항목 | 실제 모양·매개변수 | 호출에서 하는 일 |
| --- | --- | --- |
| token embedding | `262144 × 512` = 134,217,728개 | 82개의 token row를 gather; FP32 장치 가중치를 사용 |
| 공유 PLE 생성 projection | `512 × (24×512)` = 6,291,456개 | 문단 전체에 한 번 GEMM 후 24개 slice의 RMSNorm |
| 20개 local layer의 행렬 | 층당 5,242,880개 | QKV·O·GeGLU·PLE gate/projection |
| 4개 full layer의 행렬 | 층당 6,291,456개 | head width 증가로 QKV·O가 큼 |
| 최종 output projection | `512 × 768` = 393,216개 | 평균 pooling 뒤 시퀀스당 한 번 |

따라서 dense 연산 가중치는 **136,708,096개**, embedding table은 별도 **134,217,728개**다. “130M transformer + 140M PLE tables”라는 개략 표현으로 테이블 전체를 매 층 읽는다고 계산하면 틀린다. 현재 413-record 포맷에는 별도의 vocabulary×24×512 PLE lookup table이 없다. PLE 입력은 공유 projection으로 생성한다. 원래 모델 문서의 명명보다 **측정 대상 GGUF와 구현의 실제 tensor 목록**을 우선했다.

82-token gather의 FP32 논리 읽기량은 `82×512×4 = 167,936 bytes`(약 164 KiB)다. 중복 token, cache line, cache 상태에 따라 물리 트래픽은 다르지만 512 MiB 테이블 전체 스캔과는 거리가 크다. 테이블 양자화는 상주 용량을 줄일 수 있어도 단일 지연의 첫 번째 해결책은 아니다.

## 결과

### 추가된 정상 경로 trace 재분석

코디네이터가 전달한 425 대 3 buffer 관찰을, 실제로 존재하는 `/private/tmp/ib-mojo-opt/trace-mojo-final-summary.json`과 `trace-llama-final-summary.json`에서 직접 확인했다. 각각 **30 measured calls**다. 이는 다른 작업자가 수집한 자료의 재분석이며 본 연구자가 capture를 새로 실행한 것이 아니다. 층별 hardware-counter 표가 기록되었다고 주장하지 않는다.

| 단일 문단 trace 지표 | Mojo | llama.cpp Q8 | 해석 |
| --- | ---: | ---: | --- |
| traced call median | 29.136480 ms | 16.181208 ms | 계측 실행; 위 비계측 gate와 별도 |
| mean call | 29.577988 ms | 17.092893 ms | 독립 5-process 통계 아님 |
| command buffers / encoders per call | 425 / 425 | 3 / 3 | **submission 분할 차이 확인** |
| mean CPU encoding wall duration | 20.667341 ms | 2.235936 ms | GPU 실행과 overlap; CPU busy와 다름 |
| mean command-buffer GPU busy union | 19.802042 ms | 14.604789 ms | 순수 연산·DRAM 시간으로 분해되지 않음 |
| mean target queue idle | 7.115017 ms | 0.199564 ms | 약 6.915 ms 차이; 원인별 인과 기여율은 아님 |
| median encoding wall / buffer | 42.708 µs | 202.563 µs | payload가 다름. 언어별 호출 overhead 비교로 쓰지 않음 |

Mojo의 425 buffers는 **417 compute + metadata upload 6 + download/completion 2**와 맞는다. llama는 input 1 + whole forward 1 + output/completion 1이다. 따라서 이 direct Mojo 경로에서 릴리스 문구의 coalescing을 활성 상태로 가정하는 해석은 반증된다. 반면 `CPU encoding 20.67 + GPU busy 19.80 = 40.47ms`처럼 합산하면 잘못이다. 두 구간은 겹치고 전체 call mean은 29.58ms다.

| Mojo stage, 30-call 평균 | compute dispatches | CPU encoding wall ms | command-buffer GPU busy ms |
| --- | ---: | ---: | ---: |
| Embedding + PLE setup | 4 | 0.186782 | 0.427918 |
| Residual/norm | 121 | 5.940472 | 2.438274 |
| QKV | 24 | 1.151156 | 1.786480 |
| Norm/RoPE | 24 | 1.192065 | 1.351555 |
| Attention | 24 | 1.191814 | 3.573626 |
| Attention-out, cast 포함 | 48 | 2.269374 | 1.931288 |
| FFN | 72 | 3.540974 | 6.059921 |
| PLE | 96 | 4.721210 | 2.107387 |
| Pooling/output | 4 | 0.203192 | 0.125593 |
| **compute 합** | **417** | **20.397039** | **19.802042** |

llama의 전체 forward GPU busy는 12.691690 ms, input은 1.910858 ms, completion은 0.002240 ms다. 한 compute encoder 내부의 QKV/FFN/attention 세부 분할은 자료에 없으므로 대응 값을 만들지 않았다. shader timeline은 sampled intervals이며 **dispatch 수가 아니고**, interval의 합을 각 stage의 정확한 shader 실행 시간으로 쓰지 않는다. GPU busy 자체도 Mojo가 더 크므로 “수학에는 더 이상 개선 여지가 전혀 없다”는 결론까지 나아가지는 않는다.

| 과제의 가설 | 추가 trace 이후 판정 |
| --- | --- |
| (a) FP16 대 Q8의 weight bandwidth | bytes 차이는 확인. **bandwidth-bound라는 진단은 미확인**; DRAM counter 없음 |
| (b) 작은 M에서 submission/encoding 비용 | **op별 buffer/encoder·큰 encoding wall·queue idle 확인**. 병합 후 실제 이득은 통제 ablation 필요 |
| (c) throughput용 tile의 M=82 낭비 | geometry 근거는 있음. 실제 tile별 occupancy·시간 기여율 미확인 |
| (d) PLE/head-width occupancy | PLE stage 비용은 관측. 원인이 gather/occupancy라는 주장은 미확인 |

### 기존 정확도 자료 재계산

마지막 A/B의 `q8-gate.json`과 `mojo-gate.json`을 읽어 20개 cosine을 확인했다. **min 0.999701849487, mean 0.999928046554**, 최종 768-d normalized vector 전체의 **max absolute difference 0.002901162021**이다. raw 512-d mean-pooled vector는 export되어 있지 않아 그 차이는 미확인이다.

| fixture | cosine | fixture | cosine |
| --- | ---: | --- | ---: |
| 1 | 0.999906731 | 11 | 0.999963560 |
| 2 | 0.999886149 | 12 | 0.999959048 |
| 3 | 0.999888778 | 13 | 0.999965036 |
| 4 | 0.999930369 | 14 | 0.999952931 |
| 5 | 0.999947022 | 15 | 0.999961990 |
| 6 | 0.999934989 | 16 | 0.999956671 |
| 7 | 0.999933654 | 17 | 0.999962797 |
| 8 | 0.999903676 | 18 | 0.999942905 |
| 9 | 0.999961311 | 19 | 0.999956186 |
| 10 | 0.999701849 | 20 | 0.999945278 |

### 원인 순위와 정량 근거

### 1위 — command-buffer 분할·CPU encoding·GPU idle: trace로 구조 확인, 개선량은 ablation 필요

**[코드]** 현재 normal path를 소스 수준에서 세면 아래와 같다. `mm()`에는 FP32→FP16 cast와 matmul이 들어가므로 2회로 센다.

| 범위 | 최소 kernel enqueue 수 |
| --- | ---: |
| gather + 공유 PLE projection/cast + RMSNorm | 4 |
| 층별: pre-norm, QKV, head norm/RoPE, attention | 4 |
| 층별: O cast/GEMM + residual norm | 3 |
| 층별: FFN pre-norm, gate/up GEMM, GeGLU/cast, down GEMM, residual norm | 5 |
| 층별: PLE gate cast/GEMM, gate/cast, projection GEMM, residual norm | 5 |
| 마지막 norm + pool + output cast/GEMM + L2 | 5 |
| **합계** | **4 + 24×17 + 5 = 417** |

복사·초기화·profile fence는 제외다. MAX matmul 내부 split-K partial/reduction 등이 추가되면 실제 dispatch 수는 늘어난다. README의 원래 607→현재 417과 일치한다. **417개 enqueue ≠ 417개 command buffer ≠ 417개 CPU/GPU 동기화**다.

**[외부]** [MLX discussion #3939][S3]의 단일 M3 Ultra 개발자 측정은 가벼운 op당 수 µs, 불리한 skinny shape에서 약 12–17 µs의 잔여 고정 비용을 보고한다. 실제 dispatch 분모를 capture하지 않은 한계가 있어 **M5의 확정적 per-launch 값으로 인용할 수 없다**. 이 근거에서 감도 분석 범위만 얻는다.

| 가정한 경계 비용 | 417회 합 | 26.59 ms 대비 |
| --- | ---: | ---: |
| 3 µs | 1.251 ms | 4.7% |
| 6 µs | 2.502 ms | 9.4% |
| 10 µs | 4.170 ms | 15.7% |
| 17 µs, 불리한 shape의 예시 | 7.089 ms | 26.7% |

7.23 ms 격차를 전부 설명하려면 `7.23ms/417 = 17.34µs`의 **추가 비용**이 매 enqueue마다 필요하다. llama.cpp에도 dispatch가 있으므로 위 합 전체가 상대 개선 가능량은 아니다. “전체 26.59 ms가 launch”라면 평균 63.76 µs가 필요한데, 현재 근거로 뒷받침되지 않는다.

**[릴리스 문구와 실측 구분]** [MAX v26.5 release note][S2]에는 연속 Metal launch를 shared command buffer에 합치는 기능이 명시되어 있다. 하지만 위 26.7rc2 direct 경로의 trace는 실제로 425 buffers를 보인다. cap 설정을 바꾼 통제 실험은 아직 없다. [Apple의 command-buffer 권고][S1]도 “GPU를 굶기지 않는 범위에서 최소 제출”이며 무조건 전부 인코딩한 후 submit하라는 뜻이 아니다. CPU encoding과 GPU 실행의 overlap을 없애면 첫 작업 시작이 늦어질 수 있다.

**[더 직접적인 외부 증거]** [Modular #6943][S34]은 M5 Max/MAX 26.5의 trace에서 여전히 op당 한 buffer를 관측하고 `MODULAR_METAL_MAX_OPS_PER_COMMAND_BUFFER` unset/64/1에서 유의한 개선이 없었다고 보고한다. 릴리스 문구가 이 실행 경로의 활성 증거가 아니라는 구체적 사례다. [#6899][S35]의 M4 direct `DeviceContext` 측정은 outstanding 64회까지 enqueue 6–7µs, 이후 14–17µs를 보고하며 queue-depth 제한·op당 command buffer·동일한 graph-builder 거절을 함께 기록한다. 다른 장치의 과거 결과지만 이 엔진의 417회 연속 enqueue에 잘 맞는 가설이다. 단순 예시 `64×6.5µs + 353×15.5µs ≈ 5.89ms`는 **M5 실측이 아니고**, CPU/GPU overlap 때문에 그대로 wall time에 더할 수도 없다. 해당 epic이 closed여도 일부 완료 조건은 후속 설계/추적이므로 batching 수정이 모든 경로에 배포됐다고 해석하지 않는다.

### 2위 — 작은 GEMM의 tile·grid·경계 처리 효율: 가능성 높음, 기여율 미측정

**[코드/외부]** [Modular Apple GEMM][S5]는 64×64 출력 tile, threadgroup당 128 threads·4 SIMD groups, SIMD group당 32×32 subtile을 사용하는 M5 경로를 설명한다. 작은 출력 grid와 깊은 K에는 split-K 경로도 있다. 공개 main은 실험 wheel의 내부 구현과 동일하다고 보장할 수 없으므로 실제 lowered kernel·grid는 capture로 확인해야 한다.

**[계산/추론]** 82행을 64행 tile로 덮으면 128행 영역 중 유효 행 비율은 `82/128 = 64.06%`; 32행 단위로만 보면 `82/96 = 85.42%`다. 범위 밖 subtile이 생략될 수 있으므로 35.94%가 실제 낭비된다는 측정은 아니다. QKV N=2048/3072, FFN N=4096, O·down·PLE N=512인 출력 grid의 크기도 다르다. N=512이면 64 tile 기준 약 `2×8=16` threadgroups뿐이다. 한 wave에서 끝나는 작은 grid와 부분 tile은 GPU를 충분히 채우기 어렵다.

packed 100문단의 M=8200에서는 이 효과가 크게 희석된다. 같은 코드가 batch에 유리하면서 단일에 불리한 현상과 맞는다. 다만 마지막 A/B의 배치 실패까지 이 가설 하나가 설명하지는 않는다.

**[외부 반증 가능 근거]** [MLX #4198][S6]은 M5에서 M=32보다 M=33이 약 21% 빠른 경계 현상을 dependent-chain으로 보고했고, [#4720][S7]은 2026-10-17 기준 N=4096·M=16–64에서 split-K가 NAX 경로를 밀어내는 사례를 보고한다. 이는 Mojo에도 같은 버그가 있다는 증거가 아니라, **GPU generation·shape별 dispatch 선택이 byte 수보다 중요할 수 있다는 실측 사례**다.

### 3위 — FP16 weight traffic와 Q8의 bandwidth 이점: 기여는 타당, 단독 원인 설명력 낮음

**[외부/코드]** GGML `Q8_0`는 32개 값마다 int8 32 bytes + FP16 scale 2 bytes, 즉 **1.0625 bytes/weight**다. `Q4_0`는 16-byte nibble + 2-byte scale, **0.5625 bytes/weight**다. [블록 정의][S10]를 기준으로 했으며 Q4_K·NVFP4·AWQ 포맷에는 다른 metadata 비용이 있다.

**[계산]** 위 136,708,096 dense weights를 각각 한 번 읽는다고 가정한 논리 traffic이다. embedding gather·norm gamma·activation·attention·반복 tile load는 제외한다. [Apple 공식 M5 bandwidth 153 GB/s][S11]를 사용한 이상적 DRAM streaming budget이며 실측 bandwidth가 아니다.

| 포맷 | 논리 bytes | MiB | 153 GB/s에서 전송 시간 |
| --- | ---: | ---: | ---: |
| FP16 | 273,416,192 | 260.75 | 1.787 ms |
| Q8_0 | 145,252,352 | 138.52 | 0.949 ms |
| Q4_0 | 76,898,304 | 73.34 | 0.503 ms |

Q8_0는 FP16의 53.125%, Q4_0는 28.125%다. Q8의 압축률은 scale 포함 약 1.88배이며 정확히 2배가 아니다. FP16→Q8의 한 번 읽기 차이는 **128.16 MB / 153GB/s = 0.838 ms**다. 이 차이만으로 7.23 ms를 설명하려면 유효 대역폭이 약 **17.73 GB/s**이거나 반복 읽기·낮은 활용률 등 다른 손실이 커야 한다.

M=82인 주요 dense GEMM의 유효 연산량은 약 **22.36 GFLOP**다(마지막 출력 projection은 M=1로 계산). 가중치만 고려한 FP16 산술 집약도는 약 82 FLOP/byte다. 1-token decode처럼 거의 순수한 weight streaming이라고 단정할 수 없다. 실제 weight tile을 여러 row tile에서 다시 읽는 경우 논리 traffic은 증가하고, L2/SLC 재사용은 DRAM traffic을 줄인다. GPU counter 없이 어느 쪽도 확정하지 않는다.

양자화로 시간이 절반이 되는 것은 아니다. 예를 들어 전체 시간의 40%만 압축으로 절반이 된다면 Amdahl 이득은 `1/(0.6+0.4/2)=1.25배`이고, 26.59 ms는 21.27 ms로 여전히 Q8 기준보다 느리다. dequant 비용과 tile 효율 저하가 있으면 이득은 더 줄어든다.

### 4위 — attention의 register 압력·짧은 grid, PLE의 작은 projection: 국소 후보

**[코드]** online attention은 query/head마다 한 SIMD group을 쓴다. 82토큰×4heads=328 SIMD groups, block=128threads이면 **82 threadgroups/layer**다. 256-d에서는 각 lane이 Q와 output accumulator 각각 8 FP32값, 512-d에서는 각각 16값을 유지한다. 다른 임시값을 제외해도 기본 live state가 16→32 FP32값/lane으로 늘어난다. [Apple의 register/occupancy 설명][S12]과 부합하지만 실제 spill·occupancy 하락은 측정되지 않았다.

attention의 QK/PV 산술은 대략 `20×4×4×82²×256 + 4×4×4×82²×512 = 0.771 GFLOP`다. dense보다 작아도 softmax·exp·reduction·load·낮은 병렬성 때문에 시간이 클 수 있다. 82토큰에서는 ±512 window가 전 토큰을 포함하므로 local/full의 key 범위가 같고, head dimension·KV head 수 차이가 주로 남는다.

또한 현재 구현은 각 query/head가 82개 key를 순회하며 `peak/denom/accum`을 갱신한다. key마다 rescale과 probability를 위한 두 `exp` 및 accumulator update가 이어진다. 이 직렬 의존성과 scalar 연산은 register 점유율과 별개인 지연 후보다. block 단위 online softmax·QK/PV MMA가 유리할 수 있으나, FLOP 수만으로 이득을 예측하지 않는다.

PLE는 공유 setup에 이어 층당 512×512 projection 두 개와 norm/gate가 있다. 48개 작은 GEMM·부수 dispatch는 후보지만, 거대한 lookup table의 bandwidth 병목이라고 볼 증거는 없다. [최종 fenced profile](MOJO-ENGINE-OPTIMIZATION.md)의 100-sequence FFN 295.48 ms·attention 236.34 ms·PLE 100.69 ms는 **배치+stage-fence** 결과라 단일 문단 비중으로 옮기지 않는다.

### 경쟁 설명과 배제 범위

- Python interpreter가 각 op를 호출하는 구조가 아니다. C ABI로 호출하는 Mojo shared library다. MAX의 그래프 compiler 사용 여부와 “Mojo로 작성됨”은 별개다.
- normal path에서 per-layer readback/fence는 없다. “매 층 synchronize 제거”를 이미 수행한 개선으로 다시 제안하지 않는다.
- graph replay probe는 pinned Metal context에서 거절되었다. 이것은 CUDA-style `DeviceGraphBuilder` 미지원 증거이며, **Metal ICB·MPSGraph·MAX 고수준 graph가 전부 불가능하다는 증거는 아니다**.
- profiling·다른 worker의 compile·GPU 사용·열 상태는 상대 수치를 바꿀 수 있다. batch 92.55–119.75/s의 변동은 통제된 재측정이 필요한 이유다.

## 절제 실험 (Ablations)

기존 측정은 탐색 결과다. FP16과 buffer reuse를 함께 바꾼 117.88→23.55 ms, projection/epilogue fusion의 23.55→38.86 ms는 단일 요인 효과나 인과적 speedup으로 해석할 수 없다. online attention·shared-SRAM 시도 역시 서로 다른 시점의 전체 gate이며 통제된 반복 CI가 없다. 후속 표는 submission만 변경, precision만 변경, tile만 변경, fusion 하나만 변경, batch-size만 변경하는 arm을 각각 분리하고 같은 Q8 baseline과 교차해야 한다. 현재 이러한 통제 ablation의 median/IQR/CI는 **미측정**이다.

## 논의

### 해결책의 우선순위: 기대 이득과 구현 비용

아래 이득은 **조건부 예상**이다. 1.5배·2배라는 외부 논문 결과를 이 엔진의 목표치로 보장하지 않는다.

| 우선순위 | 후보 | 기대 이득과 노력 | 근거·실패 위험 |
| --- | --- | --- | --- |
| P0 | normal-path capture와 작은 GEMM의 실제 경로 확인 | 낮은 구현 비용; 잘못된 대규모 최적화를 막음 | 417 enqueue의 실제 kernel·submit·idle·copy를 분리. stage fence 추가 금지 |
| **P1, 첫 수정 실험** | **실제 command-buffer/encoder 병합**: Rust host/허용된 ObjC shim 또는 runtime 경로 | 중간–높음 비용; trace상 425 대 3 분할과 queue idle을 직접 겨냥. 개선 크기는 H1로 측정 | [S1, S2, S34, S35]. cap이 no-op면 host/runtime 작업 필요. GPU hazard·CPU/GPU overlap 보존 |
| P1 | **M=82용 skinny GEMM**: 16/32/64행 tile, direct MMA와 split-K A/B; M=1 최종층은 GEMV | 중간 비용; 주요 GEMM이 전체의 50%이고 1.5배 빨라지면 전체 약 16.7% 단축 | [S4–S7, S9]. 무조건 M≤128 GEMV는 피하고 K/N별 선택; split-K의 추가 reduction/dispatch 비용 포함 |
| P1 | **기존 공식 W8A16 경로부터 검토**, 이후 Q8_0-compatible dequant-in-kernel skinny GEMM | 중간 비용; traffic가 병목인 층에서 유리. 한 번 읽기 계산의 raw 이득은 0.84 ms | [S13–S15]. FP8과 Q8_0는 다른 포맷; BF16 activation 전환·scale 처리·정확도 재검증 필요 |
| P1–P2 | macOS 27 TensorOps의 quantized `matmul2d` 소규모 비교 | 중간 비용; 표준 저정밀 경로를 직접 활용할 수 있으면 custom decode를 줄임 | [S33]. Mojo wrapper/lowering 지원 미확인; GGML scale/packing과 native tensor format의 불일치 확인 |
| P1 | 작은 norm/cast/pointwise 경계를 줄이는 제한적 fusion | 중간 비용; 48 dispatch를 줄이면 3–10µs 가정에서 0.14–0.48 ms의 기회 규모 | QKV/GeGLU fusion은 이미 존재. whole-row RMS는 tile reduction과 다른 문제; 잘못 합치면 parallelism 상실 [S3] |
| P2 | 불변 binding·argument table·command allocator 재사용 | 중간 비용; 제출 병합 뒤 남는 encoding 비용에 대응 | [S16]. 이득은 동일 dispatch payload의 host 시간으로 측정 |
| P2 | 82-query attention의 tiled QK/PV·작은-head/큰-head 별 kernel | 중간–높음 비용; 해당 stage가 커야 전체 지연 개선 | [S8, S12, S17]. exact online softmax 유지, 256/512 d·GQA·bidirectional mask 지원 필요. 기존 shared-SRAM 시도는 배치 실패 |
| P2 | W4A16: Q4_0 또는 groupwise INT4/NVFP4 | 높음; bandwidth 이점이 크지만 dequant가 MMA를 방해할 수 있음 | [S14, S15, S18]. Q4의 기존 ≥0.999 gate 통과는 미확인. calibration·검색 품질·INDEX_VERSION 필요 |
| P3 | 정적 Metal compute ICB / MAX compiled graph / MPSGraphExecutable | 높음; CPU encoding이 큰 경우 host 비용 감소 | [S19–S21]. ICB는 GPU dispatch 경계 자체를 없애지 않는다. shape별 recording·pointer lifetime·barrier·residency 계약 필요 |
| P3 | per-block persistent kernel → 전체 megakernel | 매우 높음; 경계와 memory bubble이 측정상 클 때 투자 | [S22, S23]. NVIDIA 연구 코드의 직접 이식이 아님. cross-threadgroup synchronization·register·watchdog·교착 위험 |
| P3 | Core ML / ANE encoder 별도 구현 | 높음; 짧은 encoder 지연·에너지 최적화 후보 | [S24, S25]. 전 모델이 ANE에 놓인다는 보장 없음. gather·RoPE·GeGLU·PLE·norm 변환과 fallback copy 비용 검증 |
| P4 | embedding/가상의 PLE lookup table 양자화 | 메모리 목표라면 가치 있음; 현재 단일 지연 이득은 낮을 가능성 | sparse gather 164 KiB. 실제 PLE projection을 최적화하는 것과 구분 |
| 운영 대안 | batched indexing은 Mojo, single query는 llama.cpp | 이론상 각 장점 활용; **현재는 채택 근거 부족** | 마지막 측정은 Mojo batch도 패배. 서로 다른 precision의 vector space를 조용히 혼용할 수 없음 |

### 4.1 양자화: “파일을 줄임”과 “실행 중 읽는 양을 줄임”은 다르다

로드 시 Q8/Q4를 FP16 전체로 풀어 현재 GEMM에 넣으면 저장/로드 비용은 줄어도 warm forward traffic는 그대로다. 성능 실험은 packed weights를 유지하고 각 tile 안에서 unpack/dequant하거나 hardware가 지원하는 low-precision operand를 직접 읽어야 한다.

[공식 Apple kernel API][S13]에 이미 `matmul2d_fp8`(W8A16), `fp4_matmul`/`matmul2d_fp4`(W4A16), M=1 전용 FP8/FP4 GEMV가 있다. [FP8 구현][S14]은 bf16 activation·FP8 B·FP32 output을 명시한다. **기존 Q8_0 bytes를 그대로 넣을 수 없고, API 존재만으로 현재 wheel에서 import/성능/정확도가 확인된 것은 아니다.** FP8을 먼저 시도하더라도 Q8_0 oracle와의 직접 비교를 별도로 유지한다.

더 최신인 [WWDC26 Metal tensors 세션][S33]은 macOS 26의 INT4/INT8에 이어 macOS 27의 FP4/FP8·INT2, quantized `matmul2d`, scale plane을 설명한다. custom format이면 cooperative tensor에서 dequant해 threadgroup-memory 왕복을 줄이는 경로도 제시한다. 이 장치는 macOS 27이므로 **직접 TensorOps 경로를 작은 projection 하나에서 비교할 가치가 있다**. native scale plane의 E8M0·block layout과 GGML의 FP16 scale은 같지 않다. 현재 Mojo intrinsics가 이 API를 노출하는지는 별도 확인해야 하며, 지원하지 않으면 작은 Metal reference harness에서 먼저 상한을 잰다. 같은 세션의 cooperative-tensor softmax/reduction 예제는 attention fusion의 구현 참고 자료이기도 하다.

[NVFP4 구현 설명][S15]은 packed nibble와 block scale을 threadgroup에서 협력 decode하고 MMA가 재사용하도록 한다. scalar dequant와 MMA의 overlap에 한계가 있음을 명시한다. [Marlin][S18]의 핵심도 offline layout·가중치 reuse·dequant/MMA 균형이다. CUDA tensor-core·async-copy·shared-memory 전략은 Apple에서 다시 검증해야 한다. [AWQ][S26]는 정확도 보존의 calibration 접근이며 이 모델의 한국어 검색 품질 보증은 아니다.

### 4.2 command buffer·ICB·megakernel은 해결하는 비용이 다르다

1. **한 command buffer에 여러 dispatch**: command 제출/관리 비용을 줄인다. GPU의 dependent kernel 경계와 메모리 재시작 비용은 남는다.
2. **ICB에 정적 compute commands 기록**: 반복 host encoding을 줄이는 수단이다. `MTLIndirectComputeCommand`의 binding·dispatch·barrier 제약을 따르고 불변 weight/scratch 주소를 유지한다. allocator가 capacity를 늘리면 recording을 갱신해야 한다.
3. **compiled model graph**: compiler의 fusion·memory planning·shape specialization을 활용한다. MAX [고수준 graph compilation][S21]은 거절된 low-level device graph capture와 다른 계층이다. 지원 가능 여부는 작은 block부터 증명한다.
4. **persistent/megakernel**: 여러 op의 작업을 장치 내에서 스케줄하고 경계/weight-load bubble을 줄인다. 하나의 threadgroup에서 모델 전체를 직렬 실행하는 구현은 이에 해당하는 성능 해법이 아니다.

[Hazy의 No Bubbles][S22]는 H100의 작은 autoregressive model에서 CUDA graph 뒤에도 boundary bubble이 남는 것을 보였다. CUDA launch 2.1µs·graph 1.3µs는 **Apple launch 수치가 아니다**. [Mirage MPK][S23]는 SM-task graph·device scheduler로 CUDA mega-kernel을 생성하며 평가 대상은 A100/H100/B200다. Metal backend를 제공한다는 근거로 사용하지 않았다. 따라서 전체 megakernel은 작은 block 실험에서 이득과 안전한 synchronization이 입증된 뒤의 연구다.

### 4.3 Flash-Decoding을 그대로 적용하지 않는 이유

[FlashAttention/FA2][S8, S17]의 tiled exact attention은 후보지만 현재 online-softmax kernel과 동일한 구현이 아니다. 반대로 [Flash-Decoding][S27]은 query 길이 1, 긴 KV context에서 추가 key-axis 병렬화로 낮은 점유율을 해소한다. 여기서는 query 길이 82이고 KV도 82다. split-K attention과 별도 reduction이 오히려 dispatch를 늘릴 수 있다. 먼저 현재 kernel의 시간·register spill을 측정하고, tiled bidirectional prefill과 비교한다. FlashDecoding++의 비동기 softmax도 기준 numerics·안정성 없이 차용하지 않는다.

### 4.4 hybrid routing과 ANE의 채택 조건

Mojo FP16과 llama Q8의 min cosine 약 0.99970은 높은 유사도지만 동일한 embedding contract는 아니다. 기존 제품은 model/quantization/backend/prompt/context 등이 바뀌면 `INDEX_VERSION`을 올려 파생 vectors를 재생성하도록 규정한다. 문서는 FP16, query는 Q8인 혼합 경로를 도입하려면 이를 명시한 하나의 새 index 계약과 검색 품질 검증이 필요하다. 기존 Q8 index에 새 vectors를 일부만 섞는 방식은 권하지 않는다. 두 모델 상주 메모리와 M5 외 fallback도 비용이다.

[Apple ANE Transformer 연구][S24]는 DistilBERT에서 data layout·Conv2D 치환·copy 감소를 통해 짧은 encoder의 낮은 지연을 보였다. 그 수치를 EmbeddingGemma 2나 M5로 환산하지 않는다. Core ML 변환 후 [MLComputePlan][S25]과 Instruments로 ANE 배치/CPU·GPU fallback을 확인해야 한다. GPU 코어 안의 M5 Neural Accelerators와 별도 ANE는 다른 하드웨어다.

`MLComputePlan`의 device usage와 cost는 **예상 계획**이다. 실제 실행 장치와 전환 비용의 증거는 runtime Instruments 측정으로 보완한다.

### Mojo 작업자용 구체적인 실험 순서

### E0 — 정상 경로 타임라인과 재현성 확보: 가장 먼저

고정된 Q8/Mojo 바이너리·소스 hash·toolchain·weights hash·입력 token IDs를 기록한다. 다른 worker의 compile/benchmark와 GPU 측정이 겹치지 않도록 조율한다. cold load, 첫 shape compile, warm forward를 분리하고 Q8→Mojo / Mojo→Q8 순서를 교대로 반복한다. 각 arm은 충분한 warmup 후 최소 30회, 독립된 여러 묶음의 median·p95·분산을 함께 기록한다. 같은 arm의 좋은 실행과 다른 arm의 나쁜 실행을 골라 붙이지 않는다.

82-token 단일과 길이 `1, 8, 16, 32, 64, 80, 82, 96, 128, 256, 512, 1024, 2048`를 구분한다. 주요 목표는 82이고 긴 입력은 회귀/분기 진단용이다. 100문단 동일 입력뿐 아니라 서로 다른 문단·한국어·mixed length도 측정한다. 기존 Q8 batch sweep `4/8/16/24/32/64/100`의 동일 pooling·positions 계약을 유지한다.

**얻을 증거**: Metal System Trace 또는 GPU capture에서 단일 normal forward의 CPU enqueue 구간, command-buffer 개수/commit 시점, encoder 수, 실제 dispatch 수/이름/grid, GPU 첫 시작~마지막 완료, idle gap, copy/readback, 각 주요 kernel GPU duration. capture 영향이 있는 실행과 비계측 gate 실행은 분리한다. stage마다 synchronize한 profile의 합으로 대신하지 않는다. counter 미제공이면 DRAM bytes·occupancy는 미확인으로 남긴다.

**원인 판별**: GPU가 CPU 제출을 기다리는 gap이 크면 E1, GPU가 끊임없이 일하지만 작은 matmul이 길면 E2, dense stage의 실제 DRAM traffic가 크면 E3, attention이 큰 비율이면 E4를 우선한다. 서로 겹치는 시간은 단순 합산하지 않는다.

### E1 — 제출 비용: coalescing이 실제로 작동하는지 확인

설치된 runtime이 지원하는 공식 op-cap 제어를 먼저 확인하고, default / 소수의 더 큰 cap / 가능한 단일 묶음의 submit 수를 측정한다. 공개 issue [S34]의 `MODULAR_METAL_MAX_OPS_PER_COMMAND_BUFFER`도 pinned runtime에서 실제로 읽히는지와 submit 수 변화부터 확인한다. 환경 변수 이름이나 지원을 추정해 no-op 설정으로 실험하지 않는다. 동일 kernel을 유지한 채 submit 수만 바꾼다. GPU gap·host encoding·전체 median이 함께 줄어야 가설이 지지된다. submit 수만 줄고 지연이 같으면 이 경로의 우선순위를 내린다.

direct `DeviceContext`에 batching API가 없고 cap도 무효라면, Mojo host loop를 정리하는 것만으로 해결됐다고 하지 않는다. runtime의 실제 batch-encoding 경로를 노출하는 upstream 수정 또는 명시적인 Metal host/ICB 경로가 필요할 수 있다. 이 경우 엔진 한 파일의 낮은 비용 수정이 아니라 runtime/host 경계 작업으로 추정 노력을 올린다. 여러 dependent dispatch를 묶더라도 중간 buffer 재사용의 memory hazard·barrier는 보존한다.

별도 작은 harness에서 정상 호출과 동일 queue/runtime로 `T(K)=intercept+K×slope`를 K=1/16/64/256에 맞추되 dependency가 있는 tiny kernel chain과 최소 메모리 kernel을 사용한다. CPU enqueue 시간과 한 번의 최종 fence를 분리한다. slope는 body work도 포함하므로 “순수 driver launch”라는 이름으로 보고하지 않는다. llama의 실제 dispatch 수와 gap도 함께 비교한다.

### E2 — quantization 전에 M=82 matmul 선택을 분리

실제 shape를 그대로 사용한다: `(M,K,N)=(82,512,2048/3072/4096/512/12288)`, `(82,1024/2048,512)`, 마지막 `(1,512,768)`. FP16 유지 상태에서 direct MMA / split-K / 더 작은 M tile를 비교한다. split-K 추가 reduction 비용과 actual grid를 함께 적는다. K=512의 작은 PLE에 큰 split-K를 강제하지 않는다.

독립 matmul을 많이 enqueue한 throughput microbenchmark와 **이전 결과를 다음 입력으로 쓰는 dependent chain**을 구분한다. 원래 shape가 비정방이면 고정 projection/normalization을 동일하게 넣은 model-block chain으로 측정한다. [MLX #4265][S28]는 독립 호출 benchmark에서 좋아 보인 kernel이 실제 model을 26% 느리게 만든 반례와 dependent-chain 재측정을 공개한다.

**입증 기준**: M=82 주요 stage GPU duration 감소가 비계측 전체 지연에도 반영되고, 같은 값으로 20 singles·mixed batch·100 packed·작은 호출 after workspace growth가 통과해야 한다. 아주 작은 최종 GEMV만 빨라졌다면 전체 해결로 보고하지 않는다.

### E3 — W8 먼저, Q4는 그 다음

첫 범위는 전체 변환기가 아니라 **한 FFN gate/up 또는 down projection**이다. (a) 현재 FP16, (b) 공식 FP8 W8A16 또는 실제 사용 가능한 Q8_0-compatible fused kernel, (c) 동일 low-bit weights를 미리 FP16으로 풀어 기존 GEMM에 넣은 control을 비교한다. (b)와 (c)를 비교하면 precision 변화와 packed traffic 이득을 구분하기 쉽다. packing/initial upload는 warm timing 밖, call별 dequant·cast·scale kernel은 안에 포함한다.

**입증 기준**: 실제 packed bytes 유지, stage 시간 감소, GPU traffic 감소가 가능하면 counter로 확인, 각 projection 오차와 최종 cosine 모두 통과. FP8→BF16 operand 변경은 별도 오차 원인이다. E2×E3의 2×2 실험으로 shape tuning과 quantization의 효과를 분리한다. 통과한 층부터 확장하고 Q4는 representative calibration corpus와 gate를 추가한 다음 진행한다. min cosine ≥0.999 외에 query/document retrieval 순위·Recall@k 변화도 기록한다.

### E4 — attention/PLE에 시간 비례로 투자

현재 online kernel과 tiled non-causal attention을 82/512/2048 길이·256/512 head별로 비교한다. head 수만 보고 부족하다고 하지 말고 82 threadgroups·live register·spill·GPU duration을 확인한다. 기존 shared-SRAM 실패를 반복하기보다 query tile reuse와 MMA 경로의 차이를 명시한다. ±512의 **양방향** window, sequence boundary, reset position, full layers 5/11/17/23을 그대로 유지한다.

PLE는 512×512 두 projection과 pointwise를 각각 계측한다. whole-row norm은 tile epilogue에서 reduction이 완성되지 않을 수 있으므로 partial reduction 또는 중복 계산의 비용을 포함해 비교한다. fusion 개수보다 전체 latency가 기준이다. norm·residual을 cast와 공유하는 작은 변경부터 시도한다.

### E5 — 단순 변경의 개선 한계가 보인 다음

E0에서 CPU encoding이 크면 82-token 고정 shape에 compute ICB 또는 compiled block graph 하나를 시험한다. E0에서 GPU boundary bubble이 크면 **한 transformer block** persistent scheduler를 먼저 만든다. 1 block이 기존보다 빠르고 numerics·threadgroup synchronization을 검증한 뒤에만 24층으로 확장한다. host loop를 kernel 안의 단일 row loop로 옮기는 것만으로는 충분하지 않다.

Core ML/ANE는 별도 실험 lane으로 다룬다. 먼저 82/128-token 고정 shape 한 개를 변환하고 마지막 768-d·mean pooling·L2 norm까지 동일하게 비교한다. CPU/GPU fallback, compile/load, warm latency, 전력, 한국어 query 품질을 보고한다. 서버·HTTP 오버헤드를 포함한 MLX embedding server 수치를 C ABI forward와 직접 비교하지 않는다. [oMLX #266][S29]도 idle 후 graph 재준비가 latency처럼 보일 수 있음을 보여주는 운영상의 경고다.

이 issue의 후속 기록은 compile 경로의 개선과 함께 2초 주기 keepalive forward가 높은 GPU 사용량 때문에 제거된 사실도 담고 있다. 지연 수치를 유지하기 위한 상시 warmup은 이 앱의 idle 메모리·배터리 정책을 대체할 해법으로 삼지 않는다.

### 채택/중단 기준

기존 두 speed gate와 모든 20-case ≥0.999 기준을 유지한다. 과거 baseline이 아니라 **같은 실행 묶음의 새 Q8 best batch**와 비교한다. 통과해도 long-window·repeated load/unload·오류/취소·M5 외 fallback·packaged app·서명/구버전 OS 실행은 별도 gate다. 이번 연구는 새 속도 기준이나 제품 라우팅 정책을 채택하지 않았다.

### 언어별 장점으로 푸는 방법

**범위 변경:** Swift host 실험은 사용자 요청으로 취소되었다. 아래 Swift 비교는 문헌상의 비교로만 남기며 Swift host를 구축·권고 실행하지 않는다. ObjC shim은 별도 후보로 유지한다.

언어 선택의 목적은 **이미 빠른 GPU 수학을 보존하면서 command encoding/submission을 제어하는 것**이다. Rust·Swift·Zig·C 중 어느 언어가 같은 Metal API를 몇 ns 더 빠르게 호출하는지는 이번 조사에서 측정되지 않았다. 이 차이에 관한 보편적 순위를 만들지 않는다. 모든 커널을 한 host 호출 안에서 인코딩하면 언어 간 FFI 경계는 문단당 한 번이고, Metal dispatch 자체는 여러 번이다. 반대로 Rust가 기존 Mojo `embed()`를 그대로 부르는 wrapper는 내부 command-buffer 분할을 바꾸지 못한다.

### 6.1 모든 hybrid의 선행 조건: Mojo 커널을 다른 host가 인코딩할 수 있는가

**[관측: 설치된 CLI]** 이 연구에서 컴파일 없이 실행한 명령은 다음과 같다.

```sh
/private/tmp/ib-mojo-spike/venv/bin/mojo build --help
/private/tmp/ib-mojo-spike/venv/bin/mojo build --print-supported-accelerators
```

현재 1.2.0rc2 help에는 `--emit air`가 있고, 설명은 **Metal kernel마다 optimized Apple AIR bitcode `.air`와 host LLVM bitcode를 출력**한다는 것이다. target 목록에는 `apple-m5-metal4`도 있다. 오래된 [compilation 문서][S36]의 `--emit asm → Metal .ll sidecar`보다 현재 로컬 CLI가 더 구체적이다. [Modular 개발자 설명][S30]도 Mojo→LLVM/AIR→MetalDeviceContext→metallib 순서를 설명한다. 즉 **AIR를 내보내는 compiler 기능은 확인**, 그 AIR가 독립 host에서 정상 작동하는 **완결된 export 계약은 아직 미검증**이다.

[Apple Metal tool 문서][S37]는 `.air`를 `.metallib`로 묶는 경로를 제공한다. 따라서 다음은 구현 작업자가 시도할 **실험 명령의 형태**다. 이번 연구에서 실행한 명령이 아니며 새 파일을 만들지 않았다.

```sh
# 외부 임시 디렉터리의 최소 커널 harness에서 실행할 예시.
mojo build --target-accelerator=apple-m5-metal4 --emit air kernel_probe.mojo
xcrun -sdk macosx metallib emitted_kernel.air -o kernel_probe.metallib
```

여기서 `emitted_kernel.air`는 실제 출력 이름으로 바꿔야 한다. AIR를 얻거나 link에 성공한 것만으로 forward export 성공이라고 하지 않는다. 필요한 확인은 다음과 같다.

1. `MTLLibrary`가 load되고 기대한 kernel entry를 나열할 수 있는가. specialization별 이름을 고정 manifest로 기록할 수 있는가.
2. buffer slot/argument-buffer 구조, scalar 크기·alignment, threadgroup size·shared memory, function constants와 pointer의 GPU address 의미가 보존되는가. `Pointer`/`TileTensor`를 Metal의 평범한 buffer slot과 같다고 추정하지 않는다.
3. MAX runtime 내부 helper 또는 숨겨진 binding에 의존하는가. 단순 vector kernel, 현재 MMA GEMM, attention을 각각 smoke test한다.
4. host가 직접 만든 persistent `MTLBuffer`를 bind해 같은 출력이 나오는가. **기존 Mojo C ABI export는 CPU entrypoint**이므로 그 주소를 GPU kernel로 쓰는 방식은 성립하지 않는다.

이 gate가 통과하면 Mojo는 SIMD·compile-time specialization·MMA·portable kernel authoring에 남기고 Rust/ObjC/Swift/Zig가 encoding을 맡을 수 있다. 실패하면 선택지는 runtime batching API의 upstream 수정, 필요한 kernel의 MSL/TensorOps 이식, MPSGraph/Core ML이다. 단순히 host 언어를 추가해 export 문제를 감추지 않는다.

### 6.2 host 후보 비교

| 후보 | 이 문제에서의 장점과 근거 | FFI·encoding·Tauri 통합 비용 | 판단 |
| --- | --- | --- | --- |
| **Rust + objc2-metal** | 앱의 기존 Rust engine actor·취소/메모리 수명 관리 재사용. [objc2-metal][S38]은 command queue/buffer/encoder와 Metal 4 API를 제공; [Rust C ABI][S39]로 기존 경계와 연결 가능 | 새 compiler 불필요. crate/features·macOS cfg·unsafe Metal resource lifetime 검토는 추가. `MTLBuffer` 내부 타입과 GPU 완료 전 수명은 Rust 타입만으로 보장되지 않음. 한 forward 안에서 loop를 실행하면 per-op 외부 FFI wrapper 불필요 | **제품 host 1순위**, AIR export가 먼저 |
| **C ABI + Objective-C/Objective-C++** | [ggml Metal context][S32]와 같은 Apple SDK의 직접 경로. 한 command buffer·serial [compute encoder][S40]에 여러 `setBuffer/dispatch`를 인코딩 가능. C++가 필요하면 [Metal-cpp][S41]도 공식 선택지 | 작은 `.m/.mm` static library를 Rust에 링크하면 문단당 C ABI 한 번. clang/Xcode는 이미 있음. manual ownership 또는 ARC 경계·NSError·autoreleasepool·build integration이 필요 | **가장 작은 native reference/prototype 대안**. Rust binding 문제 시 작은 shim 우선 |
| **Swift** | Apple Metal·MPSGraph/Core ML 예제와 API 직접 사용. 설치된 Swift 6.4 확인. [SE-0495][S42]의 `@c`가 Swift 6.3에 구현돼 C-callable 진입점을 공식화 | Rust→C-compatible entry 한 번, 이후 Swift 안에서 encoding. ARC·bridging과 Swift runtime/dylib closure, swiftc build/link 단계·deployment target 감사 필요. string/array 변환을 dispatch loop에 넣지 않음 | **host 실험 취소**. 문헌 비교로만 남기며 현재 실행 후보에서 제외 |
| **Zig** | [공식 C interop/export/comptime][S43]로 작은 C ABI host·정적 operation table 생성 가능. [zig-objc][S44]도 ObjC runtime 호출 경로를 제공 | 이 환경에서 Zig는 PATH에 없음. 설치·version pin·SDK/ObjC binding·Rust↔Zig ownership/build 추가. 같은 Metal 호출이 Rust/ObjC보다 빨라진다는 측정 없음. comptime은 CPU operation table 구축 비용을 옮길 뿐 GPU submit을 자동 합치지 않음 | 현재 **4순위**. 기존 Zig 기반 host 자산이나 독자적 재현 이득이 생기면 재평가 |
| **Go** | [goroutine/channel][S45], [net/http][S46]로 batch queue·요청 취소·지정 시각의 service orchestration에 적합 | 현재 Go 1.26.1 설치. native Metal 사용에는 cgo/ObjC wrapper 또는 다른 binding 계층 필요. Tauri 안에 추가 Go runtime을 넣거나 별도 process/IPC를 운영하는 비용 | **로컬 Metal host로는 우선하지 않음**. 독립 batch service를 실제로 만들 때 후보 |

**언어별 per-dispatch 비용의 증거 수준:** 현재 직접 비교한 것은 Mojo와 llama.cpp의 서로 다른 submission 경로다. Rust vs Swift vs Zig vs C를 동일 kernel·buffer·encoder·thread에서 비교한 수치는 없다. [Metal-cpp][S41]는 공식적으로 Objective-C와 비교한 추가 overhead가 없는 thin wrapper를 지향하지만, 이것도 본 모델의 전체 latency 측정은 아니다. 각 후보는 동일한 `MTLCommandEncoder` 작업을 수행하므로 **우선 해결할 차이는 425개 수준의 submit 대 소수 submit**이지 언어의 일반적 속도 순위가 아니다.

새 host가 한 `.metallib`와 statically linked 코드를 사용하면 원래 Mojo/MAX dylib closure를 줄일 가능성은 있다. 그러나 kernel의 runtime helper 의존성을 아직 검사하지 않았으므로 제거를 약속할 수 없다. 별도 dylib를 배포하면 install name/rpath·transitive dependency·minos·Developer ID·hardened runtime을 다시 검증해야 한다. `.metallib`도 앱 resource seal에 포함된다. Swift/ObjC/Rust/Zig 어떤 host든 Tauri 종료·취소 중 GPU가 사용하는 buffer/weights를 먼저 free하지 않는 계약을 유지한다.

### 6.3 Go를 어디에 쓰는 것이 맞는가

“Go에는 Metal binding이 없다”는 절대 명제는 사실이 아니다. [go-mtl][S47]은 Go/ObjC wrapper와 compute encoder 예제를 제공한다. 다만 이것의 존재가 M5 Metal 4·모델 kernel export·signing·latency 요구를 충족한다는 증거도 아니다. Apple 공식 Swift/ObjC SDK나 현재 Rust actor보다 이 앱에 이미 통합된 경로가 없다는 것이 낮은 우선순위의 근거다.

[Go runtime의 cgocall 코드][S48]는 scheduler 상태 관리·system stack 전환을 설명하고, [cgo 문서][S49]는 Go pointer를 C가 보관하는 경우의 pin/lifetime 제한을 명시한다. [Go 1.26 release notes][S50]는 baseline cgo overhead가 약 30% 감소했다고 하므로 오래된 “cgo는 언제나 매우 느리다”는 수치를 적용하지 않는다. 417번의 얇은 cgo 호출 대신 C/ObjC에서 전체 encoding을 수행하는 **단 한 번의 coarse call**이면 cgo 비용은 상당히 amortize된다. 그렇더라도 이 작업을 위해 Go runtime과 build 경계를 추가할 이점은 현재 입증되지 않았다.

Go의 실용적 역할은 **독립된 배치 embedding service**다. HTTP 입력 검증, bounded queue, backpressure, 요청 취소, 일정·시간대 기반 작업 실행을 맡고 수학은 native engine/server로 보낸다. 이는 single-paragraph GPU forward의 지연을 줄이는 해법이 아니며 network/serialization·queue 대기 시간이 추가된다. “선택한 시점에 cloud에서 embedding”은 별도의 명시적 opt-in 제품 계약이 필요한 대안이다. 현재 local-first 앱의 노트 전송·cloud 실행·서비스 생성은 이 연구에서 수행하거나 채택하지 않았다.

### 6.4 host를 직접 쓰지 않는 대안

- **MPSGraphExecutable**: 전체 graph를 compile하고 command buffer에 encode한다 [S20]. graph operator로 encoder를 재구성할 비용과 지원/수치 검증이 있으나 수백 개 custom host API 호출의 소유권을 줄일 수 있다.
- **MAX compiled graph**: low-level DeviceGraph replay와 구별한다 [S21]. 다만 [S34]는 `ExecutableModel`에서도 coalescing이 무효인 사례이므로 “compile만 하면 자동 해결”이라고 하지 않는다.
- **Metal 4 command buffer·ML/Tensor APIs**: allocator·argument table·native quantized TensorOps를 활용할 수 있다 [S16, S33]. **host가 전혀 필요 없는 API는 아니다**. runtime 또는 기존 framework가 그 역할을 대신하거나 host code를 줄여 주는 선택지다. reusable command-buffer object를 자동 replay recording과 혼동하지 않는다.
- **Core ML/ANE**: Rust 또는 허용된 native bridge에서 Core ML 모델을 호출하면 모델 내부 kernel encoding을 framework가 맡는다. 기존 6.1의 Mojo kernel export가 불가능해도 독립 경로로 시험할 수 있다. 변환·padding/mask·모든 layer의 실제 placement가 별도 검증 대상이다 [S24, S25].

### 6.5 권고하는 역할 분담과 첫 pass/fail 실험

**권고 순위 [추론]:** (1) **Mojo kernel + Rust Metal host + 기존 Rust actor scheduling**, (2) binding/SDK 문제를 만났을 때만 **작은 ObjC C ABI shim**, (3) graph 재표현을 감수할 **MPSGraph/Core ML lane**(Swift host 실험은 취소), (4) 기존 자산 없이 추가하는 Zig host, (5) 이 앱에 Go runtime을 넣는 host. Go는 별도 service가 필요해졌을 때 다시 선택하며 GPU 수학이나 on-device scheduler의 대체 언어로 먼저 넣지 않는다. 현재 제품 backend는 새 gate 전까지 llama.cpp다.

첫 실험 H0는 **Mojo AIR export→metallib→독립 native host load/bind/dispatch의 작동 증명**이다. vector kernel 한 개에서 시작해 실제 MMA GEMM·attention으로 확장한다. entry/argument layout이 불명확하거나 MAX runtime 없이는 load/execute하지 못하면 **H0 실패**로 기록하고 full-host 구현을 중단한다. CLI의 `--emit air` 존재만으로 통과하지 않는다.

H0가 통과하면 H1에서는 **같은 FP16 weights·같은 Mojo kernels·같은 scratch와 token IDs**를 Rust host 안에서 먼저 한 command buffer·serial compute encoder로 인코딩한다. uploads/readback은 기존과 같은 범위로 포함하고 마지막에 한 번 완료를 기다린다. 그 다음 소수의 chunked buffers도 비교해 CPU/GPU overlap 손실 여부를 확인한다. quantization·attention 수학·tile를 동시에 바꾸지 않는다. trace에서 실제 buffer/encoder 수가 줄고 GPU math duration은 대체로 같은데 idle/submission 시간이 줄어야 원인을 분리한 실험이다.

**최종 pass는 기존 gate 그대로**다: 같은 세션의 Q8보다 82-token warm single median이 낮고, Q8 best batch보다 100문단 throughput이 높고, 모든 20-case cosine이 ≥0.999여야 한다. mixed-length/cross-sequence/window·workspace-growth 회귀도 유지한다. buffer 수 감소는 중간 증거이지 최종 통과가 아니다.

순위를 바꿀 조건도 명확하다. native host가 submit을 줄여도 전체 지연이 좋아지지 않으면 GPU stage·memory·format을 다시 본다. Mojo AOT binding 계약이 불안정하면 Rust+Mojo보다 upstream runtime 수정 또는 MSL/TensorOps가 앞선다. Core ML이 실제 ANE 배치와 같은 수치/검색 품질로 두 speed gate를 통과하면 해당 lane을 올린다. Zig·Go는 동일 Metal workload에서 재현되는 이득과 새 build/runtime 유지 비용을 상쇄할 근거가 있어야 순위를 올린다.

## 타당성 위협

기존 측정은 공유 Mac의 전력·열·다른 작업을 통제하지 못했다. trace는 instrumentation과 sampling에 의해 지연을 바꿀 수 있고, command-buffer GPU busy는 순수 shader arithmetic 시간이 아니다. trace의 CPU encode wall time은 on-CPU sampling이 아니며 GPU 실행과 겹친다. llama의 단일 compute encoder 안에서 층별 GPU split을 얻지 못했으므로 Mojo stage와 숫자를 임의 대응하지 않는다. 20 synthetic inputs의 cosine은 전체 검색 품질·긴 문맥·배포 호환성을 보장하지 않는다. 통제된 5-process 실험과 bootstrap CI는 아직 없다.

## 결론

현재 증거는 command-buffer/encoder를 op마다 만드는 submission 경로를 첫 최적화 대상으로 지목한다. 기존 llama.cpp Q8은 계속 유지하고, Mojo AIR export의 독립 host binding을 먼저 증명한 뒤 **Mojo kernels + Rust Metal host + 기존 Rust scheduling**을 한 요인 실험으로 평가한다. ObjC shim은 필요한 경우에만 사용하고, Swift host는 취소 상태이며 Zig/Go를 추가하는 것 자체는 성능 해결책이 아니다. 정밀도·kernel math 최적화는 submission ablation 이후의 실제 잔여 시간에 맞춰 투자한다.

## 참고문헌과 증거 범위

2026-10-20 공개 web 검색과 격리한 ego lite TaskSpace 45에서 공식 문서·원문·개발자 스레드를 읽었다. 로그인·게시·외부 메시지 전송은 하지 않았다. Discord의 비공개 대화는 접근하지 않았고, 공개 Modular forum [S30]을 사용했다. GitHub issue는 재현 가능한 보고일 뿐 maintainer가 원인을 확정한 것으로 취급하지 않았다.

upstream branch는 계속 움직인다. 조사 중 API로 확인한 HEAD는 Modular `6a2c21ffdf56a2bd57b32dea319c9c5f8ab9bdd2`, MLX `f41bec734ac9fc96723ab7d4e64e385796f15561`, llama.cpp `84663953535d4323e92b4bc90971aa022c305d06`이다. 이들은 실험 wheel 또는 Rust pin과 동일하다는 뜻이 아니다. 실제 llama 기준 구현은 Cargo checkout `llama-cpp-rs cb98c630d0fec934a8a379db4fd63cd3622f6984` 아래의 Metal ops/kernel도 직접 읽었다. Q8가 항상 `mul_mv_q8_0`를 사용한다고 가정하지 않았다. 이 소스는 small-batch 2–8 전용 경로, MMA·mul_mm·mul_mv 분기를 갖고 있어 M=82에서는 capture로 kernel명을 확인해야 한다.

| 출처 | 확인한 내용과 적용 한계 |
| --- | --- |
| [S1 Apple Metal command buffers][S1] | 적은 submit과 GPU starvation 사이의 균형. kernel fusion과 다름 |
| [S2 MAX v26.5 release notes][S2] | coalescing·op cap의 기능 설명. 이 경로의 실제 활성 증거는 아니며 추가 trace와 구분 |
| [S3 MLX discussion #3939][S3] | µs급 잔여 비용·동기화 측정 함정·buffer 병합의 무효 사례. 다른 장치의 제한적 개발자 측정 |
| [S4 MLX quantized.cpp][S4] | shape/GPU별 qmv·qmv_wide·qmm 분기 |
| [S5 Modular Apple GEMM][S5] | 64×64/32×32 tile, direct load, split-K. public main과 wheel 구분 |
| [S6 MLX #4198][S6], [S7 #4720][S7] | M5 작은 shape의 split-K/NAX 경계 현상. Mojo 결함의 직접 증거 아님 |
| [S8 FlashAttention][S8], [S17 FA2][S17] | exact attention의 IO 절감·query tiling·병렬성 원리 |
| [S9 FlashDecoding++][S9] | flat GEMM·padding·dataflow 선택 문제. NVIDIA/AMD 연구 |
| [S10 GGML quant blocks][S10] | Q8_0/Q4_0의 block scale 포함 bytes |
| [S11 Apple M5 발표][S11] | base M5 메모리 bandwidth 153GB/s; 지속 실효 bandwidth 아님 |
| [S12 WWDC20 optimize Metal][S12] | live register·data type·occupancy·spill 고려 |
| [S13 MAX Apple package][S13], [S14 FP8 source][S14], [S15 FP4 API][S15] | 재사용할 공식 low-bit 경로와 dtype/packing 조건 |
| [S16 Discover Metal 4][S16] | command allocator·resource/binding·encoding 모델. 자동 graph replay 보장 아님 |
| [S18 Marlin][S18], [S26 AWQ][S26] | low-bit kernel의 재사용/packing과 calibration. Apple용 binary가 아님 |
| [S19 indirect compute][S19], [S20 MPSGraphExecutable][S20], [S21 MAX graph][S21] | 서로 다른 host encoding·compiled graph 대안 |
| [S22 Hazy No Bubbles][S22], [S23 Mirage MPK][S23] | GPU boundary 제거 연구. CUDA 수치를 Metal 수치로 대체하지 않음 |
| [S24 Apple ANE Transformer][S24], [S25 MLComputePlan][S25] | encoder 배치/layout 사례와 실제 placement 확인 수단 |
| [S27 Flash-Decoding][S27] | Q=1·long-KV 대상임을 확인; 82-token encoder와 구분 |
| [S28 MLX #4265][S28] | independent throughput와 dependent latency의 역전 사례 |
| [S29 oMLX #266][S29] | embedding 서버 warm/idle·graph 준비 비용 구분 |
| [S30 Modular forum][S30] | Apple GPU의 장치별 패턴·최적화 필요. 과거 지원 상태를 현재 제한으로 인용하지 않음 |
| [S31 llama Metal kernels][S31], [S32 Metal context][S32] | dequantized block을 사용하는 matmul과 graph encoding 구조. 실행된 커널은 trace로 확인 |
| [S33 WWDC26 Metal tensors][S33] | 최신 quantized TensorOps·cooperative tensor·attention reduction 경로. Mojo 노출 여부는 별도 |
| [S34 Modular #6943][S34], [S35 #6899][S35] | coalescing 비활성·direct enqueue의 queue-depth 비용·graph 거절의 개발자 측정. closed epic과 모든 수정 배포는 구분 |

보고서 자체 검증: 50개 reference 정의와 사용 일치, 상대 경로 5개 존재, trailing whitespace 없음, dense parameter/FP16·Q8·Q4 byte 수·153GB/s 차이·417회 합산의 assert 검증을 통과했다. 위 내장 Python 재분석 script도 실제 실행하여 기존 JSON만 읽고 수치·20-case correctness를 재계산했다. 고정 commit을 사용한 GitHub source URL 6개는 raw endpoint에서 HTTP 200을 확인했다. 앱 동작을 바꾸지 않는 문서 작업이므로 제품 테스트는 실행하지 않았다.

실행하지 않은 것: 새 GPU benchmark, 새 kernel/graph·양자화·ANE prototype, hardware-counter capture, 앱 통합·테스트·빌드. 본 연구는 지정 보고서만 작성하며 엔진·fixture·manifest를 변경하지 않았다. 추가 trace JSON은 직접 재분석했지만 독립 5-process 반복이나 수정 후 인과적 개선은 아직 증명되지 않았다. Swift host는 취소 상태다.

[S1]: https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/MTLBestPracticesGuide/CommandBuffers.html
[S2]: https://max.modular.com/releases/v26.5/
[S3]: https://github.com/ml-explore/mlx/discussions/3939
[S4]: https://github.com/ml-explore/mlx/blob/f41bec734ac9fc96723ab7d4e64e385796f15561/mlx/backend/metal/quantized.cpp
[S5]: https://github.com/modular/modular/blob/6a2c21ffdf56a2bd57b32dea319c9c5f8ab9bdd2/max/kernels/src/linalg/matmul/gpu/apple/matmul_kernel.mojo
[S6]: https://github.com/ml-explore/mlx/issues/4198
[S7]: https://github.com/ml-explore/mlx/issues/4720
[S8]: https://arxiv.org/abs/2205.14135
[S9]: https://arxiv.org/abs/2311.01282
[S10]: https://github.com/ggml-org/llama.cpp/blob/84663953535d4323e92b4bc90971aa022c305d06/ggml/src/ggml-common.h
[S11]: https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/
[S12]: https://developer.apple.com/videos/play/wwdc2020/10632/
[S13]: https://max.modular.com/stable/api/mojo/linalg/matmul/gpu/apple/
[S14]: https://github.com/modular/modular/blob/6a2c21ffdf56a2bd57b32dea319c9c5f8ab9bdd2/max/kernels/src/linalg/matmul/gpu/apple/matmul2d_fp8.mojo
[S15]: https://max.modular.com/stable/api/mojo/linalg/matmul/gpu/apple/fp4_matmul/
[S16]: https://developer.apple.com/videos/play/wwdc2025/205/
[S17]: https://arxiv.org/abs/2307.08691
[S18]: https://github.com/IST-DASLab/marlin
[S19]: https://developer.apple.com/documentation/metal/mtlindirectcomputecommand
[S20]: https://developer.apple.com/documentation/metalperformanceshadersgraph/mpsgraphexecutable
[S21]: https://max.modular.com/develop/graph/
[S22]: https://hazyresearch.stanford.edu/blog/2025-05-27-no-bubbles
[S23]: https://arxiv.org/html/2512.22219v1
[S24]: https://machinelearning.apple.com/research/neural-engine-transformers
[S25]: https://developer.apple.com/documentation/coreml/mlcomputeplan
[S26]: https://arxiv.org/abs/2306.00978
[S27]: https://pytorch.org/blog/flash-decoding/
[S28]: https://github.com/ml-explore/mlx/issues/4265
[S29]: https://github.com/jundot/omlx/issues/266
[S30]: https://forum.modular.com/t/apple-silicon-gpu-support-in-mojo/2295
[S31]: https://github.com/ggml-org/llama.cpp/blob/84663953535d4323e92b4bc90971aa022c305d06/ggml/src/ggml-metal/kernels/mul_mm.metal
[S32]: https://github.com/ggml-org/llama.cpp/blob/84663953535d4323e92b4bc90971aa022c305d06/ggml/src/ggml-metal/ggml-metal-context.m
[S33]: https://developer.apple.com/videos/play/wwdc2026/330/
[S34]: https://github.com/modular/modular/issues/6943
[S35]: https://github.com/modular/modular/issues/6899
[S36]: https://docs.modular.com/mojo/tools/compilation/
[S37]: https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/MetalProgrammingGuide/Dev-Technique/Dev-Technique.html
[S38]: https://docs.rs/objc2-metal/latest/objc2_metal/
[S39]: https://doc.rust-lang.org/reference/items/functions.html
[S40]: https://developer.apple.com/documentation/metal/mtlcomputecommandencoder/
[S41]: https://developer.apple.com/metal/cpp/
[S42]: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0495-cdecl.md
[S43]: https://ziglang.org/documentation/master/#C
[S44]: https://github.com/mitchellh/zig-objc
[S45]: https://go.dev/doc/effective_go#concurrency
[S46]: https://pkg.go.dev/net/http
[S47]: https://github.com/hupe1980/go-mtl
[S48]: https://go.dev/src/runtime/cgocall.go
[S49]: https://pkg.go.dev/cmd/cgo
[S50]: https://go.dev/doc/go1.26
