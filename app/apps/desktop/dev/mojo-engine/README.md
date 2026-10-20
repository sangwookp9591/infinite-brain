# Mojo EmbeddingGemma 2 spike

This folder is an isolated feasibility experiment, not an application engine switch.
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

`engine.mojo` uses SIMD normalization and Apple's Accelerate SGEMM on CPU.
`engine_gpu.mojo`/`gpu_ops.mojo` keep forward-pass tensors on Metal and use MAX's
M5 matrix kernel. The GPU implementation currently requires M5; M1–M4 GPU dispatch
is not implemented. GPU batching packs independent sequences into the same
matrix operations, with separate positions, attention bounds and pooling.

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
comparison. `verify.py` asserts 20 individual cosines ≥0.99 before timing. It also
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
