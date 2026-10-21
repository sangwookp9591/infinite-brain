// SPDX-License-Identifier: Apache-2.0
const std = @import("std");
extern "c" fn open([*:0]const u8, c_int) c_int;
extern "c" fn close(c_int) c_int;
extern "c" fn lseek(c_int, i64, c_int) i64;
extern "c" fn mmap(?*anyopaque, usize, c_int, c_int, c_int, i64) ?*anyopaque;
extern "c" fn munmap(*anyopaque, usize) c_int;
extern fn mh_create([*:0]const u8) ?*anyopaque;
extern fn mh_free(?*anyopaque) void;
extern fn mh_buffer(*anyopaque, usize) ?*anyopaque;
extern fn mh_release(*anyopaque) void;
extern fn mh_contents(*anyopaque) [*]u8;
extern fn mh_begin(*anyopaque) c_int;
extern fn mh_dispatch(*anyopaque, [*:0]const u8, [*]const ?*anyopaque, [*]const usize, c_uint, [*]const u32, c_uint, c_uint, c_uint) c_int;
extern fn mh_finish(*anyopaque, c_int) c_int;
extern fn mh_dispatch_count(*anyopaque) c_uint;

const Table = extern struct { offset: u64, k: u64, d: u64, count: u64 };
const Ref = struct { buffer: ?*anyopaque, offset: usize = 0 };
const Params = extern struct { n: u32 = 0, k: u32 = 0, d: u32 = 512, layer: u32 = 0, full: u32 = 0, count: u32 = 0, a: u32 = 0, b: u32 = 0 };
const Model = struct {
    host: ?*anyopaque = null,
    mapping: ?*anyopaque = null,
    bytes: usize = 0,
    table: [413]Table = undefined,
    buffers: [21]?*anyopaque = @splat(null),
    cap: usize = 0,
    seq: usize = 0,

    fn release(self: *Model) void {
        for (self.buffers) |buffer| if (buffer) |b| mh_release(b);
        mh_free(self.host);
        if (self.mapping) |p| _ = munmap(p, self.bytes);
    }
    fn weight(self: *Model, i: usize, half: bool) Ref {
        return .{ .buffer = self.buffers[if (half) 1 else 0], .offset = @intCast(self.table[i].offset / (if (half) @as(u64, 2) else 1)) };
    }
    fn ref(self: *Model, i: usize) Ref {
        return .{ .buffer = self.buffers[i] };
    }
    fn dispatch(self: *Model, name: [*:0]const u8, refs: []const Ref, p: Params, gx: u32, gy: u32) !void {
        var buffers: [8]?*anyopaque = undefined;
        var offsets: [8]usize = undefined;
        for (refs, 0..) |r, i| {
            buffers[i] = r.buffer;
            offsets[i] = r.offset;
        }
        if (mh_dispatch(self.host.?, name, &buffers, &offsets, @intCast(refs.len), @ptrCast(&p), gx, gy, 128) == 0) return error.Metal;
    }
    fn mm(self: *Model, x: usize, wi: usize, y: usize, n: u32, k: u32, d: u32) !void {
        try self.dispatch("mm", &.{ self.ref(x), self.weight(wi, true), self.ref(y) }, .{ .n = n, .k = k, .d = d }, (d + 31) / 32, (n + 31) / 32);
    }
    fn norm(self: *Model, x: usize, wi: usize, y: usize, n: u32, mode: u32, scale: usize) !void {
        try self.dispatch("norm", &.{ self.ref(x), self.weight(wi, false), self.ref(y), self.ref(2), self.weight(scale, false) }, .{ .n = n, .a = mode }, (n * 32 + 127) / 128, 1);
    }
    fn grow(self: *Model, n: usize, count: usize) !void {
        if (n <= self.cap and count <= self.seq) return;
        const cap = @max(n, self.cap);
        const seq = @max(count, self.seq);
        const sizes = [_]usize{ cap * 512 * 4, cap * 512 * 4, cap * 512 * 4, cap * 12288 * 4, cap * 2048 * 4, cap * 512 * 4, cap * 512 * 4, cap * 2048 * 4, cap * 3072 * 4, cap * 4096 * 4, cap * 2048 * 4, seq * 512 * 4, seq * 768 * 4, cap * 4, cap * 4, cap * 4, cap * 4, seq * 4, seq * 4 };
        var replacement: [19]?*anyopaque = @splat(null);
        errdefer for (replacement) |b| if (b) |v| mh_release(v);
        for (sizes, 0..) |size, i| replacement[i] = mh_buffer(self.host.?, size) orelse return error.Memory;
        for (replacement, 0..) |b, i| {
            if (self.buffers[i + 2]) |old| mh_release(old);
            self.buffers[i + 2] = b;
        }
        self.cap = cap;
        self.seq = seq;
    }
    fn ints(self: *Model, i: usize) [*]i32 {
        return @ptrCast(@alignCast(mh_contents(self.buffers[i].?)));
    }
    fn run(self: *Model, ids: [*]const i32, lengths: [*]const i32, count: usize, output: [*]f32) !i32 {
        var total: usize = 0;
        for (lengths[0..count]) |len| {
            if (len < 1 or len > 2048) return -1;
            total += @intCast(len);
        }
        if (total > 16384) return -1;
        for (ids[0..total]) |token| if (token < 0 or token >= 262144) return -2;
        try self.grow(total, count);
        var offset: usize = 0;
        for (lengths[0..count], 0..) |len, s| {
            self.ints(19)[s] = @intCast(offset);
            self.ints(20)[s] = len;
            for (0..@intCast(len)) |t| {
                self.ints(15)[offset + t] = ids[offset + t];
                self.ints(16)[offset + t] = @intCast(t);
                self.ints(17)[offset + t] = @intCast(offset);
                self.ints(18)[offset + t] = len;
            }
            offset += @intCast(len);
        }
        if (mh_begin(self.host.?) == 0) return error.Metal;
        var finished = false;
        defer {
            if (!finished) _ = mh_finish(self.host.?, 0);
        }
        const n: u32 = @intCast(total);
        const c: u32 = @intCast(count);
        try self.dispatch("gather", &.{ self.ref(2), self.weight(0, false), self.ref(15) }, .{ .n = n }, (n * 512 + 127) / 128, 1);
        try self.mm(2, 1, 5, n, 512, 12288);
        try self.norm(5, 2, 5, n * 24, 1, 3);
        for (0..24) |layer| {
            const wi = 5 + layer * 17;
            const full = layer % 6 == 5;
            const d: u32 = if (full) 512 else 256;
            const p = Params{ .n = n, .d = d, .full = @intFromBool(full), .layer = @intCast(layer) };
            try self.norm(2, wi, 3, n, 0, wi + 16);
            try self.mm(3, wi + 1, 10, n, 512, 4 * d + 1024);
            try self.dispatch("rope", &.{ self.ref(10), self.ref(6), self.ref(7), self.ref(8), self.weight(wi + 5, false), self.weight(wi + 6, false), self.ref(16) }, p, (n * (4 + 2 * (512 / d)) * 32 + 127) / 128, 1);
            try self.dispatch("attention", &.{ self.ref(6), self.ref(7), self.ref(8), self.ref(9), self.ref(17), self.ref(18) }, p, n, 1);
            try self.mm(9, wi + 4, 4, n, 4 * d, 512);
            try self.norm(4, wi + 7, 2, n, 2, wi + 16);
            try self.norm(2, wi + 8, 3, n, 0, wi + 16);
            try self.mm(3, wi + 9, 11, n, 512, 4096);
            try self.dispatch("activation", &.{ self.ref(11), self.ref(5), self.ref(12) }, .{ .n = n, .d = 2048 }, (n * 2048 + 127) / 128, 1);
            try self.mm(12, wi + 11, 4, n, 2048, 512);
            try self.norm(4, wi + 12, 2, n, 2, wi + 16);
            try self.mm(2, wi + 13, 3, n, 512, 512);
            try self.dispatch("activation", &.{ self.ref(3), self.ref(5), self.ref(12) }, .{ .n = n, .d = 512, .a = 1, .layer = @intCast(layer) }, (n * 512 + 127) / 128, 1);
            try self.mm(12, wi + 14, 4, n, 512, 512);
            try self.norm(4, wi + 15, 2, n, 3, wi + 16);
        }
        try self.norm(2, 3, 3, n, 0, 3);
        try self.dispatch("pool", &.{ self.ref(3), self.ref(13), self.ref(19), self.ref(20) }, .{ .count = c }, (c * 512 + 127) / 128, 1);
        try self.mm(13, 4, 14, c, 512, 768);
        try self.dispatch("l2", &.{self.ref(14)}, .{ .count = c }, (c * 32 + 127) / 128, 1);
        const ok = mh_finish(self.host.?, 1);
        finished = true;
        if (ok == 0) return error.Metal;
        const result: [*]const f32 = @ptrCast(@alignCast(mh_contents(self.buffers[14].?)));
        for (result[0 .. count * 768]) |v| if (!std.math.isFinite(v)) return -3;
        @memcpy(output[0 .. count * 768], result[0 .. count * 768]);
        return 0;
    }
};

