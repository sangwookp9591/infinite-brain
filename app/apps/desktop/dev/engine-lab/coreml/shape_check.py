# SPDX-License-Identifier: Apache-2.0
"""Check every exported shape against GGUF PyTorch, separately from the unchanged 20-case gate."""
import argparse
import ctypes as c
import json
import os
from pathlib import Path
import numpy as np

here = Path(__file__).resolve().parent
p = argparse.ArgumentParser()
p.add_argument('--prepare', action='store_true')
p.add_argument('--reference', type=Path, default=here / 'artifacts/q8-setup.json')
a = p.parse_args()
path = here / 'artifacts/shape-reference.json'
if a.prepare:
    import torch
    from convert import Encoder
    torch.set_num_threads(4)
    model = Encoder(Path.home() / '.cache/infinite-brain-b0/models/embeddinggemma-2-BF16.gguf').eval()
    rows = json.loads(a.reference.read_text())['rows']
    records = []
    with torch.inference_mode():
        for batch in (1, 4):
            for length in (64, 128, 256, 512):
                tokens = [(r['ids'] * ((length + len(r['ids']) - 1) // len(r['ids'])))[:length] for r in rows[:batch]]
                ids = torch.tensor(tokens, dtype=torch.int32)
                expected = model(ids, torch.ones(ids.shape)).numpy().tolist()
                records.append({'batch': batch, 'length': length, 'tokens': tokens, 'vectors': expected})
                print(batch, length, flush=True)
    path.write_text(json.dumps(records))
else:
    from convert import cosine
    assert Path('/private/tmp/ib-gpu-bench.lock').is_dir()
    lib = c.CDLL(str(here / 'artifacts/libib_coreml.dylib'))
    lib.ib_engine_init.argtypes = [c.c_char_p]
    lib.ib_engine_init.restype = c.c_void_p
    lib.ib_engine_embed_batch.argtypes = [c.c_void_p, c.POINTER(c.c_int32), c.POINTER(c.c_size_t), c.c_size_t, c.POINTER(c.c_float)]
    lib.ib_engine_free.argtypes = [c.c_void_p]
    h = lib.ib_engine_init(str(here / 'artifacts/encoder.mlmodelc').encode())
    assert h
    result = []
    try:
        for row in json.loads(path.read_text()):
            batch, length = row['batch'], row['length']
            flat = sum(row['tokens'], [])
            tokens = (c.c_int32 * len(flat))(*flat)
            lengths = (c.c_size_t * batch)(*([length] * batch))
            output = (c.c_float * (batch * 768))()
            assert lib.ib_engine_embed_batch(h, tokens, lengths, batch, output) == 0
            actual = np.ctypeslib.as_array(output).reshape(batch, 768)
            cosines = [cosine(v, ref) for v, ref in zip(actual, row['vectors'])]
            assert min(cosines) >= .999, (batch, length, cosines)
            result.append({'batch': batch, 'length': length, 'min_cosine': min(cosines),
                           'max_abs_diff': float(np.max(np.abs(actual - np.array(row['vectors']))))})
    finally:
        lib.ib_engine_free(h)
    print(json.dumps(result, indent=2))
    (here / ('artifacts/shapes-' + os.environ['IB_COREML_COMPUTE_UNITS'] + '.json')).write_text(json.dumps(result, indent=2))
