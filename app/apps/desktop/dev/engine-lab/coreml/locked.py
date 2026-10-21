# SPDX-License-Identifier: Apache-2.0
"""Serialize a measurement command with the engine-lab's shared mkdir lock."""
import os
from pathlib import Path
import subprocess
import sys
import time

lock = Path('/private/tmp/ib-gpu-bench.lock')
while True:
    try:
        lock.mkdir()
        break
    except FileExistsError:
        time.sleep(5)
try:
    print(f'acquired GPU lock pid={os.getpid()}', flush=True)
    status = subprocess.run(sys.argv[1:], check=False).returncode
finally:
    lock.rmdir()
sys.exit(status)
