<!-- SPDX-License-Identifier: Apache-2.0 -->
# Engine Lab 코디네이터 인계와 공개 상태

2026-10-21. Claude 크레딧 만료 후 Codex가 기존 Orca Run
`run_5e2e2aedc9c7`의 자료를 인계받았다. 연구의 현재 결론과 한계는
[비교 보고서](ENGINE-LAB-COMPARISON.md), 알고리즘·논문 정의는
[방법 해설](ENGINE-LAB-ALGORITHMS-AND-METHODS.md)을 기준으로 읽는다.
다른 PC에서 재개하는 절차와 별도 artifact 인계 범위는
[PC 인계서](ENGINE-LAB-HANDOFF.md)를 따른다.

## 실행 상태

공개 정리 시점에 해당 Run의 active worker는 없고, 원래 Mojo native 측정
프로세스도 실행 중이지 않았다. 런타임 재시작으로 마지막 측정 worker의
Dispatch는 failed/abandoned 상태다. `user_owned`로 전환된 터미널은 닫거나
해제하지 않았다. 없는 터미널 상태를 프로세스 종료의 유일한 근거로 쓰지 않았다.

E1의 10개 프로세스·5,100행 완결 비교는 별도로 검증했고 공개 근거에 보존했다.
원래 Mojo는 9개 프로세스만 완결됐으며 마지막 프로세스는 종료 메타데이터가
없다. 중단 결과를 E1 또는 앞선 원래 Mojo 실행과 합치지 않았다.

## Task별 근거와 미해결 작업

| Task | 결과 / 근거 | 미해결 작업 |
| --- | --- | --- |
| `task_ff3dfad960cc` E1 | 완료된 공통 반복 연구와 E1 보고서 | 별도 독립 검증·제품 채택은 이 Task의 완료 범위가 아님 |
| `task_2a14aafd7b62` 하네스 / 원래 Mojo | 공통 구현·CPU 검증 완료, 원래 Mojo 연구 중단 | 전체 5쌍 완결과 보고서 최종 통계 |
| `task_6e2de20eebe6` E0 | 8개 동결 ABI 변형, 일부 정확도·trace | 변형별 공통 성능 연구 |
| `task_29c01c8c2248` E3 | native 게이트·진단·static 호출 | 2개 제출 셀의 정식 비교 |
| `task_db90ea353f21` E4 | static82 shape 수정 후 실제 native 게이트 통과 | 지원 모드별 정식 성능 연구 |
| `task_0a2be80e1f92` E5 | 탐색 결과·공통 ABI CPU smoke | 공통 GPU 게이트·정식 성능 연구 |
| `task_82d1725732cd` 독립 검증 | 실행되지 않음 | Claude Opus 크레딧 또는 승인된 대체 검증자 |
| `task_c3076a68d6f0` 최종 논문 | 실행되지 않음 | 앞선 독립 검증; 현재 비교 보고서는 코디네이터 작성 |

E2 Swift는 기존 중단 요청을 유지한다. 소개 영상은 기존 커밋 `f499a26`의
`docs/assets/promo/infinite-brain-promo.mp4`를 유지한다.

## 재개 시 보존할 조건

- 하네스의 정확도 게이트, 예열 10회, 5개 프로세스 × 30회는 변경하지 않았다.
  Offline 3회 screening 전환 제안은 승인·적용하지 않았다.
- GPU 작업은 `/private/tmp/ib-gpu-bench.lock`으로 직렬화한다. 남의 잠금을
  제거하지 않으며, 소유 프로세스의 종료를 확인한 뒤에만 고아 잠금을 정리한다.
- 새로운 실행은 고유 결과 디렉터리를 사용하고, source/model/library/runtime
  artifact SHA-256을 측정 전후 확인한다. 부분 실행을 덮어쓰지 않는다.
- 동결 빌드는 로컬 `harness/build/`, `/private/tmp/ib-engine-e1/`,
  `/private/tmp/ib-mojo-opt/`에 있고 Git에 배포하지 않는다. 각 실험 README의
  재생성 경로와 실제 모델 취득 조건을 확인한다.
- 기존 상세 운영 기록은 로컬 `harness/results/coordination-before-publication.md`에
  보존했다. 이 공개 스냅샷은 미완료 Task를 완료 상태로 바꾸지 않는다.
