<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shared embedding engine harness

This isolated macOS/Apple Silicon laboratory implements [the binding methodology](../../../../../../docs/reports/ENGINE-LAB-METHODOLOGY.md). It does not change the app, model downloads or semantic index. Native Rust owns all engine timing; Python orchestrates fresh processes and analyzes raw files.

```sh
cd app/apps/desktop/dev/engine-lab/harness
./run.sh build/libib_mojo.dylib
# Arbitrary ABI engine; absolute library paths also work:
IB_ENGINE_MODELS='{"/absolute/engine.dylib":"/absolute/model.bin"}' ./run.sh /absolute/engine.dylib
# Installation / ABI smoke only, clearly labeled and kept separate:
IB_LAB_SMOKE=1 ./run.sh build/libib_mojo.dylib
```

Prerequisites: Rust/Cargo, clang/Xcode with Metal and MPS, uv, Python 3.11; packages are pinned in `requirements.txt` and installed only in this directory's `.venv`. Cargo is isolated with its own manifest and lockfile. The optimized harness package retains line debug information and disables stripping to avoid the reproduced macOS 27 LINKEDIT alignment defect ([rust#157750](https://github.com/rust-lang/rust/issues/157750)); a real dylib-load check runs before any GPU work. The baseline uses the **same** `llama-cpp-2` full SHA as the app and existing Mojo oracle, `cb98c630d0fec934a8a379db4fd63cd3622f6984`, with Metal enabled. The copied adapter code belongs to this harness; no files in `dev/mojo-engine` are modified.

`run.sh` builds adapters, regenerates the pretokenized 20-input Q8 oracle, runs the GPU microbenchmarks, freezes the analytic prediction **before engine timing**, then interleaves A/B/A/B for five independent processes per engine. Each process runs the accuracy and mixed-batch gates, ten discarded warmup calls per workload, 30 SingleStream calls, 30 Offline trials at **each** batch size 1/4/8/16/32/64/100, then 30 open-loop Poisson requests per QPS 5/10/20/30/40/50/60/80/100. An Offline trial always handles 100 paragraphs, with the final partial group included. The strict default processes 105,000 Offline paragraphs per engine and can take tens of minutes. A process failure stops the pipeline; partial runs never enter final tables.

The first input is the existing 82-token paragraph. Accuracy uses all 20 English/Korean inputs and pretokenized IDs, including BOS. The Q8 adapter mean-pools independent noncausal sequences and L2-normalizes. It uses four CPU threads, all GPU layers, 2048 minimum context and 256 slots per sequence. Remainder batches reuse the prepared context, matching the existing oracle. Batch fallback serially calls `ib_engine_embed`; it does not imply native engine batching. Unknown optional counters remain blank in CSV. Offline elapsed time excludes the separately clocked optional counter-query phase, so providing instrumentation does not penalize candidate throughput. The Mojo adapter converts `size_t[]` to checked `int32_t[]`, the old Mojo ABI's actual representation.

Every GPU operation, including oracle construction, initialization, gates, warmup, timing and microbenchmarks, runs while owning `mkdir /private/tmp/ib-gpu-bench.lock`. Cleanup removes **only a lock acquired by this process**. The script never removes another worker's lock or guesses that a lock is stale. It may wait for other workers. Do not nest a runner inside another bench-lock wrapper. Native process exit/SIGKILL can leave a lock; the owner/operator must confirm process death before cleanup.

## Engine contract

Include [`ib_engine.h`](ib_engine.h). Export init/embed/free/name; batch and stats are optional. Calls are synchronous and serialized, outputs caller-owned and 768-dimensional per sequence. No tokenizer belongs in the engine. Dynamic library name must be nonempty UTF-8 without commas or newlines. Model format is engine-defined. Model directories are hashed via a sorted `ib-model-tree-v1` manifest of relative paths and file SHA-256 values, before and after the run; use a materialized snapshot without symlinks. File/tree or library/reference drift across process runs rejects final analysis. Inputs for this suite fit 100 sequences, 16,384 total tokens and 2048 per sequence. A failed gate (cosine <0.999, nonfinite/nonunit vector, or batch mismatch) aborts that process. Engines must release all GPU/runtime objects in free.

Paths default to existing read-only experiment artifacts:

