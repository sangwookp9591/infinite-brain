#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Coordinator-scheduled original Mojo pair; frozen runtime closure, strict sampling.
set -euo pipefail
cd "$(dirname "$0")"
export IB_MOJO_LIBRARY
IB_MOJO_LIBRARY=$(.venv/bin/python - <<'PY'
import json
print(json.load(open('build/mojo-original-manifest.json'))['backend'])
PY
)
export IB_ENGINE_MODELS
IB_ENGINE_MODELS=$(.venv/bin/python - <<'PY'
import json
m=json.load(open('build/mojo-original-manifest.json'))
print(json.dumps({m['adapter']:m['model']}))
PY
)
export IB_ENGINE_FACTORS
IB_ENGINE_FACTORS=$(.venv/bin/python - <<'PY'
import json
m=json.load(open('build/mojo-original-manifest.json'))
print(json.dumps({m['adapter']:{'kernel':'Mojo','host':'DeviceContext','precision':'FP16','submission':'per-operation'}}))
PY
)
export IB_EXTRA_ARTIFACTS
IB_EXTRA_ARTIFACTS=$(.venv/bin/python - <<'PY'
import json
from pathlib import Path
m=json.load(open('build/mojo-original-manifest.json'))
a=m['artifacts'];a[str(Path.home()/'.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf')]='6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc'
print(json.dumps(a))
PY
)
unset IB_LAB_SMOKE
export IB_RESULTS_DIR="$PWD/results/mojo-original-final-$(date +%Y%m%d-%H%M%S)"
mojo_adapter=$(.venv/bin/python - <<'PY'
import json
print(json.load(open('build/mojo-original-manifest.json'))['adapter'])
PY
)
./run.sh "$mojo_adapter"