fn initialize(path: [*:0]const u8) !*Model {
    const m = try std.heap.c_allocator.create(Model);
    m.* = .{};
    errdefer {
        m.release();
        std.heap.c_allocator.destroy(m);
    }
    const fd = open(path, 0);
    if (fd < 0) return error.File;
    defer _ = close(fd);
    const size = lseek(fd, 0, 2);
    if (size < 16384) return error.Format;
    const mapped = mmap(null, @intCast(size), 1, 2, fd, 0);
    if (mapped == null or @intFromPtr(mapped.?) == std.math.maxInt(usize)) return error.Mapping;
    m.mapping = mapped;
    m.bytes = @intCast(size);
    const bytes: [*]const u8 = @ptrCast(mapped.?);
    const head: [*]align(1) const u64 = @ptrCast(bytes);
    if (!std.mem.eql(u8, bytes[0..8], "IBMOJO01") or head[1] != 413 or head[2] != m.bytes) return error.Format;
    const table: [*]align(1) const Table = @ptrCast(bytes + 32);
    var next: u64 = 16384;
    for (0..413) |i| {
        var k: u64 = 512;
        var d: u64 = 1;
        if (i == 0) d = 262144 else if (i == 1) d = 12288 else if (i == 4) d = 768 else if (i >= 5) {
            const layer = (i - 5) / 17;
            const field = (i - 5) % 17;
            const h: u64 = if (layer % 6 == 5) 512 else 256;
            switch (field) {
                1 => d = 4 * h,
                2, 3, 13, 14 => d = 512,
                4 => {
                    k = 4 * h;
                    d = 512;
                },
                5, 6 => k = h,
                9, 10 => d = 2048,
                11 => {
                    k = 2048;
                    d = 512;
                },
                16 => k = 1,
                else => {},
            }
        }
        const t = table[i];
        if (t.k != k or t.d != d or t.count != k * d or t.offset != next or t.offset > m.bytes or t.count > (m.bytes - t.offset) / 4) return error.Format;
        m.table[i] = t;
        next += t.count * 4;
    }
    if (next != m.bytes) return error.Format;
    m.host = mh_create(@embedFile("kernels.metal") ++ "\x00") orelse return error.Metal;
    m.buffers[0] = mh_buffer(m.host.?, m.bytes) orelse return error.Memory;
    @memcpy(mh_contents(m.buffers[0].?)[0..m.bytes], bytes[0..m.bytes]);
    m.buffers[1] = mh_buffer(m.host.?, m.bytes / 2) orelse return error.Memory;
    const src: [*]const f32 = @ptrCast(@alignCast(bytes));
    const dst: [*]f16 = @ptrCast(@alignCast(mh_contents(m.buffers[1].?)));
    for (4096..m.bytes / 4) |i| {
        if (!std.math.isFinite(src[i])) return error.Format;
        dst[i] = @floatCast(src[i]);
    }
    return m;
}
export fn ib_mojo_gpu_init(path: ?[*:0]const u8) ?*Model {
    return initialize(path orelse return null) catch null;
}
export fn ib_mojo_gpu_free(m: ?*Model) void {
    if (m) |p| {
        p.release();
        std.heap.c_allocator.destroy(p);
    }
}
export fn ib_mojo_gpu_embed_batch(m: ?*Model, ids: ?[*]const i32, lengths: ?[*]const i32, count: usize, out: ?[*]f32) i32 {
    if (m == null or ids == null or lengths == null or out == null or count < 1 or count > 100) return -1;
    return m.?.run(ids.?, lengths.?, count, out.?) catch -4;
}
export fn ib_mojo_gpu_embed(m: ?*Model, ids: ?[*]const i32, n: usize, out: ?[*]f32) i32 {
    if (m == null or ids == null or out == null or n < 1 or n > 2048) return -1;
    const len: i32 = @intCast(n);
    return ib_mojo_gpu_embed_batch(m, ids, @ptrCast(&len), 1, out);
}
export fn ib_zig_dispatch_count(m: *Model) u32 {
    return mh_dispatch_count(m.host.?);
}

