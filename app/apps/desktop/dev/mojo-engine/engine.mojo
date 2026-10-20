# SPDX-License-Identifier: Apache-2.0
"""EmbeddingGemma 2 text forward pass, FP32 CPU reference implementation."""
from std.ffi import external_call
from std.memory import Pointer
from std.math import sqrt, tanh, exp, cos, sin, pow, isfinite
from std.runtime import initialize_runtime

comptime P = Pointer[Float32, MutUntrackedOrigin]
comptime I = Pointer[Int64, MutUntrackedOrigin]
comptime T = Pointer[Int32, MutUntrackedOrigin]


def weight(base: Int, index: Int) -> P:
    var table = I(unsafe_from_address=base + 32)
    return P(unsafe_from_address=base + Int(table[unsafe_offset=index * 4]))


def linear(
    x: Pointer[mut=True, Float32, _],
    w: Pointer[mut=True, Float32, _],
    y: Pointer[mut=True, Float32, _],
    n: Int,
    k: Int,
    d: Int,
):
    external_call["cblas_sgemm", NoneType](
        Int32(101),
        Int32(111),
        Int32(112),
        Int32(n),
        Int32(d),
        Int32(k),
        Float32(1),
        x,
        Int32(k),
        w,
        Int32(k),
        Float32(0),
        y,
        Int32(d),
    )


def norm(
    x: Pointer[mut=True, Float32, _],
    w: Pointer[mut=True, Float32, _],
    y: Pointer[mut=True, Float32, _],
    rows: Int,
    d: Int,
):
    for r in range(rows):
        var sum = Float32(0)
        for j in range(0, d, 8):
            var v = x.unsafe_load[width=8](r * d + j)
            sum += (v * v).reduce_add()
        var scale = 1 / sqrt(sum / Float32(d) + Float32(1e-6))
        for j in range(0, d, 8):
            y.unsafe_store(
                r * d + j,
                x.unsafe_load[width=8](r * d + j)
                * scale
                * w.unsafe_load[width=8](j),
            )


def norm_inplace(
    x: Pointer[mut=True, Float32, _],
    w: Pointer[mut=True, Float32, _],
    rows: Int,
    d: Int,
):
    for r in range(rows):
        var sum = Float32(0)
        for j in range(0, d, 8):
            var v = x.unsafe_load[width=8](r * d + j)
            sum += (v * v).reduce_add()
        var scale = 1 / sqrt(sum / Float32(d) + Float32(1e-6))
        for j in range(0, d, 8):
            x.unsafe_store(
                r * d + j,
                x.unsafe_load[width=8](r * d + j)
                * scale
                * w.unsafe_load[width=8](j),
            )


def gelu(x: Float32) -> Float32:
    return (
        Float32(0.5)
        * x
        * (
            1
            + tanh(
                Float32(0.7978845608028654)
                * x
                * (1 + Float32(0.044715) * x * x)
            )
        )
    )


