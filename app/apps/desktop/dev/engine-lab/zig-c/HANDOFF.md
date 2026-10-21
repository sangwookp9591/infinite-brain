# E3 implementation and diagnostic handoff

2026-10-20. This delivery completes implementation and diagnostic work only. The coordinator explicitly retained the final two-cell study and report integration as **open Task `task_29c01c8c2248`**, owned by the harness/coordinator after this worker settles. The experiment and adoption decision are incomplete. There is no queued or running E3 GPU job.

From this directory, verify the immutable runtime closure before measurement:

```sh
shasum -a 256 -c results/setup/frozen-runtime.sha256
```

| Artifact | SHA-256 |
| --- | --- |
| `build/frozen/libib_zig.dylib` | `3224d038052d17d980dfe1c818c73cf0ab71cebabb02459109763258835019b7` |
| `build/frozen/libib_zig_split.dylib` | `f40737ef2e4eea7dbf7f80433d27629808a6e83abde471d79c21ead3059275c3` |
| `build/frozen/weights.bin` | `edbf9720b35ccbe13dbea1e74da31d7057ea497e9b3b98ed1944462517009f34` |

Both libraries and the model are read-only. The model is an APFS clone of the existing converted BF16 artifact, not a new download. The libraries depend only on macOS system frameworks/libraries. The original mutable build outputs remain available, but use the frozen copies for final research.

After the coordinator assigns the GPU turn, run the primary single-command-buffer cell using the already-built shared harness. Do not wrap the pipeline or native runner in another GPU lock; both manage their own acquisition. This runs a fresh Q8 reference/calibration, then five A/B process pairs with the unchanged 10 warmups and 30 calls/trials per scenario.

```sh
MODEL_MAP=$(python3 - <<'PY'
from pathlib import Path
import json
print(json.dumps({str(Path('build/frozen/libib_zig.dylib').resolve()):str(Path('build/frozen/weights.bin').resolve())}))
PY
)
IB_RESULTS_DIR="$PWD/results/final-singlecb-$(date +%Y%m%d-%H%M%S)" \
IB_ENGINE_MODELS="$MODEL_MAP" \
../harness/.venv/bin/python ../harness/pipeline.py "$PWD/build/frozen/libib_zig.dylib"
```

After that cell completes and the coordinator assigns the split-ablation turn:

```sh
MODEL_MAP=$(python3 - <<'PY'
from pathlib import Path
import json
print(json.dumps({str(Path('build/frozen/libib_zig_split.dylib').resolve()):str(Path('build/frozen/weights.bin').resolve())}))
PY
)
IB_RESULTS_DIR="$PWD/results/final-split-$(date +%Y%m%d-%H%M%S)" \
IB_ENGINE_MODELS="$MODEL_MAP" \
../harness/.venv/bin/python ../harness/pipeline.py "$PWD/build/frozen/libib_zig_split.dylib"
```

Unset `IB_ZIG_DEBUG`, `IB_ZIG_SPLIT`, and `IB_LAB_SMOKE` before final runs. The dedicated split library has the split setting compiled into only its Objective-C shim. Its Zig scheduler and MSL kernels are identical to the primary cell. Actual runtime counters should show 1/367 command buffers/dispatches for a primary single paragraph, and 367/367 for split. Mixed sequences and batches share token GEMMs but preserve attention and pooling boundaries.

Final report work remains:

- Confirm five completed process pairs per cell and all original correctness gates; never promote partial or smoke files.
- Integrate shared CSV/JSON, latency IQR and process-level bootstrap CI, throughput mean/SD by batch, Server results, paired baseline comparisons, MWU/Holm/Cliff statistics and measured factor coverage.
- Compare the fixed conditional analytic model with observations, distinguish CPU/GPU overlap, and capture a trace if required to explain a >20% discrepancy. The report's Amdahl numbers are sensitivity conditions, not a measured removable critical-path share.
- Use the final shared calibration for plots; `plot_calibration.py SHARED_DIR OWN_CALIBRATION_JSON OUTPUT.png` produces the E3 tile calibration plot. `results/setup/roofline-e3.png` is already inspected but comes from the earlier completed calibration phase of an interrupted study.
- Complete the Korean [report](../../../../../../docs/reports/ENGINE-LAB-E3-ZIG.md) and independent validation. Keep application integration, Developer ID/notarization and Windows execution unverified.

Existing evidence:

- `results/original/preflight.json`: unchanged original `verify.py`, 20 single fixtures, mixed batch, 100 packed paragraphs, invalid model/input rejection and small-after-growth regression all passed. Minimum cosine 0.9997069468, mean 0.9999284187, maximum normalized-output absolute difference 0.00286235.
- `results/original/q8-after.json`: same-session fresh Q8 baseline after E3; median 23.148542ms and best batch32 92.1882801 paragraphs/s. E3 diagnostic median 37.339084ms and packed throughput27.554387/s. These are diagnostic-only single-process data, not final shared statistics.
- `results/original/paired-diagnostic.json`: preserved E3 vectors rechecked against the fresh after-run Q8, with the same cosines/difference; no additional GPU timings were invented.
- `results/original/static-smoke.log`: actual Rust→Zig→ObjC→MSL static call, cosine0.9999073815 and observed 1 command buffer/367 dispatches.
- `results/setup/`: environment, work/traffic CSV, frozen hypotheses/calibration, source/build hashes, Cargo and zig-cc build evidence, expected failed Windows DLL link and ad-hoc signature check.
- `results/shared-full/PARTIAL.md`: oracle and microbench completed, then the initial baseline process was interrupted while waiting for another worker's lock. No engine performance run completed. Hardware serial/UUID/UDID were redacted from its environment metadata.

`sh reproduce.sh` rebuilds and reproduces the original gate, static smoke, calibration and a new complete two-candidate shared study; it is a long experiment, not a quick build check. It must only be launched in a scheduled turn. No app files, commits, pushes, release keys or production data were changed.
