<!-- SPDX-License-Identifier: Apache-2.0 -->
# 다른 PC에서 Engine Lab 이어가기

2026-10-21. 먼저 [비교 보고서](ENGINE-LAB-COMPARISON.md),
[알고리즘·논문](ENGINE-LAB-ALGORITHMS-AND-METHODS.md),
[방법론](ENGINE-LAB-METHODOLOGY.md)을 읽는다. 앱 엔진은 llama.cpp이고 버전은
0.2.2다. 연구 후보를 앱에 연결하거나 릴리스한 상태가 아니다.

## 받을 자료와 기기 조건

| 자료 / 기기 | 가능한 작업 |
| --- | --- |
| Git의 main만 받음 | 코드·보고서 검토, 공개 E1 CSV 5,100행 재분석 |
| 별도 handoff archive도 받음 | Q8/BF16/변환 가중치, 남은 동결 runtime과 Core ML 모델, 중단 원본 보존·활용 |
| Windows / Linux / M5 이외 Mac | Python 통계 재분석·문서·코드 작업. 기존 M5 엔진의 GPU 재측정 가능성은 입증하지 않음 |
| Apple M5 + macOS | 도구와 모델 검사 후 native 연구 재개. 기존 측정 환경은 macOS 27.0.1, Xcode/Metal 27 |

기존 `/private/tmp/ib-mojo-spike`, `/private/tmp/ib-mojo-opt`,
`/private/tmp/ib-engine-e1`은 인계 준비 시점에 존재하지 않았다. 반면 저장소의
ignored `harness/build/`에는 원래 Mojo runtime closure와 수정된 E4 static82
closure가 남아 있었다. **E1 metallib/kernel-name closure와 E0의 동결 8변형은
보존됐다고 가정하지 말고 다시 빌드한다.** 기존 보고서의 절대 경로는 관측 기록이다.

별도 archive는 이 Mac의 Downloads에 생성하며 Git에 올리지 않는다. 내부 구조:

```text
README.md                         이 인계서
infinite-brain-main.bundle         main 이력과 코드 (Git 원격 없이 clone 가능)
inventory.json                    payload별 크기와 SHA-256, 원본 base commit
SHA256SUMS                        archive 내부 파일 검증
models/                           Q8 GGUF, BF16 GGUF, 변환 weights.bin
runtime/mojo-original/             adapter/backend 및 네 runtime dylib
runtime/zig/                       1-buffer / split 후보 dylib
runtime/coreml-enumerated/          GPU 후보 dylib와 compiled model
runtime/coreml-static82/            수정된 macOS15 대상 dylib와 compiled model
raw/harness-results/               원래 Mojo 중단본과 E1·E4 원본
```

가상환경, compiler 설치본, Rust target cache, 개인 vault, `.env`, 인증 토큰,
SSH/업데이터 키, Orca 세션 데이터는 포함하지 않는다. 의존성 설치에는 네트워크가
필요하다. 모델 포함 archive는 개인 기기 간 인계용이며 public Git/Release에 올리지 않는다.

## 1. 코드와 archive 검증

온라인이면 `git clone https://github.com/sangwookp9591/infinite-brain.git` 후
`git switch main`과 `git pull --ff-only`로 시작한다. 기존 checkout은 먼저
`git status --short`로 작업을 확인하고 임의 reset을 하지 않는다.

archive를 받았다면 **새 빈 디렉터리**에 풀고 내부 SHA-256을 먼저 검사한다.
macOS/Linux의 예:

```sh
tar -xf infinite-brain-engine-lab-handoff-*.tar -C /absolute/empty-directory
cd /absolute/empty-directory
shasum -a 256 -c SHA256SUMS
git clone --branch main ./infinite-brain-main.bundle ./infinite-brain
cd infinite-brain
git remote set-url origin https://github.com/sangwookp9591/infinite-brain.git
git status --short
```

archive 옆의 `.tar.sha256`는 archive 전송 손상을 검사한다. Windows에서도
`tar -xf`로 풀 수 있고 `Get-FileHash -Algorithm SHA256`으로 파일 hash를 검사할
수 있다. Git bundle을 clone한 뒤 원격을 위 URL로 교체해야 후속 pull/push가 된다.

아래 모델 세 개는 인계 준비 시 원본 파일에서 직접 다시 해시했다:

| 파일 | bytes | SHA-256 |
| --- | --- | --- |
| `embeddinggemma-2-Q8_0.gguf` | 309855520 | `6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc` |
| `embeddinggemma-2-BF16.gguf` | 557950240 | `f315cbbb30dd487e44d501c8902abe88808755e43753a96beed1964f0a48aa4f` |
| `weights.bin` | 1084026976 | `edbf9720b35ccbe13dbea1e74da31d7057ea497e9b3b98ed1944462517009f34` |

