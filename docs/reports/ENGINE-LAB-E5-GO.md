# E5 연구: Go 호스트와 지연 배치

작성: 2026-10-20, Asia/Seoul. 장비: Apple M5, 메모리 24 GB, macOS 27.0.1, AC 전원. Go 1.26.1 (`darwin/arm64`). 앱 코드, 앱 manifest, Mojo 엔진 코드는 수정하지 않았다.

> **증거 경계:** 아래 수치는 앞선 탐색 실행이다. 이 실행은 warmup 1회, Go batch/Offline 반복 3회였으므로 공통 방법론의 warmup 10회·독립 5×30·Offline 7개 크기 × 30회 결과로 취급하지 않는다. 공통 `ib_engine` ABI 참여는 별도 c-shared 후보와 CPU-only ABI smoke로 준비했으며, 예약된 공통 GPU harness 실행은 아직 하지 않았다.

## Abstract

Go가 제품의 임베딩 엔진에 이득을 주는지 기존 Mojo C ABI와 작은 HTTP 배치 서비스로 측정했다. Go→cgo no-op은 호출당 평균 125 ns였다. 82-token Go process median은 29.63 ms, Q8_0 process median은 21.70 ms로 Go가 36.5% 느렸다. Go pooled-call p50은 28.38 ms였다. Go에서 한 번에 100개를 보내는 엔진 경로는 111.86 ± 9.24 문단/s로 Q8_0 최적 배치의 84.62 ± 7.47 문단/s보다 높았지만, 이는 Go가 아니라 Mojo의 GPU batch 경로 비교다. 3 ms HTTP 수집창은 32개 동시 클라이언트에서 240 ± 39 요청/s를 냈고, 지연은 p50 118 ms, p95 286 ms였다.

**판정: 현 제품에는 Go를 추가하지 않는다.** 온디바이스 엔진에는 Go 이점이 없고 단일 지연은 Q8보다 나쁘다. 별도 서버에서 동시 임베딩을 모으는 역할은 가능성이 있지만, 이 실험은 Go가 현재 서버 런타임보다 낫다는 비교를 하지 않았다. 서버 배치의 실용성은 후속 Rust/Hono 비교로 판단해야 한다.

## Introduction / Question

질문은 Go가 (1) 기존 추론 엔진의 호스트 언어로 적절한지, (2) 수 ms 동안 요청을 모아 batch 호출로 실행하는 서버 경계에 적절한지다.

측정 전에 둔 가설은 다음과 같다. **H1:** 추론 계산이 대부분을 차지하므로 cgo 전환은 단일 추론 시간을 거의 바꾸지 않으며, Go를 온디바이스 엔진으로 추가할 성능 근거가 없다. no-op 경계가 단일 호출 지연의 1%를 넘거나 Go의 단일 median이 Q8보다 빨라지면 H1을 반박한다. **H2:** 여러 요청을 batch로 모으면 서버 처리량은 증가하지만 수집·대기 시간이 tail latency를 높인다. 수 ms 창이 0 ms보다 동시 처리량을 높이지 않거나 p95를 낮추지 못하면 H2를 반박한다.

## 공통 ABI 후보 상태 (CPU-only, GPU 비교 미실행)

기존 Go/cgo host를 Go `-buildmode=c-shared`로 빌드해 공통 [ib_engine.h](../../app/apps/desktop/dev/engine-lab/harness/ib_engine.h)의 `ib_engine_init/embed/embed_batch/free/name`을 export한다. `size_t[]` batch 길이는 1–2048 및 총 16,384 token 경계를 검사한 뒤 Mojo ABI의 `int32[]`로 변환한다. `ib_engine_stats`는 신뢰 가능한 호출별 엔진 카운터가 없어 생략했다.

