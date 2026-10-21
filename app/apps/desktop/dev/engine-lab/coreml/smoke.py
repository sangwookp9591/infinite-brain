# SPDX-License-Identifier: Apache-2.0
"""Real-model C ABI correctness/shape checks; final timings use the shared harness."""
import argparse
import ctypes as c
import json
import os
from pathlib import Path
import sys
import numpy as np

here = Path(__file__).resolve().parent
assert Path('/private/tmp/ib-gpu-bench.lock').is_dir()
p = argparse.ArgumentParser()
p.add_argument('reference', type=Path)
p.add_argument('--compiled', type=Path, default=here / 'artifacts/encoder.mlmodelc')
p.add_argument('--library', type=Path, default=here / 'artifacts/libib_coreml.dylib')
p.add_argument('--plan-output', type=Path)
a = p.parse_args()
reference = json.loads(a.reference.read_text())
lib = c.CDLL(str(a.library.resolve()))
lib.ib_engine_init.argtypes = [c.c_char_p]
lib.ib_engine_init.restype = c.c_void_p
lib.ib_engine_embed.argtypes = [c.c_void_p, c.POINTER(c.c_int32), c.c_size_t, c.POINTER(c.c_float)]
lib.ib_engine_embed_batch.argtypes = [c.c_void_p, c.POINTER(c.c_int32), c.POINTER(c.c_size_t), c.c_size_t, c.POINTER(c.c_float)]
lib.ib_engine_free.argtypes = [c.c_void_p]
assert not lib.ib_engine_init(b'/nonexistent/model.mlmodelc')
assert lib.ib_engine_embed(None, None, 0, None) == -1
h = lib.ib_engine_init(str(a.compiled.resolve()).encode())
assert h
out = (c.c_float * (100 * 768))()
cosines, errors, mixed = [], [], []
try:
    rows = reference['rows']
    vectors = []
    for row in rows:
        ids = (c.c_int32 * len(row['ids']))(*row['ids'])
        assert lib.ib_engine_embed(h, ids, len(ids), out) == 0
        v = np.array(out[:768], dtype=np.float64)
        expected = np.array(row['vector'])
        assert np.isfinite(v).all() and abs(np.linalg.norm(v) - 1) < 1e-5
        cosines.append(float(v @ expected / np.linalg.norm(v) / np.linalg.norm(expected)))
        errors.append(float(np.max(np.abs(v - expected))))
        vectors.append(v)
    packed = [token for row in rows for token in row['ids']]
    ids = (c.c_int32 * len(packed))(*packed)
    lens = (c.c_size_t * 20)(*(len(row['ids']) for row in rows))
    assert lib.ib_engine_embed_batch(h, ids, lens, 20, out) == 0
    for i, row in enumerate(rows):
        v, expected = np.array(out[i * 768:(i + 1) * 768]), np.array(row['vector'])
        mixed.append(float(v @ expected / np.linalg.norm(v) / np.linalg.norm(expected)))
    invalid = (c.c_int32 * 1)(262144)
    assert lib.ib_engine_embed(h, invalid, 1, out) == -2
    assert lib.ib_engine_embed(h, invalid, 513, out) == -1
    if a.compiled.parent.name == 'static82':
        assert lib.ib_engine_embed(h, invalid, 83, out) == -1
        invalid_lens = (c.c_size_t * 1)(83)
        assert lib.ib_engine_embed_batch(h, invalid, invalid_lens, 1, out) == -1
    assert lib.ib_engine_embed_batch(h, ids, lens, 101, out) == -1
    first = rows[0]['ids']
    ids = (c.c_int32 * (len(first) * 100))(*(first * 100))
    lens = (c.c_size_t * 100)(*([len(first)] * 100))
    assert lib.ib_engine_embed_batch(h, ids, lens, 100, out) == 0
    for i in range(100):
        v = np.array(out[i * 768:(i + 1) * 768])
        assert float(v @ vectors[0] / np.linalg.norm(v) / np.linalg.norm(vectors[0])) >= .9999
    single = (c.c_int32 * len(first))(*first)
    assert lib.ib_engine_embed(h, single, len(first), out) == 0
    assert np.max(np.abs(np.array(out[:768]) - vectors[0])) < 1e-5
    record = {'compiled': str(a.compiled), 'library': str(a.library), 'units': os.environ['IB_COREML_COMPUTE_UNITS'], 'cosines': cosines, 'cosine_min': min(cosines),
              'cosine_mean': float(np.mean(cosines)), 'mixed_min': min(mixed), 'max_abs_diff': max(errors)}
    if a.plan_output:
        import coremltools as ct
        from bench import compute_plan
        try:
            plan = compute_plan(a.compiled.resolve(), getattr(ct.ComputeUnit, os.environ['IB_COREML_COMPUTE_UNITS']))
            record['cpu_preferred_ops'] = [op['op'] for op in plan['operations'] if op['preferred'] == 'MLCPUComputeDevice']
        except RuntimeError as error:
            plan = {'error': str(error)}
            record['plan_error'] = str(error)
        a.plan_output.write_text(json.dumps(plan, indent=2))
    print(json.dumps(record, indent=2))
    assert min(cosines + mixed) >= .999
finally:
    lib.ib_engine_free(h)
