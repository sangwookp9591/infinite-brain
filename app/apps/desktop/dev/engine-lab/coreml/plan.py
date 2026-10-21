# SPDX-License-Identifier: Apache-2.0
from pathlib import Path
import json
import coremltools as ct
from bench import compute_plan

here = Path(__file__).resolve().parent
assert Path('/private/tmp/ib-gpu-bench.lock').is_dir()
for unit in ['CPU_AND_NE', 'CPU_AND_GPU', 'ALL']:
    try:
        result = compute_plan(here / 'artifacts/encoder.mlmodelc', getattr(ct.ComputeUnit, unit))
    except RuntimeError as error:
        result = {'counts': None, 'error': str(error)}
    (here / f'artifacts/plan-{unit}.json').write_text(json.dumps(result, indent=2))
    print(unit, result['counts'], flush=True)