def head_norm_rope(
    x: Pointer[mut=True, Float32, _],
    w: Pointer[mut=True, Float32, _],
    n: Int,
    heads: Int,
    d: Int,
    base: Float32,
    rotate: Bool,
):
    for t in range(n):
        for h in range(heads):
            var at = (t * heads + h) * d
            var sum = Float32(0)
            for j in range(0, d, 8):
                var v = x.unsafe_load[width=8](at + j)
                sum += (v * v).reduce_add()
            var scale = 1 / sqrt(sum / Float32(d) + Float32(1e-6))
            for j in range(0, d, 8):
                x.unsafe_store(
                    at + j,
                    x.unsafe_load[width=8](at + j)
                    * w.unsafe_load[width=8](j)
                    * scale,
                )
            if rotate:
                for j in range(d // 2):
                    var angle = Float32(t) * pow(
                        base, -Float32(2 * j) / Float32(d)
                    )
                    var a = x.unsafe_load(at + j)
                    var b = x.unsafe_load(at + j + d // 2)
                    x.unsafe_store(at + j, a * cos(angle) - b * sin(angle))
                    x.unsafe_store(
                        at + j + d // 2, a * sin(angle) + b * cos(angle)
                    )


def forward(base: Int, ids: T, n: Int, output: P) -> Int32:
    var xbuf = List[Float32](length=n * 512, fill=0)
    var zbuf = List[Float32](length=n * 512, fill=0)
    var ybuf = List[Float32](length=n * 512, fill=0)
    var pbuf = List[Float32](length=n * 12288, fill=0)
    var qbuf = List[Float32](length=n * 2048, fill=0)
    var kbuf = List[Float32](length=n * 512, fill=0)
    var vbuf = List[Float32](length=n * 512, fill=0)
    var abuf = List[Float32](length=n * 2048, fill=0)
    var gbuf = List[Float32](length=n * 2048, fill=0)
    var ubuf = List[Float32](length=n * 2048, fill=0)
    var sbuf = List[Float32](length=n * n, fill=0)
    var ones = List[Float32](length=512, fill=1)
    var x = xbuf.unsafe_ptr()
    var z = zbuf.unsafe_ptr()
    var y = ybuf.unsafe_ptr()
    var ple = pbuf.unsafe_ptr()
    var q = qbuf.unsafe_ptr()
    var k = kbuf.unsafe_ptr()
    var v = vbuf.unsafe_ptr()
    var a = abuf.unsafe_ptr()
    var g = gbuf.unsafe_ptr()
    var u = ubuf.unsafe_ptr()
    var s = sbuf.unsafe_ptr()
    var embedding = weight(base, 0)
    for t in range(n):
        var token = Int(ids.unsafe_load(t))
        if token < 0 or token >= 262144:
            return -2
        for j in range(0, 512, 8):
            x.unsafe_store(
                t * 512 + j,
                embedding.unsafe_load[width=8](token * 512 + j)
                * sqrt(Float32(512)),
            )
    linear(x, weight(base, 1), ple, n, 512, 12288)
    for i in range(0, n * 12288, 8):
        ple.unsafe_store(i, ple.unsafe_load[width=8](i) / sqrt(Float32(512)))
    norm_inplace(ple, weight(base, 2), n * 24, 512)
    for layer in range(24):
        var wi = 5 + layer * 17
        var full = (layer % 6) == 5
        var d = 512 if full else 256
        var heads = 1 if full else 2
        var qdim = 4 * d
        var ropebase = Float32(1000000) if full else Float32(10000)
        norm(x, weight(base, wi), z, n, 512)
        linear(z, weight(base, wi + 1), q, n, 512, qdim)
        linear(z, weight(base, wi + 2), k, n, 512, 512)
        linear(z, weight(base, wi + 3), v, n, 512, 512)
        head_norm_rope(q, weight(base, wi + 5), n, 4, d, ropebase, True)
        head_norm_rope(k, weight(base, wi + 6), n, heads, d, ropebase, True)
        head_norm_rope(v, ones.unsafe_ptr(), n, heads, d, ropebase, False)
        for h in range(4):
            var kh = h // (4 // heads)
            external_call["cblas_sgemm", NoneType](
                Int32(101),
                Int32(111),
                Int32(112),
                Int32(n),
                Int32(n),
                Int32(d),
                Float32(1),
                q.unsafe_offset(h * d),
                Int32(qdim),
                k.unsafe_offset(kh * d),
                Int32(512),
                Float32(0),
                s,
                Int32(n),
            )
            for t in range(n):
                var peak = Float32(-1e30)
                for j in range(n):
                    if not full and abs(t - j) > 512:
                        s.unsafe_store(t * n + j, Float32(-1e30))
                    peak = max(peak, s.unsafe_load(t * n + j))
                var total = Float32(0)
                for j in range(n):
                    var score = exp(s.unsafe_load(t * n + j) - peak)
                    s.unsafe_store(t * n + j, score)
                    total += score
                for j in range(n):
                    s.unsafe_store(t * n + j, s.unsafe_load(t * n + j) / total)
            external_call["cblas_sgemm", NoneType](
                Int32(101),
                Int32(111),
                Int32(111),
                Int32(n),
                Int32(d),
                Int32(n),
                Float32(1),
                s,
                Int32(n),
                v.unsafe_offset(kh * d),
                Int32(512),
                Float32(0),
                a.unsafe_offset(h * d),
                Int32(qdim),
            )
        linear(a, weight(base, wi + 4), y, n, qdim, 512)
        norm_inplace(y, weight(base, wi + 7), n, 512)
        for i in range(0, n * 512, 8):
            x.unsafe_store(
                i, x.unsafe_load[width=8](i) + y.unsafe_load[width=8](i)
            )
        norm(x, weight(base, wi + 8), z, n, 512)
        linear(z, weight(base, wi + 9), g, n, 512, 2048)
        linear(z, weight(base, wi + 10), u, n, 512, 2048)
        for i in range(n * 2048):
            g.unsafe_store(i, gelu(g.unsafe_load(i)) * u.unsafe_load(i))
        linear(g, weight(base, wi + 11), y, n, 2048, 512)
        norm_inplace(y, weight(base, wi + 12), n, 512)
        for i in range(0, n * 512, 8):
            x.unsafe_store(
                i, x.unsafe_load[width=8](i) + y.unsafe_load[width=8](i)
            )
        linear(x, weight(base, wi + 13), z, n, 512, 512)
        for t in range(n):
            for j in range(512):
                z.unsafe_store(
                    t * 512 + j,
                    gelu(z.unsafe_load(t * 512 + j))
                    * ple.unsafe_load((t * 24 + layer) * 512 + j),
                )
        linear(z, weight(base, wi + 14), y, n, 512, 512)
        norm_inplace(y, weight(base, wi + 15), n, 512)
        var scale = weight(base, wi + 16).unsafe_load()
        for i in range(0, n * 512, 8):
            x.unsafe_store(
                i,
                (x.unsafe_load[width=8](i) + y.unsafe_load[width=8](i)) * scale,
            )
    norm(x, weight(base, 3), z, n, 512)
    for j in range(512):
        var sum = Float32(0)
        for t in range(n):
            sum += z.unsafe_load(t * 512 + j)
        y.unsafe_store(j, sum / Float32(n))
    linear(y, weight(base, 4), output, 1, 512, 768)
    var length = Float32(0)
    for j in range(768):
        length += output.unsafe_load(j) * output.unsafe_load(j)
    if not isfinite(length) or length <= 0:
        return -3
    length = sqrt(length)
    for j in range(768):
        output.unsafe_store(j, output.unsafe_load(j) / length)
    return 0


@export("ib_mojo_init")
def init(path: Int) abi("C") -> Int:
    initialize_runtime()
    if path == 0:
        return 0
    var fd = external_call["open", Int32](path, Int32(0))
    if fd < 0:
        return 0
    var size = external_call["lseek", Int](fd, Int(0), Int32(2))
    if size < 16384:
        _ = external_call["close", Int32](fd)
        return 0
    var base = external_call["mmap", Int](
        Int(0), size, Int32(1), Int32(2), fd, Int(0)
    )
    _ = external_call["close", Int32](fd)
    if base == -1:
        return 0
    var header = I(unsafe_from_address=base)
    if (
        header.unsafe_load(0) != Int64(0x31304F4A4F4D4249)
        or header.unsafe_load(1) != 413
        or header.unsafe_load(2) != Int64(size)
    ):
        _ = external_call["munmap", Int32](base, size)
        return 0
    for i in range(413):
        var at = 4 + i * 4
        var offset = Int(header.unsafe_load(at))
        var count = Int(header.unsafe_load(at + 3))
        if (
            offset < 16384
            or offset > size
            or count < 1
            or count > (size - offset) // 4
        ):
            _ = external_call["munmap", Int32](base, size)
            return 0
        var k = 512
        var d = 1
        if i == 0:
            d = 262144
        elif i == 1:
            d = 12288
        elif i == 4:
            d = 768
        elif i >= 5:
            var layer = (i - 5) // 17
            var field = (i - 5) % 17
            var head = 512 if layer % 6 == 5 else 256
            if field == 1:
                d = 4 * head
            elif field == 2 or field == 3 or field == 13 or field == 14:
                d = 512
            elif field == 4:
                k = 4 * head
                d = 512
            elif field == 5 or field == 6:
                k = head
            elif field == 9 or field == 10:
                d = 2048
            elif field == 11:
                k = 2048
                d = 512
            elif field == 16:
                k = 1
        if (
            Int(header.unsafe_load(at + 1)) != k
            or Int(header.unsafe_load(at + 2)) != d
            or count != k * d
        ):
            _ = external_call["munmap", Int32](base, size)
            return 0
    return base


@export("ib_mojo_embed")
def embed(handle: Int, ids: Int, n: Int, output: Int) abi("C") -> Int32:
    if handle == 0 or ids == 0 or output == 0 or n < 1 or n > 2048:
        return -1
    return forward(
        handle, T(unsafe_from_address=ids), n, P(unsafe_from_address=output)
    )


@export("ib_mojo_free")
def free(handle: Int) abi("C"):
    if handle != 0:
        _ = external_call["munmap", Int32](
            handle, Int(I(unsafe_from_address=handle).unsafe_load(2))
        )