| 역할 | 절대 경로 |
|---|---|
| Go 공통 ABI 후보 | `/Users/iron/Project/psw/infinite-brain/app/apps/desktop/dev/engine-lab/go/build/libib_go.dylib` |
| 후보 SHA-256 | `f50f8c7fdc2ca46497b9e56df185e31af5ddd4de77930f8143d2422efa7e1641` |
| ABI가 내부에서 dlopen 하는 Mojo 엔진 | `/private/tmp/ib-mojo-opt/package-final/optimized-final.dylib` |
| `IB_ENGINE_MODELS`에서 후보에 매핑할 모델 | `/private/tmp/ib-mojo-spike/weights.bin` |

[`abi_smoke.sh`](../../app/apps/desktop/dev/engine-lab/go/abi_smoke.sh)는 임시 fake Mojo dylib와 C caller로 후보를 `dlopen`하고 공통 헤더의 init/name/single/batch/free를 호출했다. `size_t` 길이 변환, 순서/offset, 0·초과 sequence·초과 token 경계 거부를 확인해 `PASS`했다. 결과 로그는 [abi-smoke-cpu.log](../../app/apps/desktop/dev/engine-lab/go/results/abi-smoke-cpu.log)에 남겼다. 이 검사는 GPU, 실제 모델, 정확도 gate, 공통 harness pipeline을 실행하지 않아 20-fixture gate 통과를 의미하지 않는다.

공통 비교는 실행 대기 중이다. 예약된 슬롯에서 아래 명령을 실행해야 실제 모델의 20-fixture gate와 warmup10/full5×30 SingleStream·Offline·Server 결과를 얻는다. 후보를 다시 빌드하면 SHA-256도 다시 기록한다.

```sh
cd app/apps/desktop/dev/engine-lab/go
go build -buildmode=c-shared -o build/libib_go.dylib .
./abi_smoke.sh
CANDIDATE="$PWD/build/libib_go.dylib"
IB_MOJO_LIBRARY=/private/tmp/ib-mojo-opt/package-final/optimized-final.dylib \
IB_ENGINE_MODELS="{\"$CANDIDATE\":\"/private/tmp/ib-mojo-spike/weights.bin\"}" \
  ../harness/run.sh "$CANDIDATE"
```

## Method

### 구현

[실험 디렉터리의 Go 프로그램](../../app/apps/desktop/dev/engine-lab/go/)은 `dlopen`/`dlsym`으로 이미 빌드된 Mojo GPU C ABI를 로드한다. 직접 단일 호출과 기존 `ib_mojo_gpu_embed_batch`를 모두 호출해 cgo 경계의 하한, 단일 latency, batch 100 처리량을 잰다. HTTP `/embed`는 fixture 번호를 받고, 서버 큐가 지정한 시간 동안 요청을 모아 하나의 C batch 호출로 처리한다. 한 Mojo handle 호출은 직렬화해 ABI 계약을 따른다.

본문 문자열을 토큰화하지 않고 **기존 20개 fixture의 인덱스**를 받는다. 요청마다 이 인덱스를 fixture의 기존 token IDs로 바꾸며, 결과는 해당 Q8 oracle vector와 비교한다. 따라서 이 결과는 일반 텍스트 임베딩 API 또는 인증·취소·장애복구를 갖춘 운영 서비스 결과가 아니다.

### 입력과 게이트

공유 입력은 `app/apps/desktop/dev/mojo-engine/inputs.json` 20개다. oracle과 기준 구현은 기존 Mojo 연구의 Rust `reference` 바이너리와 같은 llama.cpp Q8_0 모델이다. 각 Q8 실행은 단일 warmup 이후 30회 latency, 100문단 batch 크기 4/8/16/24/32/64/100 sweep을 수행한다. Go도 GPU에 각 fixture를 단일/혼합 batch로 넣어 20개 cosine을 모두 oracle과 비교하고, 단일 82-token 경로는 warmup 1회 후 30회 기록한다. Go 100문단 batch는 warmup 3회 뒤 3회 측정한다.

