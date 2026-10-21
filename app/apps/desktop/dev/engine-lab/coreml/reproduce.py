# SPDX-License-Identifier: Apache-2.0
"""Regenerate E4 with the shared pipeline (IB_LAB_SMOKE=1 is explicitly nonfinal)."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys

here = Path(__file__).resolve().parent
harness = here.parent / 'harness'
python = here / '.venv/bin/python'


def run(argv, **kwargs):
    subprocess.run(list(map(str, argv)), cwd=here, check=True, **kwargs)


if __name__ == '__main__':
    if not (harness / 'target/release/runner').is_file():
        sys.exit('Shared harness is not built; build it according to harness/README.md first.')
    (here / 'artifacts').mkdir(exist_ok=True)
    reference = here / 'artifacts/q8-setup.json'
    run([python, here / 'locked.py', '/private/tmp/ib-mojo-spike/rust-target/release/reference',
         Path.home() / '.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf',
         here.parent.parent / 'mojo-engine/inputs.json', reference])
    run([python, here / 'convert.py', '--reference', reference])
    run([python, here / 'compile.py'])
    library = here / 'artifacts/libib_coreml.dylib'
    static_library = here / 'artifacts/libib_coreml_static82.dylib'
    for target in (library, static_library):
        run(['xcrun', 'clang++', '-std=c++17', '-O3', '-fobjc-arc', '-dynamiclib',
             '-mmacosx-version-min=15.0', '-framework', 'Foundation', '-framework', 'CoreML',
             here / 'engine.mm', '-o', target])
    (here / 'evidence').mkdir(exist_ok=True)
    for name in ('torch-check.json', 'conversion.json', 'compile.json'):
        shutil.copyfile(here / 'artifacts' / name, here / 'evidence' / name)
    run([python, here / 'convert.py', '--reference', reference, '--static-length', '82',
         '--output', here / 'artifacts/static82/encoder.mlpackage'])
    run([python, here / 'compile.py', '--directory', here / 'artifacts/static82'])
    run([python, here / 'manifest.py'])
    run([python, here / 'shape_check.py', '--prepare', '--reference', reference])
    run([python, here / 'locked.py', python, here / 'short_diagnostics.py', reference])
    failures = []
    modes = [(unit, library, here / 'artifacts/encoder.mlmodelc', unit) for unit in ('CPU_AND_NE', 'CPU_AND_GPU', 'ALL')]
    modes.append(('static82-ane', static_library, here / 'artifacts/static82/encoder.mlmodelc', 'CPU_AND_NE'))
    for mode, candidate, model, unit in modes:
        env = dict(os.environ, IB_COREML_COMPUTE_UNITS=unit,
            IB_ENGINE_MODELS=json.dumps({str(candidate): str(model)}),
            IB_RESULTS_DIR=str(here / 'results' / mode))
        try:
            with (here / f'evidence/preflight-{mode}.log').open('w') as log:
                run([python, here / 'locked.py', python, here / 'smoke.py', reference, '--compiled', model, '--library', candidate], env=env, stdout=log, stderr=subprocess.STDOUT)
            run([harness / '.venv/bin/python', harness / 'pipeline.py', candidate], env=env)
        except subprocess.CalledProcessError as error:
            failures.append({'mode': mode, 'units': unit, 'returncode': error.returncode, 'command': list(map(str, error.cmd))})
    run([python, here / 'locked.py', python, here / 'plan.py'])
    (here / 'evidence/reproduction-failures.json').write_text(json.dumps(failures, indent=2))
    sys.exit(1 if failures else 0)
