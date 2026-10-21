<!-- SPDX-License-Identifier: Apache-2.0 -->
# E4 — Core ML / Neural Engine 연구

## Abstract

FP16 Core ML 변환과 CPU+GPU 주 모델의 네이티브 정확도 검증은 통과했다. 열거 shape 모델의 CPU+ANE/ALL은 load 오류 -5로 실패했고, 같은 가중치의 고정 1×82 대조군은 세 설정 모두 Python Core ML 정확도 기준을 통과했다. 후속 공통 하네스에서 정적82 native ABI gate를 실제 실행했으나 첫 82토큰 입력을 128로 패딩해 모델이 거절했다. 원전달본은 고정 shape 인식 문제로 native gate가 실패했으며, 실제 메타데이터로 원인을 확인해 수정한 새 라이브러리는 전체 native gate를 통과했다. 공통 성능 연구는 아직 수행하지 않았다. 이 문서의 사전 분석은 그 최종 측정 전에 기록했다.

## Introduction / Question

EmbeddingGemma 2 텍스트 encoder를 동일 GGUF 가중치에서 FP16 Core ML로 변환하면 M5에서 llama.cpp Q8보다 단일 문단 지연과 100문단 처리량이 개선되는가? CPU+ANE, CPU+GPU, ALL의 차이는 무엇인가? 가설과 반증 조건은 실험 디렉터리 `HYPOTHESIS.md`에 선기록했다.

## Method — 사전 분석

공통 `ENGINE-LAB-METHODOLOGY.md`를 따른다. Core ML E4는 그 문서의 Metal 커널/호스트 부분 요인 공간 밖의 대안이다. 커널=Apple ML Program compiler, 호스트=Objective-C++ Core ML C ABI adapter, 정밀도=FP16, 제출 전략=Core ML 내부, 묶음=1/4. 컴파일러는 opaque이므로 N_cb를 1로 간주하지 않는다.

`배타적 임계 경로 구간을 가정한 T_single = T_pack + T_CoreML_host + N_cb*t_submit + Σ max(bytes_k/BW, flops_k/P)/η_k + T_gap + T_readback + T_normalize`.

측정 전 계산: 원본 GGUF의 token embedding을 제외한 선형 가중치는 136,708,096 elements=273,416,192 FP16 bytes다. 82 tokens의 선형 GEMM은 22,420,127,744 FLOPs; attention의 QK/AV는 약 771,162,112 FLOPs다. 선택한 128-token padding에서는 각각 34,997,272,576 FLOPs / 1,879,048,192 FLOPs로 증가한다(원본 길이보다 선형 1.56배, attention 2.44배). 커널별 선형 근사 `bytes=2*K*D + 2*N*(K+D)`, `FLOPs=2*N*K*D`; attention은 레이어별 `FLOPs=16*N²*head_dim`이다. 중간 텐서 materialization/fusion은 컴파일 후에만 알 수 있다.

N_cb, BW, P_peak, η를 직접 잰 값이 아직 없어 단일 수치 예측과 실측 roofline 점은 식별 불가다. 273.4MB/BW와 36.88GFLOPs/P는 128 길이의 조건부 계산 항이며, 실효 마이크로벤치 값은 Core ML 전체에 성립하는 엄밀한 하한이 아니다. CPU encode와 GPU 실행이 겹치면 합산하지 않고 임계 경로에서 `max(T_submit,T_gpu)`와 배타적 나머지 구간을 사용한다. 또한 칩 사양표를 실측 BW/P로 대체하지 않는다. 과거 Mojo 425개와 llama.cpp 3개 command buffers를 Core ML의 버퍼 수로 대입하지 않는다. ANE와 GPU의 메모리 경로/peak도 다르다. 따라서 H2는 방향 가설이며 수치 예측이 아니다; 20% 예측 오차 판정은 이 미측정 변수 때문에 불가능하다는 한계를 결과에도 유지한다.

Amdahl: 배타적 임계 경로에서 제거 가능한 직렬 제출/host 비용의 비율을 p라고 하면 개선 상한은 1/(1-p). p=0.1/0.25/0.5이면 1.11/1.33/2.0배다. 이는 감도 분석이며 p의 실측치가 아니다. padding의 추가 연산과 CPU/device 전환은 이 상한을 낮출 수 있다.

## Results

공통 하네스 최종 성능 통계는 아직 대기 중이다. 다음은 실제 네이티브 capability/correctness 결과이며 지연·처리량 최종 표와 구분한다.

