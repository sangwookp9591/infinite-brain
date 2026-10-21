# SPDX-License-Identifier: Apache-2.0
"""Small deterministic checks for statistical direction, correction and ABI batch conversion."""
import ctypes as c
from pathlib import Path
import subprocess
import tempfile
import numpy as np
from analyze import bootstrap, cliffs, holm, validate_run
import csv
import json

HERE=Path(__file__).resolve().parent
baseline=c.CDLL(str(HERE/"target/release/libib_llama.dylib"))
baseline.ib_engine_name.restype=c.c_char_p
assert baseline.ib_engine_name()==b"llama-cpp-q8-metal"
assert cliffs([1,2],[3,4]) == -1
assert cliffs([1,2],[1,2]) == 0
assert np.allclose(holm([.01,.04,.03]),[.03,.06,.06])
assert bootstrap([2,2,2,2,2]) == [2,2]
assert bootstrap([1,2,3,4,5]) == bootstrap([1,2,3,4,5])

# Complete planned process/scenario accounting, including separate neighboring baseline pairs.
with tempfile.TemporaryDirectory(dir=HERE/'build') as temp:
    out=Path(temp);base='/base.dylib';b='/b.dylib';d='/d.dylib'
    config={'smoke':True,'processes':1,'calls':1,'engines':[base,b,d],'baseline':base,'models':{p:'/model' for p in [base,b,d]}}
    order=[]
    header=['engine','process','scenario','batch_size','qps','iteration','service_ms','latency_ms','throughput','command_buffers','dispatches']
    conditions=[('SingleStream',1,0.)]+[('Offline',n,0.) for n in [1,4,8,16,32,64,100]]+[('Server',1,q) for q in [5.,10.,20.,30.,40.,50.,60.,80.,100.]]
    for slot,(library,pair) in enumerate([(base,b),(b,b),(base,d),(d,d)]):
        stem=f'engine-{config["engines"].index(library)}-p0-slot{slot}'
        prefix=out/stem;order.append({'process':0,'slot':slot,'library':library,'pair':pair,'prefix':str(prefix)})
        meta={'model_sha256':'a'*64,'library_sha256':'b'*64,'reference_sha256':'c'*64,'engine':library,'library':library,'model':'/model','calls':1,'process':0,'gate_passed':True,'finished_unix_s':1.,'accuracy':[{'cosine':1.,'max_abs_diff':0.}]*20,'mixed_batch_accuracy':[{'cosine':1.,'max_abs_diff':0.}]*20}
        prefix.with_suffix('.json').write_text(json.dumps(meta))
        with prefix.with_suffix('.csv').open('w') as stream:
            writer=csv.writer(stream);writer.writerow(header)
            for scenario,batch,qps in conditions:writer.writerow([library,0,scenario,batch,qps,0,1.,1.,1000.,'',''])
    (out/'order.json').write_text(json.dumps(order))
    records=validate_run(out,config)
    assert len(records)==4
    assert sorted(meta['pair'] for meta,data in records if meta['library']==base)==[b,d]
    last=Path(order[-1]['prefix']).with_suffix('.csv')
    lines=last.read_text().splitlines();last.write_text('\n'.join(lines[:-1])+'\n')
    try:validate_run(out,config)
    except RuntimeError:pass
    else:raise AssertionError('Incomplete raw scenario was accepted')
    last.write_text('\n'.join(lines)+'\n')
    first=Path(order[0]['prefix']).with_suffix('.json')
    meta=json.loads(first.read_text());meta['accuracy'][0]['cosine']=float('nan');first.write_text(json.dumps(meta))
    try:validate_run(out,config)
    except RuntimeError:pass
    else:raise AssertionError('Nonfinite gate was accepted')

# A fake old Mojo ABI catches accidental size_t/int32 length forwarding across the adapter.
source=r'''
// SPDX-License-Identifier: Apache-2.0
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
void *ib_mojo_gpu_init(const char *p) { return p ? malloc(1) : NULL; }
int ib_mojo_gpu_embed(void *e,const int32_t *t,size_t n,float *o) { if(!e||!t||!o||!n)return -1; o[0]=(float)n; return 0; }
int ib_mojo_gpu_embed_batch(void *e,const int32_t *t,const int32_t *lens,size_t n,float *o) {
 if(!e||!t||!lens||!o)return -1;
 for(size_t i=0;i<n;i++)o[i*768]=(float)lens[i];return 0;
}
void ib_mojo_gpu_free(void *e) { free(e); }
'''
with tempfile.TemporaryDirectory(dir=HERE/'build') as temp:
    tmp=Path(temp)
    (tmp/'fake.c').write_text(source)
    subprocess.run(['clang','-dynamiclib',str(tmp/'fake.c'),'-o',str(tmp/'fake.dylib')],check=True)
    import os
    os.environ['IB_MOJO_LIBRARY']=str(tmp/'fake.dylib')
    lib=c.CDLL(str(HERE/'build/libib_mojo.dylib'))
    lib.ib_engine_init.argtypes=[c.c_char_p];lib.ib_engine_init.restype=c.c_void_p
    lib.ib_engine_embed_batch.argtypes=[c.c_void_p,c.POINTER(c.c_int32),c.POINTER(c.c_size_t),c.c_size_t,c.POINTER(c.c_float)]
    lib.ib_engine_free.argtypes=[c.c_void_p]
    handle=lib.ib_engine_init(b'fake')
    assert handle
    tokens=(c.c_int32*14)(*range(14));lens=(c.c_size_t*3)(2,5,7);out=(c.c_float*(768*3))()
    assert lib.ib_engine_embed_batch(handle,tokens,lens,3,out)==0
    assert [out[i*768] for i in range(3)]==[2.,5.,7.]
    assert lib.ib_engine_embed_batch(handle,tokens,lens,101,out)==-1
    lens[1]=2049
    assert lib.ib_engine_embed_batch(handle,tokens,lens,3,out)==-1
    assert lib.ib_engine_embed_batch(None,tokens,lens,3,out)==-1
    lib.ib_engine_free(handle)
print('PASS: dylib loading, bootstrap, Holm, Cliff delta, complete-study accounting, paired baselines, nonfinite exclusion, checked Mojo size_t/int32 batch conversion')
