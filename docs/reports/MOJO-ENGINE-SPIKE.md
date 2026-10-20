# Mojo EmbeddingGemma 2 spike — NO-GO for engine switch

Date: 2026-10-20, Asia/Seoul. Recommendation: **do not switch**. The full Mojo text encoder now matches llama.cpp, including packed independent sequences, and can be called from a relocated, ad-hoc-signed Rust-loaded dylib. Its speed does not improve on the existing Q8 Metal engine, and the implemented GPU path is M5-specific. The shipped engine remains untouched.

## Measured gates

| Gate | Result | Evidence |
|---|---|---|
| 1: 20 fixed shared-token inputs, each cosine ≥0.99 | **PASS** | CPU min 0.9999992711, mean 0.9999998981; GPU min 0.9999997888, mean 0.9999998938 |
| Additional packed-batch correctness | **PASS** | Mixed English/Korean, document/query, variable-length 20-input batch min 0.9999995655, mean 0.9999998789; all 100 repeated paragraph outputs match the single-input vector at cosine ≥0.999 |
| 2: performance sufficient to justify replacing Q8 Metal | **NO-GO** | Final GPU single-paragraph median 112.05 ms versus Q8 23.85 ms; true batch of 100 reaches 46.71/s versus Q8 sequential 47.21/s |
| 3: C ABI, Rust load/call/free, dependency closure, ad-hoc signing | **PASS on this Mac** | 20 Rust calls pass after relocation and signing, min cosine 0.9999997888; engine plus four runtime dylibs 3,137,152 bytes |
| Older OS / Developer ID distribution | **PARTIAL / not demonstrated** | Native GPU dylib declares macOS 27.0; an M1 CPU dylib declares 15.0 and passes on this M5/macOS 27 host; no macOS 15 machine, M1–M4 GPU execution, actual Developer ID signing, hardened runtime or notarization test |

All-switch acceptance is **not met**. The performance failure was escalated to the coordinator; no application integration or further optimization was performed after the agreed two GPU fix rounds.

## Environment and source parity

