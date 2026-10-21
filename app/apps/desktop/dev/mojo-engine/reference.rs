// SPDX-License-Identifier: Apache-2.0
use llama_cpp_2::{
    context::params::{LlamaAttentionType, LlamaContextParams, LlamaPoolingType},
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, LlamaModel},
};
use std::{env, fs, num::NonZeroU32, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 4 {
        return Err("reference MODEL.gguf INPUTS.json OUTPUT.json".into());
    }
    let input: serde_json::Value = serde_json::from_slice(&fs::read(&args[2])?)?;
    assert_eq!(input.as_array().ok_or("expected array")?.len(), 20);
    let mut backend = LlamaBackend::init()?;
    backend.void_logs();
    let model = LlamaModel::load_from_file(
        &backend,
        &args[1],
        &LlamaModelParams::default().with_n_gpu_layers(999),
    )?;
    let mut ctx = model.new_context(
        &backend,
        LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(2048))
            .with_n_batch(2048)
            .with_n_ubatch(2048)
            .with_embeddings(true)
            .with_pooling_type(LlamaPoolingType::Mean)
            .with_attention_type(LlamaAttentionType::NonCausal)
            .with_n_threads(4)
            .with_n_threads_batch(4),
    )?;
    let mut rows = vec![];
    for text in input.as_array().ok_or("expected array")? {
        let text = text.as_str().ok_or("expected string")?;
        let ids = model.vocab().tokenize(text.as_bytes(), true, false);
        assert!(!ids.is_empty() && ids.len() <= 2048);
        let mut batch = LlamaBatch::new(ids.len(), 1);
        batch.add_sequence(&ids, 0, false)?;
        ctx.clear_kv_cache();
        ctx.decode(&mut batch)?;
        let mut vector = ctx.embeddings_seq_ith(0)?.to_vec();
        assert_eq!(vector.len(), 768);
        let norm = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!(norm.is_finite() && norm > 0.0);
        vector.iter_mut().for_each(|x| *x /= norm);
        rows.push(serde_json::json!({"text":text,"ids":ids.iter().map(|t| t.0).collect::<Vec<_>>(),"vector":vector}));
    }
    let text = input[0].as_str().unwrap();
    let ids = model.vocab().tokenize(text.as_bytes(), true, false);
    let mut batch = LlamaBatch::new(ids.len(), 1);
    batch.add_sequence(&ids, 0, false)?;
    let mut timings = vec![];
    for _ in 0..31 {
        ctx.clear_kv_cache();
        let start = Instant::now();
        ctx.decode(&mut batch)?;
        let _ = ctx.embeddings_seq_ith(0)?;
        timings.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    timings.remove(0);
    let latency_samples = timings.clone();
    timings.sort_by(f64::total_cmp);
    let start = Instant::now();
    for _ in 0..100 {
        ctx.clear_kv_cache();
        ctx.decode(&mut batch)?;
        let _ = ctx.embeddings_seq_ith(0)?;
    }
    let sequential_throughput = 100.0 / start.elapsed().as_secs_f64();
    // Use independent sequence IDs, reset positions per paragraph, and retrieve every result.
    drop(ctx);
    let trials_count = env::var("IB_ENGINE_BENCH_TRIALS")
        .unwrap_or_else(|_| "4".into())
        .parse::<usize>()?;
    assert!(matches!(trials_count, 2 | 4));
    let mut batched = vec![];
    for size in [4usize, 8, 16, 24, 32, 64, 100] {
        let capacity = (256 * size).max(2048) as u32;
        let mut ctx = model.new_context(
            &backend,
            LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(capacity))
                .with_n_batch(capacity)
                .with_n_ubatch(capacity)
                .with_n_seq_max(size as u32)
                .with_kv_unified(true)
                .with_embeddings(true)
                .with_pooling_type(LlamaPoolingType::Mean)
                .with_attention_type(LlamaAttentionType::NonCausal)
                .with_n_threads(4)
                .with_n_threads_batch(4),
        )?;
        let expected: Vec<f64> = rows[0]["vector"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap())
            .collect();
        let mut trials = vec![];
        let mut min_cosine = 1.0f64;
        for _ in 0..trials_count {
            let mut vectors = vec![];
            let started = Instant::now();
            for from in (0..100).step_by(size) {
                let count = size.min(100 - from);
                let mut batch = LlamaBatch::new(count * ids.len(), size as i32);
                for seq in 0..count {
                    batch.add_sequence(&ids, seq as i32, false)?;
                }
                ctx.clear_kv_cache();
                ctx.decode(&mut batch)?;
                for seq in 0..count {
                    vectors.push(ctx.embeddings_seq_ith(seq as i32)?.to_vec());
                }
            }
            trials.push(started.elapsed().as_secs_f64() * 1000.0);
            for vector in vectors {
                let norm = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
                let cosine = vector
                    .iter()
                    .zip(&expected)
                    .map(|(a, b)| f64::from(*a / norm) * b)
                    .sum::<f64>();
                assert!(norm.is_finite() && norm > 0.0 && cosine >= 0.9999);
                min_cosine = min_cosine.min(cosine);
            }
        }
        let mut warm = trials[1..].to_vec();
        warm.sort_by(f64::total_cmp);
        let record = serde_json::json!({"batch_size":size,"trials_ms":trials,"median_ms":warm[warm.len()/2],"paragraphs_per_second":100000.0/warm[warm.len()/2],"cosine_min":min_cosine});
        eprintln!("{}", record);
        batched.push(record);
    }
    let output = serde_json::json!({"model":args[1],"rows":rows,"benchmark_tokens":ids.len(),"median_ms":(timings[14]+timings[15])/2.0,"latency_samples_ms":latency_samples,"paragraphs_per_second":sequential_throughput,"batch_100":batched});
    fs::write(&args[3], serde_json::to_vec_pretty(&output)?)?;
    eprintln!(
        "{}",
        serde_json::json!({"tokens":ids.len(),"median_ms":output["median_ms"],"paragraphs_per_second":output["paragraphs_per_second"]})
    );
    drop(model);
    drop(backend);
    Ok(())
}