5개 독립 프로세스에서 매번 Q8을 먼저 재고 곧바로 Go를 실행했다(A/B 반복). 마지막에도 Q8을 한 번 더 실행했다. 각 GPU 측정 명령은 `/private/tmp/ib-gpu-bench.lock`을 취한 동안만 실행했다. 3 ms 창은 32 HTTP worker × 50 요청으로 5회 반복했다. 0 ms와 6 ms 창은 같은 부하로 한 번씩 비교했다. GPU 계측 중첩은 잠금으로 막았지만 OS의 다른 CPU 작업, 열 상태, 장기 전원/성능 상태는 통제하지 않았다.

### 장비와 모델 식별

| 항목 | 값 |
|---|---|
| Go | 1.26.1, `darwin/arm64` |
| 기기 | Apple M5, RAM 24 GB, macOS 27.0.1 |
| 전원 | 측정 전 AC Power, 배터리 100% 확인 |
| BF16 모델 SHA-256 | `f315cbbb30dd487e44d501c8902abe88808755e43753a96beed1964f0a48aa4f` |
| Q8_0 모델 SHA-256 | `6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc` |
| fixture | 기존 `inputs.json`, 20개, 82-token benchmark 문단 |

통계 단위는 5개 독립 실행의 단일 median 또는 Go의 150개 warm 호출 원자료다. p50/IQR와 10,000회 seeded percentile bootstrap 95% CI를 사용했다. Q8 실행은 개별 30개 시간 배열을 저장하지 않고 프로세스 median만 남기므로 Q8 CI는 **5개 process median**의 bootstrap이다. 처리량은 각 독립 실행별 best Q8 batch와 Go batch-100 측정값의 평균 ± 표본 표준편차다.

## Results — 탐색 실행 (공통 harness 최종 결과 아님)

### 공유 gate와 동일 세션 Q8 기준

| 실행 | cosine min / mean (20개) | max absolute vector diff | warm single latency | 100문단 처리량 | dispatch / command buffer |
|---|---:|---:|---:|---:|---|
| Go → Mojo, direct cgo | 0.99970185 / 0.99992805 | 0.00290116 | **29.63 ms** 중앙 process median; process IQR 25.37–54.44, bootstrap 95% CI 25.23–77.98 (5회); pooled-call p50 28.38 ms, IQR 23.86–39.78 (150회) | **111.86 ± 9.24 문단/s**; batch 100 | 엔진 경로에 그대로 위임; Go가 줄이지 않음 |
| llama.cpp Q8_0 oracle/baseline | oracle 대비 자체 기준 | — | **21.70 ms**; IQR 21.35–23.54; bootstrap 95% CI 21.06–25.03; n=5 process median (각 30 warm calls) | **84.62 ± 7.47 문단/s**; 실행별 최적 batch 8–64 | 이전 동시 세션 trace: 3 command buffers / 3 encoders |
| Go HTTP, 3 ms collection | 같은 20 fixture; direct/mixed batch cosine gate 통과 | single max diff와 동일 | HTTP p50 118.18 ms, p95 285.90 ms; 8,000 요청 | **240.18 ± 39.27 요청/s**, 32 workers | batch 호출 수는 이번 로그에서 계수 오류로 미확인 |

Go의 20개 단일 fixture cosine 최솟값과 20개 mixed-length batch 최솟값이 모두 0.999를 넘었다. 단일/Mixed batch cosine 평균은 각각 0.99992805 / 0.99992798이었다. 값 차이는 Q8 oracle과의 비교이며, 이전 BF16 기준 결과와 섞지 않았다.

Q8의 다섯 process median 중앙값은 21.70 ms (95% bootstrap CI 21.06–25.03)였고, Go의 다섯 process median 중앙값은 29.63 ms (95% CI 25.23–77.98)였다. 같은 process-level 요약에서 Go는 36.5% 느렸다. 추정 구간은 거의 맞닿지만 겹치지 않았고 Go 반복 하나는 77.98 ms까지 튀었다. Go의 150 pooled warm call p50은 28.38 ms (95% CI 26.33–30.86)다. batch-100 처리량은 Go 5회 모두 Q8 실행별 최적 batch보다 높았지만, 배치 엔진은 Mojo였고 Go/Rust/Hono 호스트 간 통제 비교는 없었다.

