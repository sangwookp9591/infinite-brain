# SPDX-License-Identifier: Apache-2.0
"""Judge adoption from a fresh Q8 oracle and verify.py output against that oracle."""
import json
import sys
from pathlib import Path

q8_path, mojo_path = map(Path, sys.argv[1:])
q8, mojo = (json.loads(path.read_text()) for path in (q8_path, mojo_path))
assert (
    Path(mojo["reference"]).resolve() == q8_path.resolve()
), "use the same Q8 oracle"
assert len(q8["rows"]) == len(mojo["cosines"]) == len(mojo["vectors"]) == 20
assert q8["benchmark_tokens"] == mojo["tokens"] == 82
assert {row["batch_size"] for row in q8["batch_100"]} == {
    4,
    8,
    16,
    24,
    32,
    64,
    100,
}
best = max(q8["batch_100"], key=lambda row: row["paragraphs_per_second"])
checks = {
    "cosine": min(mojo["cosines"]) >= 0.999
    and mojo["mixed_batch_cosine_min"] >= 0.999,
    "latency": mojo["median_ms"] < q8["median_ms"],
    "throughput": mojo["batch_100_paragraphs_per_second"]
    > best["paragraphs_per_second"],
}
print(
    json.dumps(
        {
            "adopt": all(checks.values()),
            "checks": checks,
            "q8_median_ms": q8["median_ms"],
            "mojo_median_ms": mojo["median_ms"],
            "q8_best_batch_size": best["batch_size"],
            "q8_best_paragraphs_per_second": best["paragraphs_per_second"],
            "mojo_batch_100_paragraphs_per_second": mojo[
                "batch_100_paragraphs_per_second"
            ],
            "cosine_min": min(mojo["cosines"]),
            "would_require_index_version_bump": min(mojo["cosines"]) < 0.9999,
        },
        indent=2,
    )
)
sys.exit(0 if all(checks.values()) else 1)
