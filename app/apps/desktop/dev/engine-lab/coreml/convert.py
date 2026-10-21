# SPDX-License-Identifier: Apache-2.0
"""GGUF -> exact PyTorch encoder -> FP16 Core ML; no model download."""
import argparse
import importlib.util
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent
SHARED = HERE.parent.parent / 'mojo-engine'
spec = importlib.util.spec_from_file_location('gguf_converter', SHARED / 'convert.py')
gguf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gguf)


def cosine(a, b):
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    return float(a @ b / np.linalg.norm(a) / np.linalg.norm(b))


class Encoder(torch.nn.Module):
    def __init__(self, path):
        super().__init__()
        self.fixed_length = None
        meta, tensors, base = gguf.read_gguf(path)
        assert meta['general.architecture'] == 'gemma-embedding2'
        assert meta['gemma-embedding2.block_count'] == 24
        assert meta['gemma-embedding2.attention.sliding_window'] == 1024
        names = gguf.GLOBALS + [f'blk.{i}.{n}.weight' for i in range(24) for n in gguf.LAYER]
        for i, name in enumerate(names):
            shape, kind, offset = tensors[name]
            assert kind in (0, 1, 30), (name, kind)
            raw = np.memmap(path, mode='r', offset=base + offset,
                            dtype={0: '<f4', 1: '<f2', 30: '<u2'}[kind], shape=math.prod(shape))
            arr = (raw.astype(np.uint32) << 16).view(np.float32) if kind == 30 else raw.astype(np.float32)
            assert np.isfinite(arr).all(), name
            self.register_buffer(f'w{i}', torch.from_numpy(arr.copy().reshape(tuple(reversed(shape)))))
        for dim, theta in [(256, 10000), (512, 1000000)]:
            angle = torch.arange(512)[:, None] * theta ** (-torch.arange(0, dim, 2).float() / dim)
            self.register_buffer(f'cos{dim}', angle.cos()[None, None])
            self.register_buffer(f'sin{dim}', angle.sin()[None, None])

    def w(self, i):
        return getattr(self, f'w{i}')

    @staticmethod
    def norm(x, w):
        return x * torch.rsqrt((x * x).mean(dim=-1, keepdim=True) + 1e-6) * w

    def rope(self, x, dim):
        a, b = x[..., :dim // 2], x[..., dim // 2:]
        length = self.fixed_length if self.fixed_length else x.shape[2]
        c = getattr(self, f'cos{dim}')[..., :length, :]
        s = getattr(self, f'sin{dim}')[..., :length, :]
        return torch.cat((a * c - b * s, a * s + b * c), dim=-1)

    def forward(self, ids, valid):
        batch, length = (1, self.fixed_length) if self.fixed_length else ids.shape
        x = F.embedding(ids, self.w(0)) * math.sqrt(512)
        ple = F.linear(x, self.w(1)) / math.sqrt(512)
        ple = self.norm(ple.reshape(batch, length, 24, 512), self.w(2))
        mask = (1 - valid[:, None, None, :]) * -10000.0
        for layer in range(24):
            wi = 5 + layer * 17
            full = layer % 6 == 5
            dim, kv = (512, 1) if full else (256, 2)
            z = self.norm(x, self.w(wi))
            q = F.linear(z, self.w(wi + 1)).reshape(batch, length, 4, dim).transpose(1, 2)
            k = F.linear(z, self.w(wi + 2)).reshape(batch, length, kv, dim).transpose(1, 2)
            v = F.linear(z, self.w(wi + 3)).reshape(batch, length, kv, dim).transpose(1, 2)
            q = self.rope(self.norm(q, self.w(wi + 5)), dim)
            k = self.rope(self.norm(k, self.w(wi + 6)), dim)
            v = self.norm(v, 1.0)
            k = k.repeat_interleave(4 // kv, dim=1)
            v = v.repeat_interleave(4 // kv, dim=1)
            # All supported lengths <=512: the symmetric +/-512 local window covers every key.
            a = torch.softmax(q @ k.transpose(-1, -2) + mask, dim=-1) @ v
            a = a.transpose(1, 2).reshape(batch, length, 4 * dim)
            x = x + self.norm(F.linear(a, self.w(wi + 4)), self.w(wi + 7))
            z = self.norm(x, self.w(wi + 8))
            g = F.gelu(F.linear(z, self.w(wi + 9)), approximate='tanh')
            u = F.linear(z, self.w(wi + 10))
            x = x + self.norm(F.linear(g * u, self.w(wi + 11)), self.w(wi + 12))
            z = F.gelu(F.linear(x, self.w(wi + 13)), approximate='tanh') * ple[:, :, layer, :]
            x = (x + self.norm(F.linear(z, self.w(wi + 14)), self.w(wi + 15))) * self.w(wi + 16)
        z = self.norm(x, self.w(3))
        pooled = (z * valid[:, :, None]).sum(dim=1) / valid.sum(dim=1, keepdim=True)
        out = F.linear(pooled, self.w(4))
        return out / torch.sqrt((out * out).sum(dim=-1, keepdim=True))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--gguf', type=Path, default=Path.home() / '.cache/infinite-brain-b0/models/embeddinggemma-2-BF16.gguf')
    p.add_argument('--reference', type=Path, required=True)
    p.add_argument('--static-length', type=int, choices=[82], help='diagnose enumerated-shape compiler failures with fixed batch=1')
    p.add_argument('--output', type=Path, default=HERE / 'artifacts/encoder.mlpackage')
    a = p.parse_args()
    a.output.parent.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    started = time.perf_counter()
    model = Encoder(a.gguf).eval()
    rows = json.loads(a.reference.read_text())['rows']
    cosines = []
    with torch.inference_mode():
        for row in rows:
            ids = torch.tensor([row['ids']], dtype=torch.int32)
            v = model(ids, torch.ones(ids.shape)).numpy()[0]
            cosines.append(cosine(v, row['vector']))
        # Masked padding and separate batch rows must preserve all 20 reference vectors.
        ids = torch.zeros((20, 128), dtype=torch.int32)
        valid = torch.zeros((20, 128))
        for i, row in enumerate(rows):
            ids[i, :len(row['ids'])] = torch.tensor(row['ids'])
            valid[i, :len(row['ids'])] = 1
        mixed = model(ids, valid).numpy()
        mixed_cosines = [cosine(v, r['vector']) for v, r in zip(mixed, rows)]
        check = {'cosines': cosines, 'mixed_cosines': mixed_cosines, 'cosine_min': min(cosines),
                 'mixed_min': min(mixed_cosines), 'seconds': time.perf_counter() - started}
        (a.output.parent / 'torch-check.json').write_text(json.dumps(check, indent=2))
        print(check, flush=True)
        assert len(cosines) == 20 and min(cosines + mixed_cosines) >= .999
        if a.static_length:
            model.fixed_length = a.static_length
            ids, valid = ids[:1, :a.static_length], valid[:1, :a.static_length]
            assert cosine(model(ids, valid).numpy()[0], rows[0]['vector']) >= .999
        else:
            ids, valid = ids[:1], valid[:1]
        traced = torch.jit.trace(model, (ids, valid), check_trace=False)
    import coremltools as ct
    started = time.perf_counter()
    shapes = [(1, a.static_length)] if a.static_length else [(1, n) for n in [64, 128, 256, 512]] + [(4, n) for n in [64, 128, 256, 512]]
    input_shape = (1, a.static_length) if a.static_length else ct.EnumeratedShapes(shapes, default=(1, 128))
    converted = ct.convert(traced, source='pytorch', convert_to='mlprogram',
        inputs=[ct.TensorType(name='ids', shape=input_shape, dtype=np.int32),
                ct.TensorType(name='valid', shape=input_shape, dtype=np.float32)],
        outputs=[ct.TensorType(name='embedding', dtype=np.float32)],
        minimum_deployment_target=ct.target.macOS15, compute_precision=ct.precision.FLOAT16,
        skip_model_load=True)
    converted.save(str(a.output))
    result = {'conversion_seconds': time.perf_counter() - started, 'torch': torch.__version__,
              'coremltools': ct.__version__, 'shapes': shapes,
              'package_bytes': sum(f.stat().st_size for f in a.output.rglob('*') if f.is_file())}
    (a.output.parent / 'conversion.json').write_text(json.dumps(result, indent=2))
    print(result, flush=True)


if __name__ == '__main__':
    main()
