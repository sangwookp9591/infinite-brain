# SPDX-License-Identifier: Apache-2.0
"""One bounded GPU slot, after coordinator scheduling; no full measurement sweeps."""
import json
import os
from pathlib import Path
import subprocess
import sys

here = Path(__file__).resolve().parent
assert Path('/private/tmp/ib-gpu-bench.lock').is_dir()
reference = sys.argv[1]
commands = [
    ('native-all', [sys.executable, here / 'smoke.py', reference], {'IB_COREML_COMPUTE_UNITS': 'ALL'}),
    ('native-shapes-gpu', [sys.executable, here / 'shape_check.py'], {'IB_COREML_COMPUTE_UNITS': 'CPU_AND_GPU'}),
    ('static82', [sys.executable, here / 'static_diagnostic.py', reference], {}),
]
results = []
for name, argv, changes in commands:
    with (here / f'evidence/{name}.log').open('w') as log:
        outcome = subprocess.run(list(map(str, argv)), cwd=here, env=dict(os.environ, **changes),
                                 stdout=log, stderr=subprocess.STDOUT, check=False)
    results.append({'diagnostic': name, 'returncode': outcome.returncode})
    print(name, outcome.returncode, flush=True)
(here / 'evidence/short-diagnostics-status.json').write_text(json.dumps(results, indent=2))
