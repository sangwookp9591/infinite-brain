# SPDX-License-Identifier: Apache-2.0
"""Calibration of this MSL tile and streaming copy; caller must hold the GPU lock."""
import ctypes as c
import json
import statistics
import sys
from pathlib import Path
import numpy as np

lib = c.CDLL(str(Path('build/libib_zig.dylib').resolve()))
lib.mh_create.argtypes = [c.c_char_p]; lib.mh_create.restype = c.c_void_p
lib.mh_buffer.argtypes = [c.c_void_p,c.c_size_t];lib.mh_buffer.restype = c.c_void_p
lib.mh_contents.argtypes = [c.c_void_p];lib.mh_contents.restype = c.c_void_p
lib.mh_begin.argtypes = [c.c_void_p]
lib.mh_finish.argtypes = [c.c_void_p,c.c_int]
lib.mh_dispatch.argtypes = [c.c_void_p,c.c_char_p,c.POINTER(c.c_void_p),c.POINTER(c.c_size_t),c.c_uint,c.POINTER(c.c_uint),c.c_uint,c.c_uint,c.c_uint]
lib.mh_gpu_seconds.argtypes = [c.c_void_p];lib.mh_gpu_seconds.restype = c.c_double
lib.mh_free.argtypes=[c.c_void_p];lib.mh_release.argtypes=[c.c_void_p]
h=lib.mh_create(Path('kernels.metal').read_bytes());assert h
result={}
try:
    for name,n,k,d,sizes,metric in [
        ('stream_copy',16*1024*1024,0,0,[64*1024*1024]*2,128*1024*1024),
        ('mm',1024,1024,1024,[1024*1024*4,1024*1024*2,1024*1024*4],2*1024**3),
        ('mm_skinny',82,512,2048,[82*512*4,2048*512*2,82*2048*4],2*82*512*2048),
    ]:
        bs=[lib.mh_buffer(h,s) for s in sizes];assert all(bs)
        try:
            for i,b in enumerate(bs):
                dtype=np.float16 if name!='stream_copy' and i==1 else np.float32
                arr=np.ctypeslib.as_array((c.c_uint8*sizes[i]).from_address(lib.mh_contents(b))).view(dtype)
                arr.fill(.02 if i==1 else .01)
            params=(c.c_uint*8)(n,k,d,0,0,0,0,0)
            times=[]
            for trial in range(20):
                assert lib.mh_begin(h)
                assert lib.mh_dispatch(h,b'mm' if name.startswith('mm') else name.encode(),(c.c_void_p*len(bs))(*bs),(c.c_size_t*len(bs))(),len(bs),params,(d+31)//32 if k else (n+127)//128,(n+31)//32 if k else 1,128)
                assert lib.mh_finish(h,1)
                if trial>=10:times.append(lib.mh_gpu_seconds(h))
            out=np.ctypeslib.as_array((c.c_float*(n*d if k else n)).from_address(lib.mh_contents(bs[-1])))
            assert np.isfinite(out).all()
            assert np.allclose(out,k*.01*.02 if k else .01,rtol=.002,atol=1e-5)
            seconds=statistics.median(times)
            result[name]={'gpu_seconds':times,'median_seconds':seconds,'bytes_or_flops':metric,'gb_per_s_or_gflops':metric/seconds/1e9}
        finally:
            for b in bs:lib.mh_release(b)
finally:lib.mh_free(h)
Path(sys.argv[1]).write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
