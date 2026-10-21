// SPDX-License-Identifier: Apache-2.0
#include "go_bridge.h"
#include <dlfcn.h>
#include <stdlib.h>

typedef void *(*init_fn)(const char *);
typedef int32_t (*embed_fn)(void *, const int32_t *, size_t, float *);
typedef int32_t (*batch_fn)(void *, const int32_t *, const int32_t *, size_t, float *);
typedef void (*free_fn)(void *);
typedef struct { uintptr_t id; } go_handle;

static void *lib_handle;
static init_fn engine_init;
static embed_fn engine_embed;
static batch_fn engine_batch;
static free_fn engine_free;

int load_engine(const char *path) {
    if (!path || !*path) return -1;
    if (lib_handle) return 0;
    void *lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!lib) return -1;
    init_fn init = (init_fn)dlsym(lib, "ib_mojo_gpu_init");
    embed_fn single = (embed_fn)dlsym(lib, "ib_mojo_gpu_embed");
    batch_fn batch = (batch_fn)dlsym(lib, "ib_mojo_gpu_embed_batch");
    free_fn release = (free_fn)dlsym(lib, "ib_mojo_gpu_free");
    if (!init || !single || !batch || !release) { dlclose(lib); return -2; }
    lib_handle = lib;
    engine_init = init;
    engine_embed = single;
    engine_batch = batch;
    engine_free = release;
    return 0;
}

void *new_engine(const char *path) { return engine_init ? engine_init(path) : NULL; }
int32_t embed(void *h, const int32_t *ids, size_t n, float *out) {
    return engine_embed(h, ids, n, out);
}
int32_t embed_batch(void *h, const int32_t *ids, const int32_t *lens,
                    size_t n, float *out) {
    return engine_batch(h, ids, lens, n, out);
}
void free_engine(void *h) { if (engine_free && h) engine_free(h); }
int noop(void) { return 1; }
void *go_handle_new(uintptr_t id) {
    go_handle *h = malloc(sizeof(*h));
    if (h) h->id = id;
    return h;
}
uintptr_t go_handle_id(void *value) { return value ? ((go_handle *)value)->id : 0; }
void go_handle_free(void *value) { free(value); }
const char *go_engine_name(void) { return "go-cgo-mojo-fp16"; }