다섯 쌍 뒤 마지막 Q8 재측정은 26.65 ms / 68.34 문단/s였다. 앞선 Q8 중앙값 21.70 ms / 84.62 문단/s보다 느렸다. 실행 전후 기준도 안정적이지 않아 작은 성능 차이를 결론으로 취급하지 않았다.

단일 C no-op 1,000,000회는 호출당 평균 125 ns(반복별 69–225 ns)였다. 28.38 ms 추론 median 대비 약 0.00044%다. 이는 cgo 경계의 하한만 재며 실제 ABI 호출 부하의 직접 분리가 아니다. 관측상 cgo는 단일 지연의 원인이 아니었다.

### 이전 trace에서 확인한 engine 제출 수

E5에서는 명령 제출 trace를 새로 캡처하지 않았다. 같은 엔진을 측정한 기존 [지연 연구](MOJO-LATENCY-RESEARCH.md)의 30-call trace 분석은 Mojo 단일 호출 **417 compute dispatch + metadata upload 6 + download/completion 2 = 425 command buffers**와 llama.cpp **3 command buffers**를 기록했다. Mojo의 batch ABI가 이 수를 문단별로 유지하거나 줄이는지는 이번 E5에서 확인하지 않았다. 따라서 425 대 3은 Go 실행의 신규 측정치가 아니라 엔진 경계의 직전 독립 실험 근거다.

### 수집창 ablation

| HTTP 수집창 | 실행 수 | 처리량 | p50 | p95 |
|---:|---:|---:|---:|---:|
| 0 ms | 1 | 72.1 요청/s | 401.1 ms | 731.1 ms |
| 3 ms | 5 | 240.2 ± 39.3 요청/s | 118.2 ms | 285.9 ms |
| 6 ms | 1 | 284.2 요청/s | 97.8 ms | 199.0 ms |

동시 부하에서 짧은 수집창이 한 번에 더 많은 일을 처리해 0 ms보다 처리량과 tail을 개선했다. 6 ms 수치는 한 번이라 일반화할 수 없다. 3 ms 다섯 반복에서도 다섯 번째 실행은 170 요청/s, p95 420 ms로 나빠져 서비스 latency가 실행 조건에 민감했다.

## Ablations

1. **single cgo vs batch 100:** cgo 단일 호출은 약 125 ns 하한이고 batch-100은 Q8의 최적 batch sweep과 비교해 32.2% 높은 처리량을 기록했다. 이 비교는 입력 배치 크기와 엔진 batch path를 함께 바꾸므로 “Go가 빨라졌다”는 결론이 아니다.
2. **HTTP 수집창 0/3/6 ms:** 0→3 ms에서 반복 평균 처리량이 72→240 요청/s로 증가했고 p95가 731→286 ms로 낮아졌다. 6 ms 단일 실행은 284 요청/s, p95 199 ms였다. 큐잉 정책이 동시 부하 처리에 영향을 주는 것은 지지하지만, 표본 수가 적은 6 ms와 호스트 부하를 고려해 최적값은 정하지 않는다.
3. **Go 대 native Go 없는 HTTP 호스트:** 측정하지 않았다. Go의 HTTP 수치는 Mojo의 GPU batch 엔진과 구현된 queue를 합친 값이다. 같은 queue와 GPU ABI를 Rust/Hono로 작성해 비교하기 전에는 Go 자체의 서버 이점을 알 수 없다.

## Discussion

**온디바이스:** 채택하지 않는다. Go/cgo 경계는 충분히 작지만 Mojo 단일 호출은 기존 Q8보다 느렸고, 현재 Tauri 앱에는 Rust 엔진 경로가 이미 있다. Go 바이너리와 C ABI를 추가해도 기존 425 제출을 줄이지 않으므로 실측된 이득이 없다.

