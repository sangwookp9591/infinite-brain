#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Coordinator-scheduled strict E1 pair; no sampling override.
set -euo pipefail
cd "$(dirname "$0")"
export E1_OUT=/private/tmp/ib-engine-e1/frozen-20261020-a
export IB_ENGINE_MODELS='{"/private/tmp/ib-engine-e1/frozen-20261020-a/libib_rust_metal.dylib":"/private/tmp/ib-mojo-spike/weights.bin"}'
export IB_ENGINE_FACTORS='{"/private/tmp/ib-engine-e1/frozen-20261020-a/libib_rust_metal.dylib":{"kernel":"Mojo AIR","host":"Rust Metal","precision":"FP16","submission":"one-buffer-per-paragraph"}}'
export IB_EXTRA_ARTIFACTS
IB_EXTRA_ARTIFACTS=$(.venv/bin/python - <<'PY'
import json
from pathlib import Path
manifest=json.loads(Path('../rust-metal/results/frozen-manifest.json').read_text())
artifacts={str(Path(manifest['directory'])/name):sha for name,sha in manifest['files'].items()}
artifacts[manifest['model_path']]=manifest['model_sha256']
print(json.dumps(artifacts))
PY
)
unset IB_LAB_SMOKE
export IB_RESULTS_DIR="$PWD/results/e1-final-$(date +%Y%m%d-%H%M%S)"
./run.sh "$E1_OUT/libib_rust_metal.dylib"
