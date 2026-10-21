# SPDX-License-Identifier: Apache-2.0
import argparse
import json
import shutil
from pathlib import Path
import time
import coremltools as ct

p = argparse.ArgumentParser()
p.add_argument('--directory', type=Path, default=Path(__file__).resolve().parent / 'artifacts')
here = p.parse_args().directory.resolve()
started = time.perf_counter()
compiled = Path(ct.models.utils.compile_model(str(here / 'encoder.mlpackage')))
target = here / 'encoder.mlmodelc'
if target.exists():
    shutil.rmtree(target)  # Generated model only; compile succeeded before replacing the previous result.
shutil.move(str(compiled), target)
assert (target / 'model.mil').is_file() and (target / 'coremldata.bin').is_file()
assert not any(p.is_dir() and p.suffix == '.mlmodelc' for p in target.iterdir())
result = {'compile_seconds': time.perf_counter() - started,
          'compiled_bytes': sum(x.stat().st_size for x in (here / 'encoder.mlmodelc').rglob('*') if x.is_file())}
(here / 'compile.json').write_text(json.dumps(result, indent=2))
print(result)