| 주 모델 설정 | 네이티브 load / 20개 gate | cosine min / mean | 혼합 배치 min | 최종 768-d 최대 절대 오차 | compute plan |
|---|---|---|---|---|---|
| CPU+GPU | 통과 | 0.9997322855 / 0.9999288729 | 0.9997161359 | 0.0027197320 | 계산 op 3,145개 GPU preferred; 상수 3,277개 device usage 없음 |
| CPU+ANE | **load 실패** | 미측정 | 미측정 | 미측정 | architecture execution-plan error -5 |
| ALL | **load 실패** | 미측정 | 미측정 | 미측정 | architecture execution-plan error -5 |

CPU+GPU의 100개 독립 문단, 큰 배치 후 작은 입력 재사용, 잘못된 크기·토큰 거부도 통과했다. 오차는 reference가 제공하는 pooling→projection→L2 이후 768차원 벡터 기준이며 raw 512차원 pooling 전후의 오차는 미측정이다. GPU 우선 op 수는 command buffer/dispatch 수가 아니다. 실제 CPU fallback op 수는 runtime trace가 없어 미확인이다.

[20개 native cosines](../../app/apps/desktop/dev/engine-lab/coreml/evidence/native-gpu-correctness.json), [ANE load 실패](../../app/apps/desktop/dev/engine-lab/coreml/evidence/native-ne-failure.txt), [ALL load 실패](../../app/apps/desktop/dev/engine-lab/coreml/evidence/native-all-failure.txt), [GPU op별 계획](../../app/apps/desktop/dev/engine-lab/coreml/evidence/plan-CPU_AND_GPU.json)에 원시 증거를 보존했다. 모델 디렉터리 hash는 [manifest](../../app/apps/desktop/dev/engine-lab/coreml/evidence/model-manifest.json)에 있으며 `.mlmodelc` canonical manifest SHA-256은 `901dd10a4f073b0ae946ac9246c5950092351b35a5535cab2d5e8663bb104b5b`다.

초기 Python `verify.py` probe는 min cosine 0.9997322855, single median 55.044 ms, 100문단 batch4 80.189/s를 관측했다. [30개 raw 호출 CSV](../../app/apps/desktop/dev/engine-lab/coreml/evidence/python-probe-single.csv)는 **비최종 Python 예비 결과**다. 당시 기준 벡터는 재사용한 Q8 oracle였고 시간 측정용 같은 세션 교차 baseline이 아니므로 최종 성능 채택 판정에 사용하지 않는다. 공통 네이티브 표에 이 수치를 섞지 않는다.

### 후속 static82 native ABI gate — 실패

2026-10-20 18:20 KST, 공통 하네스의 새 Q8 참조(`e1-final-20261020-173052/reference.json`)와 `CPU_AND_NE`를 사용해 전달받은 static82 네이티브 게이트를 한 번 실행했다. 라이브러리와 `.mlmodelc`를 하네스 소유 경로에 복사하고 symlink를 materialize한 뒤 E4 원래 파일목록 해시와 비교했다. 기존 E4 canonical JSON 알고리즘(상대 경로·bytes·파일 SHA 포함)과 공통 `ib-model-tree-v1`(상대 경로·파일 SHA)의 서로 다른 식별자를 모두 기록했다. E4 모델 해시는 `8d219634c160367b24738ee547cc07a5bd1268aae077408e90961260b078c450`, 라이브러리는 `63c8e5839e71244dfcdaf2291f4392b5dbc9e5f839d4e017a9b13b44e1fbd641`로 원래 전달물과 일치했다.

실행은 자체 GPU/ANE 잠금 안에서 수행됐고 timeout 없이 **exit1**로 끝났다. 모델 load는 성공했으나 첫 82토큰 문단에서 `MultiArray shape (1 x 128) does not match ... (1 x 82)` 오류가 발생했다. 따라서 **20개 단일·혼합20개·독립100개·확장 뒤 작은 입력·83토큰 거절은 완주하지 못했다**. 보조 검사 코드의 비유한 혼합 출력/단위 노름 검사와 83토큰 명시 거절도 실제 엔진에서 도달하지 못했으며 성공으로 기록하지 않는다.

