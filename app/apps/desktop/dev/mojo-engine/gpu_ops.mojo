# SPDX-License-Identifier: Apache-2.0
from std.memory import Pointer
from std.math import sqrt, exp, cos, sin, pow
from max.gpu import global_idx, lane_id
from max.gpu.primitives.warp import sum as warp_sum
from engine import gelu


def gather(
    x: Pointer[Float32, MutAnyOrigin],
    w: Pointer[mut=False, Float32, ImmutAnyOrigin],
    ids: Pointer[mut=False, Int32, ImmutAnyOrigin],
    count_arg: Int32,
):
    var count = Int(count_arg)
    var i = global_idx.x
    if i < count * 512:
        x.unsafe_store(
            i,
            w.unsafe_load(Int(ids.unsafe_load(i // 512)) * 512 + i % 512)
            * sqrt(Float32(512)),
        )


def rms(
    x: Pointer[Float32, MutAnyOrigin],
    w: Pointer[mut=False, Float32, ImmutAnyOrigin],
    rows_arg: Int32,
    d_arg: Int32,
    scale: Float32,
):
    var rows = Int(rows_arg)
    var d = Int(d_arg)
    var r = global_idx.x // 32
    var lane = Int(lane_id())
    if r >= rows:
        return
    var sum = Float32(0)
    for j in range(lane, d, 32):
        var v = x.unsafe_load(r * d + j) * scale
        sum += v * v
    sum = warp_sum(sum)
    var factor = scale / sqrt(sum / Float32(d) + Float32(1e-6))
    for j in range(lane, d, 32):
        x.unsafe_store(
            r * d + j, x.unsafe_load(r * d + j) * factor * w.unsafe_load(j)
        )


def normalize_copy(
    x: Pointer[mut=False, Float32, ImmutAnyOrigin],
    w: Pointer[mut=False, Float32, ImmutAnyOrigin],
    y: Pointer[Float32, MutAnyOrigin],
    rows_arg: Int32,
):
    var rows = Int(rows_arg)
    var r = global_idx.x // 32
    var lane = Int(lane_id())
    if r >= rows:
        return
    var sum = Float32(0)
    for j in range(lane, 512, 32):
        var v = x.unsafe_load(r * 512 + j)
        sum += v * v
    sum = warp_sum(sum)
    var factor = 1 / sqrt(sum / Float32(512) + Float32(1e-6))
    for j in range(lane, 512, 32):
        y.unsafe_store(
            r * 512 + j, x.unsafe_load(r * 512 + j) * factor * w.unsafe_load(j)
        )


def pool(
    z: Pointer[mut=False, Float32, ImmutAnyOrigin],
    y: Pointer[Float32, MutAnyOrigin],
    offsets: Pointer[mut=False, Int32, ImmutAnyOrigin],
    lens: Pointer[mut=False, Int32, ImmutAnyOrigin],
    count_arg: Int32,
):
    var count = Int(count_arg)
    var i = global_idx.x
    if i >= count * 512:
        return
    var seq = i // 512
    var j = i % 512
    var start = Int(offsets.unsafe_load(seq))
    var len = Int(lens.unsafe_load(seq))
    var sum = Float32(0)
    for t in range(len):
        sum += z.unsafe_load((start + t) * 512 + j)
    y.unsafe_store(i, sum / Float32(len))


def l2(x: Pointer[Float32, MutAnyOrigin], count_arg: Int32):
    var count = Int(count_arg)
    var seq = global_idx.x
    if seq >= count:
        return
    var sum = Float32(0)
    for j in range(768):
        var v = x.unsafe_load(seq * 768 + j)
        sum += v * v
    var factor = 1 / sqrt(sum)
    for j in range(768):
        x.unsafe_store(seq * 768 + j, x.unsafe_load(seq * 768 + j) * factor)


def attention[
    d: Int, heads: Int, full: Bool
](
    q: Pointer[mut=False, Float32, ImmutAnyOrigin],
    k: Pointer[mut=False, Float32, ImmutAnyOrigin],
    v: Pointer[mut=False, Float32, ImmutAnyOrigin],
    a: Pointer[Float32, MutAnyOrigin],
    starts: Pointer[mut=False, Int32, ImmutAnyOrigin],
    lengths: Pointer[mut=False, Int32, ImmutAnyOrigin],
    n_arg: Int32,
):
    var row = global_idx.x // 32
    var lane = Int(lane_id())
    var n = Int(n_arg)
    if row >= n * 4:
        return
    var t = row // 4
    var h = row % 4
    var kh = h // (4 // heads)
    var start = Int(starts.unsafe_load(t))
    var length = Int(lengths.unsafe_load(t))
    var qv = SIMD[.float32, d // 32](0)
    var accum = SIMD[.float32, d // 32](0)
    comptime for c in range(d // 32):
        qv[c] = q.unsafe_load(t * 4 * d + h * d + lane + c * 32)
    var peak = Float32(-1e30)
    var denom = Float32(0)
    var lo = 0
    var hi = length
    comptime if not full:
        lo = max(0, t - start - 512)
        hi = min(length, t - start + 513)
    for j in range(lo, hi):
        var partial = Float32(0)
        comptime for c in range(d // 32):
            partial += qv[c] * k.unsafe_load(
                (start + j) * 512 + kh * d + lane + c * 32
            )
        var score = warp_sum(partial)
        var new_peak = max(peak, score)
        var correction = exp(peak - new_peak)
        var weight = exp(score - new_peak)
        denom = denom * correction + weight
        comptime for c in range(d // 32):
            accum[c] = accum[c] * correction + weight * v.unsafe_load(
                (start + j) * 512 + kh * d + lane + c * 32
            )
        peak = new_peak
    comptime for c in range(d // 32):
        a.unsafe_store(t * 4 * d + h * d + lane + c * 32, accum[c] / denom)


def half_copy(
    source: Pointer[mut=False, Float32, ImmutAnyOrigin],
    target: Pointer[Float16, MutAnyOrigin],
    count: Int32,
):
    var i = global_idx.x
    if i < Int(count):
        target.unsafe_store(i, Float16(source.unsafe_load(i)))


def normalize_half(
    x: Pointer[mut=False, Float32, ImmutAnyOrigin],
    w: Pointer[mut=False, Float32, ImmutAnyOrigin],
    y: Pointer[Float16, MutAnyOrigin],
    rows_arg: Int32,
):
    var r = global_idx.x // 32
    var lane = Int(lane_id())
    if r >= Int(rows_arg):
        return
    var ss = Float32(0)
    for j in range(lane, 512, 32):
        var value = x.unsafe_load(r * 512 + j)
        ss += value * value
    var factor = 1 / sqrt(warp_sum(ss) / Float32(512) + Float32(1e-6))
    for j in range(lane, 512, 32):
        y.unsafe_store(
            r * 512 + j,
            Float16(x.unsafe_load(r * 512 + j) * factor * w.unsafe_load(j)),
        )


def rms_residual(
    x: Pointer[Float32, MutAnyOrigin],
    y: Pointer[mut=False, Float32, ImmutAnyOrigin],
    w: Pointer[mut=False, Float32, ImmutAnyOrigin],
    scale: Pointer[mut=False, Float32, ImmutAnyOrigin],
    rows_arg: Int32,
    apply_scale_arg: Int32,
):
    var r = global_idx.x // 32
    var lane = Int(lane_id())
    if r >= Int(rows_arg):
        return
    var ss = Float32(0)
    for j in range(lane, 512, 32):
        var value = y.unsafe_load(r * 512 + j)
        ss += value * value
    var factor = 1 / sqrt(warp_sum(ss) / Float32(512) + Float32(1e-6))
    var multiplier = scale.unsafe_load() if apply_scale_arg != 0 else Float32(1)
    for j in range(lane, 512, 32):
        var at = r * 512 + j
        x.unsafe_store(
            at,
            (x.unsafe_load(at) + y.unsafe_load(at) * factor * w.unsafe_load(j))
            * multiplier,
        )


def projected_rope[
    d: Int, heads: Int
](
    packed: Pointer[mut=False, Float32, ImmutAnyOrigin],
    q: Pointer[Float32, MutAnyOrigin],
    k: Pointer[Float32, MutAnyOrigin],
    v: Pointer[Float32, MutAnyOrigin],
    qnorm: Pointer[mut=False, Float32, ImmutAnyOrigin],
    knorm: Pointer[mut=False, Float32, ImmutAnyOrigin],
    positions: Pointer[mut=False, Int32, ImmutAnyOrigin],
    n_arg: Int32,
    base: Float32,
):
    var row = global_idx.x // 32
    var lane = Int(lane_id())
    comptime groups = 4 + 2 * heads
    var t = row // groups
    var h = row % groups
    if t >= Int(n_arg):
        return
    var source = t * (4 * d + 1024)
    var dest = q
    var weights = qnorm
    var target = t * 4 * d + h * d
    if h < 4:
        source += h * d
    elif h < 4 + heads:
        source += 4 * d + (h - 4) * d
        target = t * 512 + (h - 4) * d
        dest = k
        weights = knorm
    else:
        source += 4 * d + 512 + (h - 4 - heads) * d
        target = t * 512 + (h - 4 - heads) * d
        dest = v
    var ss = Float32(0)
    for j in range(lane, d, 32):
        var value = packed.unsafe_load(source + j)
        ss += value * value
    var factor = 1 / sqrt(warp_sum(ss) / Float32(d) + Float32(1e-6))
    if h < 4 + heads:
        var position = Float32(positions.unsafe_load(t))
        for j in range(lane, d // 2, 32):
            var angle = position * pow(base, -Float32(2 * j) / Float32(d))
            var aa = (
                packed.unsafe_load(source + j) * factor * weights.unsafe_load(j)
            )
            var bb = (
                packed.unsafe_load(source + j + d // 2)
                * factor
                * weights.unsafe_load(j + d // 2)
            )
            dest.unsafe_store(target + j, aa * cos(angle) - bb * sin(angle))
            dest.unsafe_store(
                target + j + d // 2, aa * sin(angle) + bb * cos(angle)
            )
    else:
        for j in range(lane, d, 32):
            dest.unsafe_store(
                target + j, packed.unsafe_load(source + j) * factor
            )


def geglu_half(
    packed: Pointer[mut=False, Float32, ImmutAnyOrigin],
    target: Pointer[Float16, MutAnyOrigin],
    count_arg: Int32,
):
    var i = global_idx.x
    if i < Int(count_arg):
        var at = i // 2048 * 4096 + i % 2048
        target.unsafe_store(
            i,
            Float16(
                gelu(packed.unsafe_load(at)) * packed.unsafe_load(at + 2048)
            ),
        )


def ple_half(
    z: Pointer[mut=False, Float32, ImmutAnyOrigin],
    ple: Pointer[mut=False, Float32, ImmutAnyOrigin],
    target: Pointer[Float16, MutAnyOrigin],
    count_arg: Int32,
    layer_arg: Int32,
):
    var i = global_idx.x
    if i < Int(count_arg):
        target.unsafe_store(
            i,
            Float16(
                gelu(z.unsafe_load(i))
                * ple.unsafe_load(
                    (i // 512 * 24 + Int(layer_arg)) * 512 + i % 512
                )
            ),
        )


def residual_prepare[
    normalize: Bool
](
    x: Pointer[Float32, MutAnyOrigin],
    y: Pointer[mut=False, Float32, ImmutAnyOrigin],
    norm: Pointer[mut=False, Float32, ImmutAnyOrigin],
    next_norm: Pointer[mut=False, Float32, ImmutAnyOrigin],
    scale: Pointer[mut=False, Float32, ImmutAnyOrigin],
    target: Pointer[Float16, MutAnyOrigin],
    rows_arg: Int32,
    apply_scale_arg: Int32,
):
    var row = global_idx.x // 32
    var lane = Int(lane_id())
    if row >= Int(rows_arg):
        return
    var ss = Float32(0)
    for j in range(lane, 512, 32):
        var value = y.unsafe_load(row * 512 + j)
        ss += value * value
    var factor = 1 / sqrt(warp_sum(ss) / Float32(512) + Float32(1e-6))
    var multiplier = scale.unsafe_load() if apply_scale_arg != 0 else Float32(1)
    var values = SIMD[.float32, 16](0)
    ss = 0
    comptime for c in range(16):
        var j = lane + c * 32
        var at = row * 512 + j
        values[c] = (
            x.unsafe_load(at) + y.unsafe_load(at) * factor * norm.unsafe_load(j)
        ) * multiplier
        ss += values[c] * values[c]
        x.unsafe_store(at, values[c])
    comptime if normalize:
        factor = 1 / sqrt(warp_sum(ss) / Float32(512) + Float32(1e-6))
    comptime for c in range(16):
        var j = lane + c * 32
        var value = values[c]
        comptime if normalize:
            value *= factor * next_norm.unsafe_load(j)
        target.unsafe_store(row * 512 + j, Float16(value))
