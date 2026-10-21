# Mojo EmbeddingGemma 2 spike

This folder is an isolated feasibility experiment, not an application engine switch.
The initial optimization gate is **NO-GO**: Mojo 23.57 ms / 92.55 paragraphs/s versus
fresh Q8 Metal 17.34 ms / best batched 105.72/s; the 20-case cosine gate passes.
`src-tauri/src/semantic.rs`, stored vectors, model downloads, and app dependencies
are untouched. See the external `REPORT.md` supplied with the experiment for the
measured decision; successful compilation alone is not an acceptance gate.

The implementation reads llama.cpp token IDs, including BOS, so tokenizer
differences cannot hide forward-pass errors. It implements all 24 encoder layers:
512-wide embeddings scaled by √512, per-layer input projection and RMSNorm,
grouped-query non-causal attention, split-half RoPE, GeGLU, four residual norms,
per-layer input gates/projections/scalars, final RMSNorm, mean pooling, the
768-dimensional projection, and L2 normalization. Full-attention layers 5/11/17/23
use 512-wide heads; the remaining layers use 256-wide heads and a symmetric ±512
token window. The local GGUF's window metadata is authoritative for this parity
experiment (the HF config expresses it differently).

## Engine architecture

The CPU reference path (`engine.mojo`) retains FP32 weights and Accelerate SGEMM.
The experimental Metal encoder (`engine_gpu.mojo` / `gpu_ops.mojo`) uploads the
validated FP32 converted model once and makes an FP16 device weight copy. MAX's
M5 tiled matrix kernel uses FP16 operands and FP32 accumulation; residuals, norms,
attention and final output stay FP32. No llama.cpp inference is called by Mojo.

The data flow is token gather → shared PLE projection/norm → 24 bidirectional
encoder layers → final RMSNorm → per-sequence mean → 768-d projection → L2 norm.
Each layer packs Q/K/V into one GEMM and gate/up into one GEMM. QKV normalization
and RoPE share one scatter kernel; GeGLU and PLE gates write half operands directly;
post-norm/residual/scale share row kernels. Attention currently uses exact online
softmax with a register accumulator per query/head, preserving the GGUF's symmetric
±512 local window and full layers 5/11/17/23. This is not a matrix-tiled FlashAttention
implementation. Normalization/cast fusion does not mean an RMS reduction inside MMA.

Independent sequences share token GEMMs but keep positions, attention boundaries
and pooling separate. Device workspaces grow by token/sequence capacity and are
reused across serialized calls; active-sized sub-buffer copies prevent an old
larger capacity from overreading a later smaller input or overwriting its output.
Normal execution has metadata uploads, one final download and one completion
fence; the optional profile export adds stage fences only for diagnosis. FFI
ownership and error statuses below are unchanged. M5 is required; M1–M4 dispatch
and application fallback are not implemented. Follow the measured attempts and
rejected approaches in [the optimization log](../../../../../docs/reports/MOJO-ENGINE-OPTIMIZATION.md).

## Reproduce

Run from `app/apps/desktop/dev/mojo-engine/`. All generated models, build outputs,
and logs below stay outside the repository. Dependencies are isolated from the
app's pnpm and Rust manifests. The recorded environment is Mojo 1.2.0rc2
(`2016d0cd`), MAX/Modular 26.7.0rc2, Python 3.11.16, uv 0.12.9, Xcode 27.0 and
Metal Toolchain 27A266a on an Apple M5 with 24 GiB RAM, macOS 27.0.1.