Q8 취득 원본은 `src-tauri/src/semantic.rs`의 pinned MODEL_URL/bytes/SHA다.
archive 없이 BF16을 다시 구하면 파일명이 같다는 이유로 채택하지 말고 위 해시를
검사한다. BF16→weights 변환은 `dev/mojo-engine/convert.py`를 사용한다.

## 2. 모든 PC에서 먼저 할 CPU 재분석

아래 명령은 repo root에서 시작한다. Python 3.11 venv를 만들고 정확한 분석
의존성만 설치한다. 앱의 pnpm 설치·서버·DB는 필요 없다.

```sh
cd app/apps/desktop/dev/engine-lab/harness
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python analyze.py ../evidence/e1-final-20261020-173052
```

Windows PowerShell은 venv 생성 명령을 `py -3.11 -m venv .venv`로,
Python 실행 경로를 `.venv\Scripts\python.exe`로 바꾼다.
이 venv는 해당 디렉터리의 `.gitignore`로 제외된다. 그래프 재생성은
라이브러리 환경에 따라 PNG byte가 바뀔 수 있으므로 `git diff`를 확인하고
원본 evidence를 덮어쓴 결과를 측정값 변경으로 커밋하지 않는다. 가능하면
evidence 디렉터리를 repo 밖에 복사해서 재분석한다.

`harness/selfcheck.py`는 macOS dylib와 clang을 요구하므로 Windows/Linux에서
실행할 CPU-only 분석 명령으로 사용하지 않는다. `analyze.py`는 dylib를 로드하지 않는다.

## 3. M5에서 실제 측정 재개

기존 설치 기록: Rust/Cargo 1.94.0, Python 3.11.16, uv 0.12.9,
Mojo 1.2.0rc2 (`2016d0cd`), Modular/MAX 26.7.0rc2,
Xcode/Metal 27.0/27A266a, Zig 0.17.0, Core ML 변환 coremltools 9.0 /
PyTorch 2.14.1. Go 버전은 `go.mod`와 실제 설치값을 확인한다.
이는 재현 환경 기록이며 더 최신 버전으로 조용히 바꾸지 않는다. pinned nightly가
없으면 중단 이유를 기록하고 새로운 compiler cohort를 구분한다.

먼저 `uname -m`, `sw_vers`, `system_profiler SPHardwareDataType`,
`xcodebuild -version`, `xcrun --find metal`, `rustc -V`, `cargo -V`,
`python3.11 -V`, `uv --version`을 확인한다. 출력의 serial/UUID/UDID를 공개 자료에 넣지 않는다.
도구 설치와 모델 이동 후에도 native 실행 호환성은 실제 gate로 확인해야 한다.

archive를 푼 디렉터리를 `TRANSFER`, checkout의 절대 경로를 `REPO`로 지정한다.
아래는 **원래 Mojo를 새 기준선과 새 전체 cohort로 재측정**하는 예다.

```sh
export TRANSFER=/absolute/unpacked-handoff
export REPO=/absolute/infinite-brain
export IB_Q8_MODEL="$TRANSFER/models/embeddinggemma-2-Q8_0.gguf"
export IB_MOJO_MODEL="$TRANSFER/models/weights.bin"
export IB_MOJO_LIBRARY="$TRANSFER/runtime/mojo-original/optimized-final.dylib"
export IB_REFERENCE_CHECK="$REPO/app/apps/desktop/dev/engine-lab/evidence/e1-final-20261020-173052/reference.json"
unset IB_LAB_SMOKE IB_ENGINE_MODELS IB_ENGINE_FACTORS E1_OUT
cd "$REPO/app/apps/desktop/dev/engine-lab/harness"
export IB_RESULTS_DIR="$PWD/results/resume-mojo-$(date +%Y%m%d-%H%M%S)"
./run.sh "$PWD/build/libib_mojo.dylib"
```

실행 전에 runtime 네 dylib·backend·모델의 hash를 `inventory.json`과 검사하고,
측정 중에도 보존할 파일을 `IB_EXTRA_ARTIFACTS` JSON map에 넣어 전후 검사를 켠다.
[하네스 README](../../app/apps/desktop/dev/engine-lab/harness/README.md)의 계약을 따른다.
기존 `run-mojo-final.sh` / `run-e1-final.sh`는 이 Mac의 frozen 경로에 묶인
세션 launcher다. 새 PC에서는 위처럼 실제 절대 경로를 명시하거나 launcher를
새로 준비한다. 옛 manifest의 `/Users/iron/...` 경로를 그대로 실행하지 않는다.

