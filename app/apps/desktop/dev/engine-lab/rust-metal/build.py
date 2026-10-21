# SPDX-License-Identifier: Apache-2.0
"""AOT existing Mojo kernels; no Mojo runtime is linked into the Rust host."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent.parent / "mojo-engine"
OUT = Path(os.environ.get("E1_OUT", "/private/tmp/ib-engine-e1")).resolve()
MOJO = os.environ.get("MOJO", "/private/tmp/ib-mojo-spike/venv/bin/mojo")
OUT.mkdir(parents=True, exist_ok=True)
for pattern in ("engine_*.air", "engine_*.ll"):
    for generated in OUT.glob(pattern):
        generated.unlink()  # Do not silently link a stale kernel after the source kernel set changes.


def run(*args):
    print(" ".join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), check=True)


for emission, suffix in (("air", "bc"), ("asm", "s")):
    run(MOJO, "build", SOURCE / "engine_gpu.mojo", "--target-accelerator", "apple-m5",
        "--emit", emission, "-o", OUT / f"engine.{suffix}")
air = sorted(OUT.glob("engine_*.air"))
assert len(air) >= 19, f"kernel set changed: {len(air)}"
names = {}
selected = []
for path in air:
    ir = path.with_suffix(".ll").read_text()
    name = re.search(r"define void @([^ (]+)", ir)[1]
    if name.startswith("gpu_ops_residual_prepare_"):
        continue  # E0 owns these new fused kernels; E1 preserves the unfused 417-op graph.
    if name.startswith("gpu_ops_"):
        key = name.removeprefix("gpu_ops_").split("_Point")[0].split("_SIMD")[0]
        if key in ("attention", "projected_rope"):
            # Validate the pinned specializations, rather than guessing an ABI after a compiler update.
            full = name.endswith(("7cfbd0802168c665", "d0d48eb284b016ca"))
            key += "_full" if full else "_local"
    elif name.startswith("apple_matmul_run"):
        if name.endswith("fc27a9da"):
            continue  # i64 offset arithmetic; this experiment's bounded shapes fit i32.
        assert name.endswith("289ceaea")
        key = "matmul"
    elif name.startswith("apple_matmul_split_k_partial"):
        if name.endswith("f60d1238"):
            continue
        assert name.endswith("ed4686e2")
        key = "split_partial"
    else:
        assert name.startswith("apple_matmul_split_k_reduce")
        key = "split_reduce"
    assert key not in names, key
    names[key] = name
    selected.append(path)
assert set(names) == {
    "matmul", "split_partial", "split_reduce", "attention_full", "attention_local",
    "gather", "geglu_half", "half_copy", "l2", "normalize_copy", "normalize_half",
    "ple_half", "pool", "projected_rope_full", "projected_rope_local", "rms", "rms_residual",
}, names
run("xcrun", "metallib", *selected, "-o", OUT / "mojo.metallib")
(OUT / "kernels.json").write_text(json.dumps(names, indent=2) + "\n")
manifest = {str(p.relative_to(SOURCE)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (SOURCE / "engine_gpu.mojo", SOURCE / "gpu_ops.mojo", SOURCE / "engine.mojo")}
manifest["mojo.metallib"] = hashlib.sha256((OUT / "mojo.metallib").read_bytes()).hexdigest()
manifest["selected_air_sha256"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in selected}
(OUT / "aot-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
run("cargo", "build", "--release", "--locked", "--manifest-path", HERE / "Cargo.toml")
