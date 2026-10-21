# SPDX-License-Identifier: Apache-2.0
"""Exact token-id correctness and warm latency/throughput gate."""
import ctypes as c
import json
import statistics
import os
import sys
import time
import struct
import tempfile

import numpy as np


def run(library, weights, reference_path, output_path):
    lib = c.CDLL(library)
    prefix = os.environ.get("IB_MOJO_PREFIX", "ib_mojo")
    if prefix != "ib_mojo":
        for name in ("init", "embed", "free"):
            setattr(lib, f"ib_mojo_{name}", getattr(lib, f"{prefix}_{name}"))
    lib.ib_mojo_init.argtypes = [c.c_char_p]
    lib.ib_mojo_init.restype = c.c_void_p
    lib.ib_mojo_embed.argtypes = [
        c.c_void_p,
        c.POINTER(c.c_int32),
        c.c_size_t,
        c.POINTER(c.c_float),
    ]
    lib.ib_mojo_embed.restype = c.c_int32
    lib.ib_mojo_free.argtypes = [c.c_void_p]
    assert not lib.ib_mojo_init(b"/nonexistent/embedding-model")
    assert lib.ib_mojo_embed(None, None, 0, None) == -1
    with tempfile.NamedTemporaryFile() as bad_model:
        with open(weights, "rb") as source:
            header = bytearray(source.read(16384))

        struct.pack_into("<Q", header, 40, 1)

        bad_model.write(header)
        bad_model.truncate(os.path.getsize(weights))
        bad_model.flush()
        assert not lib.ib_mojo_init(
            bad_model.name.encode()
        ), "invalid tensor dimensions accepted"
    if prefix == "ib_mojo_gpu":
        with tempfile.NamedTemporaryFile() as bad_model:
            with open(weights, "rb") as source:
                header = bytearray(source.read(16384))
            offset = 32 + 7 * 32

            struct.pack_into(
                "<Q",
                header,
                offset,
                struct.unpack_from("<Q", header, offset)[0] + 4,
            )

            bad_model.write(header)
            bad_model.truncate(os.path.getsize(weights))
            bad_model.flush()
            assert not lib.ib_mojo_init(
                bad_model.name.encode()
            ), "noncontiguous QKV accepted"
    start = time.perf_counter()
    handle = lib.ib_mojo_init(weights.encode())
    assert handle, "model initialization failed"
    load_ms = (time.perf_counter() - start) * 1000
    try:
        reference = json.load(open(reference_path))
        assert (
            len(reference["rows"]) == 20
        ), "exactly 20 oracle fixtures required"
        vectors, cosines, max_diffs = [], [], []
        for row in reference["rows"]:
            ids = (c.c_int32 * len(row["ids"]))(*row["ids"])
            output = (c.c_float * 768)()
            assert lib.ib_mojo_embed(handle, ids, len(ids), output) == 0
            actual = np.array(output, dtype=np.float64)
            expected = np.array(row["vector"], dtype=np.float64)
            assert (
                np.isfinite(actual).all()
                and abs(np.linalg.norm(actual) - 1) < 1e-5
            )
            cosine = float(
                np.dot(actual, expected)
                / np.linalg.norm(actual)
                / np.linalg.norm(expected)
            )
            print(len(ids), cosine, row["text"][:50], flush=True)
            max_diffs.append(float(np.max(np.abs(actual - expected))))
            cosines.append(cosine)
            vectors.append(actual.tolist())
        invalid = (c.c_int32 * 1)(262144)
        assert lib.ib_mojo_embed(handle, invalid, 1, output) == -2
        assert lib.ib_mojo_embed(handle, ids, 2049, output) == -1
        assert min(cosines) >= 0.999, "correctness gate failed"
        ids = (c.c_int32 * len(reference["rows"][0]["ids"]))(
            *reference["rows"][0]["ids"]
        )
        timings = []
        for _ in range(30):
            start = time.perf_counter()
            assert lib.ib_mojo_embed(handle, ids, len(ids), output) == 0
            timings.append((time.perf_counter() - start) * 1000)
        start = time.perf_counter()
        for _ in range(100):
            assert lib.ib_mojo_embed(handle, ids, len(ids), output) == 0
        throughput = 100 / (time.perf_counter() - start)
        result = {
            "library": library,
            "reference": reference_path,
            "tokens": len(ids),
            "load_ms": load_ms,
            "cosine_min": min(cosines),
            "cosine_mean": statistics.mean(cosines),
            "cosines": cosines,
            "vectors": vectors,
            "median_ms": statistics.median(timings),
            "latency_samples_ms": timings,
            "max_abs_diff": max(max_diffs),
            "max_abs_diff_by_case": max_diffs,
            "paragraphs_per_second": throughput,
        }
        if prefix == "ib_mojo_gpu":
            batch = lib.ib_mojo_gpu_embed_batch
            batch.argtypes = [
                c.c_void_p,
                c.POINTER(c.c_int32),
                c.POINTER(c.c_int32),
                c.c_size_t,
                c.POINTER(c.c_float),
            ]
            batch.restype = c.c_int32
            rows = reference["rows"]
            all_ids = [token for row in rows for token in row["ids"]]
            packed = (c.c_int32 * len(all_ids))(*all_ids)
            lengths = (c.c_int32 * len(rows))(
                *(len(row["ids"]) for row in rows)
            )
            outputs = (c.c_float * (len(rows) * 768))()
            assert batch(handle, packed, lengths, len(rows), outputs) == 0
            batch_cosines = []
            for i, row in enumerate(rows):
                actual = np.array(
                    outputs[i * 768 : (i + 1) * 768], dtype=np.float64
                )
                expected = np.array(row["vector"], dtype=np.float64)
                cosine = float(
                    actual
                    @ expected
                    / np.linalg.norm(actual)
                    / np.linalg.norm(expected)
                )
                assert (
                    cosine >= 0.999 and abs(np.linalg.norm(actual) - 1) < 1e-5
                )
                batch_cosines.append(cosine)
            result["mixed_batch_cosine_min"] = min(batch_cosines)
            result["mixed_batch_cosine_mean"] = statistics.mean(batch_cosines)
            packed = (c.c_int32 * (len(ids) * 100))(*(list(ids) * 100))
            lengths = (c.c_int32 * 100)(*([len(ids)] * 100))
            outputs = (c.c_float * (100 * 768))()
            assert batch(handle, packed, lengths, 101, outputs) == -1
            # Each batch output must match the single-input embedding, preventing cross-note attention.
            batch_ms = []
            trials = int(os.environ.get("IB_ENGINE_BENCH_TRIALS", "4"))
            assert trials in (2, 4)
            for _ in range(trials):
                start = time.perf_counter()
                assert batch(handle, packed, lengths, 100, outputs) == 0
                batch_ms.append((time.perf_counter() - start) * 1000)
            reference_vector = np.array(vectors[0], dtype=np.float64)
            for i in range(100):
                actual = np.array(
                    outputs[i * 768 : (i + 1) * 768], dtype=np.float64
                )
                assert (
                    float(
                        actual
                        @ reference_vector
                        / np.linalg.norm(actual)
                        / np.linalg.norm(reference_vector)
                    )
                    >= 0.9999
                )
            result["batch_100_median_ms"] = statistics.median(batch_ms[1:])
            result["batch_100_paragraphs_per_second"] = (
                100000 / result["batch_100_median_ms"]
            )
            result["batch_100_trials_ms"] = batch_ms
            # Reuse a grown workspace with small active buffers; capacity is not input length.
            single = (c.c_float * 768)()
            assert lib.ib_mojo_embed(handle, ids, len(ids), single) == 0
            actual = np.array(single, dtype=np.float64)
            cosine = float(
                np.dot(actual, reference_vector)
                / np.linalg.norm(actual)
                / np.linalg.norm(reference_vector)
            )
            assert np.isfinite(actual).all() and cosine >= 0.9999
            result["after_large_batch_single_cosine"] = cosine
        open(output_path, "w").write(json.dumps(result, indent=2))
        print(
            json.dumps(
                {
                    k: v
                    for k, v in result.items()
                    if k not in ("vectors", "cosines")
                }
            ),
            flush=True,
        )
    finally:
        lib.ib_mojo_free(handle)


if __name__ == "__main__":
    run(*sys.argv[1:])
