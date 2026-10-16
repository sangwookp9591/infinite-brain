#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# 한 설정을 한 프로세스로 측정하고 key=value 와 최대 RSS(MB)를 한 블록으로 출력한다.
# 사용: run-bench.sh <bin> <model.gguf> <gpu-layers> <threads> [dump.txt]
set -euo pipefail
BIN=$1; MODEL=$2; NGL=$3; THREADS=$4; DUMP=${5:-}
OUT=$(mktemp)
ARGS=(--model "$MODEL" --gpu-layers "$NGL" --threads "$THREADS")
[ -n "$DUMP" ] && ARGS+=(--dump "$DUMP")
/usr/bin/time -l "$BIN" "${ARGS[@]}" >"$OUT.out" 2>"$OUT.err" || { echo "FAILED"; tail -5 "$OUT.err"; exit 1; }
echo "## $(basename "$BIN") model=$(basename "$MODEL") ngl=$NGL threads=$THREADS"
grep -E '^[a-z_0-9]+=' "$OUT.out" | grep -v '^device='
grep -E '^device=' "$OUT.out"
awk '/maximum resident set size/ {printf "peak_rss_mb=%.0f\n", $1/1048576} /peak memory footprint/ {printf "peak_footprint_mb=%.0f\n", $1/1048576}' "$OUT.err"
rm -f "$OUT" "$OUT.out" "$OUT.err"
