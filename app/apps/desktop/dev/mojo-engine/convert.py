# SPDX-License-Identifier: Apache-2.0
"""Convert the pinned BF16/F16 text GGUF once to mmap-friendly FP32 tensors."""
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np

GLOBALS = [
    "token_embd.weight",
    "per_layer_model_proj.weight",
    "per_layer_proj_norm.weight",
    "output_norm.weight",
    "output.weight",
]
LAYER = [
    "attn_norm",
    "attn_q",
    "attn_k",
    "attn_v",
    "attn_output",
    "attn_q_norm",
    "attn_k_norm",
    "post_attention_norm",
    "ffn_norm",
    "ffn_gate",
    "ffn_up",
    "ffn_down",
    "post_ffw_norm",
    "inp_gate",
    "proj",
    "post_norm",
    "layer_output_scale",
]


def read_gguf(path):
    f = open(path, "rb")

    def unpack(fmt):
        return struct.unpack("<" + fmt, f.read(struct.calcsize("<" + fmt)))[0]

    def string():
        return f.read(unpack("Q")).decode("utf8")

    def value(kind):
        if kind == 8:
            return string()
        if kind == 9:
            item, count = unpack("I"), unpack("Q")
            return [value(item) for _ in range(count)]
        return unpack(
            {
                0: "B",
                1: "b",
                2: "H",
                3: "h",
                4: "I",
                5: "i",
                6: "f",
                7: "?",
                10: "Q",
                11: "q",
                12: "d",
            }[kind]
        )

    assert f.read(4) == b"GGUF" and unpack("I") == 3
    count, kv_count = unpack("Q"), unpack("Q")
    meta = {}
    for _ in range(kv_count):
        name = string()
        meta[name] = value(unpack("I"))
    tensors = {}
    for _ in range(count):
        name = string()
        shape = tuple(unpack("Q") for _ in range(unpack("I")))
        tensors[name] = (shape, unpack("I"), unpack("Q"))
    alignment = meta.get("general.alignment", 32)
    base = (f.tell() + alignment - 1) // alignment * alignment
    f.close()
    return meta, tensors, base


def convert(source, target):
    if Path(source).resolve() == Path(target).resolve():
        raise ValueError("source and target must be different files")
    meta, tensors, base = read_gguf(source)
    assert meta["general.architecture"] == "gemma-embedding2"
    names = GLOBALS + [
        f"blk.{i}.{name}.weight" for i in range(24) for name in LAYER
    ]
    assert len(names) == 413
    # The fixed table contains byte offsets followed by tensor dimensions.
    header_bytes = 32 + len(names) * 32
    offset = (header_bytes + 4095) // 4096 * 4096
    table, arrays = [], []
    for name in names:
        shape, kind, tensor_offset = tensors[name]
        assert 1 <= len(shape) <= 2, (name, shape)
        assert kind in (0, 1, 30), (name, kind)
        count = math.prod(shape)
        raw = np.memmap(
            source,
            mode="r",
            dtype={0: "<f4", 1: "<f2", 30: "<u2"}[kind],
            offset=base + tensor_offset,
            shape=(count,),
        )
        data = (raw.astype(np.uint32) << 16).view(
            np.float32
        ) if kind == 30 else raw.astype(np.float32)
        assert np.isfinite(data).all(), name
        table.append(
            (offset, shape[0], shape[1] if len(shape) > 1 else 1, count)
        )
        arrays.append(data)
        offset += count * 4
    with open(target, "wb") as out:
        out.write(struct.pack("<8sQQQ", b"IBMOJO01", len(names), offset, 0))
        for row in table:
            out.write(struct.pack("<QQQQ", *row))
        out.seek((header_bytes + 4095) // 4096 * 4096)
        for data in arrays:
            out.write(data.tobytes())
    manifest = {
        "source": str(source),
        "source_sha256": hashlib.file_digest(
            open(source, "rb"), "sha256"
        ).hexdigest(),
        "bytes": offset,
        "tensors": [
            {"name": name, "offset": row[0], "shape": [row[1], row[2]]}
            for name, row in zip(names, table)
        ],
        "hparams": {
            k: v for k, v in meta.items() if k.startswith("gemma-embedding2.")
        },
    }
    Path(str(target) + ".json").write_text(json.dumps(manifest, indent=2))
    print(
        json.dumps(
            {
                "bytes": offset,
                "tensors": len(names),
                "hparams": manifest["hparams"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path)
    p.add_argument("target", type=Path)
    a = p.parse_args()
    convert(a.source, a.target)
