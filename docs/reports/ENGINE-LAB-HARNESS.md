<!-- SPDX-License-Identifier: Apache-2.0 -->
# 공통 임베딩 엔진 벤치마크 하네스

2026-10-20. [실험 방법론](ENGINE-LAB-METHODOLOGY.md)의 C ABI와 세 시나리오를 구현한 격리 실험이다. 구현 위치는 [harness](../../app/apps/desktop/dev/engine-lab/harness/README.md)이며 앱의 엔진·인덱스·모델 배포 경로는 변경하지 않는다.

## 초록

본 문서는 공통 하네스의 방법, 자체 검증, llama.cpp Q8_0 Metal과 현재 Mojo FP16의 동일 세션 비교를 기록한다. 독립 프로세스 다섯 개를 통계 단위로 사용하며 정확도 게이트를 통과한 완결 실행만 성능 분석에 포함한다. 현재 이 파일의 측정 표는 실행 종료 후 원본 CSV로 생성한다.

## 1. 방법

공통 [ib_engine.h](../../app/apps/desktop/dev/engine-lab/harness/ib_engine.h)는 init/embed/free/name을 필수로, batch/stats를 선택으로 정의한다. 배치 길이는 `size_t[]`이며 Mojo의 기존 `int32_t[]`와 혼동하지 않는다. Mojo 어댑터는 크기·합계 토큰 수를 검사한 뒤 길이를 변환한다. batch 심볼이 없으면 네이티브 러너가 순차 embed로 대체하고 이 여부를 기록한다. stats를 제공하지 않는 엔진의 명령 버퍼·dispatch 값은 빈 값으로 남긴다.

Q8 기준선은 앱 및 기존 Mojo 실험과 같은 `llama-cpp-2` git SHA `cb98c630d0fec934a8a379db4fd63cd3622f6984`를 사용한다. Metal 전체 offload, CPU 스레드 4개, noncausal attention, mean pooling 및 768차원 L2 정규화 조건을 유지한다. 단일 입력은 최소 2048 context, 묶음은 sequence당 256 슬롯을 사용하고 나머지 그룹은 준비된 context를 재사용한다. 초기화와 context 확장은 예열에서 제외한다. Mojo는 기존 `/private/tmp/ib-mojo-opt/optimized-final.dylib`와 `/private/tmp/ib-mojo-spike/weights.bin`을 읽기 전용으로 사용한다.

토큰화는 기존 `dev/mojo-engine/inputs.json`의 한·영 20개 문장에 대해 한 번 실행한다. 문단 지연/처리량은 첫 번째 82토큰 입력을 사용한다. 각 프로세스는 20개 단일 벡터와 서로 다른 길이의 20개 배치를 검사한다. 코사인 0.999 이상, 유한한 원소, 단위 노름을 요구하고 최대 절대 오차를 기록한다. 각 Offline 묶음의 모든 출력과 큰 workspace 사용 뒤 작은 입력도 검사한다.

시나리오는 SingleStream, Offline, Server이다. SingleStream은 앞 호출이 끝난 뒤 다음을 보낸다. Offline 한 표본은 100개 독립 문단이며 묶음 1/4/8/16/32/64/100과 마지막 나머지 그룹을 포함한다. Server는 seed를 고정한 포아송 도착을 5/10/20/30/40/50/60/80/100 QPS에서 재생하고 단일 엔진 worker가 직렬 처리한다. 지연은 예정 도착 시각부터 완료까지이므로 밀린 요청을 제거하거나 생성 시각을 뒤로 미루지 않는다.

기본 실행은 A/B/A/B 순서의 엔진별 독립 프로세스 5회이며, 각 workload에서 10회 예열 후 30회 측정한다. 모든 GPU 작업은 `/private/tmp/ib-gpu-bench.lock` 디렉터리를 직접 획득한 프로세스만 수행한다. 다른 worker의 잠금을 임의 해제하지 않는다. 측정 루프는 Rust `Instant`, 동적 라이브러리 로더는 `libloading`이며 Python은 프로세스 실행과 분석만 담당한다.

