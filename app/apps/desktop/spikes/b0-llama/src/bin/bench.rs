// SPDX-License-Identifier: Apache-2.0
//! B0-a 측정 도구. 한 번 실행에 한 설정(모델, GPU 층 수, 스레드)을 측정하고 `key=value` 줄로 출력한다.
//! 최대 메모리(RSS)는 바깥에서 `/usr/bin/time -l` 로 잰다.
//!
//! 사용: bench --model <gguf> [--gpu-layers N] [--threads N] [--dump <out.txt>] [--skip-100]
#[path = "../corpus.rs"]
mod corpus;

use corpus::{PAIRS, TOPICS};
use llama_cpp_2::context::params::{LlamaContextParams, LlamaPoolingType};
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::list_llama_ggml_backend_devices;
use std::io::Write;
use std::num::NonZeroU32;
use std::time::Instant;

const N_CTX: u32 = 4096;

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn l2(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}

/// Matryoshka: 앞 d개만 자르고 다시 L2 정규화한다.
fn truncate_norm(v: &[f32], d: usize) -> Vec<f32> {
    let mut t = v[..d].to_vec();
    let n = l2(&t);
    t.iter_mut().for_each(|x| *x /= n);
    t
}

fn cos(a: &[f32], b: &[f32]) -> f32 {
    let d: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    d / (l2(a) * l2(b))
}

fn pct(sorted: &[f64], p: f64) -> f64 {
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter().position(|a| a == k).and_then(|i| args.get(i + 1).cloned())
}

struct Embedder<'a> {
    ctx: llama_cpp_2::context::LlamaContext<'a>,
    model: &'a LlamaModel,
    dim: usize,
    tokens_total: usize,
}

impl<'a> Embedder<'a> {
    /// 문단 여러 개를 시퀀스로 묶어 한 번에 decode한다. 반환은 문단별 임베딩.
    fn embed_batch(&mut self, texts: &[String]) -> Vec<Vec<f32>> {
        let vocab = self.model.vocab();
        let toks: Vec<_> = texts.iter().map(|t| vocab.tokenize(t.as_bytes(), true, false)).collect();
        let total: usize = toks.iter().map(|t| t.len()).sum();
        assert!(total <= N_CTX as usize, "배치가 N_CTX({N_CTX})를 넘는다: {total}");
        self.tokens_total += total;
        let mut batch = LlamaBatch::new(total.max(8), texts.len() as i32);
        for (i, t) in toks.iter().enumerate() {
            batch.add_sequence(t, i as i32, false).unwrap();
        }
        self.ctx.clear_kv_cache();
        self.ctx.decode(&mut batch).expect("decode 실패");
        (0..texts.len())
            .map(|i| self.ctx.embeddings_seq_ith(i as i32).expect("임베딩 없음")[..self.dim].to_vec())
            .collect()
    }
}

