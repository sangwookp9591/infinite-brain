# SPDX-License-Identifier: Apache-2.0
"""Build-free orchestration. GPU work is serialized; measurement loops live in Rust."""
import contextlib
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
LOCK = Path('/private/tmp/ib-gpu-bench.lock')

@contextlib.contextmanager
def gpu_lock():
    while True:
        try:
            LOCK.mkdir()
            break
        except FileExistsError:
            time.sleep(0.5)
    try:
        yield
    finally:
        LOCK.rmdir()

def run(argv, log=None, env=None):
    print(' '.join(map(str, argv)), flush=True)
    if log:
        with open(log, 'w') as stream:
            subprocess.run(list(map(str, argv)), check=True, stdout=stream, stderr=subprocess.STDOUT, env=env)
    else:
        subprocess.run(list(map(str, argv)), check=True, env=env)

def check_artifacts(artifacts):
    for filename,expected in artifacts.items():
        with open(filename,'rb') as source:
            actual=hashlib.file_digest(source,'sha256').hexdigest()
        if actual!=expected:
            raise RuntimeError(f'Frozen artifact changed: {filename}')


def validate_reference(out):
    prior_path=Path(os.getenv('IB_REFERENCE_CHECK','/private/tmp/ib-mojo-opt/q8-gate.json'))
    if not prior_path.exists():
        result={'available':False,'reason':'Independent previous reference unavailable'}
    else:
        previous=json.loads(prior_path.read_text())
        current=json.loads((out/'reference.json').read_text())
        assert len(previous['rows'])==len(current['rows'])==20
        checks=[]
        for old,new in zip(previous['rows'],current['rows']):
            assert old['ids']==new['ids'] and old['text']==new['text']
            a,b=old['vector'],new['vector']
            assert len(a)==len(b)==768 and all(math.isfinite(x) for x in a+b)
            cosine=sum(x*y for x,y in zip(a,b))/math.sqrt(sum(x*x for x in a)*sum(y*y for y in b))
            error=max(abs(x-y) for x,y in zip(a,b))
            assert cosine>=.99999, f'Independent oracle mismatch: {cosine}'
            checks.append({'cosine':cosine,'max_abs_diff':error})
        result={'available':True,'path':str(prior_path),'sha256':hashlib.sha256(prior_path.read_bytes()).hexdigest(),'cases':checks,
                'previous_single_ms':previous.get('median_ms'),'previous_batches':previous.get('batch_100')}
    (out/'reference-validation.json').write_text(json.dumps(result,indent=2))


