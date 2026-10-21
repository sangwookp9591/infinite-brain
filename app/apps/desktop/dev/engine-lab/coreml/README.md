# E4: EmbeddingGemma 2 → Core ML

An isolated research prototype. No app code, index format, production model or dependency changes.
Read the [Korean report](../../../../../../docs/reports/ENGINE-LAB-E4-COREML.md) and the
[shared methodology](../../../../../../docs/reports/ENGINE-LAB-METHODOLOGY.md).

Run every command here from `app/apps/desktop/dev/engine-lab/coreml/`.
Generated 544 MB model packages, virtualenv and binaries stay in ignored directories.
No Hugging Face weights were cached; `convert.py` reads the specified local BF16 GGUF
with the existing `mojo-engine/convert.py` reader. No model download is performed.

```sh
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r requirements.lock
mkdir -p artifacts
```

The recorded tools are Python 3.11.16, coremltools 9.0, PyTorch 2.14.1,
NumPy 2.4.6 and Xcode 27 / Apple clang / Swift 6.4 toolchain.
coremltools warns that PyTorch newer than 2.7 is untested; successful conversion
and real-model parity are recorded, not assumed from that compatibility warning.
The read-only Endor package-risk lookup for coremltools 9.0 was unavailable
because the installed CLI had no credentials; no package security verdict was established.

Generate a fresh shared reference under the mandatory GPU lock (existing oracle binary):

```sh
.venv/bin/python locked.py \
  /private/tmp/ib-mojo-spike/rust-target/release/reference \
  "$HOME/.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf" \
  ../../mojo-engine/inputs.json artifacts/q8-setup.json
.venv/bin/python convert.py --reference artifacts/q8-setup.json > conversion.log 2>&1
.venv/bin/python compile.py > compile.log 2>&1
xcrun clang++ -std=c++17 -O3 -fobjc-arc -dynamiclib \
  -mmacosx-version-min=15.0 -framework Foundation -framework CoreML \
  engine.mm -o artifacts/libib_coreml.dylib
```

`convert.py` asserts all 20 original fixture cosines and a separate padded mixed
batch before conversion. Sequence lengths 64/128/256/512 and batch sizes 1/4 are
enumerated. Real lengths are masked for both attention keys and mean pooling.
The model contains all 24 layers, GQA, unscaled bidirectional QK scores,
split-half RoPE, four residual norms, GeGLU and per-layer embeddings/gates/scales.
For supported lengths <=512 the GGUF's symmetric +/-512 local mask covers every key.
It exports a float32 768-vector; the host normalizes again after FP16 rounding.

The native C ABI implements `ib_engine_init/embed/embed_batch/stats/free/name`.
`model_path` is the absolute `artifacts/encoder.mlmodelc` directory. Set
`IB_COREML_COMPUTE_UNITS=CPU_AND_NE`, `CPU_AND_GPU` or `ALL` before initialization.
Apple offers no ANE-only or GPU-only setting: CPU fallback is allowed in all three.
The native adapter reuses input arrays, preserves output strides, serializes model
calls and packs at most four independent sequences per prediction. It accepts
1–100 sequences, 1–512 tokens each, at most 16,384 total tokens per ABI call.
Callers own token/output buffers; an engine must be freed exactly once after calls finish.
`stats` returns -1 and UINT32_MAX: runtime dispatch counts are unknown, not zero.

Native correctness and compute-plan checks:

```sh
IB_COREML_COMPUTE_UNITS=CPU_AND_NE .venv/bin/python locked.py \
  .venv/bin/python smoke.py artifacts/q8-setup.json > smoke-ne.log 2>&1
IB_COREML_COMPUTE_UNITS=CPU_AND_GPU .venv/bin/python locked.py \
  .venv/bin/python smoke.py artifacts/q8-setup.json > smoke-gpu.log 2>&1
IB_COREML_COMPUTE_UNITS=ALL .venv/bin/python locked.py \
  .venv/bin/python smoke.py artifacts/q8-setup.json > smoke-all.log 2>&1
.venv/bin/python locked.py .venv/bin/python plan.py > plan.log 2>&1
```

`smoke.py` checks every reference vector, a mixed-length 20-sequence batch,
100 identical independent sequences, small-after-large reuse, malformed sizes
and out-of-vocabulary token rejection. Compute plans describe anticipated placement,
not an Instruments runtime trace or a count of actual CPU fallback operations.

`bench.py` is the initial Python compatibility probe: it runs the **unchanged**
shared `verify.py` and can feed unchanged `gate.py`. Its ctypes-shaped adapter
calls real Core ML rather than a mock. Its model-file corruption checks exercise
path rejection (it does not parse the Mojo tensor format); normalization is on CPU.
It is retained as quick-check evidence; final performance tables use the common
native harness, not this Python probe.

```sh
.venv/bin/python locked.py .venv/bin/python bench.py \
  --units CPU_AND_GPU --reference artifacts/q8-setup.json \
  --output artifacts/python-probe.json
.venv/bin/python ../../mojo-engine/gate.py \
  artifacts/q8-setup.json artifacts/python-probe.json
# A performance-gate exit 1 means NO-GO, not a broken runner.
```

Full shared-harness reproduction (build the harness once using its own README):

```sh
.venv/bin/python reproduce.py > reproduce.log 2>&1
```

