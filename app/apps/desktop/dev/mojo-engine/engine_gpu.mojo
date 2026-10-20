# SPDX-License-Identifier: Apache-2.0
"""Batched, bidirectional Mojo Metal text encoder. M5 GEMMs accumulate in FP32."""
from std.memory import Pointer
from std.ffi import external_call
from std.runtime import initialize_runtime
from std.sys import size_of
from std.math import sqrt, isfinite
from max.gpu.host import DeviceContext, DeviceBuffer
from layout import TileTensor, row_major
from linalg.matmul.gpu.apple.matmul_kernel import enqueue_apple_matmul

# shortcut: M5 GEMM only; add M1-M4 dispatch after the performance gate passes.
from engine import init as map_model, free as unmap_model, P, I, T
from gpu_ops import (
    gather,
    rms,
    normalize_copy,
    residual,
    geglu,
    ple_gate,
    head_rope,
    scores,
    softmax,
    values,
    pool,
    l2,
)


def gw[
    origin: Origin[mut=False]
](w: Pointer[mut=False, Float32, origin], base: Int, index: Int) -> Pointer[
    mut=False, Float32, origin
]:
    return w.unsafe_offset(
        Int(I(unsafe_from_address=base + 32).unsafe_load(index * 4)) // 4
    )


def mm(
    ctx: DeviceContext,
    x: Pointer[mut=False, Float32, _],
    w: Pointer[mut=False, Float32, _],
    y: Pointer[mut=True, Float32, _],
    n: Int,
    k: Int,
    d: Int,
) raises:
    var a = TileTensor(x, row_major(n, k))
    var b = TileTensor(w, row_major(d, k))
    var c = TileTensor(y, row_major(n, d))
    enqueue_apple_matmul[in_type=.float32, c_type=.float32, transpose_b=True](
        c, a, b, ctx
    )


