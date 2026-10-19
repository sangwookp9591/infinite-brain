// SPDX-License-Identifier: Apache-2.0
use llama_cpp_2::{
    context::params::{LlamaContextParams, LlamaPoolingType},
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, LlamaModel},
};
use serde::{Deserialize, Serialize};
use std::{env, fs, num::NonZeroU32, path::PathBuf, time::Instant};

#[derive(Deserialize)]
struct Input {
    texts: Vec<String>,
    repeat: usize,
}
#[derive(Serialize)]
struct Output {
    vectors: Vec<Vec<f32>>,
    cold_load_ms: f64,
    warm_load_ms: f64,
    warm_batch_ms: Vec<f64>,
    tokens: usize,
    max_rss_kib: u64,
}
fn rss_kib() -> u64 {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    unsafe {
        libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr());
        usage.assume_init().ru_maxrss as u64 / 1024
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let model_path = PathBuf::from(
        args.next()
            .ok_or("usage: semantic_b0 MODEL.gguf INPUT.json")?,
    );
    let input_path = PathBuf::from(args.next().ok_or("missing input json")?);
    let input: Input = serde_json::from_slice(&fs::read(input_path)?)?;
    let backend = LlamaBackend::init()?;
    let mut model_params = LlamaModelParams::default();
    model_params = model_params.with_n_gpu_layers(u32::MAX).with_use_mmap(true);
    let cold_start = Instant::now();
    let cold_model = LlamaModel::load_from_file(&backend, &model_path, &model_params)?;
    let cold_load_ms = cold_start.elapsed().as_secs_f64() * 1000.0;
    drop(cold_model);
    let warm_start = Instant::now();
    let model = LlamaModel::load_from_file(&backend, &model_path, &model_params)?;
    let warm_load_ms = warm_start.elapsed().as_secs_f64() * 1000.0;
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(4096))
        .with_n_batch(8192)
        .with_n_ubatch(2048)
        .with_n_seq_max(input.texts.len() as u32)
        .with_embeddings(true)
        .with_pooling_type(LlamaPoolingType::Cls);
    let mut ctx = model.new_context(&backend, ctx_params)?;
    let vocab = model.vocab();
    let tokenized: Vec<_> = input
        .texts
        .iter()
        .map(|t| vocab.tokenize(t.as_bytes(), true, true))
        .collect();
    let token_count = tokenized.iter().map(Vec::len).sum();
    let mut batch = LlamaBatch::new(token_count, input.texts.len() as i32);
    for (seq, tokens) in tokenized.iter().enumerate() {
        for (pos, token) in tokens.iter().enumerate() {
            batch.add(*token, pos as i32, &[seq as i32], true)?;
        }
    }
    let mut warm_batch_ms = Vec::new();
    let mut vectors = Vec::new();
    for run in 0..=input.repeat {
        if run > 0 {
            ctx.clear_kv_cache();
        }
        let start = Instant::now();
        ctx.encode(&mut batch)?;
        ctx.synchronize();
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        warm_batch_ms.push(elapsed);
        if run == input.repeat {
            for i in 0..input.texts.len() {
                vectors.push(ctx.embeddings_seq_ith(i as i32)?.to_vec());
            }
        }
    }
    let result = Output {
        vectors,
        cold_load_ms,
        warm_load_ms,
        warm_batch_ms,
        tokens: token_count,
        max_rss_kib: rss_kib(),
    };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
