# SPDX-License-Identifier: Apache-2.0
from std.memory import Pointer
from std.testing import assert_equal
from max.gpu.host import DeviceContext, DeviceGraph, DeviceGraphBuilder


def kernel(x: Pointer[Float32, MutAnyOrigin]):
    x.unsafe_store(0, Float32(7))


def main() raises:
    var ctx = DeviceContext()
    var buffer = ctx.enqueue_create_buffer[.float32](1)
    var p = buffer.unsafe_ptr()

    def build(mut builder: DeviceGraphBuilder) raises {imm}:
        var recording = builder.recording_context()
        recording.enqueue_function[kernel](p, grid_dim=1, block_dim=32)

    var graph = DeviceGraph.create(ctx, build)
    graph.replay()
    var value = Float32(0)
    buffer.enqueue_copy_to(Pointer(to=value))
    ctx.synchronize()
    assert_equal(value, Float32(7))
    print("graph pass")