읽기 전용 소스 대조에서 고정 길이 인식은 `shape==1×82`와 `shapeConstraint.type!=Enumerated`를 함께 요구한다. 실제 전달물은 고정 길이 경로가 활성화되지 않아 기본 64→128 버킷 패딩 경로를 탔다. 모델의 ANE load 실패와 다른 **어댑터 shape 인식/패킹 문제**이며, 실제 shapeConstraint enum 값은 추가 진단하지 않았다. E4 소스 수정·재빌드·재시도는 수행하지 않았다.

라이브러리와 모델은 실행 전후 변하지 않았고, child 종료 후 소유 잠금을 해제했다. [실제 실패 로그](../../app/apps/desktop/dev/engine-lab/harness/results/e4-static82-native-20261020-182026/gate.log), [exit/해시 상태](../../app/apps/desktop/dev/engine-lab/harness/results/e4-static82-native-20261020-182026/status.json), [복사본 identity 및 두 해시 알고리즘](../../app/apps/desktop/dev/engine-lab/harness/results/e4-static82-native-20261020-182026/identity.json), [검사 코드](../../app/apps/desktop/dev/engine-lab/harness/gate-coreml.py). 원전달본은 실패 상태로 보존하고, 이후 수정본 게이트 결과와 구분한다.

### 확인한 원인과 수정본 native gate — 통과

후속 실제 모델 메타데이터 회귀 검사에서 `ids`와 `valid` 모두 `shape=[1,82]`, `constraint_type=2(Enumerated)`, 허용 shape는 단 하나 `[1,82]`였다. 원래 어댑터는 `fixed_length=0/max_batch=4`로 판정했다. [수정 전 실제 모델 회귀 로그](../../app/apps/desktop/dev/engine-lab/coreml/evidence/shape-policy-before.log)는 exit1이며, 열거512 모델의 8개 shape와 `fixed_length=0/max_batch=4` 판정은 유지됐다.

`engine.mm`의 고정 길이 조건만 바꾸어 **단일 shape 열거 제약도 고정82로 인정**했다. 새 회귀 검사는 static82의 `fixed_length=82/max_batch=1`과 단일·배치83토큰 거절, 기존 열거512의 판정과513토큰 거절을 모두 통과했다. `-std=c++17 -O3 -Wall -Wextra -Werror -fobjc-arc` strict build를 통과했고, 최종 전달 라이브러리는 원래 `-mmacosx-version-min=15.0`을 보존했다. 원래 실패 산출물과 메타데이터는 덮어쓰지 않았다. [회귀 검사 소스](../../app/apps/desktop/dev/engine-lab/coreml/policy-smoke.mm), [수정 후 회귀 로그](../../app/apps/desktop/dev/engine-lab/coreml/evidence/shape-policy-after.log).

| macOS15 대상 수정본 CPU+ANE native gate | 실제 결과 |
| --- | --- |
| 단일20 cosine 최소 / 평균 | 0.999503761464 / 0.999888848027 |
| 혼합20 cosine 최소 | 0.999503761464 |
| 최종768-d 최대 절대 오차 | 0.003592808 |
| 혼합 벡터 유한성·단위 노름 | 20개 모두 통과 |
| 독립100개 결과·workspace 이후 single | 통과 |
| 단일/배치83토큰 명시 거절 | 모두 −1, 통과 |
| 프로세스 / 모델·라이브러리 해시 | exit0 / 전후 동일 |

최종 라이브러리는 `artifacts/shape-policy-repair/libib_coreml_static82_fixed_macos15.dylib`, SHA-256 `a55938897d5d6e97fed17f186fb0f469e794b376248964c9ae5e372df5ad8ae4`이며, 모델은 원래 `8d219634...` 파일목록 해시 그대로다. [수정된 모드/해시](../../app/apps/desktop/dev/engine-lab/coreml/evidence/native-modes-corrected-macos15.json), [최종 gate 원본](../../app/apps/desktop/dev/engine-lab/evidence/e4-static82-native-20261020-183359/gate.json), [종료·불변성 상태](../../app/apps/desktop/dev/engine-lab/evidence/e4-static82-native-20261020-183359/status.json), [최종 snapshot identity](../../app/apps/desktop/dev/engine-lab/evidence/e4-static82-native-20261020-183359/identity.json).

첫 수정 빌드는 기본 minOS27로도 gate를 통과했으나 원래 배포 대상 플래그 누락을 발견해 동일 소스를 minOS15로 빌드한 별도 산출물도 검증했다. [첫 수정본 gate](../../app/apps/desktop/dev/engine-lab/harness/results/e4-static82-native-20261020-183123/gate.json)는 별도로 남겼다. 이 과정은 기존 실패 binary의 동일 조건 반복이 아니라 명시한 소스·빌드 설정 수정에 따른 새 산출물 검증이다. 새 모델·가중치·fixture를 만들거나 기준을 낮추지 않았다.

