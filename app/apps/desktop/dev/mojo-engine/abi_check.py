# SPDX-License-Identifier: Apache-2.0
"""Untimed correctness check of an E0 dylib through the shared size_t-length ABI."""
import ctypes as c
import json
import sys
import numpy as np

library, model, reference, output = sys.argv[1:]
lib = c.CDLL(library)
lib.ib_engine_init.argtypes = [c.c_char_p]
lib.ib_engine_init.restype = c.c_void_p
lib.ib_engine_embed.argtypes = [
    c.c_void_p,
    c.POINTER(c.c_int32),
    c.c_size_t,
    c.POINTER(c.c_float),
]
lib.ib_engine_embed.restype = c.c_int
lib.ib_engine_embed_batch.argtypes = [
    c.c_void_p,
    c.POINTER(c.c_int32),
    c.POINTER(c.c_size_t),
    c.c_size_t,
    c.POINTER(c.c_float),
]
lib.ib_engine_embed_batch.restype = c.c_int
lib.ib_engine_free.argtypes = [c.c_void_p]
lib.ib_engine_name.restype = c.c_char_p
assert not lib.ib_engine_init(b"/nonexistent/embedding-model")
assert lib.ib_engine_embed(None, None, 0, None) == -1
rows = json.load(open(reference))["rows"]
assert len(rows) == 20
handle = lib.ib_engine_init(model.encode())
assert handle
cosines, differences = [], []
try:
    for row in rows:
        ids = (c.c_int32 * len(row["ids"]))(*row["ids"])
        out = (c.c_float * 768)()
        assert lib.ib_engine_embed(handle, ids, len(ids), out) == 0
        actual, expected = np.array(out, dtype=np.float64), np.array(
            row["vector"], dtype=np.float64
        )
        assert (
            np.isfinite(actual).all() and abs(np.linalg.norm(actual) - 1) < 1e-5
        )
        cosines.append(
            float(
                actual
                @ expected
                / np.linalg.norm(actual)
                / np.linalg.norm(expected)
            )
        )
        differences.append(float(np.max(np.abs(actual - expected))))
    packed_values = [token for row in rows for token in row["ids"]]
    packed = (c.c_int32 * len(packed_values))(*packed_values)
    lengths = (c.c_size_t * 20)(*(len(row["ids"]) for row in rows))
    out = (c.c_float * (20 * 768))()
    assert lib.ib_engine_embed_batch(handle, packed, lengths, 20, out) == 0
    mixed = []
    for i, row in enumerate(rows):
        actual, expected = np.array(
            out[i * 768 : (i + 1) * 768], dtype=np.float64
        ), np.array(row["vector"], dtype=np.float64)
        assert (
            np.isfinite(actual).all() and abs(np.linalg.norm(actual) - 1) < 1e-5
        )
        mixed.append(
            float(
                actual
                @ expected
                / np.linalg.norm(actual)
                / np.linalg.norm(expected)
            )
        )
    assert min(cosines) >= 0.999 and min(mixed) >= 0.999
    result = {
        "engine": lib.ib_engine_name().decode(),
        "cosine_min": min(cosines),
        "cosine_mean": float(np.mean(cosines)),
        "cosines": cosines,
        "max_abs_diff": max(differences),
        "max_abs_diff_by_case": differences,
        "mixed_cosine_min": min(mixed),
        "timed": False,
    }
    open(output, "w").write(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
finally:
    lib.ib_engine_free(handle)
