// SPDX-License-Identifier: Apache-2.0
#ifndef GO_BRIDGE_H
#define GO_BRIDGE_H
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <dlfcn.h>
int load_engine(const char *path);
void *new_engine(const char *path);
int32_t embed(void *handle, const int32_t *ids, size_t n, float *out);
int32_t embed_batch(void *handle, const int32_t *ids, const int32_t *lens,
                    size_t n, float *out);
void free_engine(void *handle);
int noop(void);
void *go_handle_new(uintptr_t id);
uintptr_t go_handle_id(void *handle);
void go_handle_free(void *handle);
const char *go_engine_name(void);
#endif