| Variable | Default |
| --- | --- |
| `IB_Q8_MODEL` | `~/.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf` |
| `IB_MOJO_MODEL` | `/private/tmp/ib-mojo-spike/weights.bin` |
| `IB_MOJO_LIBRARY` | `/private/tmp/ib-mojo-opt/optimized-final.dylib` |
| `IB_EXTRA_ARTIFACTS` | Optional JSON map of additional absolute runtime artifact paths to expected SHA-256; checked before/after each process (e.g. metallib/kernel manifests) |
| `IB_ENGINE_FACTORS` | Optional JSON map of absolute library paths to `kernel`, `host`, `precision`, `submission` labels; unknown by default except the two bundled adapters |
| `IB_ENGINE_MODELS` | JSON map of absolute dylib paths to model paths; defaults to Q8 except built Mojo adapter |
| `IB_RESULTS_DIR` | fresh `results/YYYYMMDD-HHMMSS`; must not already exist |

Other candidates need only export the header ABI and supply their model path. For several candidates, execution is A/B/A/C/... per round so each candidate has a nearby baseline. The comparison uses process medians; each candidate is compared only to its adjacent baseline processes (five per pair), as documented in the complete planned order. Manual reanalysis validates every planned process, all 17 scenario/level groups and all iteration counts; interrupted or inconsistent data cannot produce final tables. Concurrent calls to one engine are outside this ABI; Server uses a single serial worker and includes scheduler/queue delay in latency. Target QPS is not achieved completion QPS. Highest passing tested QPS is a finite-sample observation, not sustained serving capacity.

## Outputs and statistics

Each fresh run contains `config.json`, `order.json`, `reference.json`, `prediction.json`, `microbench.csv`, per-process CSV/JSON/logs, `tables.md`, `summary.json` and PNG plots. JSON records hardware/OS (serial number, UUID and provisioning UDID omitted), compiler versions, model/library/reference hashes, swap/VM state, battery/AC source and `pmset` plus `NSProcessInfo` thermal state before and after execution. ProcessInfo states are 0 nominal, 1 fair, 2 serious, 3 critical. Raw CSV identifies engine, process, scenario, batch/QPS factor, iteration, service/end-to-end latency, throughput and optional counters.

Latency quantiles/IQR describe all calls; CI and tests use independent **process medians**, avoiding call-level pseudoreplication. Seeded 10,000-draw percentile bootstrap estimates CI for median process latency. Throughput mean±SD is computed across process means. Mann–Whitney U and Cliff's delta compare candidate and baseline process medians; Holm corrects one family across all candidates and scenario/batch/QPS comparisons. Five processes give limited test resolution. Plotting uses headless Matplotlib.

The measured roofline uses a 128 MiB streaming Metal blit (read+write bytes), validated FP16 MPS GEMM at 1024/2048/4096, and tiny-kernel CPU commit/completion cost at queue depths 1–256. Thirty samples follow five warmups. The command queue permits 512 outstanding buffers so default 64-slot allocation does not deadlock a 256-buffer preparation. `cpu_submit_us` measures commits of already encoded commands; `host_ms` includes queue completion. They are different quantities. Model prediction uses source-audited aggregate weights/FLOPs, historical trace counts (llama 3 / Mojo 425), η=1 and zero unmeasured host/gap/readback costs. Its concurrent estimate is `max(aggregate kernel floor, CPU commit cost)` under the assumption that measured BW/MPS peak are ceilings. It is an empirical optimistic envelope, not a hardware-proven lower bound or a sum of per-kernel maxima. The separately reported nonoverlap Amdahl illustration is hypothetical, not a measured removable fraction; deviations >20% are flagged for trace diagnosis, not fixed by fitting coefficients after seeing results. Aggregate engine roofline points are explicitly proxies; kernel-isolated counters require a trace. Q8 dequantization is not modeled as pure FP16 GEMM.

The two original engines confound kernel/host/precision/submission factors A–D: no independent main-effect or interaction claim is possible. Arbitrary candidate factors and predictions remain unknown unless independently supplied. Seven batch levels measure E. A future valid fractional-factorial design needs additional independently varied combinations.

## Verification

```sh
cargo test --release --locked --bin runner
.venv/bin/python selfcheck.py
# Reanalyze existing completed data without GPU use:
.venv/bin/python analyze.py results/RUN
```

Smoke outputs are excluded from research claims. Browser/native UI, app integration, production, signing, older Macs and Windows are outside this laboratory's verification.

## Bounded Core ML capability gate

`gate-coreml.py REFERENCE.json --modes ../coreml/evidence/native-modes-corrected-macos15.json` materializes and fingerprints the handed-off static82 model/library, then runs the existing 20/mixed/100/growth/83-token checks plus explicit finite/unit-norm mixed-vector checks inside the GPU/ANE lock, with a 300-second child timeout. It records E4's canonical file-list fingerprint (including bytes) separately from `ib-model-tree-v1`. `--selfcheck` tests the hashing and vector validators without GPU use. It is a correctness gate and does not create performance claims. Failed and corrected artifact results are preserved separately.
