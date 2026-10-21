<!-- SPDX-License-Identifier: Apache-2.0 -->
# 임베딩 엔진 비교와 채택 판정

2026-10-21 공개 정리. **E1은 성능 후속 검증 후보이며, 제품 엔진은 llama.cpp를 유지한다.**
이 문서는 확보한 근거를 비교한 코디네이터 보고서다. 모든 후보의 실험 완료나
Claude Opus 독립 재측정을 대신하는 최종 논문으로 표시하지 않는다.

## 완료한 비교에서 알 수 있는 것

동일한 Apple M5 24GB에서 Q8 기준선과 E1을 번갈아 실행했다. 엔진마다 독립
프로세스 5개, workload별 예열 10회와 측정 30회를 사용했다. SingleStream은
82토큰 문단 하나, Offline은 한 표본당 문단 100개다. 정확도는 한·영 20개 단일
입력과 길이가 다른 20개 배치를 검사하며 최소 cosine 0.999를 요구했다.

| 지표 | llama.cpp Q8 | E1 Rust + Mojo AIR | 해석 |
| --- | --- | --- | --- |
| SingleStream 전체 호출 p50 | 15.8753ms | 11.0869ms | 관측 지연 30.2% 감소 |
| 프로세스 중앙값의 중앙값에 대한 bootstrap 95% CI | 14.7547–18.7565ms | 10.6148–12.1712ms | CI는 위의 pooled p50과 추정 대상이 다름 |
| 최고 Offline 평균 | 103.965 ± 4.903문단/s, batch8 | 128.436 ± 6.836문단/s, batch16 | 각자의 시험한 최고 묶음에서 23.5% 증가; ±는 프로세스 간 SD |
| 최소 단일 / 혼합 cosine | 1.000 / 1.000 | 0.999708 / 0.999700 | 이 입력 집합의 정확도 게이트 통과 |
| Holm 보정 p | 기준선 | 17개 비교 모두 0.134921 | 보정 후 유의성을 확보하지 못함 |

E1은 시험한 Server 수준 중 최대 40QPS에서 p99 41.513ms를 기록했다. 더 낮은
5QPS와 30QPS에서 실패했으므로 지속 가능한 40QPS 용량이라는 결론은 내릴 수
없다. QPS당 150요청의 관측이며 추가 장시간 검증이 필요하다.

원본 CSV 5,100행과 완료 메타데이터, 통계·그래프는
[공개 근거](../../app/apps/desktop/dev/engine-lab/evidence/README.md)에 보존했다.
[E1 보고서](ENGINE-LAB-E1-RUST.md)는 모든 묶음 수준과 trace를 설명한다.

## 시간을 줄인 방법

E1은 forward 전체 GPU 작업을 하나의 Metal command buffer와 encoder에
기록하고, 의존성이 있는 작업 사이에 barrier를 둔 뒤 한 번 제출·대기한다.
물리 trace에서 forward 40회에 서로 다른 command buffer 40개를 확인했다.
이는 GPU 명령 제출·동기화 비용을 줄이는 실행 스케줄링 최적화다.

커널에는 online softmax attention, 타일 행렬곱, FP16 피연산자와 FP32 누산,
조건부 split-K, QKV 및 gate/up fusion, workspace 재사용이 포함된다.
Online softmax는 attention score 전체를 전역 메모리에 만들지 않고 현재
최댓값·정규화 합·가중합을 갱신한다. 타일링은 작은 행렬 블록을 재사용하고,
fusion은 중간 결과의 저장과 추가 dispatch를 줄인다.

단, E1은 기존 Mojo의 417개 계산 dispatch 대신 split-K reduction 등을 포함한
445개 dispatch를 사용한다. 호스트, 정밀도, 커널 launch 구성이 함께 바뀌었다.
따라서 위 30.2%를 Rust 언어, 제출 통합 또는 특정 커널 한 가지의 효과로
분배할 수 없다. 원래 Mojo의 미완결 반복 표본과 E1을 합쳐 인과 비교하지 않는다.
각 알고리즘의 수식과 예시는 [정의 문서](ENGINE-LAB-ALGORITHMS-AND-METHODS.md)에 있다.

## 참고한 방법론과 채택 이유