export fn ib_engine_init(path: ?[*:0]const u8) ?*Model {
    return ib_mojo_gpu_init(path);
}
export fn ib_engine_free(m: ?*Model) void {
    ib_mojo_gpu_free(m);
}
export fn ib_engine_embed(m: ?*Model, ids: ?[*]const i32, n: usize, out: ?[*]f32) i32 {
    return ib_mojo_gpu_embed(m, ids, n, out);
}
export fn ib_engine_embed_batch(m: ?*Model, ids: ?[*]const i32, lens: ?[*]const usize, count: usize, out: ?[*]f32) i32 {
    if (lens == null or count < 1 or count > 100) return -1;
    var lengths: [100]i32 = undefined;
    for (lens.?[0..count], 0..) |len, i| {
        if (len < 1 or len > 2048) return -1;
        lengths[i] = @intCast(len);
    }
    return ib_mojo_gpu_embed_batch(m, ids, &lengths, count, out);
}
export fn ib_engine_stats(m: ?*Model, buffers: ?*u32, dispatches: ?*u32) i32 {
    if (m == null or buffers == null or dispatches == null) return -1;
    dispatches.?.* = mh_dispatch_count(m.?.host.?);
    buffers.?.* = mh_command_count(m.?.host.?);
    return 0;
}
extern fn mh_command_count(*anyopaque) u32;
extern fn mh_split_enabled() u32;
export fn ib_engine_name() [*:0]const u8 {
    return if (mh_split_enabled() != 0) "zig-c-msl-fp16-split" else "zig-c-msl-fp16-singlecb";
}
