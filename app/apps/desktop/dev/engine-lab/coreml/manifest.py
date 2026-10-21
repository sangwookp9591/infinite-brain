# SPDX-License-Identifier: Apache-2.0
"""Content hashes for a directory-valued Core ML model, independent of absolute paths."""
import hashlib
import json
from pathlib import Path

here = Path(__file__).resolve().parent
result = {}
for name in ('encoder.mlpackage', 'encoder.mlmodelc', 'static82/encoder.mlpackage', 'static82/encoder.mlmodelc'):
    directory = here / 'artifacts' / name
    files = []
    for path in sorted(directory.rglob('*')):
        if path.is_file():
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            files.append({'path': str(path.relative_to(directory)), 'bytes': path.stat().st_size, 'sha256': digest})
    assert files and sum(x['bytes'] for x in files) > 500_000_000
    canonical = json.dumps(files, sort_keys=True, separators=(',', ':')).encode()
    result[name] = {'manifest_sha256': hashlib.sha256(canonical).hexdigest(),
                    'bytes': sum(x['bytes'] for x in files), 'files': files}
(here / 'evidence').mkdir(exist_ok=True)
(here / 'evidence/model-manifest.json').write_text(json.dumps(result, indent=2))
print(json.dumps({k: {a: b for a, b in v.items() if a != 'files'} for k, v in result.items()}, indent=2))

modes = []
for mode, library, model, units, limit, policy in [
    ('enumerated-gpu', 'libib_coreml.dylib', 'encoder.mlmodelc', 'CPU_AND_GPU', 512, 'independent chunks of four'),
    ('static82-ane', 'libib_coreml_static82.dylib', 'static82/encoder.mlmodelc', 'CPU_AND_NE', 82, 'serial independent sequences'),
]:
    path = here / 'artifacts' / library
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    modes.append({'mode': mode, 'library': str(path), 'library_sha256': digest,
                  'model': str(here / 'artifacts' / model), 'units': units, 'max_tokens': limit,
                  'batch_policy': policy, 'model_manifest_sha256': result[model]['manifest_sha256']})
assert len(modes) == 2 and all(x['model_manifest_sha256'] for x in modes)
(here / 'evidence/native-modes.json').write_text(json.dumps(modes, indent=2))
