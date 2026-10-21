# SPDX-License-Identifier: Apache-2.0
"""Build common-ABI E0 factor levels without editing the shared harness."""
from pathlib import Path
import json
import subprocess
import sys

here = Path(__file__).resolve().parent
out = Path(
    sys.argv[1] if len(sys.argv) > 1 else "/private/tmp/ib-mojo-opt/e0-abi"
).resolve()
out.mkdir(parents=True, exist_ok=True)
levels = [
    ("base", 0, 0, 0),
    ("sync1", 1, 0, 0),
    ("sync2", 2, 0, 0),
    ("sync3", 3, 0, 0),
    ("sync4", 4, 0, 0),
    ("cap64", 0, 0, 64),
    ("prepare", 0, 1, 0),
    ("prepare-sync3", 3, 1, 0),
]
manifest = []
for name, sync, prepare, cap in levels:
    path = out / f'libe0_{name}.dylib'
    command = [
        "xcrun",
        "clang",
        "-dynamiclib",
        "-O2",
        "-Wall",
        "-Wextra",
        "-mmacosx-version-min=11.0",
        f'-DE0_SYNC={sync}',
        f'-DE0_PREPARE={prepare}',
        f'-DE0_CAP={cap}',
        f'-DE0_NAME="mojo-gpu-fp16-{name}"',
        "e0_adapter.c",
        "-o",
        str(path),
    ]
    subprocess.run(command, cwd=here, check=True)
    manifest.append(
        {
            "name": name,
            "library": str(path),
            "model": "/private/tmp/ib-mojo-spike/weights.bin",
            "kernel": "Mojo AIR",
            "host": "Mojo DeviceContext",
            "precision": "FP16 weights/FP32 accum",
            "submission": "one buffer per operation",
            "sync_layers": sync,
            "residual_prepare": prepare,
            "coalescing_cap": cap or None,
            "runtime_stats": "unavailable; use actual trace counters",
        }
    )
(out / "factors.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(out / "factors.json")
