# SPDX-License-Identifier: Apache-2.0
"""Run the untouched shared verify.py through a Core ML ctypes-shaped adapter."""
import argparse
import collections
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import time
import types

import coremltools as ct
import numpy as np

HERE = Path(__file__).resolve().parent
SHARED = HERE.parent.parent / 'mojo-engine'


class Export:
    def __init__(self, fn):
        self.fn = fn

    def __call__(self, *args):
        return self.fn(*args)


class CoreML:
    def __init__(self, compiled, units):
        self.compiled, self.units, self.model = compiled.resolve(), units, None
        for name in ('init', 'embed', 'embed_batch', 'free'):
            setattr(self, 'ib_mojo_gpu_' + name, Export(getattr(self, name)))

    def init(self, path):
        # The shared harness passes a file; the Core ML compiled artifact lives in its parent.
        path = Path(os.fsdecode(path))
        if path.resolve() != self.compiled / 'coremldata.bin' or not path.is_file():
            return None
        self.model = ct.models.CompiledMLModel(str(self.compiled), compute_units=self.units)
        return 1

    def free(self, handle):
        self.model = None

    def predict(self, sequences, batch_size=4):
        outputs = []
        for start in range(0, len(sequences), batch_size):
            rows = sequences[start:start + batch_size]
            b = 1 if len(rows) == 1 else 4
            length = next(n for n in (64, 128, 256, 512) if n >= max(map(len, rows)))
            ids, valid = np.zeros((b, length), np.int32), np.zeros((b, length), np.float32)
            for i, row in enumerate(rows):
                ids[i, :len(row)] = row
                valid[i, :len(row)] = 1
            # Unused batch slots are valid dummy sequences, avoiding 0/0 in pooling.
            valid[len(rows):, 0] = 1
            result = self.model.predict({'ids': ids, 'valid': valid})['embedding'][:len(rows)]
            # Preserve the public unit-vector contract after FP16 output rounding.
            result = result.astype(np.float32)
            result /= np.linalg.norm(result, axis=-1, keepdims=True)
            assert np.isfinite(result).all()
            outputs.append(result)
        return np.concatenate(outputs)

    def embed(self, handle, ids, count, output):
        if handle != 1 or self.model is None or ids is None or output is None or not 1 <= count <= 512:
            return -1
        tokens = np.ctypeslib.as_array(ids, shape=(count,))[:count]
        if np.any(tokens < 0) or np.any(tokens >= 262144):
            return -2
        np.ctypeslib.as_array(output, shape=(768,))[:768] = self.predict([tokens])[0]
        return 0

    def embed_batch(self, handle, ids, lengths, count, output):
        if handle != 1 or self.model is None or ids is None or output is None or not 1 <= count <= 100:
            return -1
        sizes = np.ctypeslib.as_array(lengths, shape=(count,))[:count]
        if np.any(sizes < 1) or np.any(sizes > 512) or sum(sizes) > 16384:
            return -1
        packed = np.ctypeslib.as_array(ids, shape=(int(sum(sizes)),))[:sum(sizes)]
        if np.any(packed < 0) or np.any(packed >= 262144):
            return -2
        rows = np.split(packed, np.cumsum(sizes)[:-1])
        np.ctypeslib.as_array(output, shape=(count * 768,))[:count * 768] = self.predict(rows).reshape(-1)
        return 0


def compute_plan(compiled, units):
    plan = ct.models.compute_plan.MLComputePlan.load_from_path(str(compiled), compute_units=units)
    records = []

    def walk(block):
        for op in block.operations:
            usage = plan.get_compute_device_usage_for_mlprogram_operation(op)
            cost = plan.get_estimated_cost_for_mlprogram_operation(op)
            records.append({'op': op.operator_name, 'outputs': [x.name for x in op.outputs],
                'preferred': type(usage.preferred_compute_device).__name__ if usage else None,
                'supported': [type(x).__name__ for x in usage.supported_compute_devices] if usage else [],
                'estimated_cost': cost.weight if cost else None})
            for nested in op.blocks:
                walk(nested)
    for fn in plan.model_structure.program.functions.values():
        walk(fn.block)
    return {'counts': dict(collections.Counter(x['preferred'] for x in records)), 'operations': records}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--compiled', type=Path, default=HERE / 'artifacts/encoder.mlmodelc')
    p.add_argument('--units', choices=['CPU_AND_NE', 'CPU_AND_GPU', 'ALL'], required=True)
    p.add_argument('--reference', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--plan', action='store_true')
    a = p.parse_args()
    assert Path('/private/tmp/ib-gpu-bench.lock').is_dir(), 'must hold the shared GPU benchmark lock'
    units = getattr(ct.ComputeUnit, a.units)
    if a.plan:
        a.output.write_text(json.dumps(compute_plan(a.compiled, units), indent=2))
        return
    spec = importlib.util.spec_from_file_location('shared_verify', SHARED / 'verify.py')
    verify = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verify)
    adapter = CoreML(a.compiled, units)
    verify.c = types.SimpleNamespace(**vars(ctypes))
    verify.c.CDLL = lambda _: adapter
    marks = []

    def clock():
        now = time.perf_counter()
        marks.append(now)
        return now
    verify.time = types.SimpleNamespace(perf_counter=clock)
    os.environ['IB_MOJO_PREFIX'] = 'ib_mojo_gpu'
    verify.run('CoreML:' + a.units, str(a.compiled / 'coremldata.bin'), str(a.reference.resolve()), str(a.output))
    result = json.loads(a.output.read_text())
    result['units'] = a.units
    result['single_trials_ms'] = [(marks[i + 1] - marks[i]) * 1000 for i in range(2, 62, 2)]
    assert len(marks) == 72 and len(result['single_trials_ms']) == 30, len(marks)
    expected = np.array([row['vector'] for row in json.loads(a.reference.read_text())['rows']])
    result['max_abs_diff'] = float(np.max(np.abs(np.array(result['vectors']) - expected)))
    result['batch_size'] = 4
    a.output.write_text(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
