#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# 측정 행렬 전체를 순차 실행해 stdout으로 낸다. CPU 경합을 피하려고 병렬로 돌리지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."
M=${MODELS:-$HOME/.cache/infinite-brain-b0/models}
D=${DUMPS:-$HOME/.cache/infinite-brain-b0/dumps}; mkdir -p "$D"
CPU=target/cpu/release/bench; MET=target/metal/release/bench
R=./scripts/run-bench.sh
Q4=$M/embeddinggemma-2-UD-Q4_K_XL.gguf; Q8=$M/embeddinggemma-2-Q8_0.gguf; BF=$M/embeddinggemma-2-BF16.gguf; F16=$M/embeddinggemma-2-F16.gguf
echo "# CPU 전용 빌드(GGML_METAL=OFF), 성능 코어 4 스레드"
for m in Q4 Q8 BF; do eval f=\$$m; $R $CPU "$f" 0 4 "$D/cpu-$m.txt"; done
echo "# CPU 전용 빌드, 스레드 수 비교(Q4)"
$R $CPU "$Q4" 0 6 
$R $CPU "$Q4" 0 10
echo "# Metal 포함 빌드, GPU 전 층 오프로드"
for m in Q4 Q8 BF; do eval f=\$$m; $R $MET "$f" 99 4 "$D/metal-$m.txt"; done
echo "# F16 GGUF (Unsloth 경고 확인용: float16 활성값 범위)"
$R $CPU "$F16" 0 4 "$D/cpu-F16.txt" || true
$R $MET "$F16" 99 4 "$D/metal-F16.txt" || true
