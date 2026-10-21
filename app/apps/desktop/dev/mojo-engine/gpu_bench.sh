#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Serialize timed GPU experiments with the engine-lab workers.
set -u
lock=/private/tmp/ib-gpu-bench.lock
until mkdir "$lock" 2>/dev/null; do sleep 5; done
trap 'rmdir "$lock"' EXIT
"$@"
