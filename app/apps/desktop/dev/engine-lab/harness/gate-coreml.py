# SPDX-License-Identifier: Apache-2.0
"""Bounded real C ABI gate for the coordinator's static82 Core ML handoff."""
import argparse
import ctypes as c
import datetime
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import numpy as np
from pipeline import gpu_lock

HERE=Path(__file__).resolve().parent
E4=HERE.parent/'coreml'

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def tree(path):
    files=[]
    for file in sorted(path.rglob('*')):
        if file.is_file():files.append({'path':str(file.relative_to(path)),'bytes':file.stat().st_size,'sha256':digest(file)})
    if not files:raise ValueError('empty model tree')
    upstream=hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    generic={'algorithm':'ib-model-tree-v1','files':[{'path':f['path'],'sha256':f['sha256']} for f in files]}
    generic_hash=hashlib.sha256(json.dumps(generic,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    return {'e4_canonical_file_list_sha256':upstream,'ib_model_tree_v1_sha256':generic_hash,'files':files,
            'e4_algorithm':'SHA256 of compact sort_keys JSON file list including relative path, bytes and SHA256',
            'generic_algorithm':'ib-model-tree-v1 (distinct from E4 file-list fingerprint)'}

def vector_check(v,expected):
    v=np.asarray(v,dtype=np.float64);expected=np.asarray(expected,dtype=np.float64)
    assert v.shape==expected.shape==(768,) and np.isfinite(v).all() and np.isfinite(expected).all()
    norm=float(np.linalg.norm(v));assert abs(norm-1)<1e-5
    cosine=float(v@expected/norm/np.linalg.norm(expected));assert np.isfinite(cosine) and cosine>=.999
    return cosine,norm

def child(reference,compiled,library,result):
    # Retain the delivered 20/mixed/100/growth/bounds gate; the static82 parent name keeps its 83-token checks active.
    assert compiled.parent.name=='static82'
    sys.argv=[str(E4/'smoke.py'),str(reference),'--compiled',str(compiled),'--library',str(library)]
    state=runpy.run_path(str(E4/'smoke.py'),run_name='__main__')
    assert len(state['cosines'])==len(state['mixed'])==20
    assert np.isfinite(state['cosines']+state['mixed']).all() and min(state['cosines']+state['mixed'])>=.999
    # Explicitly check every mixed vector's norm/finiteness, which a min(cosines) alone cannot establish.
    lib=state['lib'];handle=lib.ib_engine_init(str(compiled.resolve()).encode());assert handle
    try:
        rows=state['reference']['rows'];tokens=[t for row in rows for t in row['ids']]
        ids=(c.c_int32*len(tokens))(*tokens);lens=(c.c_size_t*20)(*(len(row['ids']) for row in rows));out=(c.c_float*(768*20))()
        assert lib.ib_engine_embed_batch(handle,ids,lens,20,out)==0
        checks=[vector_check(out[i*768:(i+1)*768],row['vector']) for i,row in enumerate(rows)]
        invalid=(c.c_int32*83)(*([rows[0]['ids'][0]]*83));long_lens=(c.c_size_t*1)(83)
        assert lib.ib_engine_embed(handle,invalid,83,out)==-1
        assert lib.ib_engine_embed_batch(handle,invalid,long_lens,1,out)==-1
    finally:lib.ib_engine_free(handle)
    record=state['record'];record.update({'passed':True,'mixed_all_finite_unit_norm':True,'mixed_norms':[n for _,n in checks],
                                        'explicit_83_token_single_batch_rejected':True,'timing_scope':'capability gate only; no performance inference'})
    result.write_text(json.dumps(record,indent=2))

def selfcheck():
    with tempfile.TemporaryDirectory(dir=HERE/'build') as tmp:
        a=Path(tmp)/'a';a.mkdir();(a/'weights').write_bytes(b'a');before=tree(a)
        b=Path(tmp)/'b';shutil.copytree(a,b);assert tree(b)==before
        (b/'weights').write_bytes(b'b');assert tree(b)['ib_model_tree_v1_sha256']!=before['ib_model_tree_v1_sha256']
    v=np.zeros(768);v[0]=1;vector_check(v,v)
    for bad in [v*2,np.full(768,np.nan),v[:1]]:
        try:vector_check(bad,v)
        except AssertionError:pass
        else:raise AssertionError('invalid vector accepted')
    print('PASS: model tree path independence/drift and finite unit vector validation')

def main():
    if sys.argv[1:]==['--selfcheck']:selfcheck();return
    p=argparse.ArgumentParser();p.add_argument('reference',type=Path);p.add_argument('--child',action='store_true')
    p.add_argument('--modes',type=Path,default=E4/'evidence/native-modes.json');p.add_argument('--compiled',type=Path);p.add_argument('--library',type=Path);p.add_argument('--result',type=Path)
    a=p.parse_args()
    if a.child:child(a.reference,a.compiled,a.library,a.result);return
    mode=next(m for m in json.loads(a.modes.read_text()) if m['mode']=='static82-ane')
    stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S');out=HERE/'results'/('e4-static82-native-'+stamp);out.mkdir()
    frozen=HERE/'build'/('frozen-e4-static82-'+stamp);(frozen/'static82').mkdir(parents=True)
    library=frozen/Path(mode['library']).name;shutil.copy2(mode['library'],library)
    compiled=frozen/'static82/encoder.mlmodelc';shutil.copytree(mode['model'],compiled,symlinks=False)
    identity=tree(compiled);assert identity['e4_canonical_file_list_sha256']==mode['model_manifest_sha256']
    assert digest(library)==mode['library_sha256'] and not any(x.is_symlink() for x in compiled.rglob('*'))
    (out/'identity.json').write_text(json.dumps({'mode':mode,'frozen_library':str(library),'frozen_model':str(compiled),'model_fingerprints':identity,
                                              'reference':str(a.reference.resolve()),'reference_sha256':digest(a.reference),'modes_manifest':str(a.modes.resolve()),'modes_sha256':digest(a.modes)},indent=2))
    import os
    env=os.environ.copy();env['IB_COREML_COMPUTE_UNITS']=mode['units']
    result=out/'gate.json';cmd=[sys.executable,str(Path(__file__).resolve()),str(a.reference.resolve()),'--child','--compiled',str(compiled),'--library',str(library),'--result',str(result)]
    with gpu_lock():
        with (out/'gate.log').open('w') as stream:
            try:
                proc=subprocess.run(cmd,stdout=stream,stderr=subprocess.STDOUT,env=env,timeout=300)
                status={'returncode':proc.returncode,'timed_out':False}
            except subprocess.TimeoutExpired:status={'returncode':None,'timed_out':True}
        status['library_unchanged']=digest(library)==mode['library_sha256']
        status['model_unchanged']=tree(compiled)==identity
    status['passed']=status['returncode']==0 and status['library_unchanged'] and status['model_unchanged'] and result.exists()
    (out/'status.json').write_text(json.dumps(status,indent=2));print(json.dumps({'output':str(out),**status}),flush=True)
    if not status['passed']:raise SystemExit(1)

if __name__=='__main__':main()