원본 CSV는 엔진, 프로세스, 반복, 시나리오·묶음·QPS, 서비스 시간, 대기 포함 지연, 처리량, 선택적 카운터를 기록한다. JSON은 모델·dylib·참조 파일 SHA-256(디렉터리는 정렬된 상대 경로·파일 SHA manifest), 하드웨어(Serial/UUID/UDID 제외), swap/VM 상태, OS, Rust/Cargo/clang/Xcode/Mojo 버전, 전원, `pmset`과 `NSProcessInfo` 열 상태를 보관한다.

## 2. 통계 및 분석 모델

전체 호출의 p50/p90/p99와 IQR은 기술 통계다. 추론의 단위는 독립 프로세스의 중앙값이며, 그 중앙값에 대해 seed 20261020, 10,000회 percentile bootstrap으로 95% 구간을 구한다. 처리량 평균±표준편차는 프로세스별 평균 간의 값이다. Mann–Whitney U와 Cliff's δ는 프로세스 중앙값끼리 비교하고 후보별로 바로 앞의 기준선 다섯 프로세스를 비교하고, 모든 후보의 시나리오·수준 비교를 한 family로 Holm 보정한다. 표본 5개의 검정 해상도는 낮다.

마이크로벤치마크는 실제 Metal device에서 128MiB blit stream copy, FP16 MPS GEMM 1024/2048/4096, 깊이 1~256의 작은 compute command buffer를 잰다. 각 조건은 5회 예열 후 30회 반복한다. 복사 대역폭은 읽기+쓰기 바이트를 사용한다. CPU commit 비용과 commit부터 완료까지 비용을 분리하며, 기본 64개 command-buffer 할당 제한으로 준비 단계가 교착되지 않도록 queue 최대 수를 512로 설정한다. 이 조건은 모든 runtime의 queue 제한을 대표하지 않는다.

모델 행렬 shape에서 FLOPs와 가중치 payload를 먼저 계산하고, **η=1, 미측정 host/gap/readback=0**으로 `max(aggregate kernel floor, CPU commit cost)`를 고정한다. CPU commit과 GPU 실행의 겹침을 고려하므로 두 시간을 더하지 않는다. 이 값은 측정 BW·MPS peak를 상한으로 가정한 경험적 envelope 추정이며 하드웨어에서 입증한 하한이나 커널별 `max`의 합이 아니다. 별도로 기록하는 비중·Amdahl 예시는 비겹침 가정의 설명값이며 실측 제거 가능 비율이 아니다. 이전 트레이스의 llama 3개, Mojo 425개(계산 417+복사 등 8) 버퍼 수는 예측 입력이며 이번 실행의 runtime 카운터로 표시하지 않는다. 결과를 본 뒤 계수를 끼워 맞추지 않는다. 이 envelope는 완전히 보정한 전체 지연 예측과 다르며, 20% 이상 어긋나면 진단 필요로 표시한다. Roofline은 검증한 GEMM 실측점과 엔진 전체의 aggregate proxy를 구분한다.

## 3. 하네스 자체 검증