```sh
SPIKE=/private/tmp/ib-mojo-spike
uv venv --python 3.11 "$SPIKE/venv"
uv pip install --python "$SPIKE/venv/bin/python" \
  --index https://whl.modular.com/nightly/simple/ --prerelease allow \
  -r requirements.lock
xcodebuild -downloadComponent MetalToolchain
"$SPIKE/venv/bin/mojo" --version

"$SPIKE/venv/bin/python" convert.py \
  "$HOME/.cache/infinite-brain-b0/models/embeddinggemma-2-BF16.gguf" \
  "$SPIKE/weights.bin"

CARGO_TARGET_DIR="$SPIKE/rust-target" cargo build --release --locked
"$SPIKE/rust-target/release/reference" \
  "$HOME/.cache/infinite-brain-b0/models/embeddinggemma-2-BF16.gguf" \
  inputs.json "$SPIKE/reference-bf16.json"
"$SPIKE/rust-target/release/reference" \
  "$HOME/.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf" \
  inputs.json "$SPIKE/reference-q8.json"

"$SPIKE/venv/bin/mojo" build engine.mojo --emit shared-lib \
  -Xlinker -framework -Xlinker Accelerate -o "$SPIKE/libib_mojo.dylib"
"$SPIKE/venv/bin/mojo" build engine_gpu.mojo --emit shared-lib \
  -Xlinker -framework -Xlinker Accelerate -o "$SPIKE/libib_mojo_gpu.dylib"

VECLIB_MAXIMUM_THREADS=4 "$SPIKE/venv/bin/python" verify.py \
  "$SPIKE/libib_mojo.dylib" "$SPIKE/weights.bin" \
  "$SPIKE/reference-bf16.json" "$SPIKE/mojo-cpu.json"
IB_MOJO_PREFIX=ib_mojo_gpu "$SPIKE/venv/bin/python" verify.py \
  "$SPIKE/libib_mojo_gpu.dylib" "$SPIKE/weights.bin" \
  "$SPIKE/reference-bf16.json" "$SPIKE/mojo-gpu.json"
```

Run performance commands sequentially; concurrent CPU/GPU workloads distort the
comparison. `verify.py` asserts 20 individual cosines ≥0.999 before timing. It also
checks invalid input handling and unit length. The GPU checks a mixed-length,
20-input batch against the oracle, then a 100-paragraph batch against the single
paragraph output, catching cross-sequence attention and position mistakes.
Single-input latency is the median of 30 warm calls. Sequential throughput is
100 calls; GPU batch throughput uses three warm 100-paragraph batches after one
batch warmup. Model initialization and tokenizer work are excluded from these
latencies; calls include allocation, GPU transfers and synchronization.

## Rust FFI and relocatable packaging

```sh
"$SPIKE/venv/bin/python" package.py "$SPIKE/libib_mojo_gpu.dylib" \
  "$SPIKE/venv/lib/python3.11/site-packages/modular/lib" "$SPIKE/package-gpu"
env -i PATH=/usr/bin:/bin IB_MOJO_PREFIX=ib_mojo_gpu \
  "$SPIKE/rust-target/release/ffi-smoke" \
  "$SPIKE/package-gpu/libib_mojo_gpu.dylib" "$SPIKE/weights.bin" \
  "$SPIKE/reference-bf16.json"
```

`package.py` follows the actual `otool -L` dependency closure, replaces build-machine
rpaths with `@loader_path`, copies only required dylibs, ad-hoc signs every file,
verifies signatures, and records exact byte sizes and `vtool -show-build` metadata.
The Rust host uses `dlopen`/`dlsym` and does not embed Python. A clean environment
plus relocated rpaths tests that loading does not depend on the virtualenv path.
This does not constitute Developer ID notarization or an older-macOS device test.

For an M1 CPU binary with a macOS 15 deployment marker:

```sh
"$SPIKE/venv/bin/mojo" build engine.mojo --emit shared-lib \
  --target-triple aarch64-apple-macosx15.0 --target-cpu apple-m1 \
  -Xlinker -framework -Xlinker Accelerate \
  -Xlinker -platform_version -Xlinker macos -Xlinker 15.0 -Xlinker 27.0 \
  -o "$SPIKE/libib_mojo_macos15.dylib"
vtool -show-build "$SPIKE/libib_mojo_macos15.dylib"
```

The explicit linker platform flags are necessary: setting the target triple alone
still produced `minos 27.0` on this host. Verify all dependencies too. A deployment
marker is not proof that this binary runs on macOS 15 hardware.

## ABI and ownership

All functions use `@export` and `abi("C")`; pointers are borrowed for the duration
of a synchronous call. Prefix `ib_mojo` selects CPU; `ib_mojo_gpu` selects Metal.

