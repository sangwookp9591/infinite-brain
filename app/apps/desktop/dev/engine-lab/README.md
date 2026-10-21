<!-- SPDX-License-Identifier: Apache-2.0 -->
# Embedding engine laboratory

Isolated Apple Silicon research; none of these engines is selected by the desktop
app. The production engine remains llama.cpp. Models, compiled engines, virtual
environments and interrupted full sweeps stay local and are ignored by Git.

Start with the [comparison and evidence limits](../../../../../docs/reports/ENGINE-LAB-COMPARISON.md),
the [algorithm and paper explanations](../../../../../docs/reports/ENGINE-LAB-ALGORITHMS-AND-METHODS.md),
and the [measurement methodology](../../../../../docs/reports/ENGINE-LAB-METHODOLOGY.md).
For another computer, follow the [handoff guide](../../../../../docs/reports/ENGINE-LAB-HANDOFF.md)
before running the historical launch scripts or rebuilding missing artifacts.

| Directory | Purpose | Measurement status |
| --- | --- | --- |
| `harness/` | Common C ABI, native runner, three scenarios, statistics | CPU self-checks pass; original Mojo full comparison interrupted |
| `rust-metal/` | E1: Rust Metal host loading Mojo AIR kernels | Complete five-process comparison; independent remeasurement pending |
| `zig-c/` | E3: Zig scheduler and Objective-C Metal shim | Correctness and diagnostic measurements only |
| `coreml/` | E4: Core ML GPU and static82 ANE candidates | Corrected static82 native accuracy gate passes; full comparison pending |
| `go/` | E5: Go/cgo embedding and batching experiment | Exploratory timings and CPU ABI smoke; native shared study pending |
| `../mojo-engine/` | E0: Mojo submission/fusion variants | Correctness and exploratory measurements; full variant studies pending |

The [shared harness README](harness/README.md) documents installation, exact study
sizes, locking and artifact fingerprints. Running a full study is intentionally
slow. Smoke and partial outputs do not qualify as full measurements.

Completed E1 raw measurements and the E4 native gate are published under
[`evidence/`](evidence/README.md). They support reanalysis, not reproduction of
GPU execution without the locally built engine and model artifacts.
