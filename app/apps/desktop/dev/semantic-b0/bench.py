# SPDX-License-Identifier: Apache-2.0
"""Reproducible B0 retrieval evaluation; see docs/reports/B0-MEASUREMENT.md."""
import hashlib, json, math, os, pathlib, re, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent
CORPUS = json.loads((ROOT / 'corpus.json').read_text())
DOCS, QUERIES = CORPUS['docs'], CORPUS['queries']

def metrics(ranked):
    hit = rr = answerable = 0
    for q, ids in zip(QUERIES, ranked):
        ans = q['answer']
        if ans is None: continue
        answerable += 1
        if ans in ids[:5]: hit += 1
        if ans in ids: rr += 1 / (ids.index(ans) + 1)
    groups={}
    for q, ids in zip(QUERIES, ranked):
        cat=q['category']; item=groups.setdefault(cat, {'queries':0,'hits':0,'rr':0.0,'false_positives':0})
        if q['answer'] is None: item['false_positives'] += bool(ids[:5]); continue
        item['queries'] += 1
        if q['answer'] in ids[:5]: item['hits'] += 1
        if q['answer'] in ids: item['rr'] += 1/(ids.index(q['answer'])+1)
    for item in groups.values():
        if item['queries']:
            item['hit_at_5']=item.pop('hits')/item['queries']; item['mrr']=item.pop('rr')/item['queries']
        else: item.pop('hits'); item.pop('rr')
    return {'hit_at_5': hit / answerable, 'mrr': rr / answerable, 'answerable_queries': answerable,
            'no_answer_false_positive_at_5': sum(bool(x[:5]) for q,x in zip(QUERIES,ranked) if q['answer'] is None), 'by_category':groups}

def words(s): return re.findall(r'[\w]+', s.casefold(), flags=re.UNICODE)
def cjk(s): return any('\uac00' <= c <= '\ud7af' or '\u3400' <= c <= '\u9fff' for c in s)
def ts_tokens(s):
    result=[]
    for w in words(s):
        if not cjk(w): result.append(w); continue
        chars=list(w); result.append(w)
        result.extend(chars[i]+chars[i+1] for i in range(len(chars)-1))
    return result

def fnv_utf16(s):
    h=0x811c9dc5
    units=[int.from_bytes(s.encode('utf-16-le')[i:i+2], 'little') for i in range(0,len(s.encode('utf-16-le')),2)]
    for u in units: h=((h ^ u)*0x01000193)&0xffffffff
    return h

def server_rank(q):
    qt=list(dict.fromkeys(ts_tokens(q)))
    qv=[0.0]*256
    for t in ts_tokens(q): qv[fnv_utf16(t)%256]+=1
    qnorm=math.sqrt(sum(x*x for x in qv)) or 1
    scored=[]
    for d in DOCS:
        content=(d['title']+' '+d['text']).casefold()
        dv=[0.0]*256
        for t in ts_tokens(d['title']+' '+d['text']): dv[fnv_utf16(t)%256]+=1
        dn=math.sqrt(sum(x*x for x in dv)) or 1
        sim=sum(a*b for a,b in zip(qv,dv))/(qnorm*dn)
        matched=sum(tok in content for tok in qt)
        score=sim+(.1*matched/len(qt) if qt else 0)
        if score>0: scored.append((score,d['id']))
    return [i for _,i in sorted(scored,key=lambda p:(-p[0],p[1]))]