```c
void *ib_mojo_gpu_init(const char *model_path);
int32_t ib_mojo_gpu_embed(void *handle, const int32_t *ids,
                        size_t len, float *out_768);
int32_t ib_mojo_gpu_embed_batch(void *handle, const int32_t *packed_ids,
                              const int32_t *lengths, size_t count,
                              float *out_count_times_768);
void ib_mojo_gpu_free(void *handle);
```

Only pass handles returned by `init`; free each once, after all calls finish.
Serialize calls on a GPU handle. Inputs must contain at least the stated token
counts, outputs must have the stated capacity, and buffers must not alias. The
GPU batch limit is 100 sequences / 16,384 total tokens; each sequence is 1–2048
tokens. Status 0 means success; −1 is an invalid size/null argument, −2 an invalid
token ID, −3 invalid vector data, and −4 a caught GPU runtime error. Initialization
returns null for unreadable or structurally invalid models. The spike validates
the converted tensor layout, but does not implement app-level model download,
SHA verification, cancellation, thread ownership or recovery.

The converted format is `IBMOJO01`, a 32-byte header, 413 fixed tensor records
(offset, input dimension, output dimension, element count; little-endian u64),
4096-byte alignment, then row-major FP32 weights. It intentionally expands the
BF16 weights; it is not a storage-optimized shipping format. The original GGUF
SHA-256 is recorded in the conversion manifest. Keep memory origins attached to
borrowed Mojo pointers, and keep host arrays alive through asynchronous GPU
copies: converting a stack pointer to an integer before an internal call can
silently change the input length.

## Sources