fn doc(t: &str) -> String {
    format!("title: none | text: {t}")
}
fn query(t: &str) -> String {
    format!("task: search result | query: {t}")
}
fn sym(t: &str) -> String {
    format!("task: sentence similarity | query: {t}")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = arg(&args, "--model").expect("--model 필요");
    let gpu_layers: u32 = arg(&args, "--gpu-layers").map_or(0, |s| s.parse().unwrap());
    let threads: i32 = arg(&args, "--threads").map_or(4, |s| s.parse().unwrap());
    let dump = arg(&args, "--dump");
    let skip100 = args.iter().any(|a| a == "--skip-100");

    let t_total = Instant::now();
    let backend = LlamaBackend::init().expect("backend");
    for d in list_llama_ggml_backend_devices() {
        println!("device={} backend={} type={:?} mem_total_mb={}", d.name, d.backend, d.device_type, d.memory_total >> 20);
    }
    let t = Instant::now();
    let model = LlamaModel::load_from_file(&backend, &model_path, &LlamaModelParams::default().with_n_gpu_layers(gpu_layers))
        .expect("모델 로드 실패");
    let load_model_ms = ms(t);
    let t = Instant::now();
    let ctx = model
        .new_context(
            &backend,
            LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(N_CTX))
                .with_n_batch(N_CTX)
                .with_n_ubatch(N_CTX)
                .with_n_seq_max(128)
                .with_embeddings(true)
                .with_pooling_type(LlamaPoolingType::Mean)
                .with_n_threads(threads)
                .with_n_threads_batch(threads),
        )
        .expect("컨텍스트 생성 실패");
    let load_ctx_ms = ms(t);
    let dim = model.n_embd_out() as usize;
    println!("arch_ok=1 n_params={} model_size_mb={:.1} n_embd={} n_embd_out={} gpu_layers={gpu_layers} threads={threads}", model.n_params(), model.size() as f64 / 1048576.0, model.n_embd(), dim);
    println!("load_model_ms={load_model_ms:.1} load_ctx_ms={load_ctx_ms:.1}");
    let mut e = Embedder { ctx, model: &model, dim, tokens_total: 0 };

    // 1) 첫 임베딩(셰이더 컴파일·페이지 폴트 포함)과 문단 1개 지연.
    let p0 = doc(TOPICS[0].ko);
    let t = Instant::now();
    let first = e.embed_batch(&[p0.clone()]).remove(0);
    let first_ms = ms(t);
    println!("first_embed_ms={first_ms:.1} first_load_to_ready_ms={:.1}", ms(t_total));
    let mut lat: Vec<f64> = (0..30)
        .map(|i| {
            let s = doc(TOPICS[i % 12].ko);
            let t = Instant::now();
            e.embed_batch(&[s]);
            ms(t)
        })
        .collect();
    lat.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("single_ko_ms_median={:.1} single_ko_ms_p95={:.1}", pct(&lat, 0.5), pct(&lat, 0.95));
    let mut lat: Vec<f64> = (0..30)
        .map(|i| {
            let s = doc(TOPICS[i % 12].en);
            let t = Instant::now();
            e.embed_batch(&[s]);
            ms(t)
        })
        .collect();
    lat.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("single_en_ms_median={:.1} single_en_ms_p95={:.1}", pct(&lat, 0.5), pct(&lat, 0.95));

    // 2) 100문단 처리량. 순차(1개씩 decode)와 묶음(16개씩 decode) 둘 다 잰다.
    if !skip100 {
        let paras: Vec<String> = (0..100)
            .map(|i| {
                let tp = &TOPICS[i % 12];
                doc(&format!("{} (#{i})", if i % 2 == 0 { tp.ko } else { tp.en }))
            })
            .collect();
        e.tokens_total = 0;
        let t = Instant::now();
        for p in &paras {
            e.embed_batch(std::slice::from_ref(p));
        }
        let seq_ms = ms(t);
        let toks = e.tokens_total;
        println!("batch100_seq_ms={seq_ms:.0} batch100_seq_paras_per_s={:.1} batch100_tokens={toks} batch100_seq_tok_per_s={:.0}", 100.0 / (seq_ms / 1000.0), toks as f64 / (seq_ms / 1000.0));
        let t = Instant::now();
        for c in paras.chunks(16) {
            e.embed_batch(c);
        }
        let b_ms = ms(t);
        println!("batch100_x16_ms={b_ms:.0} batch100_x16_paras_per_s={:.1} batch100_x16_tok_per_s={:.0}", 100.0 / (b_ms / 1000.0), toks as f64 / (b_ms / 1000.0));
    }

    // 3) 차원·정규화·Matryoshka.
    let raw_norm = l2(&first);
    let finite = first.iter().all(|x| x.is_finite());
    let t256 = truncate_norm(&first, 256);
    let mut dims_line = format!("dim={} raw_norm={raw_norm:.4} finite={finite}", first.len());
    for d in [128usize, 256, 512, 768] {
        if d <= first.len() {
            dims_line += &format!(" trunc{d}_norm_after={:.4}", l2(&truncate_norm(&first, d)));
        }
    }
    println!("{dims_line}");
    println!("trunc256_vs_full768_cos={:.4}", cos(&t256, &first));

    // 4) 한/영 유사도 smoke. 임베딩은 묶음으로 한 번에 계산한다.
    let mut sims = |d: usize, list: &[(String, String, bool)]| -> (f32, f32) {
        let mut sim = vec![];
        let mut dis = vec![];
        let flat: Vec<String> = list.iter().flat_map(|(a, b, _)| [sym(a), sym(b)]).collect();
        let embs = e.embed_batch(&flat);
        for (i, (_, _, s)) in list.iter().enumerate() {
            let c = cos(&truncate_norm(&embs[2 * i], d), &truncate_norm(&embs[2 * i + 1], d));
            if *s { sim.push(c) } else { dis.push(c) }
        }
        let avg = |v: &Vec<f32>| v.iter().sum::<f32>() / v.len() as f32;
        (avg(&sim), avg(&dis))
    };
    let pairs: Vec<(String, String, bool)> = PAIRS.iter().map(|(a, b, s)| (a.to_string(), b.to_string(), *s)).collect();
    for d in [768usize, 256] {
        let (s, u) = sims(d, &pairs);
        println!("pairs_dim{d}_similar_avg={s:.3} unrelated_avg={u:.3} gap={:.3}", s - u);
    }
    // 같은 주제의 한국어 문단과 영어 문단(교차 언어) vs 다른 주제.
    let docs_ko: Vec<String> = TOPICS.iter().map(|t| doc(t.ko)).collect();
    let docs_en: Vec<String> = TOPICS.iter().map(|t| doc(t.en)).collect();
    let all_docs: Vec<String> = docs_ko.iter().chain(docs_en.iter()).cloned().collect();
    let demb = e.embed_batch(&all_docs);
    for d in [768usize, 256] {
        let dn: Vec<Vec<f32>> = demb.iter().map(|v| truncate_norm(v, d)).collect();
        let mut same = 0.0;
        let mut other = 0.0;
        let mut n_other = 0;
        for i in 0..12 {
            same += cos(&dn[i], &dn[12 + i]);
            for j in 0..12 {
                if i != j {
                    other += cos(&dn[i], &dn[12 + j]);
                    n_other += 1;
                }
            }
        }
        println!("crosslingual_dim{d}_same_topic_avg={:.3} diff_topic_avg={:.3}", same / 12.0, other / n_other as f32);
    }
    // 5) 검색 smoke: 짧은 검색어 24개(ko 12 + en 12)를 문단 24개에서 top-1으로 찾는다. 정답은 같은 주제의 ko 또는 en 문단.
    let qs: Vec<String> = TOPICS.iter().map(|t| query(t.q_ko)).chain(TOPICS.iter().map(|t| query(t.q_en))).collect();
    let qemb = e.embed_batch(&qs);
    for d in [768usize, 256] {
        let dn: Vec<Vec<f32>> = demb.iter().map(|v| truncate_norm(v, d)).collect();
        let mut hit = 0;
        for (qi, q) in qemb.iter().enumerate() {
            let q = truncate_norm(q, d);
            let best = (0..24).max_by(|&a, &b| cos(&q, &dn[a]).partial_cmp(&cos(&q, &dn[b])).unwrap()).unwrap();
            if best % 12 == qi % 12 {
                hit += 1;
            }
        }
        println!("retrieval_dim{d}_top1={hit}/24");
    }

    if let Some(path) = dump {
        let mut f = std::fs::File::create(path).unwrap();
        for v in demb.iter().chain(qemb.iter()) {
            writeln!(f, "{}", v.iter().map(|x| format!("{x:.6}")).collect::<Vec<_>>().join(" ")).unwrap();
        }
    }
    println!("total_wall_ms={:.0}", ms(t_total));
}