**서버:** Go가 유일하게 검토 가능한 위치는 별도 동시 요청 batch broker다. 3–6 ms 수집 아이디어가 요청 처리량을 높였다는 정황은 있다. 다만 제품 서버는 이미 Hono/TypeScript이며, 이 프로토타입의 처리량 향상은 Go의 언어 성능보다 Mojo batch ABI에서 나온다. 운영 의사결정으로 이어가기 전에 동일 fixture, 같은 GPU 엔진, 같은 수집 정책으로 Rust/Hono/Go의 HTTP p50/p95/throughput을 같은 세션에서 비교해야 한다.

**제품 결론은 현재 ‘어디에도 추가하지 않음’이다.** 클라우드에서 임베딩 요청을 묶는 기능이 선택되면 서버 경계가 후보지만 Go는 검증된 필수 선택이 아니다. 기존의 문서 검색 on-device 엔진을 Go로 교체하는 것은 근거에 반한다.

### 유지보수와 서명 비용

- **온디바이스 앱에 넣는 비용 — 높음 [추론]:** Go toolchain/CGO를 빌드 파이프라인에 추가하고, Tauri와 별도 Go 프로세스의 시작·종료·포트·오류·취소·로그·모델 수명주기를 관리해야 한다. 이번 바이너리는 Mojo dylib 및 런타임 dylib가 없으면 구동되지 않는다. M5 전용 GPU ABI의 모델/엔진 호환과 앱 업데이트 순서도 새 계약이 된다.
- **서명·배포 — 높음 [공식 배포 요구 + 추론]:** macOS 외부 배포 앱은 코드 서명 및 공증 대상이다. Go 실행 파일과 중첩 dylib를 앱 번들에 넣으면 각각의 위치·서명을 패키징 및 공증 과정에서 검증해야 한다. 이번 실험은 앱 번들, Developer ID 서명, 공증, 격리된 설치를 시도하지 않았다.
- **별도 서버에 둔다면 — 중간 [추론]:** 데스크톱 서명 복잡성은 없지만 별도 배포물, 모델/GPU 운영, health/queue overload 처리, 인증과 관측이 필요하다. 현재 앱 서버와 모델 서비스 두 운영 경로를 관리하게 된다.

## Threats to validity

- GPU 측정은 전용 lock으로 직렬화했지만 다른 CPU 작업/열 상태는 고정되지 않았다. Go 5회 중 단일 median 77.98 ms 및 HTTP 170 req/s·p95 420 ms 실행이 나타났다. 이는 숨기지 않고 통계에 포함했다.
- Q8 reference 프로그램은 30 warm 호출의 process median만 JSON에 기록한다. 따라서 Q8의 CI는 원시 호출 150개 bootstrap이 아니라 독립 프로세스 5개 median을 bootstrap했다. Go는 원시 150개 호출을 CSV에 보존했다.
- 0 ms와 6 ms ablation은 각 1회이며 3 ms 결과처럼 신뢰구간을 주장할 수 없다.
- HTTP는 fixture index만 받아 tokenizer·네트워크 외부 클라이언트·인증·운영 서버 부하를 재현하지 않았다. 32 client loopback 결과를 외부 서비스 QPS로 일반화하지 않는다.
- HTTP 프로토타입의 첫 측정 바이너리는 `batches`라는 출력 필드에 실제 batch-call 수 대신 처리 요청 수를 기록했다. 따라서 3 ms 큐의 batch size/호출 수는 결과에서 제외했다. 현재 source는 batch-call 카운터를 바로잡았지만 해당 수정 버전의 instrumented GPU 실행을 아직 하지 않았다.
- 동일 Q8 모델과 Mojo BF16 변환 모델 모두 지정 로컬 파일만 사용했으며 모델을 새로 내려받지 않았다. Q8 기준 cosine의 작은 차이, pooling 구현 차이, 실제 검색 순위 영향은 검색 Recall@k로 평가하지 않았다.
- 425/3 trace와 417 dispatch는 이 보고서의 Go 반복 중 새로 수집한 것이 아니라 기존 30-call Metal trace를 인용했다.
- M5/macOS 27 이외 장치, 실제 Mojo 모델을 사용하는 CPU-only fallback, Windows, 실제 사용자 vault, Developer ID signing/notarization은 확인하지 않았다. 앞의 C ABI smoke는 fake backend만 사용했다.
- 탐색 보고서의 process median bootstrap/IQR는 exploratory raw CSV를 읽는 `summarize.py`로 재생성한다. Mann–Whitney U, Cliff's delta, Holm 보정은 공통 harness 결과가 생기기 전까지 탐색 결과에 적용하지 않았다.

