# SPDX-License-Identifier: Apache-2.0
"""Batched, bidirectional Mojo Metal text encoder. M5 GEMMs accumulate in FP32."""
from std.memory import Pointer
from std.ffi import external_call
from std.runtime import initialize_runtime
from std.sys import size_of
from std.math import sqrt, isfinite
from std.time import perf_counter_ns
from std.os import getenv
from max.gpu.host import DeviceContext, DeviceBuffer
from layout import TileTensor, row_major
from linalg.matmul.gpu.apple.matmul_kernel import enqueue_apple_matmul

# shortcut: M5 GEMM only; add M1-M4 dispatch after the performance gate passes.
from engine import init as map_model, free as unmap_model, P, I, T
from gpu_ops import (
    gather,
    half_copy,
    normalize_half,
    projected_rope,
    geglu_half,
    ple_half,
    rms_residual,
    residual_prepare,
    rms,
    normalize_copy,
    attention,
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


def gh[
    origin: Origin[mut=False]
](w: Pointer[mut=False, Float16, origin], base: Int, index: Int) -> Pointer[
    mut=False, Float16, origin
]:
    return w.unsafe_offset(
        Int(I(unsafe_from_address=base + 32).unsafe_load(index * 4)) // 4
    )


def mm(
    ctx: DeviceContext,
    x: Pointer[mut=False, Float32, _],
    w: Pointer[mut=False, Float16, _],
    y: Pointer[mut=True, Float32, _],
    n: Int,
    k: Int,
    d: Int,
    half: Pointer[mut=True, Float16, _],
) raises:
    ctx.enqueue_function[half_copy](
        x, half, Int32(n * k), grid_dim=(n * k + 255) // 256, block_dim=256
    )
    mm_half(ctx, half, w, y, n, k, d)


def mm_half(
    ctx: DeviceContext,
    x: Pointer[mut=False, Float16, _],
    w: Pointer[mut=False, Float16, _],
    y: Pointer[mut=True, Float32, _],
    n: Int,
    k: Int,
    d: Int,
) raises:
    var a = TileTensor(x, row_major(n, k))
    var b = TileTensor(w, row_major(d, k))
    var c = TileTensor(y, row_major(n, d))
    enqueue_apple_matmul[in_type=.float16, c_type=.float32, transpose_b=True](
        c, a, b, ctx
    )


def stamp[
    profile: Bool
](ctx: DeviceContext, phase: String, layer: Int, start: Int) raises -> Int:
    comptime if profile:
        ctx.synchronize()
        var now = Int(perf_counter_ns())
        print("PROFILE", layer, phase, Float64(now - start) / 1e6)
        return now
    else:
        return 0


struct GpuModel(Movable):
    var ctx: DeviceContext
    var weights: DeviceBuffer[.float32]
    var base: Int
    var half_weights: DeviceBuffer[.float16]
    var half_scratch: DeviceBuffer[.float16]
    var xb: DeviceBuffer[.float32]
    var zb: DeviceBuffer[.float32]
    var yb: DeviceBuffer[.float32]
    var pb: DeviceBuffer[.float32]
    var qb: DeviceBuffer[.float32]
    var kb: DeviceBuffer[.float32]
    var vb: DeviceBuffer[.float32]
    var ab: DeviceBuffer[.float32]
    var packed_qkv: DeviceBuffer[.float32]
    var packed_ff: DeviceBuffer[.float32]
    var pooled: DeviceBuffer[.float32]
    var result: DeviceBuffer[.float32]
    var di: DeviceBuffer[.int32]
    var dp: DeviceBuffer[.int32]
    var ds: DeviceBuffer[.int32]
    var dl: DeviceBuffer[.int32]
    var doff: DeviceBuffer[.int32]
    var dlen: DeviceBuffer[.int32]
    var token_capacity: Int
    var sequence_capacity: Int
    var sync_layers: Int
    var fuse_prepare: Bool

    def __init__(out self, base: Int) raises:
        self.ctx = DeviceContext()
        self.base = base
        self.sync_layers = 0
        var sync_setting = getenv("IB_MOJO_SYNC_LAYERS")
        if sync_setting:
            self.sync_layers = Int(sync_setting)
        if self.sync_layers < 0 or self.sync_layers > 24:
            raise Error("IB_MOJO_SYNC_LAYERS must be 0..24")
        self.fuse_prepare = False
        var fuse_setting = getenv("IB_MOJO_FUSE_PREPARE")
        if fuse_setting:
            if fuse_setting != "0" and fuse_setting != "1":
                raise Error("IB_MOJO_FUSE_PREPARE must be 0 or 1")
            self.fuse_prepare = fuse_setting == "1"
        var table = I(unsafe_from_address=base + 32)
        for index in range(413):
            if table.unsafe_load(index * 4) % 4 != 0:
                raise Error("unaligned tensor offset")
        for layer in range(24):
            for part in range(3):
                var index = (
                    6 + layer * 17 + (0 if part == 0 else 1 if part == 1 else 8)
                )
                if (
                    table.unsafe_load((index + 1) * 4)
                    != table.unsafe_load(index * 4)
                    + table.unsafe_load(index * 4 + 3) * 4
                ):
                    raise Error("packed QKV/FFN tensors must be contiguous")
        self.weights = self.ctx.enqueue_create_buffer[.float32](
            Int(I(unsafe_from_address=base).unsafe_load(2)) // 4
        )
        self.weights.enqueue_copy_from(P(unsafe_from_address=base))
        self.half_weights = self.ctx.enqueue_create_buffer[.float16](
            len(self.weights)
        )
        self.ctx.enqueue_function[half_copy](
            self.weights.unsafe_ptr(),
            self.half_weights.unsafe_ptr(),
            Int32(len(self.weights)),
            grid_dim=(len(self.weights) + 255) // 256,
            block_dim=256,
        )
        self.half_scratch = self.ctx.enqueue_create_buffer[.float16](1)
        self.xb = self.ctx.enqueue_create_buffer[.float32](1)
        self.zb = self.ctx.enqueue_create_buffer[.float32](1)
        self.yb = self.ctx.enqueue_create_buffer[.float32](1)
        self.pb = self.ctx.enqueue_create_buffer[.float32](1)
        self.qb = self.ctx.enqueue_create_buffer[.float32](1)
        self.kb = self.ctx.enqueue_create_buffer[.float32](1)
        self.vb = self.ctx.enqueue_create_buffer[.float32](1)
        self.ab = self.ctx.enqueue_create_buffer[.float32](1)
        self.packed_qkv = self.ctx.enqueue_create_buffer[.float32](1)
        self.packed_ff = self.ctx.enqueue_create_buffer[.float32](1)
        self.pooled = self.ctx.enqueue_create_buffer[.float32](1)
        self.result = self.ctx.enqueue_create_buffer[.float32](1)
        self.di = self.ctx.enqueue_create_buffer[.int32](1)
        self.dp = self.ctx.enqueue_create_buffer[.int32](1)
        self.ds = self.ctx.enqueue_create_buffer[.int32](1)
        self.dl = self.ctx.enqueue_create_buffer[.int32](1)
        self.doff = self.ctx.enqueue_create_buffer[.int32](1)
        self.dlen = self.ctx.enqueue_create_buffer[.int32](1)
        self.token_capacity = 0
        self.sequence_capacity = 0
        self.ctx.synchronize()

    def run[
        profile: Bool = False
    ](
        mut self,
        ids: T,
        lengths: Pointer[mut=False, Int32, _],
        count: Int,
        output: P,
    ) raises -> Int32:
        var clock = Int(0)
        comptime if profile:
            self.ctx.synchronize()
            clock = Int(perf_counter_ns())
        var n = 0
        var offsets = List[Int32](length=count, fill=0)
        for i in range(count):
            var len = Int(lengths.unsafe_load(i))
            if len < 1 or len > 2048:
                return -1
            offsets[i] = Int32(n)
            n += len
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
        if n > self.token_capacity or count > self.sequence_capacity:
            var cap = max(n, self.token_capacity)
            var seq = max(count, self.sequence_capacity)
            self.xb = self.ctx.enqueue_create_buffer[.float32](cap * 512)
            self.zb = self.ctx.enqueue_create_buffer[.float32](cap * 512)
            self.yb = self.ctx.enqueue_create_buffer[.float32](cap * 512)
            self.pb = self.ctx.enqueue_create_buffer[.float32](cap * 12288)
            self.qb = self.ctx.enqueue_create_buffer[.float32](cap * 2048)
            self.kb = self.ctx.enqueue_create_buffer[.float32](cap * 512)
            self.vb = self.ctx.enqueue_create_buffer[.float32](cap * 512)
            self.ab = self.ctx.enqueue_create_buffer[.float32](cap * 2048)
            self.packed_qkv = self.ctx.enqueue_create_buffer[.float32](
                cap * 3072
            )
            self.packed_ff = self.ctx.enqueue_create_buffer[.float32](
                cap * 4096
            )
            self.pooled = self.ctx.enqueue_create_buffer[.float32](seq * 512)
            self.result = self.ctx.enqueue_create_buffer[.float32](seq * 768)
            self.di = self.ctx.enqueue_create_buffer[.int32](cap)
            self.dp = self.ctx.enqueue_create_buffer[.int32](cap)
            self.ds = self.ctx.enqueue_create_buffer[.int32](cap)
            self.dl = self.ctx.enqueue_create_buffer[.int32](cap)
            self.doff = self.ctx.enqueue_create_buffer[.int32](seq)
            self.dlen = self.ctx.enqueue_create_buffer[.int32](seq)
            self.half_scratch = self.ctx.enqueue_create_buffer[.float16](
                cap * 2048
            )
            self.token_capacity = cap
            self.sequence_capacity = seq
        self.di.create_sub_buffer[.int32](0, n).enqueue_copy_from(ids)
        self.dp.create_sub_buffer[.int32](0, n).enqueue_copy_from(
            positions.unsafe_ptr()
        )
        self.ds.create_sub_buffer[.int32](0, n).enqueue_copy_from(
            starts.unsafe_ptr()
        )
        self.dl.create_sub_buffer[.int32](0, n).enqueue_copy_from(
            lens.unsafe_ptr()
        )
        self.doff.create_sub_buffer[.int32](0, count).enqueue_copy_from(
            offsets.unsafe_ptr()
        )
        self.dlen.create_sub_buffer[.int32](0, count).enqueue_copy_from(lengths)
        var x = self.xb.unsafe_ptr()
        var z = self.zb.unsafe_ptr()
        var y = self.yb.unsafe_ptr()
        var ple = self.pb.unsafe_ptr()
        var q = self.qb.unsafe_ptr()
        var k = self.kb.unsafe_ptr()
        var v = self.vb.unsafe_ptr()
        var a = self.ab.unsafe_ptr()
        var wp = self.weights.unsafe_ptr().as_imm()
        var hw = self.half_weights.unsafe_ptr().as_imm()
        var half = self.half_scratch.unsafe_ptr()
        clock = stamp[profile](self.ctx, "allocate-copy", -1, clock)
        self.ctx.enqueue_function[gather](
            x,
            gw(wp, self.base, 0),
            self.di.unsafe_ptr(),
            Int32(n),
            grid_dim=(n * 512 + 255) // 256,
            block_dim=256,
        )
        mm(self.ctx, x, gh(hw, self.base, 1), ple, n, 512, 12288, half)
        self.ctx.enqueue_function[rms](
            ple,
            gw(wp, self.base, 2),
            Int32(n * 24),
            Int32(512),
            1 / sqrt(Float32(512)),
            grid_dim=(n * 24 * 32 + 127) // 128,
            block_dim=128,
        )
        clock = stamp[profile](self.ctx, "embedding-ple", -1, clock)
        for layer in range(24):
            var wi = 5 + layer * 17
            var full = layer % 6 == 5
            var d = 512 if full else 256
            var qdim = 4 * d
            var ropebase = Float32(1000000) if full else Float32(10000)
            if not self.fuse_prepare or layer == 0:
                self.ctx.enqueue_function[normalize_half](
                    x,
                    gw(wp, self.base, wi),
                    half,
                    Int32(n),
                    grid_dim=(n * 32 + 127) // 128,
                    block_dim=128,
                )
            mm_half(
                self.ctx,
                half,
                gh(hw, self.base, wi + 1),
                self.packed_qkv.unsafe_ptr(),
                n,
                512,
                qdim + 1024,
            )
            clock = stamp[profile](self.ctx, "qkv", layer, clock)
            if full:
                self.ctx.enqueue_function[projected_rope[512, 1]](
                    self.packed_qkv.unsafe_ptr(),
                    q,
                    k,
                    v,
                    gw(wp, self.base, wi + 5),
                    gw(wp, self.base, wi + 6),
                    self.dp.unsafe_ptr(),
                    Int32(n),
                    ropebase,
                    grid_dim=(n * 6 * 32 + 127) // 128,
                    block_dim=128,
                )
            else:
                self.ctx.enqueue_function[projected_rope[256, 2]](
                    self.packed_qkv.unsafe_ptr(),
                    q,
                    k,
                    v,
                    gw(wp, self.base, wi + 5),
                    gw(wp, self.base, wi + 6),
                    self.dp.unsafe_ptr(),
                    Int32(n),
                    ropebase,
                    grid_dim=(n * 8 * 32 + 127) // 128,
                    block_dim=128,
                )
            clock = stamp[profile](self.ctx, "rope", layer, clock)
            if full:
                self.ctx.enqueue_function[attention[512, 1, True]](
                    q,
                    k,
                    v,
                    a,
                    self.ds.unsafe_ptr(),
                    self.dl.unsafe_ptr(),
                    Int32(n),
                    grid_dim=(n * 4 * 32 + 127) // 128,
                    block_dim=128,
                )
            else:
                self.ctx.enqueue_function[attention[256, 2, False]](
                    q,
                    k,
                    v,
                    a,
                    self.ds.unsafe_ptr(),
                    self.dl.unsafe_ptr(),
                    Int32(n),
                    grid_dim=(n * 4 * 32 + 127) // 128,
                    block_dim=128,
                )
            clock = stamp[profile](self.ctx, "attention", layer, clock)
            mm(self.ctx, a, gh(hw, self.base, wi + 4), y, n, qdim, 512, half)
            if self.fuse_prepare:
                self.ctx.enqueue_function[residual_prepare[True]](
                    x,
                    y,
                    gw(wp, self.base, wi + 7),
                    gw(wp, self.base, wi + 8),
                    gw(wp, self.base, wi + 16),
                    half,
                    Int32(n),
                    Int32(0),
                    grid_dim=(n * 32 + 127) // 128,
                    block_dim=128,
                )
            else:
                self.ctx.enqueue_function[rms_residual](
                    x,
                    y,
                    gw(wp, self.base, wi + 7),
                    gw(wp, self.base, wi + 16),
                    Int32(n),
                    Int32(0),
                    grid_dim=(n * 32 + 127) // 128,
                    block_dim=128,
                )
            clock = stamp[profile](self.ctx, "attention-output", layer, clock)
            if not self.fuse_prepare:
                self.ctx.enqueue_function[normalize_half](
                    x,
                    gw(wp, self.base, wi + 8),
                    half,
                    Int32(n),
                    grid_dim=(n * 32 + 127) // 128,
                    block_dim=128,
                )
            mm_half(
                self.ctx,
                half,
                gh(hw, self.base, wi + 9),
                self.packed_ff.unsafe_ptr(),
                n,
                512,
                4096,
            )
            self.ctx.enqueue_function[geglu_half](
                self.packed_ff.unsafe_ptr(),
                half,
                Int32(n * 2048),
                grid_dim=(n * 2048 + 255) // 256,
                block_dim=256,
            )
            mm_half(self.ctx, half, gh(hw, self.base, wi + 11), y, n, 2048, 512)
            if self.fuse_prepare:
                self.ctx.enqueue_function[residual_prepare[False]](
                    x,
                    y,
                    gw(wp, self.base, wi + 12),
                    gw(wp, self.base, wi + 12),
                    gw(wp, self.base, wi + 16),
                    half,
                    Int32(n),
                    Int32(0),
                    grid_dim=(n * 32 + 127) // 128,
                    block_dim=128,
                )
            else:
                self.ctx.enqueue_function[rms_residual](
                    x,
                    y,
                    gw(wp, self.base, wi + 12),
                    gw(wp, self.base, wi + 16),
                    Int32(n),
                    Int32(0),
                    grid_dim=(n * 32 + 127) // 128,
                    block_dim=128,
                )
            clock = stamp[profile](self.ctx, "ffn", layer, clock)
            if self.fuse_prepare:
                mm_half(
                    self.ctx, half, gh(hw, self.base, wi + 13), z, n, 512, 512
                )
            else:
                mm(
                    self.ctx,
                    x,
                    gh(hw, self.base, wi + 13),
                    z,
                    n,
                    512,
                    512,
                    half,
                )
            self.ctx.enqueue_function[ple_half](
                z,
                ple,
                half,
                Int32(n * 512),
                Int32(layer),
                grid_dim=(n * 512 + 255) // 256,
                block_dim=256,
            )
            mm_half(self.ctx, half, gh(hw, self.base, wi + 14), y, n, 512, 512)
            if self.fuse_prepare and layer < 23:
                self.ctx.enqueue_function[residual_prepare[True]](
                    x,
                    y,
                    gw(wp, self.base, wi + 15),
                    gw(wp, self.base, wi + 17),
                    gw(wp, self.base, wi + 16),
                    half,
                    Int32(n),
                    Int32(1),
                    grid_dim=(n * 32 + 127) // 128,
                    block_dim=128,
                )
            else:
                self.ctx.enqueue_function[rms_residual](
                    x,
                    y,
                    gw(wp, self.base, wi + 15),
                    gw(wp, self.base, wi + 16),
                    Int32(n),
                    Int32(1),
                    grid_dim=(n * 32 + 127) // 128,
                    block_dim=128,
                )
            clock = stamp[profile](self.ctx, "ple", layer, clock)
            if (
                self.sync_layers > 0
                and (layer + 1) % self.sync_layers == 0
                and layer < 23
            ):
                self.ctx.synchronize()
        self.ctx.enqueue_function[normalize_copy](
            x,
            gw(wp, self.base, 3),
            z,
            Int32(n),
            grid_dim=(n * 32 + 127) // 128,
            block_dim=128,
        )
        self.ctx.enqueue_function[pool](
            z,
            self.pooled.unsafe_ptr(),
            self.doff.unsafe_ptr(),
            self.dlen.unsafe_ptr(),
            Int32(count),
            grid_dim=(count * 512 + 255) // 256,
            block_dim=256,
        )
        mm(
            self.ctx,
            self.pooled.unsafe_ptr(),
            gh(hw, self.base, 4),
            self.result.unsafe_ptr(),
            count,
            512,
            768,
            half,
        )
        self.ctx.enqueue_function[l2](
            self.result.unsafe_ptr(),
            Int32(count),
            grid_dim=(count + 127) // 128,
            block_dim=128,
        )
        self.result.create_sub_buffer[.float32](0, count * 768).enqueue_copy_to(
            output
        )
        self.ctx.synchronize()
        clock = stamp[profile](self.ctx, "pool-readback", 24, clock)
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


@export("ib_mojo_gpu_profile")
def profile(
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
        return M(unsafe_from_address=handle)[].run[True](
            T(unsafe_from_address=ids),
            T(unsafe_from_address=lengths),
            count,
            P(unsafe_from_address=output),
        )
    except e:
        print(e)
        return -4
