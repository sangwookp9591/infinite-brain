# SPDX-License-Identifier: Apache-2.0
"""Record analytic work and memory estimates before full-model timing."""
import csv,json,math,sys
from pathlib import Path
n=82
table=json.load(open('/private/tmp/ib-mojo-spike/weights.bin.json'))['tensors']
rows=[]
for i,t in enumerate(table):
    name=t['name'];k,d=t['shape']
    if i==0 or d==1:continue
    m=1 if i==4 else n
    rows.append({'kernel':name,'m':m,'k':k,'n':d,
                 'flops':2*m*k*d,
                 'minimum_bytes':2*k*d+4*m*(k+d),
                 'tile_load_store_bytes':4*m*k*math.ceil(d/32)+2*k*d*math.ceil(m/32)+4*m*d})
root=Path(sys.argv[1]);root.mkdir(exist_ok=True)
with (root/'analytic-kernels.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
flops=sum(r['flops'] for r in rows);traffic=sum(r['minimum_bytes'] for r in rows)
result={'tokens':n,'command_buffers':1,'dispatches':367,'gemm_flops':flops,'gemm_minimum_bytes':traffic,
        'gemm_arithmetic_intensity':flops/traffic,'submission_break_even_us':(23.57-17.34)*1000/424,
        'tile_load_store_bytes':sum(r['tile_load_store_bytes'] for r in rows),
        'amdahl_required_submission_fraction':1-17.34/23.57,
        'note':'Minimum compulsory GEMM traffic; excludes cache rereads, attention, norms and host.'}
if (root/'calibration.json').exists():
    c=json.loads((root/'calibration.json').read_text())
    result['calibrated_gemm_only_estimate_ms']=max(flops/(c['mm']['gb_per_s_or_gflops']*1e9),result['tile_load_store_bytes']/(c['stream_copy']['gb_per_s_or_gflops']*1e9))*1000
    result['calibration_note']='Attained throughput of this tile, not hardware peak; excludes host and non-GEMM kernels.'
(root/'prediction.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