- [Mojo installation](https://mojolang.static.modular.com/install/),
  [Modular packages and platform requirements](https://docs.modular.com/max/packages).
- [C ABI/shared-library compilation and runtime initialization](https://mojolang.static.modular.com/docs/tools/compilation/).
- [EmbeddingGemma 2 HF config](https://huggingface.co/google/embeddinggemma-2/blob/main/config.json)
  and [Transformers forward pass](https://github.com/huggingface/transformers/blob/main/src/transformers/models/embedding_gemma2/modeling_embedding_gemma2.py).
- llama.cpp `src/models/gemma-embedding2.cpp`, bundled by llama-cpp-rs
  `cb98c630d0fec934a8a379db4fd63cd3622f6984` (the app's existing pin).
- [MAX M5 matrix kernel](https://github.com/modular/modular/blob/main/max/kernels/src/linalg/matmul/gpu/apple/matmul_kernel.mojo).

No pretrained MAX EmbeddingGemma implementation or llama.cpp inference is called
from the Mojo engine. llama.cpp is used only by the independent Rust oracle.


## Optimization profiling and adoption gate

The current experiment is still **not integrated**. See
[the dated optimization log](../../../../../docs/reports/MOJO-ENGINE-OPTIMIZATION.md)
for every retained/rejected attempt. The strict gate compares the final engine
against fresh Q8 vectors and the best llama.cpp batch, not against BF16 precision
alone or a historical sequential baseline. `inputs.json` remains the same 20 cases.

Run these commands sequentially from this directory, after the setup above:

```sh
SPIKE=/private/tmp/ib-mojo-spike
OPT=/private/tmp/ib-mojo-opt
mkdir -p "$OPT"
CARGO_TARGET_DIR="$SPIKE/rust-target" cargo build --release --locked
"$SPIKE/venv/bin/mojo" build engine_gpu.mojo --emit shared-lib \
  --target-triple aarch64-apple-macosx11.0 --target-cpu apple-m1 \
  -Xlinker -framework -Xlinker Accelerate \
  -Xlinker -platform_version -Xlinker macos -Xlinker 11.0 -Xlinker 27.0 \
  -o "$OPT/optimized-final.dylib"
"$SPIKE/rust-target/release/reference" \
  "$HOME/.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf" \
  inputs.json "$OPT/q8-gate.json"
IB_MOJO_PREFIX=ib_mojo_gpu "$SPIKE/venv/bin/python" verify.py \
  "$OPT/optimized-final.dylib" "$SPIKE/weights.bin" \
  "$OPT/q8-gate.json" "$OPT/mojo-gate.json"
"$SPIKE/venv/bin/python" gate.py "$OPT/q8-gate.json" "$OPT/mojo-gate.json"
# Exit 0 means both speed gates and cosine pass; exit 1 means do not integrate.
"$SPIKE/venv/bin/python" profile.py "$OPT/optimized-final.dylib" \
  "$SPIKE/weights.bin" "$OPT/q8-gate.json" > "$OPT/profile-final.log"
```

`reference.rs` measures 4/8/16/24/32/64/100 independent sequences per decode,
including remainder groups, with positions reset for every sequence; all returned
vectors are checked outside the timed batch region. Four 100-paragraph trials
include one warmup and a median of three warm trials. A 256-slot-per-sequence
capacity preserves llama.cpp pooling's sequence divisibility. `verify.py` also
checks mixed lengths, malformed packed weight layout, and a small embed after a
100-sequence workspace growth. Profile output contains every layer/stage in
milliseconds; those explicit fences include host submission overhead and do not
represent isolated hardware-counter GPU time. Source-audited 82-token launch counts
are 607 in the original implementation and 417 now (excluding data copies and
profile fences; MAX may split unusually small/deep shapes into extra kernels).

The optimized GPU library and runtime dependency closure can declare macOS 11.0.
A 10.15 marker linked with warnings because generated ARM64 code and runtime dylibs
require 11.0, so it is not a lower viable closure target. This metadata does not
prove execution on macOS 11: this path still requires M5, and was run only on
macOS 27.0.1. Keep M5 hardware/Metal requirements separate from loader metadata.
Developer ID signing, hardened runtime and older-device execution remain untested.

`graph_probe.mojo` reproduces the rejected official graph replay approach:
`mojo graph_probe.mojo` reports `createGraphBuilder() not supported on this device
context` on the pinned Metal runtime. No unsupported graph fallback is hidden in
the encoder. Full RMS reduction inside a matrix prologue and whole-row PLE norm
inside the projection dispatch remain future work; the implemented fusions are
stated precisely in Engine architecture above.


## E0 submission experiments (in progress)

The common-ABI variants and paper-style methodology are in
[ENGINE-LAB-E0-MOJO.md](../../../../../docs/reports/ENGINE-LAB-E0-MOJO.md).
`IB_MOJO_SYNC_LAYERS=0..24` selects an experimental completion interval (default 0).
`IB_MOJO_FUSE_PREPARE=0|1` fuses residual updates with the next GEMM operand
preparation (default 0); it reduces the source-audited benchmark dispatch count
from 417 to 346. `build_e0.py` creates common-ABI configuration wrappers using the
shared harness adapter. The actual host remains Mojo DeviceContext. These knobs
are isolated lab inputs, not app settings or a production engine switch.

`abi_check.py` validates 20 vectors and mixed-size_t-length batches without timing.
Always wrap GPU quick checks and trace recordings in `./gpu_bench.sh ...` to share
`/private/tmp/ib-gpu-bench.lock`. Final 5-process comparisons, scenario loops,
statistics and roofline plots must use `../engine-lab/harness/` after the coordinator
confirms readiness and schedules a GPU turn. E0 has not run those final sweeps yet.
Do not turn a one-process smoke into an adoption claim.

For trace reproduction, compile `trace_markers.c` as a dylib and the isolated Rust
`trace-bench` binary; `trace_template.py OUTPUT.tracetemplate` copies Xcode's Metal
System Trace template with shader timeline enabled. Record each engine separately
with `--instrument 'Points of Interest'`, then export `--toc` and the GPU/application/
encoder/submission/shader/signpost tables with `--xpath`. `trace_summary.py STEM
mojo|llama OUTPUT.json` consumes `STEM-toc.xml` and `STEM-detail.xml`, checks 30
complete measured signposts and the real buffer counts, and writes a per-layer CSV.
Its current exact stage mapping describes the original 417-dispatch baseline;
new fused/sync traces require their actual ordering/count mapping. Sampled shader
intervals are never reported as exact dispatch counts or exact Q8 per-stage times.
