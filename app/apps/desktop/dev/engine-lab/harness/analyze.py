# SPDX-License-Identifier: Apache-2.0
"""Process-level inference avoids treating 150 correlated calls as 150 independent runs."""
import csv
from collections import defaultdict
import json
import math
from pathlib import Path
import sys
import numpy as np
from scipy.stats import mannwhitneyu
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def read_csv(path):
    with path.open() as stream:
        return list(csv.DictReader(stream))


def bootstrap(values):
    a = np.asarray(values, dtype=float)
    rng = np.random.default_rng(20261020)
    samples = np.median(rng.choice(a, size=(10000, len(a)), replace=True), axis=1)
    return np.quantile(samples, [0.025, 0.975]).tolist()


def holm(pvalues):
    order = np.argsort(pvalues)
    adjusted = [0.0] * len(order)
    previous = 0.0
    for rank, index in enumerate(order):
        previous = max(previous, min(1.0, pvalues[index] * (len(order) - rank)))
        adjusted[index] = previous
    return adjusted


def cliffs(a, b):
    return float(np.sign(np.subtract.outer(a, b)).mean())


def table(headers, rows):
    return '\n'.join(['| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join(['---'] * len(headers)) + ' |'] + ['| ' + ' | '.join(map(str, r)) + ' |' for r in rows]) + '\n'


def predict(out):
    micro = read_csv(out / 'microbench.csv')
    bw = float(np.median([float(r['gb_s']) for r in micro if r['kind'] == 'copy']))
    sizes = sorted({int(r['size']) for r in micro if r['kind'] == 'gemm'})
    peak = max(float(np.median([float(r['tflops']) for r in micro if r['kind'] == 'gemm' and int(r['size']) == n])) for n in sizes)
    submit = float(np.median([float(r['cpu_submit_us']) for r in micro if r['kind'] == 'submit' and r['depth'] == '1']))
    roundtrip = float(np.median([float(r['host_ms']) * 1000 for r in micro if r['kind'] == 'submit' and r['depth'] == '1']))
    # Source-audited matrix payloads, before timing; excludes embedding lookup table and small norm tensors.
    shapes = [(512, 12288, 82), (512, 768, 1)]
    for layer in range(24):
        h = 512 if layer % 6 == 5 else 256
        kv = 1 if layer % 6 == 5 else 2
        shapes += [(512, 4*h, 82), (512, kv*h, 82), (512, kv*h, 82),
                   (4*h, 512, 82), (512, 2048, 82), (512, 2048, 82), (2048, 512, 82),
                   (512, 512, 82), (512, 512, 82)]
    weights = sum(k*n*2 for k,n,m in shapes)
    flops = sum(2*k*n*m for k,n,m in shapes) + sum(4 * 82**2 * 4 * (512 if l%6==5 else 256) for l in range(24))
    predictions = []
    for engine, weight_bytes, command_buffers in [('llama-cpp-q8-metal',151150592,3),('mojo-gpu-fp16',weights,425)]:
        kernel_floor = max(weight_bytes / (bw*1e9), flops / (peak*1e12))*1000
        submission = command_buffers * submit / 1000
        predictions.append({'engine':engine,'weight_bytes':weight_bytes,'flops':flops,'command_buffers':command_buffers,
                            'kernel_floor_ms':kernel_floor,'submission_cpu_ms':submission,
                            'predicted_ms':max(kernel_floor,submission),
                            'nonoverlap_heuristic_ms':kernel_floor+submission,
                            'nonoverlap_submit_fraction_assumption':submission/(kernel_floor+submission),
                            'nonoverlap_amdahl_assumption':(kernel_floor+submission)/kernel_floor})
    result={'bw_gb_s':bw,'fp16_peak_tflops':peak,'submit_cpu_us':submit,'submit_roundtrip_us':roundtrip,
            'tokens':82,'predictions':predictions,
            'interpretation':'Optimistic concurrent aggregate floor estimate: max(aggregate kernel floor, CPU commit cost), eta=1, host/gap/readback=0. It assumes measured copy BW/MPS peak act as ceilings; it is not a hardware-proven bound, a sum of per-kernel maxima, or a calibrated full-latency forecast. The separately labeled nonoverlap Amdahl illustration is an assumption, not a measured removable fraction. Q8 dequantization is not FP16 GEMM.',
            'counter_source':'Previous trace: llama 3; Mojo 425 (417 compute+8 transfer). Optional runtime stats remain blank if not exported.'}
    (out/'prediction.json').write_text(json.dumps(result,indent=2))
    return result


def validate_run(out,config):
    if (config['processes'],config['calls']) != ((1,1) if config['smoke'] else (5,30)):
        raise RuntimeError('Unexpected study size; only explicit smoke or full 5x30 is supported')
    candidates=[p for p in config['engines'] if p!=config['baseline']]
    expected={}
    for process in range(config['processes']):
        sequence=[(library,pair) for pair in candidates for library in [config['baseline'],pair]] or [(config['baseline'],config['baseline'])]
        for slot,(library,pair) in enumerate(sequence):
            expected[f'engine-{config["engines"].index(library)}-p{process}-slot{slot}']=(library,pair,process)
    plan=json.loads((out/'order.json').read_text())
    planned={Path(item['prefix']).name:item for item in plan}
    if len(planned)!=len(plan) or set(planned)!=set(expected):
        raise RuntimeError('Incomplete or mismatched planned process order; no final inference')
    expected_trials={(scenario,batch,qps,i) for scenario,batch,qps in [('SingleStream',1,0.)]+[('Offline',n,0.) for n in [1,4,8,16,32,64,100]]+[('Server',1,q) for q in [5.,10.,20.,30.,40.,50.,60.,80.,100.]] for i in range(config['calls'])}
    records=[]
    fingerprints={}
    for stem,(library,pair,process) in expected.items():
        item=planned[stem]
        if item['library']!=library or item['process']!=process or item.get('pair',pair)!=pair:
            raise RuntimeError('Process order has inconsistent library/pair/process')
        path=out/(stem+'.csv');meta_path=path.with_suffix('.json')
        if not path.exists() or not meta_path.exists():
            raise RuntimeError(f'Incomplete study: missing {stem}; no final inference')
        meta=json.loads(meta_path.read_text())
        if not meta.get('gate_passed') or 'finished_unix_s' not in meta or meta['calls']!=config['calls'] or meta['process']!=process or meta['library']!=library or meta['model']!=config['models'][library]:
            raise RuntimeError(f'Incomplete or mismatched process metadata: {stem}')
        fingerprint=(meta.get('model_sha256'),meta.get('library_sha256'),meta.get('reference_sha256'))
        for value in fingerprint:
            digest=str(value).split()[0]
            if len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest.lower()):
                raise RuntimeError(f'Missing/invalid artifact fingerprint: {stem}')
        if library in fingerprints and fingerprints[library]!=fingerprint:
            raise RuntimeError(f'Artifacts changed between processes for {library}')
        fingerprints[library]=fingerprint
        for gate in ['accuracy','mixed_batch_accuracy']:
            if len(meta.get(gate,[]))!=20 or any(not math.isfinite(r['cosine']) or not math.isfinite(r['max_abs_diff']) or r['cosine']<.999 or r['max_abs_diff']<0 for r in meta[gate]):
                raise RuntimeError(f'Invalid accuracy gate: {stem}')
        data=read_csv(path)
        trials=[]
        for r in data:
            if r['engine']!=meta['engine'] or int(r['process'])!=process or any(not math.isfinite(float(r[k])) or float(r[k])<=0 for k in ['service_ms','latency_ms','throughput']):
                raise RuntimeError(f'Invalid raw row: {stem}')
            trials.append((r['scenario'],int(r['batch_size']),float(r['qps']),int(r['iteration'])))
            r['source']=path.name;r['pair']=pair
        if len(trials)!=len(expected_trials) or set(trials)!=expected_trials:
            raise RuntimeError(f'Incomplete/duplicated scenario samples: {stem}; no final inference')
        meta['pair']=pair;records.append((meta,data))
    return records


def analyze(out):
    config=json.loads((out/'config.json').read_text())
    prediction=json.loads((out/'prediction.json').read_text())
    records=validate_run(out,config)
    gates=[meta for meta,_ in records]
    rows=[r for _,data in records for r in data]
    pairs=sorted({r['pair'] for r in rows})
    pair_ids={pair:index+1 for index,pair in enumerate(pairs)}
    def display(engine,pair):
        return engine if len(pairs)==1 else f'{engine} [pair {pair_ids[pair]}]'
    groups=defaultdict(list)
    for r in rows:
        groups[(r['pair'],r['engine'],r['scenario'],int(r['batch_size']),float(r['qps']))].append(r)
    summaries=[]; sample_map={}
    for key,data in sorted(groups.items()):
        pair,engine,scenario,batch,qps=key
        latency=np.array([float(r['latency_ms']) for r in data])
        by_process=defaultdict(list)
        by_rate=defaultdict(list)
        for r in data:
            # A process baseline can recur per candidate. Each invocation is its own process, keyed by source.
            by_process[r['source']].append(float(r['latency_ms']))
            by_rate[r['source']].append(float(r['throughput']))
        medians=[float(np.median(x)) for x in by_process.values()]
        sample_map[key]=medians
        rate_means=[float(x[-1]) if scenario=='Server' else float(np.mean(x)) for x in by_rate.values()]
        ci=bootstrap(medians)
        summaries.append({'engine':engine,'pair':pair,'label':display(engine,pair),'scenario':scenario,'batch':batch,'qps':qps,'processes':len(medians),'samples':len(data),
                          'mean_ms':float(np.mean(latency)),'process_mean_sd_ms':float(np.std([np.mean(x) for x in by_process.values()],ddof=1)) if len(by_process)>1 else None,'p50_ms':float(np.median(latency)),'p90_ms':float(np.quantile(latency,.9)), 'p99_ms':float(np.quantile(latency,.99)),
                          'iqr_ms':float(np.quantile(latency,.75)-np.quantile(latency,.25)),
                          'process_median_ms':float(np.median(medians)),'ci95_ms':ci,
                          'throughput_mean':float(np.mean(rate_means)),
                          'throughput_sd':float(np.std(rate_means,ddof=1)) if len(rate_means)>1 else None})
    base=next(g['engine'] for g in gates if str(Path(g['library']))==config['baseline'])
    comparisons=[]
    for key,values in sample_map.items():
        pair,engine,scenario,batch,qps=key
        baseline_key=(pair,base,scenario,batch,qps)
        if config['smoke'] or engine==base or baseline_key not in sample_map:continue
        baseline=sample_map[baseline_key]
        comparisons.append({'engine':engine,'pair':pair,'label':display(engine,pair),'scenario':scenario,'batch':batch,'qps':qps,
                            'n_candidate':len(values),'n_baseline':len(baseline),
                            'p':float(mannwhitneyu(values,baseline,alternative='two-sided',method='auto').pvalue),
                            'cliffs_delta_latency':cliffs(values,baseline)})
    for item,adjusted in zip(comparisons,holm([c['p'] for c in comparisons])):item['p_holm']=adjusted
    gate_rows=[]
    for engine in sorted({g['engine'] for g in gates}):
        runs=[g for g in gates if g['engine']==engine]
        cs=[r['cosine'] for g in runs for r in g['accuracy']]
        ds=[r['max_abs_diff'] for g in runs for r in g['accuracy']]
        mixed=[r['cosine'] for g in runs for r in g['mixed_batch_accuracy']]
        gate_rows.append([engine,len(runs),f'{min(cs):.9f}',f'{np.mean(cs):.9f}',f'{max(ds):.9f}',f'{min(mixed):.9f}'])
    ss=[r for r in summaries if r['scenario']=='SingleStream']
    offline=[r for r in summaries if r['scenario']=='Offline']
    server=[r for r in summaries if r['scenario']=='Server']
    fmt=lambda x:f'{x:.3f}'
    stats_rows=[[r['label'],fmt(r['mean_ms']),fmt(r['p50_ms']),fmt(r['p90_ms']),fmt(r['iqr_ms']),f"{r['ci95_ms'][0]:.3f}–{r['ci95_ms'][1]:.3f}",r['samples'],r['processes']] for r in ss]
    offline_rows=[[r['label'],r['batch'],fmt(r['throughput_mean']), 'N/A' if r['throughput_sd'] is None else fmt(r['throughput_sd']),fmt(r['p50_ms'])] for r in offline]
    server_rows=[[r['label'],r['qps'],fmt(r['throughput_mean']),fmt(r['p50_ms']),fmt(r['p99_ms']),'PASS' if r['p99_ms']<=50 else 'FAIL'] for r in server]
    pred_rows=[]
    for r in ss:
        if r['engine'] not in {p['engine'] for p in prediction['predictions']}:
            pred_rows.append([r['label'],'unknown',fmt(r['p50_ms']),'N/A','unknown','candidate model not supplied'])
    for p in prediction['predictions']:
        for actual in [r for r in ss if r['engine']==p['engine']]:
            error=(actual['p50_ms']/p['predicted_ms']-1)*100
            pred_rows.append([actual['label'],fmt(p['predicted_ms']),fmt(actual['p50_ms']),f'{error:+.1f}%',fmt(p['nonoverlap_amdahl_assumption']),'Trace required' if abs(error)>20 else 'within 20%'])
    max_qps={label:max([r['qps'] for r in server if r['label']==label and r['p99_ms']<=50],default=None) for label in {r['label'] for r in summaries}}
    if config['smoke']:max_qps={label:None for label in max_qps}
    text='# Engine laboratory results\n\n'
    if config['smoke']:text+='**SMOKE ONLY: 1 process × 1 call; no inferential claim.**\n\n'
    text+='Independent process is the resampling/test unit; pooled call quantiles are descriptive. CI: median of process medians, 10,000 percentile-bootstrap draws, seed 20261020.\n\n'
    text+='## Accuracy gate\n\n'+table(['Engine','Processes','Min cosine','Mean cosine','Max abs diff','Mixed min cosine'],gate_rows)
    text+='\n## SingleStream\n\n'+table(['Engine','Mean ms','p50 ms','p90 ms','IQR ms','Process median CI95 ms','Calls','Processes'],stats_rows)
    text+='\n## Offline (100 paragraphs/trial)\n\n'+table(['Engine','Batch','Mean paragraphs/s','Process SD','p50 trial ms'],offline_rows)
    text+='\n## Server (open-loop Poisson, one serialized engine worker)\n\n'+table(['Engine','Target QPS','Completed QPS','p50 ms','p99 ms','p99 ≤50ms'],server_rows)
    text+=('\nSmoke only: capacity is not estimated.\n' if config['smoke'] else '\nHighest passing **tested** QPS: '+json.dumps(max_qps)+f'. Each pair/point has {config["processes"]*config["calls"]} requests; this is not sustained capacity proof.\n')
    text+='\n## Comparisons\n\n'+table(['Engine','Scenario','Batch','QPS','MWU p','Holm p','Cliff delta latency'],[[c['label'],c['scenario'],c['batch'],c['qps'],f"{c['p']:.6g}",f"{c['p_holm']:.6g}",fmt(c['cliffs_delta_latency'])] for c in comparisons])
    text+='\nAll contrasts are one Holm family across candidates and levels; each candidate uses its adjacent baseline processes (five per pair). Negative delta means lower candidate latency. Small n=5 cannot support fine p-value resolution. Smoke runs omit inferential tests.\n'
    text+='\n## Prediction before timing\n\n'+prediction['interpretation']+'\n\n'+table(['Engine','Predicted floor ms','Measured p50 ms','Error','Amdahl illustration (nonoverlap)' ,'Diagnostic'],pred_rows)
    text+=f"\nMeasured copy BW: {prediction['bw_gb_s']:.3f} GB/s; best median MPS FP16 GEMM: {prediction['fp16_peak_tflops']:.3f} TFLOP/s; CPU commit cost: {prediction['submit_cpu_us']:.3f} µs; tiny-kernel depth-1 completion: {prediction['submit_roundtrip_us']:.3f} µs. These are microbenchmark observations, not vendor peak ratings.\n"
    text+='\n## Factor coverage and limitations\n\nKnown original combinations are MSL/llama host/Q8/coalesced and Mojo/DeviceContext/FP16/per-operation. Arbitrary candidate factors and predictions are unknown unless independently supplied; names alone do not establish factor levels. A–D effects/interactions are not estimated by this harness. Batch E is measured across seven levels. Multiple candidates retain separate adjacent-baseline pairs. Optional command-buffer counters are blank when the engine lacks stats; trace-derived prediction counts are not runtime counters.\n'
    (out/'tables.md').write_text(text)
    (out/'summary.json').write_text(json.dumps({'groups':summaries,'comparisons':comparisons,'max_tested_qps':max_qps},indent=2))
    plot(out,rows,prediction)
    print(text,flush=True)


def plot(out,rows,pred):
    for scenario in ['SingleStream','Server']:
        fig,ax=plt.subplots(figsize=(8,5))
        if scenario=='SingleStream':keys=sorted({(r['pair'],r['engine'],0.) for r in rows if r['scenario']==scenario})
        else:keys=sorted({(r['pair'],r['engine'],float(r['qps'])) for r in rows if r['scenario']==scenario and float(r['qps']) in [20.,40.,60.]})
        pairs=sorted({r["pair"] for r in rows})
        for pair,engine,qps in keys:
            data=np.sort([float(r['latency_ms']) for r in rows if r['scenario']==scenario and r['engine']==engine and r['pair']==pair and float(r['qps'])==qps])
            ax.step(data,np.arange(1,len(data)+1)/len(data),where='post',marker='.' if len(data)<2 else None,label=engine+(f' [pair {pairs.index(pair)+1}]' if len(pairs)>1 else '')+(f' {qps:g} QPS' if qps else ''))
        ax.set(xlabel='End-to-end latency (ms)',ylabel='Empirical CDF',title=scenario,ylim=(0,1.02))
        ax.legend(fontsize=8);ax.grid(alpha=.2);fig.tight_layout();fig.savefig(out/f'latency-cdf-{scenario.lower()}.png',dpi=160);plt.close(fig)
    micro=read_csv(out/'microbench.csv')
    fig,ax=plt.subplots(figsize=(8,5));x=np.logspace(-2,4,500)
    ax.loglog(x,np.minimum(pred['bw_gb_s']*x/1000,pred['fp16_peak_tflops']),label='Measured bandwidth / MPS peak envelope')
    for n in sorted({int(r['size']) for r in micro if r['kind']=='gemm'}):
        vals=[float(r['tflops']) for r in micro if r['kind']=='gemm' and int(r['size'])==n]
        ax.scatter([n/3],[np.median(vals)],label=f'MPS FP16 GEMM {n}²')
    pairs=sorted({r['pair'] for r in rows})
    for p in pred['predictions']:
        for pair in pairs:
            actual=[float(r['latency_ms']) for r in rows if r['engine']==p['engine'] and r['scenario']=='SingleStream' and r['pair']==pair]
            if actual:ax.scatter([p['flops']/p['weight_bytes']],[p['flops']/(np.median(actual)*1e9)],marker='x',s=70,label=p['engine']+f' aggregate proxy [pair {pairs.index(pair)+1}]')
    ax.set(xlabel='Arithmetic intensity (FLOP/byte)',ylabel='TFLOP/s',title='Roofline: microkernel points and aggregate engine proxies')
    ax.legend(fontsize=7);ax.grid(alpha=.2);fig.tight_layout();fig.savefig(out/'roofline.png',dpi=160);plt.close(fig)
    fig,axes=plt.subplots(1,2,figsize=(10,4))
    depths=sorted({int(r['depth']) for r in micro if r['kind']=='submit'})
    axes[0].plot(depths,[np.median([float(r['cpu_submit_us']) for r in micro if r['kind']=='submit' and int(r['depth'])==d]) for d in depths],marker='o')
    axes[1].plot(depths,[np.median([float(r['host_ms'])*1000/int(r['depth']) for r in micro if r['kind']=='submit' and int(r['depth'])==d]) for d in depths],marker='o')
    for ax in axes:ax.set_xscale('log',base=2);ax.set_xlabel('Queue depth');ax.grid(alpha=.2)
    axes[0].set_ylabel('CPU commit µs / buffer');axes[1].set_ylabel('Commit + completion µs / buffer')
    fig.tight_layout();fig.savefig(out/'submission-depth.png',dpi=160);plt.close(fig)

if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--predict':predict(Path(sys.argv[2]))
    elif len(sys.argv)==2:analyze(Path(sys.argv[1]))
    else:raise SystemExit('analyze.py [--predict] RESULTS_DIR')