def desktop_rank(q):
    import sqlite3
    db=sqlite3.connect(':memory:')
    db.execute("CREATE VIRTUAL TABLE f USING fts5(title, body, tokenize='unicode61 remove_diacritics 2')")
    db.execute("CREATE VIRTUAL TABLE tri USING fts5(title, body, path, tokenize='trigram')")
    for d in DOCS:
        db.execute('INSERT INTO f(rowid,title,body) VALUES(?,?,?)',(DOCS.index(d)+1,d['title'],d['text']))
        db.execute('INSERT INTO tri(rowid,title,body,path) VALUES(?,?,?,?)',(DOCS.index(d)+1,d['title'],d['text'],d['path']))
    raw=[]
    terms=[]
    for t in q.split():
        cleaned=''.join(c for c in t if c.isalnum() or c in '_-')
        if cleaned: terms.append(cleaned)
    cjk_terms=[t for t in terms if cjk(t)]; other=[t for t in terms if not cjk(t)]
    primary=' AND '.join('"'+t+'"*' for t in terms)
    if primary:
        try: raw.extend(r[0]-1 for r in db.execute('SELECT rowid FROM f WHERE f MATCH ? ORDER BY bm25(f)',(primary,)))
        except sqlite3.OperationalError: pass
    cjk_hits=[]
    for t in cjk_terms:
        if len(t)<3:
            got=[r[0]-1 for r in db.execute('SELECT rowid FROM tri WHERE lower(title||" "||body||" "||path) LIKE lower(?)',('%'+t+'%',))]
        else:
            got=[r[0]-1 for r in db.execute('SELECT rowid FROM tri WHERE tri MATCH ? ORDER BY bm25(tri)',('"'+t+'"',))]
        cjk_hits=got if not cjk_hits else [i for i in cjk_hits if i in got]
    if other and cjk_hits:
        o=' AND '.join('"'+t+'"*' for t in other)
        try:
            ok={r[0]-1 for r in db.execute('SELECT rowid FROM f WHERE f MATCH ?',(o,))}
            cjk_hits=[i for i in cjk_hits if i in ok]
        except sqlite3.OperationalError: cjk_hits=[]
    for i in cjk_hits:
        if i not in raw: raw.append(i)
    db.close()
    return [DOCS[i]['id'] for i in raw]

def main():
    inp=ROOT/'inputs.json'
    texts=[q['q'] for q in QUERIES]+[d['title']+'\n'+d['text'] for d in DOCS]
    inp.write_text(json.dumps({'texts':texts,'repeat':3},ensure_ascii=False))
    model=ROOT/'model/BGE-m3-ko.Q8_0.gguf'
    if not model.exists(): raise SystemExit(f'model not found: {model}; see README.md for the pinned download command')
    with model.open('rb') as model_file: digest=hashlib.file_digest(model_file, 'sha256').hexdigest()
    expected='b00170a20bd8f6d0515a52111af331242af65509f8b73884903e64740929c3a4'
    if digest != expected: raise SystemExit(f'model SHA-256 mismatch: {digest} (expected {expected})')
    exe=ROOT/'target/release/semantic_b0'
    if not exe.exists(): subprocess.run(['cargo','build','--release'],cwd=ROOT,check=True)
    baseline=ROOT/'target/release/semantic_baseline'
    subprocess.run(['rustc','--edition=2021','-C','opt-level=3','-C','strip=symbols','src/baseline.rs','-o',str(baseline)],cwd=ROOT,check=True)
    started=time.perf_counter()
    p=subprocess.run([str(exe),str(model),str(inp)],cwd=ROOT,text=True,capture_output=True,check=True)
    run_elapsed=(time.perf_counter()-started)*1000
    result=json.loads(p.stdout.strip().splitlines()[-1])
    vec=result['vectors']; qvec=vec[:len(QUERIES)]; dvec=vec[len(QUERIES):]
    semantic=[]
    for qv in qvec:
        scores=[]
        for d,dv in zip(DOCS,dvec):
            denom=math.sqrt(sum(x*x for x in qv))*math.sqrt(sum(x*x for x in dv)) or 1
            scores.append((sum(a*b for a,b in zip(qv,dv))/denom,d['id']))
        semantic.append([i for _,i in sorted(scores,key=lambda x:(-x[0],x[1]))])
    desktop=[desktop_rank(q['q']) for q in QUERIES]
    server=[server_rank(q['q']) for q in QUERIES]
    print(json.dumps({'runtime':result,'wall_ms_including_process':run_elapsed,'binary_bytes':exe.stat().st_size,'baseline_binary_bytes':baseline.stat().st_size,'binary_delta_bytes':exe.stat().st_size-baseline.stat().st_size,'model_bytes':model.stat().st_size,
       'metrics':{'semantic_bge_m3_ko_q8':metrics(semantic),'desktop_fts5_trigram_source_port':metrics(desktop),'server_bigram_hash_source_port':metrics(server)},
       'rankings':{'semantic':semantic,'desktop':desktop,'server':server}},ensure_ascii=False,indent=2))
    inp.unlink(missing_ok=True)
if __name__=='__main__': main()