struct GpuModel(Movable):
    var ctx: DeviceContext
    var weights: DeviceBuffer[.float32]
    var base: Int

    def __init__(out self, base: Int) raises:
        self.ctx = DeviceContext()
        self.base = base
        self.weights = self.ctx.enqueue_create_buffer[.float32](
            Int(I(unsafe_from_address=base).unsafe_load(2)) // 4
        )
        self.weights.enqueue_copy_from(P(unsafe_from_address=base))
        self.ctx.synchronize()

    def run(
        mut self,
        ids: T,
        lengths: Pointer[mut=False, Int32, _],
        count: Int,
        output: P,
    ) raises -> Int32:
        var n = 0
        var width = 0
        var offsets = List[Int32](length=count, fill=0)
        for i in range(count):
            var len = Int(lengths.unsafe_load(i))
            if len < 1 or len > 2048:
                return -1
            offsets[i] = Int32(n)
            n += len
            width = max(width, len)
        if n > 16384:
            return -1
        var positions = List[Int32](length=n, fill=0)
        var starts = List[Int32](length=n, fill=0)
        var lens = List[Int32](length=n, fill=0)
        for i in range(count):
            for t in range(Int(lengths.unsafe_load(i))):
                var token = Int(ids.unsafe_load(Int(offsets[i]) + t))
                if token < 0 or token >= 262144:
                    return -2
                positions[Int(offsets[i]) + t] = Int32(t)
                starts[Int(offsets[i]) + t] = offsets[i]
                lens[Int(offsets[i]) + t] = lengths.unsafe_load(i)
        var di = self.ctx.enqueue_create_buffer[.int32](n)
        var dp = self.ctx.enqueue_create_buffer[.int32](n)
        var ds = self.ctx.enqueue_create_buffer[.int32](n)
        var dl = self.ctx.enqueue_create_buffer[.int32](n)
        var doff = self.ctx.enqueue_create_buffer[.int32](count)
        var dlen = self.ctx.enqueue_create_buffer[.int32](count)
        di.enqueue_copy_from(ids)
        dp.enqueue_copy_from(positions.unsafe_ptr())
        ds.enqueue_copy_from(starts.unsafe_ptr())
        dl.enqueue_copy_from(lens.unsafe_ptr())
        doff.enqueue_copy_from(offsets.unsafe_ptr())
        dlen.enqueue_copy_from(lengths)
        var xb = self.ctx.enqueue_create_buffer[.float32](n * 512)
        var zb = self.ctx.enqueue_create_buffer[.float32](n * 512)
        var yb = self.ctx.enqueue_create_buffer[.float32](n * 512)
        var pb = self.ctx.enqueue_create_buffer[.float32](n * 12288)
        var qb = self.ctx.enqueue_create_buffer[.float32](n * 2048)
        var kb = self.ctx.enqueue_create_buffer[.float32](n * 512)
        var vb = self.ctx.enqueue_create_buffer[.float32](n * 512)
        var ab = self.ctx.enqueue_create_buffer[.float32](n * 2048)
        var gb = self.ctx.enqueue_create_buffer[.float32](n * 2048)
        var ub = self.ctx.enqueue_create_buffer[.float32](n * 2048)
        var sb = self.ctx.enqueue_create_buffer[.float32](4 * n * width)
        var pooled = self.ctx.enqueue_create_buffer[.float32](count * 512)
        var result = self.ctx.enqueue_create_buffer[.float32](count * 768)
        var x = xb.unsafe_ptr()
        var z = zb.unsafe_ptr()
        var y = yb.unsafe_ptr()
        var ple = pb.unsafe_ptr()
        var q = qb.unsafe_ptr()
        var k = kb.unsafe_ptr()
        var v = vb.unsafe_ptr()
        var a = ab.unsafe_ptr()
        var g = gb.unsafe_ptr()
        var u = ub.unsafe_ptr()
        var s = sb.unsafe_ptr()
        var wp = self.weights.unsafe_ptr().as_imm()
        self.ctx.enqueue_function[gather](
            x,
            gw(wp, self.base, 0),
            di.unsafe_ptr(),
            Int32(n),
            grid_dim=(n * 512 + 255) // 256,
            block_dim=256,
        )
        mm(self.ctx, x, gw(wp, self.base, 1), ple, n, 512, 12288)
        self.ctx.enqueue_function[rms](
            ple,
            gw(wp, self.base, 2),
            Int32(n * 24),
            Int32(512),
            1 / sqrt(Float32(512)),
            grid_dim=(n * 24 + 127) // 128,
            block_dim=128,
        )
        for layer in range(24):
            var wi = 5 + layer * 17
            var full = layer % 6 == 5
            var d = 512 if full else 256
            var heads = 1 if full else 2
            var qdim = 4 * d
            var ropebase = Float32(1000000) if full else Float32(10000)
            self.ctx.enqueue_function[normalize_copy](
                x,
                gw(wp, self.base, wi),
                z,
                Int32(n),
                grid_dim=(n + 127) // 128,
                block_dim=128,
            )
            mm(self.ctx, z, gw(wp, self.base, wi + 1), q, n, 512, qdim)
            mm(self.ctx, z, gw(wp, self.base, wi + 2), k, n, 512, 512)
            mm(self.ctx, z, gw(wp, self.base, wi + 3), v, n, 512, 512)
            self.ctx.enqueue_function[head_rope](
                q,
                gw(wp, self.base, wi + 5),
                dp.unsafe_ptr(),
                Int32(n),
                Int32(4),
                Int32(d),
                ropebase,
                Int32(1),
                grid_dim=(n * 4 + 127) // 128,
                block_dim=128,
            )
            self.ctx.enqueue_function[head_rope](
                k,
                gw(wp, self.base, wi + 6),
                dp.unsafe_ptr(),
                Int32(n),
                Int32(heads),
                Int32(d),
                ropebase,
                Int32(1),
                grid_dim=(n * heads + 127) // 128,
                block_dim=128,
            )
            self.ctx.enqueue_function[head_rope](
                v,
                gw(wp, self.base, wi + 6),
                dp.unsafe_ptr(),
                Int32(n),
                Int32(heads),
                Int32(d),
                ropebase,
                Int32(0),
                grid_dim=(n * heads + 127) // 128,
                block_dim=128,
            )
            self.ctx.enqueue_function[scores](
                q,
                k,
                s,
                ds.unsafe_ptr(),
                dl.unsafe_ptr(),
                Int32(n),
                Int32(width),
                Int32(d),
                Int32(heads),
                Int32(Int(full)),
                grid_dim=(4 * n * width + 255) // 256,
                block_dim=256,
            )
            self.ctx.enqueue_function[softmax](
                s,
                Int32(4 * n),
                Int32(width),
                grid_dim=(4 * n + 127) // 128,
                block_dim=128,
            )
            self.ctx.enqueue_function[values](
                s,
                v,
                a,
                ds.unsafe_ptr(),
                dl.unsafe_ptr(),
                Int32(n),
                Int32(width),
                Int32(d),
                Int32(heads),
                grid_dim=(n * 4 * d + 255) // 256,
                block_dim=256,
            )
            mm(self.ctx, a, gw(wp, self.base, wi + 4), y, n, qdim, 512)
            self.ctx.enqueue_function[rms](
                y,
                gw(wp, self.base, wi + 7),
                Int32(n),
                Int32(512),
                Float32(1),
                grid_dim=(n + 127) // 128,
                block_dim=128,
            )
            self.ctx.enqueue_function[residual](
                x,
                y,
                gw(wp, self.base, wi + 16),
                Int32(n * 512),
                Int32(Int(0)),
                grid_dim=(n * 512 + 255) // 256,
                block_dim=256,
            )
            self.ctx.enqueue_function[normalize_copy](
                x,
                gw(wp, self.base, wi + 8),
                z,
                Int32(n),
                grid_dim=(n + 127) // 128,
                block_dim=128,
            )
            mm(self.ctx, z, gw(wp, self.base, wi + 9), g, n, 512, 2048)
            mm(self.ctx, z, gw(wp, self.base, wi + 10), u, n, 512, 2048)
            self.ctx.enqueue_function[geglu](
                g,
                u,
                Int32(n * 2048),
                grid_dim=(n * 2048 + 255) // 256,
                block_dim=256,
            )
            mm(self.ctx, g, gw(wp, self.base, wi + 11), y, n, 2048, 512)
            self.ctx.enqueue_function[rms](
                y,
                gw(wp, self.base, wi + 12),
                Int32(n),
                Int32(512),
                Float32(1),
                grid_dim=(n + 127) // 128,
                block_dim=128,
            )
            self.ctx.enqueue_function[residual](
                x,
                y,
                gw(wp, self.base, wi + 16),
                Int32(n * 512),
                Int32(Int(0)),
                grid_dim=(n * 512 + 255) // 256,
                block_dim=256,
            )
            mm(self.ctx, x, gw(wp, self.base, wi + 13), z, n, 512, 512)
            self.ctx.enqueue_function[ple_gate](
                z,
                ple,
                Int32(n * 512),
                Int32(layer),
                grid_dim=(n * 512 + 255) // 256,
                block_dim=256,
            )
            mm(self.ctx, z, gw(wp, self.base, wi + 14), y, n, 512, 512)
            self.ctx.enqueue_function[rms](
                y,
                gw(wp, self.base, wi + 15),
                Int32(n),
                Int32(512),
                Float32(1),
                grid_dim=(n + 127) // 128,
                block_dim=128,
            )
            self.ctx.enqueue_function[residual](
                x,
                y,
                gw(wp, self.base, wi + 16),
                Int32(n * 512),
                Int32(Int(1)),
                grid_dim=(n * 512 + 255) // 256,
                block_dim=256,
            )
        self.ctx.enqueue_function[normalize_copy](
            x,
            gw(wp, self.base, 3),
            z,
            Int32(n),
            grid_dim=(n + 127) // 128,
            block_dim=128,
        )
        self.ctx.enqueue_function[pool](
            z,
            pooled.unsafe_ptr(),
            doff.unsafe_ptr(),
            dlen.unsafe_ptr(),
            Int32(count),
            grid_dim=(count * 512 + 255) // 256,
            block_dim=256,
        )
        mm(
            self.ctx,
            pooled.unsafe_ptr(),
            gw(wp, self.base, 4),
            result.unsafe_ptr(),
            count,
            512,
            768,
        )
        self.ctx.enqueue_function[l2](
            result.unsafe_ptr(),
            Int32(count),
            grid_dim=(count + 127) // 128,
            block_dim=128,
        )
        result.enqueue_copy_to(output)
        self.ctx.synchronize()
        # Async host-to-device copies borrow these arrays until synchronization.
        positions.clear()
        starts.clear()
        lens.clear()
        offsets.clear()
        for i in range(count * 768):
            if not isfinite(output.unsafe_load(i)):
                return -3
        return 0


