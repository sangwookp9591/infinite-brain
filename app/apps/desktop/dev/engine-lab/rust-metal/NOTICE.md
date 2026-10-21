# Source and license notes

This experiment's Rust/Python/shell sources use Apache-2.0, matching the repository.
The local `mojo-engine/gpu_ops.mojo` and `engine.mojo` sources also carry Apache-2.0.
No ggml-metal or MLX shader implementation was copied into this experiment.

Generated AIR includes Modular's `AppleM5MatMul` implementation:
Copyright (c) 2026, Modular Inc. All rights reserved.
Licensed under the Apache License v2.0 with LLVM Exceptions:
<https://llvm.org/LICENSE.txt>.
Source: <https://github.com/modular/modular/blob/main/max/kernels/src/linalg/matmul/gpu/apple/matmul_kernel.mojo>.
The exact local compilation inputs and selected AIR SHA-256 values are recorded in
`results/aot-manifest.json`; public main is contextual documentation, not proof of
the installed wheel's exact source revision. A redistributable package must retain
the upstream notices and license text; this research directory stores no models.

Rust dependency versions are frozen by `Cargo.lock`. Resolved manifests declare
MIT for `objc2`/`objc2-foundation`, Zlib OR Apache-2.0 OR MIT for `objc2-metal`,
and MIT OR Apache-2.0 for `memmap2`/`serde_json`. These notes are provenance, not a completed
release license audit. llama.cpp is used only by the separately built shared oracle
and baseline, and is not linked into the E1 dylib.
