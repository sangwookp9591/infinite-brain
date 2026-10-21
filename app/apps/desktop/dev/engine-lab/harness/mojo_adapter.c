// SPDX-License-Identifier: Apache-2.0
#include "ib_engine.h"
#include <dlfcn.h>
#include <limits.h>
#include <stdlib.h>

typedef struct {
    void *lib, *engine;
    int (*embed)(void *, const int32_t *, size_t, float *);
    int (*batch)(void *, const int32_t *, const int32_t *, size_t, float *);
    void (*free)(void *);
} Mojo;

void *ib_engine_init(const char *model) {
    const char *path = getenv("IB_MOJO_LIBRARY");
    if (!model || !path) return NULL;
    Mojo *m = calloc(1, sizeof(*m));
    if (!m) return NULL;
    m->lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!m->lib) { free(m); return NULL; }
    void *(*init)(const char *) = dlsym(m->lib, "ib_mojo_gpu_init");
    m->embed = dlsym(m->lib, "ib_mojo_gpu_embed");
    m->batch = dlsym(m->lib, "ib_mojo_gpu_embed_batch");
    m->free = dlsym(m->lib, "ib_mojo_gpu_free");
    if (!init || !m->embed || !m->free || !(m->engine = init(model))) {
        dlclose(m->lib); free(m); return NULL;
    }
    return m;
}
int ib_engine_embed(void *e, const int32_t *tokens, size_t n, float *out) {
    if (!e || !tokens || !out || n == 0 || n > 2048) return -1;
    Mojo *m = e;
    return m->embed(m->engine, tokens, n, out);
}
int ib_engine_embed_batch(void *e, const int32_t *tokens, const size_t *lens,
                          size_t nseq, float *out) {
    if (!e || !tokens || !lens || !out || !nseq || nseq > 100) return -1;
    int32_t lengths[100];
    size_t total = 0;
    for (size_t i = 0; i < nseq; ++i) {
        if (!lens[i] || lens[i] > 2048) return -1;
        lengths[i] = (int32_t)lens[i]; total += lens[i];
    }
    if (total > 16384) return -1;
    Mojo *m = e;
    if (m->batch) return m->batch(m->engine, tokens, lengths, nseq, out);
    for (size_t i = 0, offset = 0; i < nseq; offset += lens[i++]) {
        int rc = m->embed(m->engine, tokens + offset, lens[i], out + 768*i);
        if (rc) return rc;
    }
    return 0;
}
void ib_engine_free(void *e) {
    if (!e) return;
    Mojo *m = e;
    m->free(m->engine); dlclose(m->lib); free(m);
}
const char *ib_engine_name(void) { return "mojo-gpu-fp16"; }
