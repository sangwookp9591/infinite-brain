#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
cargo test --release --locked --lib
python3 analyze_work.py
LIB="$PWD/target/release/libib_rust_metal.dylib"
export IB_RESULTS_DIR="${E1_RESULTS:-$PWD/results/shared-$(date +%Y%m%d-%H%M%S)}"
export IB_ENGINE_MODELS
IB_ENGINE_MODELS=$(python3 -c 'import json,sys; print(json.dumps({sys.argv[1]:"/private/tmp/ib-mojo-spike/weights.bin"}))' "$LIB")
../harness/run.sh "$LIB"
python3 analyze_work.py "$IB_RESULTS_DIR"
printf 'Shared harness result: %s\n' "$IB_RESULTS_DIR"