| 근거 | 채택한 부분과 이유 | 적용 한계 |
| --- | --- | --- |
| [FlashAttention, Dao et al. 2022](https://arxiv.org/abs/2205.14135), [FlashAttention-2, 2023](https://arxiv.org/abs/2307.08691) | attention의 메모리 이동과 streaming softmax를 분석하는 근거 | 논문의 전체 kernel·스케줄러를 재현한 구현은 아님; 연산 복잡도 O(N²d)는 유지 |
| [Roofline, Williams et al. 2009](https://escholarship.org/uc/item/5tz795vq) | FLOPs/바이트와 이 Mac에서 잰 대역폭·MPS 처리량으로 병목 가설을 먼저 작성 | 측정치를 상한으로 가정한 경험적 envelope; 모든 kernel의 엄밀한 하한은 아님 |
| [Amdahl 1967](https://www.cs.cmu.edu/~18742/papers/Amdahl1967.pdf) | 제출 비용만 제거해 얻을 수 있는 개선의 민감도·상한을 설명 | CPU/GPU 겹침을 분해하지 않은 trace 시간은 단순 합산하지 않음 |
| [MLPerf Inference, Reddi et al. 2020](https://arxiv.org/abs/1911.02549) | 문단 지연, 최대 처리량, 대기 포함 Server 지연을 별도 시나리오로 비교 | 자체 load generator와 표본 수를 사용한 MLPerf-inspired 연구; 인증 결과 아님 |
| [Apple Metal command-buffer 지침](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/MTLBestPracticesGuide/CommandBuffers.html) | 제출 비용과 GPU starvation의 균형을 다루는 직접 구현 근거 | 논문이 아닌 공식 엔지니어링 지침; buffer를 줄이면 항상 빨라진다는 보장 없음 |

통계는 프로세스를 독립 표본으로 삼고 bootstrap CI, Mann–Whitney U,
Cliff's δ, Holm 보정을 사용한다. 동일 프로세스의 호출 150개를 독립 실험
150개로 취급하지 않기 위해서다. 상세 가정은 [방법론](ENGINE-LAB-METHODOLOGY.md)에 있다.

## 다른 후보와 미완료 범위

| 실험 | 확보한 근거 | 남은 검증 |
| --- | --- | --- |
| 원래 Mojo / 공통 하네스 | ABI·통계 자체 검증, 9개 완결 프로세스와 마지막 부분 프로세스 | 10개 전체 완결 연구; 부분 디렉터리는 최종 추론에서 제외 |
| E0 Mojo 제출·fusion | 8개 ABI 변형과 일부 실제 정확도·trace | 변형별 정식 공통 비교 |
| E1 Rust + Mojo AIR | 정식 5회 비교, 정확도, 1-buffer 물리 trace | 별도 구현자의 독립 재측정 및 제품 통합 검토 |
| E2 Swift | 기존 요청으로 중단 | 재개하지 않음 |
| E3 Zig + C/Metal | 실제 정확도·성장 후 재사용·Rust static ABI, 진단 측정 | 1-buffer/분할 제출의 정식 공통 비교 |
| E4 Core ML | GPU 정확도와 수정된 static82 native 게이트 | 지원 모드 정식 성능 비교, 실제 ANE 실행 확인 |
| E5 Go/cgo | 탐색 측정, CPU fake-backend 공통 ABI 검증 | 실제 GPU 공통 게이트와 정식 비교 |

원래 Mojo의 `mojo-original-final-20261020-191446`은 마지막 프로세스에서
Offline까지 기록했지만 Server·종료 메타데이터가 완결되지 않았다. 실행 중인
측정 프로세스는 공개 정리 시점에 없었다. 앞선 중단 실행과 합치거나 표본 수를
줄여 정식 완료로 바꾸지 않았다. Claude 크레딧 만료로 계획했던 Opus 재측정과
Sonnet 최종 논문도 수행되지 않았다. 이 항목들은 이 커밋으로 완료 처리하지 않는다.

## 제품 판단

E1은 사전 성능 조건을 관측상 충족하지만 모델 파일은 약 1.084GB이고 GPU
가중치 사본만 약 1.626GB다. M5 전용 경로, nightly AIR ABI, 서명·공증,
실제 Tauri 로드, 취소·실패 fallback, 인덱스 호환성, Windows를 검증하지 않았다.
따라서 연구 코드를 격리해 보존하며 앱 엔진·모델 다운로드·semantic index를
바꾸지 않는다. 버전은 0.2.2를 유지하며 이번 변경은 제품 릴리스가 아니다.

## 공개 전 확인

2026-10-21에 하네스 Rust 테스트 4개, E1 모델 검증 테스트 1개, 하네스 Python
자체 검증, Core ML 게이트의 CPU 자체 검증, Go fake-backend ABI smoke를 다시
통과했다. 기존 Mojo Rust 도구의 release cargo check, Go vet·c-shared 빌드, Zig format 검사, Python 소스 구문 검사,
shell 구문 검사도 통과했다. 공개 E1 데이터에서 통계·그래프를 다시 생성했고
summary JSON이 원래 실행 결과와 정확히 일치함을 확인했다. 공개 evidence는
SHA-256 manifest로 검사했다.

이는 GPU의 독립 재측정이 아니다. 제품 UI·실제 Tauri 통합·서명·공증·Windows와
나머지 후보의 정식 성능 연구는 실행하지 않았다. 공개 전 검사는 주석이나
보고서의 완료 문구가 아니라 실제 테스트 종료 상태와 완결 CSV 검증을 근거로 한다.