- Apple M5, 24 GiB RAM; macOS 27.0.1 (26A434), Xcode 27.0 (27A266a), separately installed Apple Metal Toolchain 27A266a.
- Installed from the official Modular nightly index into `/private/tmp/ib-mojo-spike/venv`: Mojo **1.2.0rc2 (2016d0cd)**, Modular/MAX **26.7.0rc2**, Python **3.11.16**, uv **0.12.9**. Full Python environment versions are in `requirements.lock` in the source folder.
- Rust oracle uses the app's existing llama-cpp-rs commit `cb98c630d0fec934a8a379db4fd63cd3622f6984`, bundling llama.cpp v0.7.0 / EmbeddingGemma 2 support; it is an independent crate under the owned folder, not an edit to `semantic.rs`.
- Architecture was read from bundled `src/models/gemma-embedding2.cpp`, GGUF metadata, [HF config](https://huggingface.co/google/embeddinggemma-2/blob/main/config.json), and [Transformers modeling code](https://github.com/huggingface/transformers/blob/main/src/transformers/models/embedding_gemma2/modeling_embedding_gemma2.py). There is no MAX EmbeddingGemma model wrapper in this implementation: the forward pass is implemented in Mojo.
- Source model: local `~/.cache/infinite-brain-b0/models/embeddinggemma-2-BF16.gguf`; SHA-256 **f315cbbb30dd487e44d501c8902abe88808755e43753a96beed1964f0a48aa4f**. The converter expands BF16 into **1,084,026,976 bytes** of mmap-friendly FP32 weights, including its header/table. This conversion is intentionally not a shipping-size optimization.
- Implemented: embedding scale, 24 PLE projections/norms, non-causal GQA, Q/K weighted RMSNorm and unweighted V RMSNorm, split-half RoPE, 256/512 head dimensions, GeGLU, post-attention/FFN/PLE norms, layer scalars, final norm, mean pooling, 768-d projection and L2 normalization. Sliding attention follows the local GGUF / llama.cpp symmetric ±512 window; the HF config describes the window differently.

## Correctness protocol

`inputs.json` contains exactly 20 fixed synthetic inputs: 10 documents and 10 queries, evenly divided between Korean and English, including Unicode and numbers. They use `title: ... | text: ...` and `task: search result | query: ...`. The Rust oracle tokenizes with `tokenize(bytes, true, false)` (BOS, no special-token parsing), uses non-causal attention, mean pooling and L2 normalization, and dumps the exact token IDs and vectors. Mojo receives those same IDs. BF16 and Q8 token-ID arrays are identical on every case.

The CPU and GPU gates compare all 768 values via cosine, not only a ranking or a few dimensions. Unit-length and finite-output assertions pass. Additional checks reject missing files, corrupt tensor dimensions, null/oversized calls, and out-of-vocabulary token IDs. The final packaged GPU verification passes all of them. The Rust C ABI host separately reproduces all 20 cosines and exercises init/embed/free/dlopen/dlclose.

Evidence: [BF16 oracle](evidence/reference-bf16.json), [final GPU gate](evidence/mojo-gpu-final.json), [CPU gate](evidence/mojo-cpu.json), [Rust packaged GPU result](evidence/ffi-packaged-gpu.json), [Rust macOS-15-marked CPU result](evidence/ffi-packaged-macos15.json).

Two implementation defects were detected by real execution and corrected before reporting a pass:

1. Erasing Mojo buffer origins could release scratch buffers before their raw pointers were finished; typed origin-preserving helpers fixed the CPU heap corruption.
2. The single-input GPU export converted a stack length pointer into an integer before calling the batch export. Its slot was reused for sequence count 1, so every input embedded only BOS. Per-op comparison showed identical lookup/RMSNorm/Q projections followed by four one-element attention rows; all 20 old GPU vectors were identical. Calling the typed implementation directly with a tracked pointer fixed the issue. Host metadata arrays also remain alive through asynchronous copies.

No debug prints or bypassed assertions remain in the forward pass. A green compile was never counted as the numerical gate.

## Performance

The paragraph is **82 tokens including BOS**. Tokenization and model loading are excluded; per-call allocation, copies and synchronization are included. Latency is the median of 30 warm calls, sequential throughput is 100 calls, and the GPU 100-paragraph batch uses three measured trials after one warm batch. Packed batches preserve each note's positions, attention bounds and pooling.

| Engine | Single paragraph median | 100 sequential paragraphs | 100 in one packed batch |
|---|---:|---:|---:|
| llama.cpp Q8 Metal, fresh sequential run | 23.85 ms | 47.21/s | Not measured |
| Mojo CPU FP32 + Accelerate, 4 BLAS threads | 213.96 ms | 2.49/s | Not implemented |
| Mojo Metal, final signed/relocated library | 112.05 ms | 8.07/s | **46.71/s**, 2.141 s total |
| Mojo Metal, preceding correct run | 92.55 ms | 12.88/s | 46.36/s |
| B0 historical Q8 Metal figure, supplied with task | ~15 ms | ~58/s | Not a current measurement |

Final GPU 100-paragraph trial milliseconds: `[2370.460959005868, 2119.8479579907143, 2140.822458997718, 2148.716499999864]`. Model initialization/upload was 4.03 s in the final GPU run; CPU mmap initialization was 0.26 ms but defers page faults and is not a cold-load comparison.

The fresh Q8 run occurred after the GPU test, with no other spike benchmark running. The Mac is shared with other workers/builds, so background load and thermal conditions were not controlled; the two correct GPU runs show that single-query and sequential timing are noisy. The packed-batch result is stable around 46–47/s and does not exceed even the fresh Q8 *sequential* baseline, nor the historical ~58/s. No claim is made about llama.cpp's unmeasured packed-batch maximum.

The current GPU path uses M5 matrix kernels but unfused row-wise normalization, explicit score/softmax/value kernels, and per-call workspace allocation. These are performance limitations, not missing forward-pass operations. CPU/GPU traces establish correctness; they do not establish an optimized shipping engine.

## Packaging, signatures and minimum macOS

`mojo build --emit shared-lib` exports real C ABI entrypoints. The Rust host loads them dynamically; no Python interpreter, llama.cpp inference or GGUF parser is used by the Mojo library at runtime. CPU GEMMs call the system Accelerate framework; GPU GEMMs call MAX's Mojo M5 matrix kernel.

`package.py` follows `otool -L`, copies the transitive non-system dylibs, removes the virtualenv rpaths, adds `@loader_path`, rewrites install names, signs each with `codesign --force --sign -`, and verifies with `codesign --verify --strict`. The actual packaged files are:

| File | Bytes after relocation/signing |
|---|---:|
| `libib_mojo_gpu.dylib` | 277,392 |
| `libAsyncRTMojoBindings.dylib` | 1,210,816 |
| `libAsyncRTRuntimeGlobals.dylib` | 332,176 |
| `libMSupportGlobals.dylib` | 122,816 |
| `libKGENCompilerRTShared.dylib` | 1,193,952 |
| **Total, excluding weights** | **3,137,152** |

The FP32 model plus this GPU closure totals **1,087,164,128 bytes**. Toolchain/debugger/Python packages are build dependencies and are not in that total. The CPU closure is 2,897,872 bytes. The packaged GPU library was called successfully from Rust under `env -i PATH=/usr/bin:/bin IB_MOJO_PREFIX=ib_mojo_gpu`; the CPU counterpart also passed with `VECLIB_MAXIMUM_THREADS=4`. This validates actual relocation/loading on the current machine, rather than assuming `otool` alone proves it.

The native GPU dylib's `LC_BUILD_VERSION` is **minos 27.0**; all four bundled runtime dylibs declare **11.0**. An explicit M1 CPU target plus linker platform flags produced a library marked **15.0**, and its relocated/signed Rust test passed on this macOS 27 M5. Merely setting `--target-triple aarch64-apple-macosx15.0` initially still emitted minos 27.0, so the linker flags in the README are necessary. The lowest OS actually executed here is **27.0.1**; a macOS 15 load is not proven by metadata. The GPU matrix kernel explicitly requires M5; marking it for 15 would not establish M1–M4 GPU compatibility.

Ad-hoc signing succeeds for the real binaries and runtime closure. An actual Developer ID identity, hardened-runtime app embedding, notarization and distribution to another Mac were not exercised, so those remain release gates. The package manifests preserve dependencies, byte sizes, minos and signature verification output: [GPU](evidence/package-gpu-final.json), [CPU](evidence/package-cpu.json).

## What integration would require

Do not start the engine switch from this result. First beat Q8's single-query latency and chosen indexing-throughput target with the same numerical gates, then validate a releasable host/accelerator matrix. Concrete next performance work is persistent workspaces, fused normalization/residual/GeGLU paths and efficient batched attention, followed by FP16/BF16 weight/layout experiments with the same ≥0.99 criterion. None is claimed implemented or measured here.

Once those gates pass, integrate through the existing Rust engine actor: keep typed borrowed IDs/output buffers, serialize a GPU handle, select a measured device backend and retain llama.cpp on unsupported systems. Add pinned download/size/SHA checks for the chosen shipping weights, cancellation/result-discard and on/off/exit cleanup, app bundle rpaths and Developer ID/notarization checks. Engine/quantization/prompt/context changes must bump `INDEX_VERSION` and rebuild local derived vectors without mixing versions. A 100-sequence / 16,384-total-token spike batch cap is not an app policy. Idle/scheduled/on-demand indexing moments remain a product integration decision; this spike changes no indexing cadence.

Required broader coverage before integration includes valid boundary-length inputs, long-window attention, batch memory pressure, repeated load/unload, cancellation, device/OS fallback, and native packaged-app behavior. None is inferred from the 20-case gate.

## Scope, checks and artifacts

All repository changes are new files under `app/apps/desktop/dev/mojo-engine/`. Existing dirty files, including another worker's `semantic.rs` changes, were preserved. No git commit, push, checkout, reset or stash; no server/database tests; no product UI changes. Large toolchain/model-derived artifacts stay under `/private/tmp/ib-mojo-spike/` and the pre-existing model cache.

Exact setup/build/convert/oracle/verify/package/FFI commands and ownership contract are in [the experiment README](/Users/iron/Project/psw/infinite-brain/app/apps/desktop/dev/mojo-engine/README.md). Rust release build, `cargo fmt --check`, Mojo/Python formatter checks, Python compilation and repository whitespace checks passed. Source hashes are in [source-sha256.json](evidence/source-sha256.json).

Dependency-review lookup for the exact official Mojo/Modular versions was attempted but Endor credentials were unavailable (`no credentials found`); package risk posture is **UNKNOWN**, not a security clearance. Installation had already been explicitly approved by the task; no credentials or Endor configuration were changed.

No macOS 15 device test, M1–M4 GPU test, native Windows test, Developer ID/notarization or application integration is claimed. Overall recommendation remains **do not switch**.