def main():
    os.chdir(HERE)
    smoke = os.getenv('IB_LAB_SMOKE') == '1'
    processes, calls = (1, 1) if smoke else (5, 30)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    out = Path(os.getenv('IB_RESULTS_DIR', str(HERE / 'results' / (stamp + ('-smoke' if smoke else ''))))).resolve()
    out.mkdir(parents=True, exist_ok=False)
    q8 = Path(os.getenv('IB_Q8_MODEL', str(Path.home() / '.cache/infinite-brain-b0/models/embeddinggemma-2-Q8_0.gguf'))).resolve()
    mojo = Path(os.getenv('IB_MOJO_MODEL', '/private/tmp/ib-mojo-spike/weights.bin')).resolve()
    os.environ.setdefault('IB_MOJO_LIBRARY', '/private/tmp/ib-mojo-opt/optimized-final.dylib')
    baseline = (HERE / 'target/release/libib_llama.dylib').resolve()
    candidates = list(dict.fromkeys(Path(p).resolve() for p in sys.argv[1:]))
    candidates = [p for p in candidates if p != baseline]
    engines = [baseline] + candidates
    overrides = json.loads(os.getenv('IB_ENGINE_MODELS', '{}'))
    models = {str(p): str(Path(overrides.get(str(p), mojo if p.name == 'libib_mojo.dylib' else q8)).resolve()) for p in engines}
    factors={str(baseline):{'kernel':'MSL','host':'llama.cpp','precision':'Q8_0','submission':'coalesced'}}
    mojo_adapter=(HERE/'build/libib_mojo.dylib').resolve()
    if mojo_adapter in engines:
        factors[str(mojo_adapter)]={'kernel':'Mojo','host':'DeviceContext','precision':'FP16','submission':'per-operation'}
    factors.update(json.loads(os.getenv('IB_ENGINE_FACTORS','{}')))
    artifacts=json.loads(os.getenv('IB_EXTRA_ARTIFACTS','{}'))
    check_artifacts(artifacts)
    config = {'extra_artifacts':artifacts,'backend_env':{'E1_OUT':os.getenv('E1_OUT')},'smoke': smoke, 'processes': processes, 'calls': calls, 'warmup': 10, 'bootstrap': 10000,
              'baseline': str(baseline), 'factors':factors, 'engines': list(map(str, engines)), 'models': models,
              'llama_cpp_rs_rev': 'cb98c630d0fec934a8a379db4fd63cd3622f6984',
              'mojo_library': os.environ['IB_MOJO_LIBRARY'],
              'mojo_library_sha256': hashlib.file_digest(open(os.environ['IB_MOJO_LIBRARY'],'rb'),'sha256').hexdigest() if (HERE/'build/libib_mojo.dylib').resolve() in engines else None,
              'source_sha256': {name:hashlib.sha256((HERE/name).read_bytes()).hexdigest() for name in ['ib_engine.h','runner.rs','llama_adapter.rs','mojo_adapter.c','microbench.mm','pipeline.py','analyze.py','Cargo.lock','Cargo.toml','requirements.txt','run.sh','thermal.m']},
              'methodology_sha256':hashlib.sha256((HERE/'../../../../../../docs/reports/ENGINE-LAB-METHODOLOGY.md').read_bytes()).hexdigest(),
              'inputs_sha256': hashlib.sha256((HERE/'../../mojo-engine/inputs.json').read_bytes()).hexdigest()}
    (out/'config.json').write_text(json.dumps(config, indent=2))
    with gpu_lock():
        run([HERE/'target/release/oracle', q8, HERE/'../../mojo-engine/inputs.json', out/'reference.json'], out/'oracle.log')
        validate_reference(out)
        run([HERE/'build/microbench', out/'microbench.csv'], out/'microbench.log')
    # Freeze predictions before the first engine timing; coefficients are never fitted to these timings.
    run([HERE/'.venv/bin/python', HERE/'analyze.py', '--predict', out])
    order=[]
    for process in range(processes):
        sequence=[]
        for candidate in candidates:
            sequence += [(baseline,candidate),(candidate,candidate)]
        if not candidates:
            sequence=[(baseline,baseline)]
        for slot,(library,pair) in enumerate(sequence):
            prefix=out/f'engine-{engines.index(library)}-p{process}-slot{slot}'
            order.append({'process':process,'slot':slot,'library':str(library),'pair':str(pair),'prefix':str(prefix)})
    # Save the entire plan up front: interrupted data can never masquerade as a complete study.
    (out/'order.json').write_text(json.dumps(order,indent=2))
    for item in order:
        library=item['library'];prefix=Path(item['prefix'])
        check_artifacts(artifacts)
        child_env=os.environ.copy();child_env['IB_ENGINE_FACTORS']=json.dumps(factors.get(library,{}))
        if config['mojo_library_sha256'] is not None:
            with open(config['mojo_library'],'rb') as source:
                assert hashlib.file_digest(source,'sha256').hexdigest()==config['mojo_library_sha256'], 'Mojo artifact changed during study'
        run([HERE/'target/release/runner',library,models[library],out/'reference.json',prefix,item['process'],calls],prefix.with_suffix('.log'),env=child_env)
        check_artifacts(artifacts)
    run([HERE/'.venv/bin/python',HERE/'analyze.py',out])
    print(f'Results: {out}',flush=True)

if __name__=='__main__':
    main()
