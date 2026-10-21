// SPDX-License-Identifier: Apache-2.0
#ifndef IB_ENGINE_H
#define IB_ENGINE_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// Synchronous, serialized calls; output is caller-owned, nonaliasing, 768*nseq floats.
// Inputs include BOS, positions restart for each sequence; pool and L2-normalize inside engine.
// Return 0 on success, negative on error; init returns NULL on failure.
void *ib_engine_init(const char *model_path);
int ib_engine_embed(void *e, const int32_t *tokens, size_t n, float *out);
// Optional: tokens concatenate lens[0..nseq]; absent means repeated single calls.
int ib_engine_embed_batch(void *e, const int32_t *tokens, const size_t *lens,
                          size_t nseq, float *out);
// Optional: counters for the last completed call; omit if unavailable (never invent counts).
int ib_engine_stats(void *e, uint32_t *command_buffers, uint32_t *dispatches);
void ib_engine_free(void *e);
const char *ib_engine_name(void);
#ifdef __cplusplus
}
#endif
#endif