E1은 [Mojo 준비](../../app/apps/desktop/dev/mojo-engine/README.md)의 pinned
venv를 다시 만들고 `MOJO`를 실제 compiler로 지정한다. `rust-metal/build.py`에
새 writable `E1_OUT`을 전달해 AIR·metallib·kernel-name JSON을 재생성한다.
runtime에도 같은 `E1_OUT`을 전달한다. 새 compiler에서 kernel 이름 assertion이
실패하면 이름만 대충 고쳐 통과시키지 말고 AIR ABI와 launch shape를 확인한다.
기존 frozen dylib를 새 metallib와 섞지 않는다.

E0는 `mojo-engine/build_e0.py`로 변형을 새로 만들고 core backend hash를 고정한다.
E3는 `zig-c/build.sh`로 native library를 다시 만들 수 있다. E4의 compiled
model은 OS/toolchain 호환성이 있으므로 gate 실패 시 BF16에서 `.mlpackage`와
`.mlmodelc`를 다시 생성한다. E4 CPU_AND_GPU와 static82 CPU_AND_NE를 구분하고,
`plan`의 ANE 선호를 실제 ANE 실행으로 간주하지 않는다. E5는 Go c-shared를
빌드하고 fake ABI smoke 후 실제 모델 gate를 실행한다. 각 엔진 README가 상세 절차다.

## 4. 다음 작업 순서와 완료 조건

1. 이 인계서, `CLAUDE.md`, `AGENTS.md`를 읽고 원본 evidence의 해시·재분석을 확인한다.
2. 기기·도구·모델·runtime closure를 점검한다. M5 이외 GPU 포팅은 별도 작업이다.
3. 원래 Mojo 전체 5쌍을 새 실행으로 완료한다. 기존 9개 완결+1개 부분 표본을
   새 PC의 마지막 한 프로세스로 보충하지 않는다.
4. E0 8변형, E3 2개 제출 셀, E4 지원 모드, E5의 정확도와 정식 공통 연구를 진행한다.
   E2 Swift는 기존 중단 요청을 유지한다. GPU 작업은 한 번에 하나만 실행한다.
5. 별도 검증자가 같은 Mac의 새 cohort에서 독립 재측정한다. 모델 배치는
   `model-routing` 스킬과 사용자 승인 범위를 따른다. Claude 크레딧 만료를
   이유로 검증을 수행한 것으로 처리하거나 다른 모델을 무단 배치하지 않는다.
6. 검증 뒤 최종 비교 논문·제품 비용 판정을 갱신한다. 제품 채택은 메모리,
   취소·실패 fallback, Tauri 로드, 서명·공증, 비M5/Windows, 인덱스 계약 검증이 필요하다.

정식 기준은 정확도 cosine≥0.999, workload별 예열10회, 엔진별 독립 프로세스5개,
각 측정30회다. Offline trial은 문단100개이며 7개 batch 수준을 모두 검사한다.
낮은 반복 수의 smoke/screening은 이 연구의 최종 통계로 쓰지 않는다.
다른 기기의 수치를 기존 M5 cohort와 합치지 않고 기기별 paired baseline을 잰다.
중단 실행은 원형 보존하고 `analyze.py`의 완결 검사나 예외를 우회하지 않는다.

기존 Orca Run/Task ID는 [코디네이터 기록](ENGINE-LAB-COORDINATION.md)의 이력이다.
다른 PC로 terminal handle, active Dispatch 권한, inbox 대기 상태가 복사되지는 않는다.
`orchestration` / `model-routing` 스킬을 해당 PC에서 로드하고 실제 런타임을
점검한 뒤 로컬 권한에 맞는 coordinator Run을 사용한다. 존재하지 않는 옛 worker를
종료하거나 새 worker의 완료를 옛 Dispatch ID로 제출하지 않는다.

## 새 코디네이터에게 전달할 문장

```text
Infinite Brain Engine Lab 연구를 이어서 진행해 주세요.
docs/reports/ENGINE-LAB-HANDOFF.md를 먼저 읽고 CLAUDE.md/AGENTS.md를 준수하세요.
orchestration과 model-routing 스킬을 사용하되 기존 런타임 ID를 현재 권한으로 가정하지 마세요.
E1 5회 비교는 완료됐고 다른 셀·독립 재측정·앱 통합은 미완료입니다.
handoff archive의 inventory/SHA256SUMS와 대상 하드웨어를 먼저 확인하세요.
중단 표본이나 서로 다른 PC의 표본을 합치지 말고 새 paired cohort로 진행하세요.
제품 채택·릴리스로 포장하지 말고 실제 게이트와 완결 원본으로 결과를 증명하세요.
```
