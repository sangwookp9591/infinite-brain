# SPDX-License-Identifier: Apache-2.0
"""Export exploratory verifier samples; never manufacture independent-process CIs."""
import csv
import json
from pathlib import Path
import statistics

folder = Path(__file__).resolve().parent / "results" / "diagnostic"
data = json.loads((folder / "quick-verify-fixed.json").read_text())
assert len(data["cosines"]) == 20 and len(data["latency_samples_ms"]) == 30
assert len(data["batch_100_trials_ms"]) == 4
rows = [dict(engine="rust-metal-mojoair-fp16-one", process="diagnostic-0", scenario="SingleStream",
             iteration=i, latency_ms=ms, throughput=1000/ms,
             timing_source="Python verify.py ctypes; exploratory")
        for i, ms in enumerate(data["latency_samples_ms"])]
rows += [dict(engine="rust-metal-mojoair-fp16-one", process="diagnostic-0", scenario="Offline100",
              iteration=i, latency_ms=ms, throughput=100000/ms,
              timing_source="Python verify.py ctypes; exploratory")
         for i, ms in enumerate(data["batch_100_trials_ms"][1:])]
with (folder / "raw.csv").open("w") as stream:
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
summary = dict(cosine_min=min(data["cosines"]), cosine_mean=statistics.mean(data["cosines"]),
               median_ms=statistics.median(data["latency_samples_ms"]),
               batch100_median_ms=statistics.median(data["batch_100_trials_ms"][1:]),
               batch100_per_second=data["batch_100_paragraphs_per_second"],
               max_abs_diff=data["max_abs_diff"], independent_processes=1,
               process_bootstrap_ci95=None,
               limitation="One exploratory process; not the final native shared-harness comparison")
(folder / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary))
