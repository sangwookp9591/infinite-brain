#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(cd "$HERE/../../../../../.." && pwd)
HARNESS="$ROOT/app/apps/desktop/dev/engine-lab/harness"
LIB="$HERE/build/libib_go.dylib"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ib-go-abi.XXXXXX")
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

cat > "$TMP/fake_mojo.c" <<'C'
// SPDX-License-Identifier: Apache-2.0
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
void *ib_mojo_gpu_init(const char *path) { return path ? malloc(1) : NULL; }
int32_t ib_mojo_gpu_embed(void *e, const int32_t *ids, size_t n, float *out) {
    if (!e || !ids || !n || !out) return -1;
    out[0] = (float)n; out[1] = (float)ids[0]; out[2] = (float)ids[n - 1];
    return 0;
}
int32_t ib_mojo_gpu_embed_batch(void *e, const int32_t *ids, const int32_t *lens,
                                size_t nseq, float *out) {
    if (!e || !ids || !lens || !nseq || !out) return -1;
    size_t offset = 0;
    for (size_t i = 0; i < nseq; ++i) {
        out[i * 768] = (float)lens[i];
        out[i * 768 + 1] = (float)ids[offset];
        out[i * 768 + 2] = (float)ids[offset + lens[i] - 1];
        offset += (size_t)lens[i];
    }
    return 0;
}
void ib_mojo_gpu_free(void *e) { free(e); }
C

cat > "$TMP/client.c" <<'C'
// SPDX-License-Identifier: Apache-2.0
#include "ib_engine.h"
#include <assert.h>
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
    assert(argc == 2);
    void *lib = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!lib) { fprintf(stderr, "%s\n", dlerror()); return 2; }
    void *(*init)(const char *) = dlsym(lib, "ib_engine_init");
    int (*embed)(void *, const int32_t *, size_t, float *) = dlsym(lib, "ib_engine_embed");
    int (*batch)(void *, const int32_t *, const size_t *, size_t, float *) = dlsym(lib, "ib_engine_embed_batch");
    void (*release)(void *) = dlsym(lib, "ib_engine_free");
    const char *(*name)(void) = dlsym(lib, "ib_engine_name");
    assert(init && embed && batch && release && name);
    assert(strcmp(name(), "go-cgo-mojo-fp16") == 0);
    void *e = init("fake-model"); assert(e);
    int32_t ids[] = {10, 11, 12}; float single[768] = {0};
    assert(embed(e, ids, 3, single) == 0);
    assert(single[0] == 3 && single[1] == 10 && single[2] == 12);
    int32_t packed[] = {1,2,3,4,5,6,7,8,9,10,11,12,13,14};
    size_t lens[] = {2,5,7}; float output[768 * 3] = {0};
    assert(batch(e, packed, lens, 3, output) == 0);
    assert(output[0] == 2 && output[1] == 1 && output[2] == 2);
    assert(output[768] == 5 && output[769] == 3 && output[770] == 7);
    assert(output[1536] == 7 && output[1537] == 8 && output[1538] == 14);
    assert(embed(e, ids, 0, single) < 0);
    size_t too_long[] = {2049};
    assert(batch(e, ids, too_long, 1, output) < 0);
    size_t too_many[] = {1};
    assert(batch(e, ids, too_many, 101, output) < 0);
    size_t over_capacity[9]; for (int i=0;i<9;i++) over_capacity[i]=2048;
    assert(batch(e, ids, over_capacity, 9, output) < 0);
    release(e);
    dlclose(lib);
    puts("PASS: common ib_engine init/name/single/batch/free, size_t lengths, and bounds (fake Mojo; CPU-only)");
}
C

clang -dynamiclib -O2 -Wall -Wextra "$TMP/fake_mojo.c" -o "$TMP/libfake_mojo.dylib"
clang -O2 -Wall -Wextra -I "$HARNESS" "$TMP/client.c" -o "$TMP/abi-client"
IB_MOJO_LIBRARY="$TMP/libfake_mojo.dylib" "$TMP/abi-client" "$LIB"
printf 'candidate=%s\nmodel=%s\n' "$LIB" /private/tmp/ib-mojo-spike/weights.bin
