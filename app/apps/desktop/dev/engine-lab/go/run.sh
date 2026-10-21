#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(cd "$HERE/../../../../../.." && pwd)
SPIKE=/private/tmp/ib-mojo-spike
OPT=/private/tmp/ib-mojo-opt
OUT=${IB_E5_RESULTS_DIR:-"$HERE/results/$(date +%Y%m%d-%H%M%S)"}
GO_BIN=/tmp/ib-go-e5
Q8="$HOME/.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf"
INPUTS="$ROOT/app/apps/desktop/dev/mojo-engine/inputs.json"
LIB="$OPT/package-final/optimized-final.dylib"
mkdir -p "$(dirname "$OUT")"
mkdir "$OUT"
mkdir "$OUT/raw"
(cd "$HERE" && go build -o "$GO_BIN" .)

locked() {
  until mkdir /private/tmp/ib-gpu-bench.lock 2>/dev/null; do sleep 5; done
  trap 'rmdir /private/tmp/ib-gpu-bench.lock' EXIT HUP INT TERM
  "$@"
  rmdir /private/tmp/ib-gpu-bench.lock
  trap - EXIT HUP INT TERM
}

for round in 1 2 3 4 5; do
  locked "$SPIKE/rust-target/release/reference" "$Q8" "$INPUTS" "$OUT/q8-$round.json" >"$OUT/q8-$round.log" 2>&1
  locked "$GO_BIN" -lib "$LIB" -model "$SPIKE/weights.bin" \
    -reference "$OUT/q8-$round.json" \
    -workers 32 -requests 50 -window 3ms -run "go-$round" \
    -raw-csv "$OUT/raw/go-$round.csv" >"$OUT/go-$round.log" 2>&1
done

# Isolate the batching-window trade-off at zero and six milliseconds.
for window in 0ms 6ms; do
  label=$(printf '%s' "$window" | tr -d 'ms')
  locked "$SPIKE/rust-target/release/reference" "$Q8" "$INPUTS" "$OUT/q8-window-$label.json" >"$OUT/q8-window-$label.log" 2>&1
  locked "$GO_BIN" -lib "$LIB" -model "$SPIKE/weights.bin" \
    -reference "$OUT/q8-window-$label.json" -workers 32 -requests 50 \
    -window "$window" -run "window-$label" -raw-csv "$OUT/raw/window-$label.csv" \
    >"$OUT/window-$label.log" 2>&1
done

# Final Q8 A arm to bracket the Go sequence; five runs in each arm are paired.
locked "$SPIKE/rust-target/release/reference" "$Q8" "$INPUTS" "$OUT/q8-after.json" >"$OUT/q8-after.log" 2>&1
printf 'raw data: %s/raw\n' "$OUT"