This one command reconverts/recompiles, generates a fresh Q8 reference, and runs
all three unit settings through `harness/pipeline.py`, which inserts fresh Q8
baselines A/B/A/B and records native CSV, statistics and plots. It requires absent
`results/CPU_AND_NE`, `results/CPU_AND_GPU` and `results/ALL` directories; move old
results aside explicitly before a new run. The default is the full 5-process
protocol and can take hours. `IB_LAB_SMOKE=1` produces explicitly nonfinal smoke
results. GPU lock acquisition is managed by the shared runner/pipeline; do not
wrap that pipeline in another lock (that would deadlock).

Additional exported-shape checks (distinct from the unchanged 20-fixture gate):

```sh
.venv/bin/python shape_check.py --prepare --reference artifacts/q8-setup.json
IB_COREML_COMPUTE_UNITS=ALL .venv/bin/python locked.py \
  .venv/bin/python shape_check.py
```

Already-built fixed-shape control (failure diagnosis only):

```sh
.venv/bin/python convert.py --reference artifacts/q8-setup.json \
  --static-length 82 --output artifacts/static82/encoder.mlpackage
.venv/bin/python compile.py --directory artifacts/static82
# After coordinator scheduling; estimated 2–4 minutes under one lock:
.venv/bin/python locked.py .venv/bin/python short_diagnostics.py \
  artifacts/q8-setup.json > short-diagnostics.log 2>&1
```

The static control uses explicit Python shape constants: NumPy 2.4 rejects the
converter's implicit length-one-array-to-scalar folding. The original failed
conversion is retained in `evidence/static82-conversion-first-failure.txt`.
The main enumerated model is unchanged. A control result cannot establish that
the full enumerated model runs on ANE. `short_diagnostics.py` records per-stage
failures and continues so one failed unit setting does not hide the others.
`reproduce.py` likewise checks each mode before full measurements and records
failed modes, returning nonzero when any capability failed.

The existing static82 control also has a native ABI build:

```sh
xcrun clang++ -std=c++17 -O3 -Wall -Wextra -Werror -fobjc-arc -dynamiclib \
  -mmacosx-version-min=15.0 -framework Foundation -framework CoreML \
  engine.mm -o artifacts/libib_coreml_static82.dylib
# Run only in an arranged GPU slot:
IB_COREML_COMPUTE_UNITS=CPU_AND_NE .venv/bin/python locked.py \
  .venv/bin/python smoke.py artifacts/q8-setup.json \
  --compiled artifacts/static82/encoder.mlmodelc \
  --library artifacts/libib_coreml_static82.dylib \
  --plan-output evidence/plan-static82-ane.json > static82-native.log 2>&1
```

This build recognizes the fixed `[1,82]` descriptor, rejects tokens beyond 82
before reading/copying their buffers, and handles batch calls by serial independent
predictions. It never truncates input. The original enumerated artifact is retained
unchanged for its CPU+GPU study; frozen paths and hashes are in
`evidence/native-modes.json`. The static ABI still needs its separately scheduled
native gate; Python Core ML capability checks are not a substitute for that gate.
`reproduce.py` builds both artifacts, repeats both correctness paths, runs the
shared full study only for passing modes, and also includes the fixed ANE control.

## Bounded handoff status

Implementation and the existing diagnostic evidence are ready. The coordinator
moved the remaining native static82 gate, all strict shared studies, and final
report ownership to its follow-up task. No E4 GPU job is queued/running.
The original static native delivery failed its first native input because the adapter treated the singleton enumerated 1×82 constraint as variable. The corrected macOS 15-target library passed the real 20-single/mixed20/100/growth/83-token gate; use `evidence/native-modes-corrected-macos15.json` for its exact path/hash. The original failed delivery remains archived in `evidence/native-modes.json`. Full performance studies are pending.
The complete `reproduce.py` study has not been run end to end.

At handoff the existing 20-case oracle is `/private/tmp/ib-mojo-opt/q8-gate.json`.
The immediately runnable prepared native gate (after GPU scheduling) is:

```sh
IB_COREML_COMPUTE_UNITS=CPU_AND_NE .venv/bin/python locked.py \
  .venv/bin/python smoke.py /private/tmp/ib-mojo-opt/q8-gate.json \
  --compiled artifacts/static82/encoder.mlmodelc \
  --library artifacts/libib_coreml_static82.dylib \
  --plan-output evidence/plan-static82-ane.json > static82-native.log 2>&1
```

This oracle is for correctness, not a fresh paired performance baseline. The
shared pipeline must generate its fresh Q8 oracle and run adjacent baseline pairs
for the final tables. It must use the mode-specific model override in
`evidence/native-modes.json` and `IB_COREML_COMPUTE_UNITS` before loading the dylib.
Keep failed enumerated ANE/ALL as failed capability results and static82 as a
separate serial, <=82-token control. `stats=-1` means unknown device counters.
Remaining requirements are in the report's Conclusion and the shared methodology.

## Shape-policy regression and corrected native gate

`policy-smoke.mm` includes the actual adapter and loads both compiled model descriptions. It failed before the fix because static82 selected `fixed_length=0`, and passes after the singleton-enumeration fix with static82→82/1 and enumerated512→0/4, including 83/513 single/batch rejection. Native metadata and before/after logs are in `evidence/shape-policy-before.log` and `shape-policy-after.log`. Build the corrected shim with `-mmacosx-version-min=15.0` alongside the existing strict clang flags.

The final corrected capability proof is [gate.json](../evidence/e4-static82-native-20261020-183359/gate.json) and [status.json](../evidence/e4-static82-native-20261020-183359/status.json). The model fingerprint is unchanged. This checks actual native correctness and bounds; actual per-op ANE/CPU execution and the strict five-process performance study remain pending.