comptime M = Pointer[GpuModel, MutUntrackedOrigin]


@export("ib_mojo_gpu_init")
def init(path: Int) abi("C") -> Int:
    initialize_runtime()
    var base = map_model(path)
    if base == 0:
        return 0
    var handle = external_call["malloc", Int](size_of[GpuModel]())
    if handle == 0:
        unmap_model(base)
        return 0
    try:
        M(unsafe_from_address=handle).unsafe_write(GpuModel(base))
        return handle
    except e:
        print(e)
        external_call["free", NoneType](handle)
        unmap_model(base)
        return 0


@export("ib_mojo_gpu_embed_batch")
def embed_batch(
    handle: Int, ids: Int, lengths: Int, count: Int, output: Int
) abi("C") -> Int32:
    if (
        handle == 0
        or ids == 0
        or lengths == 0
        or output == 0
        or count < 1
        or count > 100
    ):
        return -1
    try:
        return M(unsafe_from_address=handle)[].run(
            T(unsafe_from_address=ids),
            T(unsafe_from_address=lengths),
            count,
            P(unsafe_from_address=output),
        )
    except e:
        print(e)
        return -4


@export("ib_mojo_gpu_embed")
def embed(handle: Int, ids: Int, n: Int, output: Int) abi("C") -> Int32:
    if handle == 0 or ids == 0 or output == 0 or n < 1 or n > 2048:
        return -1
    var len = Int32(n)
    try:
        return M(unsafe_from_address=handle)[].run(
            T(unsafe_from_address=ids),
            Pointer(to=len),
            1,
            P(unsafe_from_address=output),
        )
    except e:
        print(e)
        return -4


@export("ib_mojo_gpu_free")
def free(handle: Int) abi("C"):
    if handle == 0:
        return
    var model = M(unsafe_from_address=handle)
    var base = model[].base
    model.unsafe_deinit_pointee()
    external_call["free", NoneType](handle)
    unmap_model(base)
