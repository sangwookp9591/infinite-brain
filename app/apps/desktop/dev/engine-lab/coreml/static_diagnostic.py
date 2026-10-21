# SPDX-License-Identifier: Apache-2.0
"""Fixed-shape control for the enumerated graph's ANE compiler failure; not a final benchmark."""
import json
from pathlib import Path
import time
import sys
import coremltools as ct
import numpy as np
from convert import cosine
from bench import compute_plan

here = Path(__file__).resolve().parent
assert Path('/private/tmp/ib-gpu-bench.lock').is_dir()
rows = json.loads(Path(sys.argv[1]).read_text())['rows']
compiled = here / 'artifacts/static82/encoder.mlmodelc'
results = []
for units in ['CPU_AND_NE', 'CPU_AND_GPU', 'ALL']:
    record = {'units': units, 'shape': [1, 82], 'status': 'unavailable'}
    try:
        plan = compute_plan(compiled, getattr(ct.ComputeUnit, units))
        record['plan_counts'] = plan['counts']
        record['cpu_preferred_ops'] = [op['op'] for op in plan['operations'] if op['preferred'] == 'MLCPUComputeDevice']
        (here / f'evidence/plan-static82-{units}.json').write_text(json.dumps(plan, indent=2))
    except RuntimeError as error:
        record['plan_error'] = str(error)
    try:
        start = time.perf_counter()
        model = ct.models.CompiledMLModel(str(compiled), compute_units=getattr(ct.ComputeUnit, units))
        record['load_ms'] = (time.perf_counter() - start) * 1000
        cosines, errors = [], []
        for row in rows:
            ids, valid = np.zeros((1, 82), np.int32), np.zeros((1, 82), np.float32)
            ids[0, :len(row['ids'])] = row['ids']
            valid[0, :len(row['ids'])] = 1
            vector = model.predict({'ids': ids, 'valid': valid})['embedding'][0].astype(np.float32)
            vector /= np.linalg.norm(vector)
            cosines.append(cosine(vector, row['vector']))
            errors.append(float(np.max(np.abs(vector - np.array(row['vector'])))))
        assert len(cosines) == 20 and min(cosines) >= .999
        record.update(status='passed', cosines=cosines, cosine_min=min(cosines), max_abs_diff=max(errors))
        del model
    except (RuntimeError, AssertionError) as error:
        record['inference_error'] = str(error)
        record['status'] = 'failed'
    results.append(record)
    print(json.dumps(record), flush=True)
(here / 'evidence/static82-diagnostic.json').write_text(json.dumps(results, indent=2))
