<!-- SPDX-License-Identifier: Apache-2.0 -->
# E5: Go host and batching prototype

This lab dynamically loads the read-only Mojo GPU C ABI, so it measures Go/cgo
hosting without adding a Go dependency or touching application code. The small
HTTP service accepts shared-fixture indexes, gathers requests for 3 ms (or
`-window`), then embeds each gathered set through one C batch call. Fixture-index
input is deliberate: tokenization is outside this experiment, so this prototype
does not claim to be a general text embedding API.

## Shared `ib_engine` ABI candidate

The same Go host builds as `build/libib_go.dylib` for the shared engine harness.
It exports `ib_engine_init/embed/embed_batch/free/name`; batch `size_t` lengths
are range-checked and converted to Mojo's `int32` contract. `ib_engine_stats` is
omitted because this wrapper has no trustworthy per-call counters. The shared
library loads the Mojo dylib from `IB_MOJO_LIBRARY` and uses the model path passed
by the harness.

Build and run a CPU-only ABI smoke with a temporary fake Mojo dylib (no model,
Metal device, GPU lock, or benchmark run):

```sh
go build -buildmode=c-shared -o build/libib_go.dylib .
./abi_smoke.sh
```

For the scheduled common harness run, map the absolute candidate path to the
existing converted weights. This invokes the GPU pipeline and must run only in
the assigned measurement slot:

```sh
CANDIDATE="$PWD/build/libib_go.dylib"
IB_MOJO_LIBRARY=/private/tmp/ib-mojo-opt/package-final/optimized-final.dylib \
IB_ENGINE_MODELS="{\"$CANDIDATE\":\"/private/tmp/ib-mojo-spike/weights.bin\"}" \
  ../harness/run.sh "$CANDIDATE"
```

## Reproduce

Run from this directory. `reference` is the existing Mojo experiment's Rust
llama.cpp/Q8 oracle and benchmark; it writes fresh vectors and timings. The runner
performs five paired Q8/Go runs, two batching-window ablations, then a final Q8
run. The GPU lock wraps every timed Metal section. Each execution creates a new
timestamped ignored result directory so prior raw CSV, oracle JSON, and logs are
never overwritten.

```sh
./run.sh
```

`reference` checks all 20 fixture token IDs, vectors, warm single latency, and
best 100-paragraph Q8 throughput. The Go process checks each of the 20
single-input and mixed-length batch vectors against that fresh Q8 oracle, then
measures 30 warm single calls, 100-input C batch calls, and concurrent HTTP
latency/throughput. It also compares zero, 3 ms and 6 ms queue windows. Its
`cgo_noop_ns_per_call` is a C ABI crossing lower bound, not the cgo cost of a
Metal embedding. The HTTP result includes the deliberate batching delay.

The prototype intentionally uses no tokenizer, authentication, cancellation
protocol, health endpoint, graceful service lifecycle, or production error
surface. Those are not needed to answer the engine-hosting question. The Go
service serializes use of one Mojo handle, matching the engine ABI's ownership
contract.
