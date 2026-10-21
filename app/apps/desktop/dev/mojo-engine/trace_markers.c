// SPDX-License-Identifier: Apache-2.0
#include <os/signpost.h>
#include <stdint.h>

void ib_trace_mark(uint64_t id, int begin) {
    static os_log_t log;
    if (!log) log = os_log_create("dev.infinitebrain.mojo-opt", OS_LOG_CATEGORY_POINTS_OF_INTEREST);
    if (begin) os_signpost_interval_begin(log, id, "Paragraph");
    else os_signpost_interval_end(log, id, "Paragraph");
}
