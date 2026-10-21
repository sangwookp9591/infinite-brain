# SPDX-License-Identifier: Apache-2.0
"""Summarize the ignored E5 raw results directory with deterministic bootstrap CI."""
import csv
import json
import random
import re
import statistics
import sys
from pathlib import Path


def read_csv(path):
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def bootstrap_median_ci(values, seed=20261020, rounds=10000):
    rng = random.Random(seed)
    estimates = sorted(statistics.median(rng.choices(values, k=len(values))) for _ in range(rounds))
    return estimates[int(rounds * .025)], estimates[int(rounds * .975) - 1]


def summarize(values):
    values = sorted(values)
    q1 = statistics.median(values[:len(values)//2])
    q3 = statistics.median(values[(len(values)+1)//2:])
    lo, hi = bootstrap_median_ci(values)
    return {"n": len(values), "median": statistics.median(values), "q1": q1, "q3": q3, "ci95": [lo, hi]}


def mean_sd(values):
    return {"mean": statistics.mean(values), "sd": statistics.stdev(values)}


def quantile(values, p):
    values = sorted(values)
    return values[min(len(values)-1, max(0, int((len(values)-1)*p + .5)))]


def main(root):
    runs = [json.loads((root / f"q8-{i}.json").read_text()) for i in range(1, 6)]
    q8_single = [r["median_ms"] for r in runs]
    q8_best = [max(r["batch_100"], key=lambda b: b["paragraphs_per_second"]) for r in runs]
    q8_after = json.loads((root / "q8-after.json").read_text())
    q8_after_best = max(q8_after["batch_100"], key=lambda b: b["paragraphs_per_second"])
    go_rows = [row for i in range(1, 6) for row in read_csv(root / "raw" / f"go-{i}.csv")]
    go_run_medians = [float(re.search(r"warm_median_ms=([\d.]+)", (root / f"go-{i}.log").read_text()).group(1)) for i in range(1, 6)]
    go_single = [float(r["ms"]) for r in go_rows if r["kind"] == "single"]
    go_batch = [float(r["ms"]) for r in go_rows if r["kind"] == "batch100_paragraphs_per_second"]
    http_rows = [row for i in range(1, 6) for row in read_csv(root / "raw" / f"go-{i}.csv") if row["kind"] == "http"]
    http = [float(r["ms"]) for r in http_rows]
    http_rps = [float(re.search(r"throughput_rps=([\d.]+)", (root / f"go-{i}.log").read_text()).group(1)) for i in range(1, 6)]
    cgo_ns = [float(re.search(r"cgo_noop_ns_per_call=([\d.]+)", (root / f"go-{i}.log").read_text()).group(1)) for i in range(1, 6)]
    go_cos = [float(r["ms"]) for r in go_rows if r["kind"] == "single_cosine"]
    go_diff = [float(r["ms"]) for r in go_rows if r["kind"] == "single_max_abs_diff"]
    batch_cos = [float(r["ms"]) for r in go_rows if r["kind"] == "batch_cosine"]
    windows = {}
    for name in ("0", "6"):
        rows = read_csv(root / "raw" / f"window-{name}.csv")
        times = [float(r["ms"]) for r in rows if r["kind"] == "http"]
        windows[name] = {"http_latency_ms": {"n":len(times), "p50":quantile(times,.50), "p95":quantile(times,.95)}}
        log = (root / f"window-{name}.log").read_text()
        windows[name]["summary_line"] = next(line for line in log.splitlines() if line.startswith("http_concurrent"))
        windows[name]["throughput_rps"] = float(re.search(r"throughput_rps=([\d.]+)", log).group(1))
    result = {
        "q8_single_process_medians_ms": summarize(q8_single),
        "go_single_process_medians_ms": summarize(go_run_medians),
        "go_single_150_calls_ms": summarize(go_single),
        "q8_best_batch100_paragraphs_per_second_mean_sd": mean_sd([b["paragraphs_per_second"] for b in q8_best]),
        "q8_best_batch_sizes": [b["batch_size"] for b in q8_best],
        "go_batch100_paragraphs_per_second_mean_sd": mean_sd(go_batch),
        "go_cgo_noop_ns_per_call_mean_sd": mean_sd(cgo_ns),
        "go_http_3ms_throughput_mean_sd_rps": mean_sd(http_rps),
        "go_http_3ms_latency_ms": {"n":len(http), "p50":quantile(http,.50), "p95":quantile(http,.95)},
        "go_single_cosine_min_mean": {"min": min(go_cos), "mean": statistics.mean(go_cos)},
        "go_single_max_abs_diff_max": max(go_diff),
        "go_mixed_batch_cosine_min_mean": {"min": min(batch_cos), "mean": statistics.mean(batch_cos)},
        "windows": windows,
        "q8_after_bracket": {"single_median_ms":q8_after["median_ms"], "best_batch_size":q8_after_best["batch_size"], "best_paragraphs_per_second":q8_after_best["paragraphs_per_second"]},
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: summarize.py RESULTS_DIR")
    main(Path(sys.argv[1]))
