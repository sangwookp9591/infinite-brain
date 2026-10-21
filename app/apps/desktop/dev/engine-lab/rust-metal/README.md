# E1: Rust host + AOT Mojo AIR

Isolated research prototype. Application code is untouched. Source license: Apache-2.0.

`build.py` reads `../../mojo-engine/{engine_gpu,gpu_ops,engine}.mojo` without editing them.
It uses Mojo `--target-accelerator apple-m5 --emit air`, then `xcrun metallib`.
No Mojo runtime or Python is linked into the Rust dylib; `objc2-metal` owns encoding.
The precompiled functions are in `/private/tmp/ib-engine-e1/mojo.metallib` and names
in `kernels.json`; both are available read-only to the E3 host experiment.

## ABI for another Metal host

Mojo AIR parameters are **by reference**, including pointer parameters. Bind each
pointer argument to an 8-byte buffer holding the **GPU address** of the actual
buffer (plus tensor byte offset), rather than binding the actual data buffer.
A row-major TileTensor argument is 32 bytes: `{uint64 gpu_ptr, int64 rows,
int64 cols, int64 row_stride}` with `row_stride == cols`. Scalars are separate
4-byte buffers (int32/float32). Argument order matches source order. Both
mutability annotations and Metal reflection report `void` for the wrapper pointers;
do not infer parameter layout from those annotations. The emitted `.ll` files
show the actual loads. Mark indirect buffers resident via `useResource`, and use
buffer memory barriers between dependent dispatches. Keep argument storage alive
until command-buffer completion. `lib.rs` is the complete working host recipe.

The GEMM accepts `C, A, B, log2_m, log2_n` with B stored `(N,K)`, grid
`nextpow2(ceil(M/64))*nextpow2(ceil(N/64))`, 128 threads/group. Split-K follows
the installed Modular source heuristic; it uses a partials buffer and reduction.
Local RoPE/attention names map to 256-d, two KV heads; full to 512-d, one KV head.

## Build and quick correctness

Run from this directory. Prerequisites: existing Mojo environment, Metal toolchain,
and existing converted weights/reference from the shared `mojo-engine/README.md`.

```sh
python3 build.py
cargo test --locked --lib
```

All timed GPU commands must acquire `/private/tmp/ib-gpu-bench.lock`. The shared
`verify.py` is reused unchanged, including invalid-model and mixed-batch checks:

```sh
(
  until mkdir /private/tmp/ib-gpu-bench.lock 2>/dev/null; do sleep 5; done
  trap 'rmdir /private/tmp/ib-gpu-bench.lock' EXIT
  IB_MOJO_PREFIX=ib_mojo_gpu /private/tmp/ib-mojo-spike/venv/bin/python \
    ../../mojo-engine/verify.py "$PWD/target/release/libib_rust_metal.dylib" \
    /private/tmp/ib-mojo-spike/weights.bin /private/tmp/ib-mojo-opt/q8-gate.json \
    /private/tmp/ib-engine-e1/quick-verify.json
)
```

The quick check above is diagnostic. Final comparison numbers will come from the
shared harness, with fresh interleaved llama.cpp baselines and the common ABI.

## Full study and trace

```sh
./reproduce.sh
# A fresh results/shared-TIMESTAMP directory receives the unchanged shared
# harness's five interleaved independent processes and native timing CSVs.
# E1_RESULTS=/absolute/fresh-directory ./reproduce.sh selects the destination.
```

The full default is long: 30 SingleStream calls, 30 *100-paragraph* Offline trials
at each of seven batch sizes, and 30 Poisson arrivals at each of nine QPS levels,
per process. Coordinate the GPU turn before launching it. `results/diagnostic/`
is one preliminary verifier pair; it is not a five-process study. `results/full/`
contains the initially interrupted shared run, and must not be presented as a
completed five-process comparison.

Trace commands from this directory (after a fresh adjacent baseline, under the
same scheduling arrangement). `TRACE_DIR` must be fresh:

```sh
TRACE_DIR=/private/tmp/ib-engine-e1/trace-$(date +%Y%m%d-%H%M%S)
mkdir -p "$TRACE_DIR"
(
  until mkdir /private/tmp/ib-gpu-bench.lock 2>/dev/null; do sleep 5; done
  trap 'rmdir /private/tmp/ib-gpu-bench.lock' EXIT
  xcrun xctrace record --template 'Metal System Trace' --time-limit 30s --no-prompt \
    --output "$TRACE_DIR/rust-one.trace" --target-stdout "$TRACE_DIR/stdout.json" \
    --launch -- "$PWD/target/release/trace-e1" /private/tmp/ib-mojo-spike/weights.bin \
    "$PWD/results/full/reference.json"
)
xcrun xctrace export --input "$TRACE_DIR/rust-one.trace" --toc --output "$TRACE_DIR/toc.xml"
xcrun xctrace export --input "$TRACE_DIR/rust-one.trace" \
  --xpath '/trace-toc/run[@number="1"]/data/table[@schema="metal-application-encoders-list"]' \
  --output "$TRACE_DIR/encoders.xml"
xcrun xctrace export --input "$TRACE_DIR/rust-one.trace" \
  --xpath '/trace-toc/run[@number="1"]/data/table[@schema="metal-gpu-intervals"]' \
  --output "$TRACE_DIR/gpu.xml"
python3 summarize_trace.py "$TRACE_DIR/encoders.xml" "$TRACE_DIR/gpu.xml" \
  "$TRACE_DIR/stdout.json" "$TRACE_DIR/counts.json"
```

The labeled trace process executes exactly 40 paragraphs: 10 warmup, a 3-second
trace-settle pause, 30 calls. Trace timing is diagnostic and separate from the
uninstrumented gate. Unique traced IDs establish command-buffer counts; dispatch
counts come from the native host launch counter, not that encoder table.

## Relocation / ad-hoc signing check

```sh
mkdir -p /private/tmp/ib-engine-e1/package
cp target/release/libib_rust_metal.dylib /private/tmp/ib-engine-e1/{mojo.metallib,kernels.json} \
  /private/tmp/ib-engine-e1/package/
install_name_tool -id @rpath/libib_rust_metal.dylib \
  /private/tmp/ib-engine-e1/package/libib_rust_metal.dylib
codesign --force --sign - /private/tmp/ib-engine-e1/package/libib_rust_metal.dylib
codesign --verify --strict /private/tmp/ib-engine-e1/package/libib_rust_metal.dylib
env -i PATH=/usr/bin:/bin /private/tmp/ib-mojo-spike/venv/bin/python -c \
  'import ctypes; l=ctypes.CDLL("/private/tmp/ib-engine-e1/package/libib_rust_metal.dylib"); l.ib_engine_name.restype=ctypes.c_char_p; print(l.ib_engine_name().decode())'
```

This checks loading/name lookup, not GPU inference from the relocated bundle.
Developer ID, hardened runtime, notarization and older-device execution are untested.
M5 is explicitly required; the Mach-O macOS 11.0 deployment marker does not provide
M1-M4 compatibility. See `NOTICE.md` for generated-kernel/dependency provenance.

Measured trace: 40 forward buffers / 40 encoders for 40 calls, host counter 445 dispatches/call.
The earlier 421 prediction omitted 24 FFN-down split-K reductions.
Final runtime closure: `/private/tmp/ib-engine-e1/frozen-20261020-a`; set `E1_OUT` to
that path **when running** its frozen dylib/trace binary. Do not rebuild into the
read-only snapshot. `results/frozen-manifest.json` records the whole closure and weights hash.
