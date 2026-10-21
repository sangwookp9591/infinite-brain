// SPDX-License-Identifier: Apache-2.0
// Reuse the common ABI boundary; only the isolated process's experiment levels differ.
#define ib_engine_init e0_shared_init
#define ib_engine_name e0_shared_name
#include "../engine-lab/harness/mojo_adapter.c"
#undef ib_engine_init
#undef ib_engine_name

#ifndef E0_SYNC
#define E0_SYNC 0
#endif
#ifndef E0_PREPARE
#define E0_PREPARE 0
#endif
#ifndef E0_CAP
#define E0_CAP 0
#endif
#ifndef E0_NAME
#define E0_NAME "mojo-gpu-fp16-base"
#endif
#define E0_TEXT_(x) #x
#define E0_TEXT(x) E0_TEXT_(x)

void *ib_engine_init(const char *model) {
    if (setenv("IB_MOJO_SYNC_LAYERS", E0_TEXT(E0_SYNC), 1) ||
        setenv("IB_MOJO_FUSE_PREPARE", E0_TEXT(E0_PREPARE), 1)) return NULL;
#if E0_CAP
    if (setenv("MODULAR_METAL_MAX_OPS_PER_COMMAND_BUFFER", E0_TEXT(E0_CAP), 1)) return NULL;
#else
    if (unsetenv("MODULAR_METAL_MAX_OPS_PER_COMMAND_BUFFER")) return NULL;
#endif
    return e0_shared_init(model);
}
const char *ib_engine_name(void) { return E0_NAME; }