- Rust 단위 테스트 4개 통과: NaN·비단위 벡터 거절, 포아송 표본 평균, 모델 디렉터리 재귀 해시의 재현성·내용 변경 감지 및 장치 식별자 제거, 선택적 batch가 없을 때 토큰/출력 stride·실패 전달·카운터 미확인 처리.
- Python 자기 검증: 실제 기준선 dylib 로드, seeded bootstrap 재현성, Holm 보정, Cliff's δ 방향·tie 처리, 완결 예정 실행/시나리오 계수 검증, 후보별 기준선 분리, 미완결 행·비유한 게이트 거절 통과.
- C ABI 자기 검증: 기존 Mojo ABI를 흉내 낸 작은 dylib로 `[2,5,7]`의 `size_t` 길이가 정확히 `int32`로 전달됨을 검사했고 null·초과 배치·초과 길이 거절을 통과했다.
- 기준선의 새 참조 벡터는 기존 독립 `reference.rs`의 Q8 oracle과 20개 토큰 ID·벡터가 일치했다. 최소 코사인 1.0, 최대 절대 오차 0.0이다.
- 초기 스모크는 Rust 1.94/Xcode 27의 Mach-O LINKEDIT 문자열 테이블 정렬 오류를 실제로 발견했다. 최적화는 유지하고 하네스 패키지에만 `debug=1`, `strip=none`을 적용해 로드를 복구했으며, GPU 작업 전 실제 로드 회귀 검사를 추가했다. 관련 upstream 기록은 [rust#157750](https://github.com/rust-lang/rust/issues/157750)이다.
- `results/20261020-171128-smoke`에서 Q8·Mojo 모두 정확도 게이트와 SingleStream/일곱 Offline/아홉 Server 수준, 분석·PNG 생성을 완주했다. 1프로세스×1호출의 연결 검증이며 p값·용량 추론은 생략한다.
- 독립 실측 스모크와 본 실행은 별도 결과 경로에 보관하며 스모크는 연구 결과로 해석하지 않는다.

## 4. 결과

2026-10-21 공개 정리: 원래 Mojo 비교는 중단되어 최종 통계를 생성하지 않았다. 복구 실행은 9개 프로세스만 완결됐고 마지막 후보 프로세스는 Server 및 종료 메타데이터가 없다. 부분 실행 전체를 최종 추론에서 제외한다. 별도 E1 비교는 10개 프로세스·5,100행 완결 검증을 통과했으며 [비교 보고서](ENGINE-LAB-COMPARISON.md)와 [공개 원본](../../app/apps/desktop/dev/engine-lab/evidence/README.md)을 따른다. 원래 Mojo와 다른 후보의 전체 정식 연구는 미완료다.

### 실행 복구 이력

`results/mojo-original-final-20261020-183836/`는 Orca runtime 재시작으로 중단됐다. 첫 두 A/B 쌍의 네 프로세스만 완료됐고 세 번째 기준선은 완료 표지가 없으므로, 디렉터리 전체를 **부분 실행**으로 보존하며 최종 통계에 포함하지 않는다. 성능에 따른 재시도가 아니라 프로세스 소실에서의 복구다.

복구 실행 `results/mojo-original-final-20261020-191446/`는 새 고유 디렉터리에서 전체 다섯 쌍을 다시 시작했다. 기존 frozen Mojo runtime closure의 7개 artifact와 Q8 모델의 SHA-256, 기존 하네스 소스 12개의 해시를 확인했고 예열 10회·측정 30회·전체 시나리오를 변경하지 않았다. 완료된 별도 E1 비교는 재실행하거나 이번 원래 Mojo 표본에 합치지 않았다. 실행과 인계 순서는 [코디네이터 기록](ENGINE-LAB-COORDINATION.md)을 따른다.

## 5. 한계

공유 M5 한 대의 synthetic 20개 입력과 82토큰 문단 중심 측정이다. 잠금은 협조하는 실험끼리만 직렬화하며 다른 앱·CPU 작업·기기 열 상태를 통제하지 않는다. Server는 QPS당 총 150요청의 관측이며 장시간 처리 용량이나 다중 worker 서버의 증명이 아니다. 두 엔진만으로 커널·호스트·정밀도·제출 요인을 분리할 수 없으므로 A–D 주효과·상호작용은 식별할 수 없다. 일곱 묶음 수준은 E 요인만 다룬다.

복사 엔진의 실효 BW가 모든 compute kernel의 BW와 같다는 보장은 없다. MPS square GEMM peak는 Mojo의 M=82 커널 효율 또는 Q8 dequantization 비용이 아니다. η와 전체 critical path를 보정한 예측, 이번 실행의 커널별 GPU counter/trace는 별도 검증 대상이다. 앱 통합, 검색 품질, 긴 문맥, 서명·공증, Windows 및 다른 Mac의 실제 동작은 검사하지 않았다.

설치 의존성은 이 하네스의 Cargo lockfile과 Python venv에 격리했다. Endor의 `libloading 0.8.9` 위험 조회는 인증 정보 부재로 실패했으므로 외부 취약점·정책 검토 완료로 주장하지 않는다.
