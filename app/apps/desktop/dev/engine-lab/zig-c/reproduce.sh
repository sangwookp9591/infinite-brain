#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
set -eu
cd "$(dirname "$0")"
unset IB_ZIG_DEBUG IB_ZIG_SPLIT
sh build.sh
python3 predict.py build
cargo build --release --target-dir build/cargo
OUT="$PWD/results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
# This suite remains the shared original regression gate; no assertions are replaced.
(
  until mkdir /private/tmp/ib-gpu-bench.lock 2>/dev/null; do sleep 5; done
  trap 'rmdir /private/tmp/ib-gpu-bench.lock' EXIT
  /private/tmp/ib-mojo-spike/rust-target/release/reference \
    "$HOME/.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf" \
    ../../mojo-engine/inputs.json "$OUT/q8-original.json" > "$OUT/q8-original.log" 2>&1
  IB_MOJO_PREFIX=ib_mojo_gpu /private/tmp/ib-mojo-spike/venv/bin/python \
    ../../mojo-engine/verify.py "$PWD/build/libib_zig.dylib" \
    /private/tmp/ib-mojo-spike/weights.bin "$OUT/q8-original.json" "$OUT/zig-original.json" > "$OUT/zig-original.log" 2>&1
  GATE_STATUS=0
  /private/tmp/ib-mojo-spike/venv/bin/python ../../mojo-engine/gate.py \
    "$OUT/q8-original.json" "$OUT/zig-original.json" > "$OUT/original-gate.json" || GATE_STATUS=$?
  test "$GATE_STATUS" -le 1
  python3 - "$OUT/original-gate.json" "$GATE_STATUS" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert set(r['checks'])=={'cosine','latency','throughput'}
assert r['adopt']==(int(sys.argv[2])==0)
PY
  python3 - "$OUT/q8-original.json" <<'PY'
import json,struct,sys
from pathlib import Path
r=json.load(open(sys.argv[1]))['rows'][0]
Path('build/tokens.bin').write_bytes(struct.pack('<'+'i'*len(r['ids']),*r['ids']))
Path('build/vector.bin').write_bytes(struct.pack('<768f',*r['vector']))
PY
  build/cargo/release/zig-static-smoke /private/tmp/ib-mojo-spike/weights.bin \
    build/tokens.bin build/vector.bin > "$OUT/static-smoke.log"
  /private/tmp/ib-mojo-spike/venv/bin/python microbench.py "$OUT/calibration.json" > "$OUT/calibration.log"
  python3 predict.py "$OUT" > "$OUT/prediction.log"
)
MODELS=$(python3 - <<'PY'
import json
from pathlib import Path
print(json.dumps({str(Path('build/'+p).resolve()):'/private/tmp/ib-mojo-spike/weights.bin' for p in ['libib_zig.dylib','libib_zig_split.dylib']}))
PY
)
IB_RESULTS_DIR="$OUT/shared" IB_ENGINE_MODELS="$MODELS" sh ../harness/run.sh \
  "$PWD/build/libib_zig.dylib" "$PWD/build/libib_zig_split.dylib"
../harness/.venv/bin/python plot_calibration.py "$OUT/shared" "$OUT/calibration.json" "$OUT/roofline-e3.png" > "$OUT/roofline-e3.json"
printf 'Results: %s\n' "$OUT"
