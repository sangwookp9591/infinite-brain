#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
set -eu
cd "$(dirname "$0")"
mkdir -p build
SDK=$(xcrun --sdk macosx --show-sdk-path)
clang -O3 -isysroot "$SDK" -mmacosx-version-min=14.0 -c metal.m -o build/metal.o
zig fmt engine.zig
zig build-obj engine.zig -O ReleaseSafe -lc -fPIC -target aarch64-macos.14.0 -femit-bin=build/engine.o
clang -dynamiclib -mmacosx-version-min=14.0 build/engine.o build/metal.o -framework Foundation -framework Metal -o build/libib_zig.dylib
libtool -static -o build/libib_zig.a build/engine.o build/metal.o
clang -O3 -isysroot "$SDK" -mmacosx-version-min=14.0 -DIB_SPLIT_DEFAULT=1 -c metal.m -o build/metal-split.o
clang -dynamiclib -mmacosx-version-min=14.0 build/engine.o build/metal-split.o -framework Foundation -framework Metal -o build/libib_zig_split.dylib
