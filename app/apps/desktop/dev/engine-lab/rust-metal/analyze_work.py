# SPDX-License-Identifier: Apache-2.0
"""Analytic GEMM work inventory, independent of benchmark timings."""
import csv
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
rows = []


def mm(name, m, k, n):
    flops = 2*m*k*n
    byte_count = 2*m*k + 2*n*k + 4*m*n
    rows.append(dict(kernel=name, m=m, k=k, n=n, flops=flops,
                     bytes_min=byte_count, intensity=flops/byte_count))


mm("ple", 82, 512, 12288)
for layer in range(24):
    d = 512 if layer % 6 == 5 else 256
    for name, k, n in (("qkv", 512, 4*d+1024), ("attention_output", 4*d, 512),
                       ("gate_up", 512, 4096), ("ffn_down", 2048, 512),
                       ("input_gate", 512, 512), ("ple_output", 512, 512)):
        mm(f"layer{layer}.{name}", 82, k, n)
mm("output", 1, 512, 768)
assert len(rows) == 146
out = HERE / "results"
out.mkdir(exist_ok=True)
with (out / "analytic-gemm.csv").open("w") as f:
    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
split_count = sum(
    (r["m"] + 63) // 64 * ((r["n"] + 63) // 64) <= 16
    and (r["k"] + 15) // 16 >= 32
    and (r["k"] + 15) // 16 >= 8 * ((r["m"] + 63) // 64) * ((r["n"] + 63) // 64)
    for r in rows
)
assert split_count == 28
summary = dict(gemm_flops=sum(r["flops"] for r in rows),
               gemm_bytes_min=sum(r["bytes_min"] for r in rows),
               fp16_dense_weight_bytes=sum(2*r["k"]*r["n"] for r in rows),
               dispatches_base=417, dispatches_with_split_k=417 + split_count,
               note="GEMM only; lower-bound bytes exclude tile rereads/cache, attention and row kernels")
(out / "analytic-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary))
calibration = Path(sys.argv[1]) if len(sys.argv) > 1 else out / "full"
if (calibration / "prediction.json").exists():
    micro = json.loads((calibration / "prediction.json").read_text())
    bw, peak = micro["bw_gb_s"] * 1e9, micro["fp16_peak_tflops"] * 1e12
    floor = sum(max(r["bytes_min"] / bw, r["flops"] / peak) for r in rows) * 1000
    result = dict(measured_bw_gb_s=micro["bw_gb_s"], measured_fp16_peak_tflops=micro["fp16_peak_tflops"],
                  cpu_submit_us=micro["submit_cpu_us"], gemm_sum_roofline_floor_ms=floor,
                  rust_cb_submission_floor_ms=micro["submit_cpu_us"] / 1000,
                  prediction_preregistered_ms=[15.4, 18.9], calibration_source=str(calibration),
                  note="GEMM floor, eta=1; excludes attention, row kernels, cache rereads, barriers and host/readback. Calibration follows diagnostic but precedes final candidate trials.")
    (out / "rust-roofline-floor.json").write_text(json.dumps(result, indent=2) + "\n")
