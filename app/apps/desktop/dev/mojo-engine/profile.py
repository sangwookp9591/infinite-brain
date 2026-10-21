# SPDX-License-Identifier: Apache-2.0
"""Stage wall times with explicit profile-only fences; never use as the latency gate."""
import ctypes as c
import json
import sys

library, weights, reference = sys.argv[1:]
lib = c.CDLL(library)
lib.ib_mojo_gpu_init.argtypes = [c.c_char_p]
lib.ib_mojo_gpu_init.restype = c.c_void_p
lib.ib_mojo_gpu_profile.argtypes = [
    c.c_void_p,
    c.c_void_p,
    c.c_void_p,
    c.c_size_t,
    c.c_void_p,
]
lib.ib_mojo_gpu_profile.restype = c.c_int32
lib.ib_mojo_gpu_embed_batch.argtypes = lib.ib_mojo_gpu_profile.argtypes
lib.ib_mojo_gpu_embed_batch.restype = c.c_int32
lib.ib_mojo_gpu_free.argtypes = [c.c_void_p]
ids = json.load(open(reference))["rows"][0]["ids"]
handle = lib.ib_mojo_gpu_init(weights.encode())
assert handle
try:
    for count in (1, 100):
        packed = (c.c_int32 * (len(ids) * count))(*(ids * count))
        lens = (c.c_int32 * count)(*([len(ids)] * count))
        output = (c.c_float * (768 * count))()
        assert (
            lib.ib_mojo_gpu_embed_batch(handle, packed, lens, count, output)
            == 0
        )
        print(
            f"PROFILE_BEGIN sequences={count} tokens={len(ids)*count}",
            flush=True,
        )
        for _ in range(3):
            assert (
                lib.ib_mojo_gpu_profile(handle, packed, lens, count, output)
                == 0
            )
        print("PROFILE_END", flush=True)
finally:
    lib.ib_mojo_gpu_free(handle)