이 결과는 **CPU+ANE 설정의 실제 native C ABI 정확도·경계 검사 통과**다. 독립5프로세스 성능, 실제 op별 ANE/CPU 배치 trace, macOS15 실제 기기 실행은 여전히 미검증이다. minOS15 loader metadata를 해당 OS 실행 증거로 해석하지 않는다.

### 도구·모델·입력

실측 호스트는 Apple M5, RAM 24 GiB, macOS 27.0.1 (26A434), AC 연결 / 배터리 100%였다. Python 3.11.16, PyTorch 2.14.1, coremltools 9.0, NumPy 2.4.6. coremltools는 PyTorch 2.7보다 새 버전을 검증하지 않았다는 경고를 출력했다. 이 경고를 무시하고 호환성을 선언하지 않았으며 실제 변환·벡터 검증을 별도로 수행했다. 공유 Mac의 다른 앱·컴파일러·WindowServer 부하는 통제하지 않았다.

| 입력 | SHA-256 |
|---|---|
| BF16 GGUF | `f315cbbb30dd487e44d501c8902abe88808755e43753a96beed1964f0a48aa4f` |
| Q8_0 GGUF | `6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc` |
| 공유 inputs.json | `1fa81e639754dca9b2df5a9e0e4d967c8559a311866765f676ac894ab3265b5c` |

로컬 HF cache에는 모델 가중치가 없었다. 새 모델 다운로드 없이 지정 BF16 GGUF를 읽었다. GGUF tensor reader는 기존 `dev/mojo-engine/convert.py`를 import하며 모델 수식은 기존 CPU oracle 구현과 대조했다. 토큰화·prompt·BOS는 공유 reference의 token IDs를 그대로 사용한다. GGUF의 local window 1024(좌우 ±512) 의미를 보존했으며 지원 길이 512 이내에서는 모든 key가 그 안에 들어간다.

### 실제로 만든 것

[실험 폴더](../../app/apps/desktop/dev/engine-lab/coreml/)에 GGUF→PyTorch→Core ML 변환기, Core ML 컴파일러 호출, Objective-C++ C ABI 동적 라이브러리, 네이티브 correctness/shape 검사, compute-plan 조회 및 단일 재현 명령을 만들었다. 모든 소스는 Apache-2.0 SPDX header를 갖는다. 애플리케이션 소스, 저장 벡터, 모델 배포 설정은 변경하지 않았다.

ML Program은 FP16, 열거 길이 64/128/256/512, 열거 batch 1/4이며 attention-key mask와 mean-pooling mask로 padding을 제외한다. 모든 24층의 GQA, Q/K/V RMSNorm, split-half RoPE, GeGLU, PLE projection/gating/scalar 및 최종 768차원 projection을 포함한다. 출력은 FP32로 내보내며 host에서 FP16 반올림 후 L2 정규화를 다시 수행한다. pooling 자체는 그래프 안이다. 호스트는 입력 MLMultiArray를 재사용하고 모델 호출을 mutex로 직렬화한다. 100문단 호출은 4문단씩 독립 Core ML batch로 나눈다.

### 빌드·저장 비용 (측정)

| 항목 | 측정값 |
|---|---:|
| Core ML 변환 | 82.305 s |
| 일반 `.mlmodelc` compile | 1.636 s |
| `.mlpackage` | 543,767,493 bytes (518.58 MiB) |
| `.mlmodelc` | 543,785,336 bytes (518.59 MiB) |
| 비교 Q8 GGUF | 309,855,520 bytes (295.50 MiB) |
| Objective-C++ dylib | 약 53 KiB |

일반 compile 시간은 장치별 최초 load/specialization 시간을 포함하지 않는다. 첫 Python CPU+GPU load는 9,288 ms였다(단일 예비 측정; cold-cache 재현성이나 독립 5회 통계가 아니다). dylib의 `otool -L`에는 Foundation/CoreML/Objective-C/C++/libSystem/CoreFoundation 시스템 라이브러리만 있었다. Python/PyTorch는 변환·연구 도구이며 네이티브 추론 경로에 포함되지 않는다.

## Ablations