## Conclusion

Go/cgo로 기존 Mojo GPU 엔진을 호출하는 것은 기술적으로 가능했고 correctness gate를 통과했다. cgo 경계 비용은 추론에 비해 무시할 수준이었다. 그러나 단일 latency는 Q8보다 느렸고, batch 처리량 이득은 Go 언어의 효과로 분리되지 않았다. 수 ms 서버 batch 수집은 0 ms보다 유망해 보이지만 높은 p95와 반복 변동이 남았다.

**권고: Go는 현재 Infinite Brain 제품에 추가하지 않는다.** 나중에 클라우드 배치가 필요하면 서버 서비스 경계를 검증하되, 구현 언어 선택 전에 기존 Hono/Rust 기반 batch host와 A/B한다. 온디바이스 Rust/Tauri 경로는 유지한다.

## Reproducibility

프로젝트의 [Go E5 README](../../app/apps/desktop/dev/engine-lab/go/README.md)와 [`run.sh`](../../app/apps/desktop/dev/engine-lab/go/run.sh)가 전체 exploratory 반복 명령을 제공한다. 각 재실행은 새 timestamp 결과 디렉터리를 만들어 기존 raw 데이터를 덮어쓰지 않는다. 이전 탐색 원자료는 `/Users/iron/Project/psw/infinite-brain/app/apps/desktop/dev/engine-lab/go/results/` 아래 보존했다. exploratory 재실행에는 Go 1.26.1, 지정된 두 GGUF, 기존 `/private/tmp/ib-mojo-spike` 및 `/private/tmp/ib-mojo-opt/package-final/optimized-final.dylib` 산출물이 필요하다.

```sh
cd app/apps/desktop/dev/engine-lab/go
RUN_DIR="$PWD/results/e5-$(date +%s)"
IB_E5_RESULTS_DIR="$RUN_DIR" ./run.sh
python3 summarize.py "$RUN_DIR" > "$RUN_DIR/summary.json"
```

`run.sh`는 Q8/Go 5쌍을 실행하고 0/6 ms 창 비교와 마지막 Q8 bracket을 수행한다. 각 실제 GPU 측정은 lock을 획득하고 해제한다. 이번 실행의 raw per-call CSV, 20개 oracle JSON, 요약, 실행 로그는 보고서와 함께 보존했다.

## References

- [Go cgo command documentation](https://go.dev/cmd/cgo/): cgo linking and Go/C pointer lifetime rules.
- [Tauri macOS code signing](https://v2.tauri.app/distribute/sign/macos/): macOS app distribution signing/notarization workflow.
- [Apple distribution signing guidance](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/): app bundles containing nested code require an explicit signing workflow.
- [Mojo engine optimization measurements](MOJO-ENGINE-OPTIMIZATION.md).
- [Mojo latency and trace analysis](MOJO-LATENCY-RESEARCH.md).
- [Mojo engine architecture, fixtures and gate](../../app/apps/desktop/dev/mojo-engine/README.md).
- [Binding engine-lab methodology](ENGINE-LAB-METHODOLOGY.md) and [shared harness contract](../../app/apps/desktop/dev/engine-lab/harness/README.md).
