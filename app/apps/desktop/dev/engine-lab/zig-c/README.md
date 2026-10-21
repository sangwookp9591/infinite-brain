# E3: Zig + Objective-C + MSL

The scheduled final study uses immutable copies in `build/frozen/` (both dylibs and an APFS clone of the existing converted model), identified by `results/setup/frozen-runtime.sha256`. These ignored build artifacts are available on this research machine; `reproduce.sh` rebuilds equivalent artifacts from source for a new study.

Isolated EmbeddingGemma 2 research prototype. No app code, tokenizer or llama.cpp inference is used by the engine. New sources and the adapted Mojo equations are Apache-2.0. The existing model's own license still applies. Zig standard-library/runtime code included in generated binaries is covered by [the Zig MIT notice](LICENSE-ZIG); the installed toolchain license was retained here. The prototype accepts the existing converted `IBMOJO01` FP32 weights, not GGUF directly.

Zig owns validation, workspace reuse and all 24 encoder layers. `metal.m` only bridges Metal API calls; `kernels.metal` implements arithmetic. FP16 matrix operands accumulate into FP32; norms, attention, residuals, pooling and the 768-dimensional result use FP32. `libib_zig_split.dylib` changes only command-buffer granularity, retaining the same scheduler object and kernels.

From this directory, on Apple Silicon/macOS with Xcode and Homebrew:

```sh
brew install zig
sh build.sh
```

The tested compiler is Zig 0.17.0. Build products stay in ignored `build/`. `build.sh` makes the ordinary dylib, split-submission dylib and a static archive. `ib_engine_*` follows [the shared header](../harness/ib_engine.h). Legacy `ib_mojo_gpu_*` exports let the unchanged `verify.py` exercise the original regression suite. Calls on one handle must be serialized. `init` returns null on error, embed returns 0, invalid argument -1, invalid token -2, nonfinite output -3, allocation/Metal error -4. Handles must be freed exactly once. Caller owns nonaliasing token/length/output storage for each synchronous call.

Prepare converted weights with the existing tool only if absent:

```sh
/private/tmp/ib-mojo-spike/venv/bin/python ../../mojo-engine/convert.py \
  "$HOME/.cache/infinite-brain-b0/models/embeddinggemma-2-BF16.gguf" \
  /private/tmp/ib-mojo-spike/weights.bin
python3 predict.py build
```

The complete reproduction command, including the shared harness's fresh interleaved Q8 baseline and raw CSV, is:

```sh
sh reproduce.sh
```

For an individual original-gate run (always take the shared GPU lock):

```sh
until mkdir /private/tmp/ib-gpu-bench.lock 2>/dev/null; do sleep 5; done
trap 'rmdir /private/tmp/ib-gpu-bench.lock' EXIT
/private/tmp/ib-mojo-spike/rust-target/release/reference \
  "$HOME/.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf" \
  ../../mojo-engine/inputs.json build/q8.json
IB_MOJO_PREFIX=ib_mojo_gpu /private/tmp/ib-mojo-spike/venv/bin/python \
  ../../mojo-engine/verify.py "$PWD/build/libib_zig.dylib" \
  /private/tmp/ib-mojo-spike/weights.bin "$PWD/build/q8.json" "$PWD/build/zig.json"
/private/tmp/ib-mojo-spike/venv/bin/python ../../mojo-engine/gate.py build/q8.json build/zig.json
# gate.py exit 1 is a NO-GO result, not a build failure to suppress.
```

Calibration uses `microbench.py build/calibration.json` under that lock. It checks stream-copy contents and full/skinny GEMM values before reporting GPU command timestamps; this is a calibration, not a substitute correctness gate. `IB_ZIG_DEBUG=1` inserts per-dispatch fences and prints intermediate ranges; it changes scheduling and must never be used for performance comparisons. `IB_ZIG_SPLIT=1` selects per-dispatch submission in the ordinary library; the dedicated split library uses a build-time default so the shared harness can compare both cells in separate processes.

Cargo integration is demonstrated by a standalone crate in this directory:

```sh
cargo build --release --target-dir build/cargo
# reproduce.sh creates the token/vector binary inputs and runs this under the lock:
build/cargo/release/zig-static-smoke /private/tmp/ib-mojo-spike/weights.bin \
  build/tokens.bin build/vector.bin
```

`cargo-build.rs` links the Zig+ObjC static archive with Metal/Foundation. A real Tauri integration would additionally run the Zig build from `build.rs`, pin its version, choose target architectures and propagate errors; this prototype deliberately does not edit the app. `zig cc` can compile the shim with the Apple SDK:

```sh
zig cc -O3 -isysroot "$(xcrun --sdk macosx --show-sdk-path)" \
  -mmacosx-version-min=14.0 -c metal.m -o build/metal-zigcc.o
zig build-obj engine.zig -O ReleaseSafe -lc -target x86_64-windows-gnu \
  -femit-bin=build/engine-windows.obj
```

The Windows object only proves Zig frontend/code generation. It does not provide Metal, Objective-C Foundation or `mmap` on Windows. A different GPU backend and platform I/O implementation are required; a compiled object is not a runnable Windows engine. The macOS deployment marker likewise does not establish execution on older hardware/OS releases.
