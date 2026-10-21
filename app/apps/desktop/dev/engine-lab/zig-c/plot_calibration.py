# SPDX-License-Identifier: Apache-2.0
"""Roofline from measured shared calibration and independently checked E3 MSL tiles."""
import csv
import json
from pathlib import Path
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

shared=Path(sys.argv[1]);local=Path(sys.argv[2]);out=Path(sys.argv[3])
with (shared/'microbench.csv').open() as f: rows=list(csv.DictReader(f))
bw=float(np.median([float(r['gb_s']) for r in rows if r['kind']=='copy']))
sizes=sorted({int(r['size']) for r in rows if r['kind']=='gemm'})
peak=max(float(np.median([float(r['tflops']) for r in rows if r['kind']=='gemm' and int(r['size'])==n])) for n in sizes)
cal=json.loads(local.read_text())
points=[]
for key,m,k,n in [('mm',1024,1024,1024),('mm_skinny',82,512,2048)]:
    flops=2*m*k*n;minimum_bytes=4*m*k+2*k*n+4*m*n
    intensity=flops/minimum_bytes;attained=cal[key]['gb_per_s_or_gflops']/1000
    ceiling=min(peak,bw*intensity/1000)
    points.append({'kernel':key,'intensity_flops_per_byte':intensity,'attained_tflops':attained,'roofline_tflops':ceiling,'attained_fraction':attained/ceiling})
out.parent.mkdir(exist_ok=True,parents=True)
with out.with_suffix('.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=points[0].keys());w.writeheader();w.writerows(points)
fig,ax=plt.subplots(figsize=(8,5));x=np.logspace(-1,4,200)
ax.loglog(x,np.minimum(bw*x/1000,peak),label=f'Measured blit/MPS envelope ({bw:.1f} GB/s, {peak:.2f} TFLOP/s)')
for p in points:
    ax.scatter(p['intensity_flops_per_byte'],p['attained_tflops'],s=65,label=f"E3 {p['kernel']}: {p['attained_tflops']:.3f} TFLOP/s")
ax.set(xlabel='Minimum compulsory arithmetic intensity (FLOP/byte)',ylabel='Attained TFLOP/s',title='E3 MSL calibration, not full-model latency')
ax.grid(alpha=.2);ax.legend(fontsize=8);fig.tight_layout();fig.savefig(out,dpi=160)
print(json.dumps({'bw_gb_s':bw,'mps_tflops':peak,'points':points},indent=2))
