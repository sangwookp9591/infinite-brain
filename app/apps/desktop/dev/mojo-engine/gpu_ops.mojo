# SPDX-License-Identifier: Apache-2.0
from std.memory import Pointer
from std.math import sqrt, exp, cos, sin, pow
from max.gpu import global_idx
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
    var r = global_idx.x
    if r >= rows:
        return
    var sum = Float32(0)
    for j in range(d):
        var v = x.unsafe_load(r * d + j) * scale
        sum += v * v
    var factor = scale / sqrt(sum / Float32(d) + Float32(1e-6))
    for j in range(d):
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
    var r = global_idx.x
    if r >= rows:
        return
    var sum = Float32(0)
    for j in range(512):
        var v = x.unsafe_load(r * 512 + j)
        sum += v * v
    var factor = 1 / sqrt(sum / Float32(512) + Float32(1e-6))
    for j in range(512):
        y.unsafe_store(
            r * 512 + j, x.unsafe_load(r * 512 + j) * factor * w.unsafe_load(j)
        )


def residual(
    x: Pointer[Float32, MutAnyOrigin],
    y: Pointer[mut=False, Float32, ImmutAnyOrigin],
    scale: Pointer[mut=False, Float32, ImmutAnyOrigin],
    count_arg: Int32,
    apply_scale_arg: Int32,
):
    var count = Int(count_arg)
    var apply_scale = Int(apply_scale_arg)
    var i = global_idx.x
    if i < count:
        var v = x.unsafe_load(i) + y.unsafe_load(i)
        if apply_scale != 0:
            v *= scale.unsafe_load()
        x.unsafe_store(i, v)


def geglu(
    g: Pointer[Float32, MutAnyOrigin],
    u: Pointer[mut=False, Float32, ImmutAnyOrigin],
    count_arg: Int32,
):
    var count = Int(count_arg)
    var i = global_idx.x
    if i < count:
        g.unsafe_store(i, gelu(g.unsafe_load(i)) * u.unsafe_load(i))


def ple_gate(
    z: Pointer[Float32, MutAnyOrigin],
    ple: Pointer[mut=False, Float32, ImmutAnyOrigin],
    count_arg: Int32,
    layer_arg: Int32,
):
    var count = Int(count_arg)
    var layer = Int(layer_arg)
    var i = global_idx.x
    if i < count:
        z.unsafe_store(
            i,
            gelu(z.unsafe_load(i))
            * ple.unsafe_load((i // 512 * 24 + layer) * 512 + i % 512),
        )


def head_rope(
    x: Pointer[Float32, MutAnyOrigin],
    w: Pointer[mut=False, Float32, ImmutAnyOrigin],
    positions: Pointer[mut=False, Int32, ImmutAnyOrigin],
    n_arg: Int32,
    heads_arg: Int32,
    d_arg: Int32,
    base: Float32,
    mode_arg: Int32,
):
    var n = Int(n_arg)
    var heads = Int(heads_arg)
    var d = Int(d_arg)
    var mode = Int(mode_arg)
    var r = global_idx.x
    if r >= n * heads:
        return
    var at = r * d
    var sum = Float32(0)
    for j in range(d):
        var v = x.unsafe_load(at + j)
        sum += v * v
    var factor = 1 / sqrt(sum / Float32(d) + Float32(1e-6))
    for j in range(d):
        var v = x.unsafe_load(at + j) * factor
        if mode != 0:
            v *= w.unsafe_load(j)
        x.unsafe_store(at + j, v)
    if mode != 0:
        var position = Float32(positions.unsafe_load(r // heads))
        for j in range(d // 2):
            var angle = position * pow(base, -Float32(2 * j) / Float32(d))
            var a = x.unsafe_load(at + j)
            var b = x.unsafe_load(at + j + d // 2)
            x.unsafe_store(at + j, a * cos(angle) - b * sin(angle))
            x.unsafe_store(at + j + d // 2, a * sin(angle) + b * cos(angle))


def scores(
    q: Pointer[mut=False, Float32, ImmutAnyOrigin],
    k: Pointer[mut=False, Float32, ImmutAnyOrigin],
    s: Pointer[Float32, MutAnyOrigin],
    starts: Pointer[mut=False, Int32, ImmutAnyOrigin],
    lengths: Pointer[mut=False, Int32, ImmutAnyOrigin],
    n_arg: Int32,
    width_arg: Int32,
    d_arg: Int32,
    heads_arg: Int32,
    full_arg: Int32,
):
    var n = Int(n_arg)
    var width = Int(width_arg)
    var d = Int(d_arg)
    var heads = Int(heads_arg)
    var full = Int(full_arg)
    var i = global_idx.x
    if i >= 4 * n * width:
        return
    var j = i % width
    var t = (i // width) % n
    var h = i // (width * n)
    var start = Int(starts.unsafe_load(t))
    var len = Int(lengths.unsafe_load(t))
    var score = Float32(-1e30)
    if j < len and (full != 0 or abs(start + j - t) <= 512):
        score = 0
        var qi = t * 4 * d + h * d
        var ki = (start + j) * 512 + (h // (4 // heads)) * d
        for c in range(d):
            score += q.unsafe_load(qi + c) * k.unsafe_load(ki + c)
    s.unsafe_store(i, score)


def softmax(
    s: Pointer[Float32, MutAnyOrigin], rows_arg: Int32, width_arg: Int32
):
    var rows = Int(rows_arg)
    var width = Int(width_arg)
    var r = global_idx.x
    if r >= rows:
        return
    var peak = Float32(-1e30)
    for j in range(width):
        peak = max(peak, s.unsafe_load(r * width + j))
    var sum = Float32(0)
    for j in range(width):
        var v = exp(s.unsafe_load(r * width + j) - peak)
        s.unsafe_store(r * width + j, v)
        sum += v
    for j in range(width):
        s.unsafe_store(r * width + j, s.unsafe_load(r * width + j) / sum)


def values(
    s: Pointer[mut=False, Float32, ImmutAnyOrigin],
    v: Pointer[mut=False, Float32, ImmutAnyOrigin],
    a: Pointer[Float32, MutAnyOrigin],
    starts: Pointer[mut=False, Int32, ImmutAnyOrigin],
    lengths: Pointer[mut=False, Int32, ImmutAnyOrigin],
    n_arg: Int32,
    width_arg: Int32,
    d_arg: Int32,
    heads_arg: Int32,
):
    var n = Int(n_arg)
    var width = Int(width_arg)
    var d = Int(d_arg)
    var heads = Int(heads_arg)
    var i = global_idx.x
    if i >= n * 4 * d:
        return
    var c = i % d
    var h = (i // d) % 4
    var t = i // (4 * d)
    var start = Int(starts.unsafe_load(t))
    var len = Int(lengths.unsafe_load(t))
    var sum = Float32(0)
    var kh = h // (4 // heads)
    for j in range(len):
        sum += s.unsafe_load((h * n + t) * width + j) * v.unsafe_load(
            (start + j) * 512 + kh * d + c
        )
    a.unsafe_store(i, sum)


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
