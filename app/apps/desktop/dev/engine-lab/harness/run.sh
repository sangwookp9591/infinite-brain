#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "$0")"
if [[ $# == 0 ]]; then
    echo 'Usage: ./run.sh <engine.dylib>... (baseline is inserted automatically)' >&2
    exit 2
fi
mkdir -p build
cargo build --release --locked
clang -dynamiclib -O2 -Wall -Wextra mojo_adapter.c -o build/libib_mojo.dylib
clang -O2 -fobjc-arc -framework Foundation thermal.m -o build/thermal
clang++ -std=c++17 -O3 -fobjc-arc -framework Foundation -framework Metal -framework MetalPerformanceShaders microbench.mm -o build/microbench
if [[ ! -x .venv/bin/python ]]; then
    uv venv --python 3.11 .venv
fi
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python selfcheck.py
.venv/bin/python pipeline.py "$@"