Core ML은 공통 방법론의 A/B/D 직접 Metal 요인 공간 밖이다. 이 실험에서 비교할 수준은 동일 그래프/FP16/host/batch 정책 아래 CPU+ANE·CPU+GPU·ALL이다. 공개 `MLComputeUnits`에는 ANE-only/GPU-only가 없으며 세 설정 모두 CPU를 허용한다. 따라서 CPU+ANE 결과를 ANE 단독 성능으로 해석하지 않는다. [Apple ComputeUnit 정의](https://github.com/apple/coremltools/blob/main/coremltools/__init__.py)

### 정적 shape 대조군 (기존 주 모델과 구분)

열거 모델 실패 후 H4를 선기록하고 같은 가중치·수식을 B=1/S=82로 고정했다. 고정 shape compiler의 NumPy 2.4 scalar-folding 오류는 원시 로그로 보존했으며, 고정 모델에서 Python shape 상수를 사용해 변환했다. 새로운 모델 다운로드나 가중치 변경은 없다.

| 고정 1×82 모드 | 20개 추론 gate | cosine min | 최대 절대 오차 | 계획상 preferred 계산 장치 | load ms (1회 진단) |
|---|---|---:|---:|---|---:|
| CPU+ANE | 통과 | 0.9995037614 | 0.0035928115 | ANE 2,599 / CPU 4 | 12,751.5 |
| CPU+GPU | 통과 | 0.9997121855 | 0.0028405711 | GPU 2,603 | 2,065.4 |
| ALL | 통과 | 0.9997121855 | 0.0028405711 | GPU 2,603 | 3,825.1 |

[static82 원시 진단 결과](../../app/apps/desktop/dev/engine-lab/coreml/evidence/static82-diagnostic.json). 이는 CPU+ANE 설정에서 실제 추론을 성공시킨 증거와 예상 ANE 배치 계획을 결합한 결과이며, Instruments로 실제 ANE/CPU 실행을 확인한 증거는 아니다. 상수 2,328개는 장치 계획이 없다. load는 각 1회이며 plan 조회가 먼저 수행되어 캐시가 예열됐을 수 있으므로 cold start나 최종 native 통계로 해석하지 않는다.

이 결과는 정적 shape 및 상수화한 graph가 실패를 피한다는 관측이다. B/S 열거 여부, shape op 제거, padding 128→82가 함께 달라지므로 어느 한 요인의 독립적인 인과 효과라고 결론내리지 않는다. 주 모델의 지원 길이 512를 정적 대조군에 적용하지 않는다. 정적 대조군의 원전달 native ABI는 고정 shape 인식이 실패했으나, 위 수정본에서 1–82토큰 한도·순차 배치·전체 native 정확도·83토큰 명시 거절을 확인했다. 실제 하드웨어 batched ANE 성능은 검증하지 않았다.

CPU+GPU 주 모델의 8개 export shape도 별도로 PyTorch와 대조해 모두 통과했다(최소 cosine 약 0.9999992). 이 추가 검사는 원래 20개 Q8 gate와 다른 진단이며 원래 기준을 대체하지 않는다.

## Discussion — 제품에 넣는 비용

**관측:** 가중치 패키지는 Q8 GGUF보다 약 223 MiB 크고 네이티브 shim은 작다. 최저 deployment target은 enum shape 변환에 사용한 macOS 15다. 실행은 M5/macOS 27에서만 검증한다.

**추론/미검증:** Tauri에서 C ABI로 연결하는 데 Python을 내장할 필요는 없다. 기존 엔진 로딩/스레드/종료/실패 fallback 경계와 모델 리소스 경로를 연결하고 모델 hash를 검증해야 한다. OS Core ML compiler 및 모델 tensor mapping을 함께 유지보수해야 하므로 shim 크기만으로 유지비가 낮다고 판단할 수 없다. macOS 15 이전과 Windows/Linux에는 같은 Core ML 경로를 쓸 수 없으며 별도 엔진 경로가 필요하다. 변경된 backend/precision의 벡터를 기존 index와 섞지 않도록 앱의 INDEX_VERSION/reindex 계약 검토도 필요하다. 특히 정적82 모드는 긴 문단을 처리하지 못하므로, 짧은 query만 이 모드로 보내고 문서는 Q8/GPU로 보내는 혼합 경로도 자동으로 안전하다고 볼 수 없다. 길이 fallback과 혼합 벡터의 검색 품질·index 계약을 따로 검증해야 한다. 이 실험에서는 그 통합을 수행하지 않았다.

**미검증:** Developer ID signing, hardened runtime, notarization, 설치된 Tauri bundle의 리소스 로딩·첫 실행 compile·취소·메모리 부족·앱 종료는 검사하지 않았다. 시스템 framework 사용은 이 검증을 대체하지 않는다. 새 native dylib를 기존 배포 서명 순서에 넣고 모델 리소스와 캐시 위치를 실배포에서 검증해야 한다.

## Threats to validity

M5 한 대, 82-token latency 한 길이 중심, 공유 Mac의 CPU/GUI/열 부하, 장치·shape별 Core ML 캐시 상태, FP16 vs Q8 정밀도 차이, 128 padding의 추가 연산, 내부 batch 4 제한이 결과를 제한한다. 64/128/256/512 shape 검사는 외삽 성능 근거가 아니다. 100문단은 공통 기준과 같이 같은 fixture의 복제본이며 실제 다양한 길이의 색인 데이터 분포가 아니다. 독립 5개 process의 표본 수는 작고 모든 기기/검색 품질로 일반화할 수 없다.

Core ML N_cb/dispatch와 ANE FLOPs·실효 BW·실제 op fallback은 현재 미측정이다. `MLComputePlan`은 anticipated device placement이며 runtime trace가 아니다. CPU+ANE plan 조회와 실제 네이티브 load는 architecture-plan error -5로 실패했으며, 이를 CPU fallback 0개나 ANE 전체 실행으로 바꾸어 적지 않는다. [Apple MLComputePlan](https://developer.apple.com/documentation/coreml/mlcomputeplan-85vdw)

## Conclusion

**구현 인계 완료, 성능 채택 판정 보류.** 실제로 확인한 것은 열거형 CPU+GPU의 native 정확도 통과, 열거형 CPU+ANE/ALL의 load 실패, 고정82의 세 모드 Python Core ML 정확도 통과다. 정적82의 원전달 C ABI는 128 패딩 오류로 실패했지만, 실제 shape 메타데이터에 근거한 최소 수정본은 20개·혼합20개·독립100개·작은 입력 재사용·83토큰 거절을 통과했다. 성능 채택은 아직 판정하지 않는다.

후속 소유자는 조정자/공통 하네스다. 정적82의 수정본 native gate는 완료했다. 남은 단계는 통과한 설정의 독립 재측정과 공통 native 성능 연구다. 통과한 설정만 같은 세션 Q8와 교차하는 5개 process×30회 및 Offline/Server 연구로 넘긴다. 그 원시 CSV, CI/IQR·처리량 표준편차·검정·효과 크기·그림·최종 판정은 **이 인계에서 미완료**이며 예비 Python 수치로 대체하지 않는다.

정확한 고정 library/model 경로·hash·모드·최대 길이·batch 정책은 [native-modes.json](../../app/apps/desktop/dev/engine-lab/coreml/evidence/native-modes.json), 디렉터리 파일별 hash는 [model-manifest.json](../../app/apps/desktop/dev/engine-lab/coreml/evidence/model-manifest.json), 준비한 gate와 full 재현 명령은 [README](../../app/apps/desktop/dev/engine-lab/coreml/README.md)에 있다. 인계 시점 E4의 GPU job은 실행/대기 모두 없다. `reproduce.py`는 전체 재현 절차를 조합했지만 end-to-end full 실행은 아직 하지 않았다.

알고리즘과 실험 방법론의 정의·근거는 [공통 해설](ENGINE-LAB-ALGORITHMS-AND-METHODS.md)을 따른다.

## References

- [공통 실험 방법론](ENGINE-LAB-METHODOLOGY.md)
- [Mojo 실제 trace와 최적화 로그](MOJO-ENGINE-OPTIMIZATION.md)
- [지연 모델·Amdahl·ANE 관련 기존 연구](MOJO-LATENCY-RESEARCH.md)
- [Apple Core ML compute-unit API](https://developer.apple.com/documentation/coreml/mlcomputeunits)
- [Apple coremltools 변환 옵션 구현](https://github.com/apple/coremltools/blob/main/coremltools/converters/_converters_entry.py)
- [Apple ANE Transformer 연구](https://machinelearning.apple.com/research/neural-engine-transformers): layout/Conv2D 등 추가 최적화 방향이며 이 모델의 실측 성능은 아니다.
- [Apple MLComputePlan](https://developer.apple.com/documentation/coreml/mlcomputeplan-85vdw)
