// SPDX-License-Identifier: Apache-2.0
//! Same pretokenized paragraph, thirteen warmups and thirty unfenced measured calls after trace setup.
use llama_cpp_2::{
    context::params::{LlamaAttentionType, LlamaContextParams, LlamaPoolingType},
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, LlamaModel},
    token::LlamaToken,
};
use std::{
    env,
    ffi::{c_char, c_void, CStr, CString},
    fs,
    num::NonZeroU32,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
type Error = Box<dyn std::error::Error>;
unsafe extern "C" {
    fn dlopen(path: *const c_char, flags: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    fn dlerror() -> *const c_char;
    fn dlclose(handle: *mut c_void) -> i32;
}
type Mark = unsafe extern "C" fn(u64, i32);
unsafe fn open(path: &str) -> Result<*mut c_void, Error> {
    let lib = dlopen(CString::new(path)?.as_ptr(), 2);
    if lib.is_null() {
        return Err(CStr::from_ptr(dlerror())
            .to_string_lossy()
            .into_owned()
            .into());
    }
    Ok(lib)
}
unsafe fn symbol(lib: *mut c_void, name: &str) -> Result<*mut c_void, Error> {
    let value = dlsym(lib, CString::new(name)?.as_ptr());
    if value.is_null() {
        return Err(format!("missing {name}").into());
    }
    Ok(value)
}
fn measure(
    mut embed: impl FnMut() -> Result<Vec<f32>, Error>,
    mark: Mark,
    expected: &[f64],
    engine: &str,
) -> Result<(), Error> {
    for _ in 0..10 {
        let _ = embed()?;
    }
    // Instruments enables shader sampling asynchronously after process launch.
    std::thread::sleep(std::time::Duration::from_secs(3));
    for _ in 0..3 {
        let _ = embed()?;
    }
    let mut timings = vec![];
    let mut last = vec![];
    let started_unix_ns = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    for i in 0..30 {
        unsafe { mark(i + 1, 1) };
        let start = Instant::now();
        last = embed()?;
        timings.push(start.elapsed().as_secs_f64() * 1000.0);
        unsafe { mark(i + 1, 0) };
    }
    let ended_unix_ns = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    assert_eq!(last.len(), 768);
    let norm = last
        .iter()
        .map(|x| f64::from(*x).powi(2))
        .sum::<f64>()
        .sqrt();
    let cosine = last
        .iter()
        .zip(expected)
        .map(|(a, b)| f64::from(*a) / norm * b)
        .sum::<f64>();
    assert!(last.iter().all(|v| v.is_finite()) && cosine >= 0.999);
    timings.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({"engine":engine,"tokens":82,"warmups":13,"trace_settle_ms":3000,"repeats":30,"median_ms":(timings[14]+timings[15])/2.0,"cosine":cosine,"started_unix_ns":started_unix_ns.to_string(),"ended_unix_ns":ended_unix_ns.to_string()})
    );
    Ok(())
}
fn main() -> Result<(), Error> {
    let args: Vec<_> = env::args().collect();
    if args.len() < 5 {
        return Err(
            "trace-bench mojo LIB WEIGHTS REFERENCE MARKERS | llama MODEL REFERENCE MARKERS".into(),
        );
    }
    let mojo = args[1] == "mojo";
    if (!mojo && args[1] != "llama") || args.len() != if mojo { 6 } else { 5 } {
        return Err("invalid trace-bench arguments".into());
    }
    let reference: serde_json::Value =
        serde_json::from_slice(&fs::read(&args[if mojo { 4 } else { 3 }])?)?;
    let ids: Vec<i32> = reference["rows"][0]["ids"]
        .as_array()
        .ok_or("missing token IDs")?
        .iter()
        .map(|v| v.as_i64().unwrap() as i32)
        .collect();
    let expected: Vec<f64> = reference["rows"][0]["vector"]
        .as_array()
        .ok_or("missing vector")?
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    assert_eq!(ids.len(), 82);
    assert_eq!(expected.len(), 768);
    unsafe {
        let markers = open(args.last().unwrap())?;
        let mark: Mark = std::mem::transmute(symbol(markers, "ib_trace_mark")?);
        let result = if mojo {
            let lib = open(&args[2])?;
            let init: unsafe extern "C" fn(*const c_char) -> *mut c_void =
                std::mem::transmute(symbol(lib, "ib_mojo_gpu_init")?);
            let embed: unsafe extern "C" fn(*mut c_void, *const i32, usize, *mut f32) -> i32 =
                std::mem::transmute(symbol(lib, "ib_mojo_gpu_embed")?);
            let free: unsafe extern "C" fn(*mut c_void) =
                std::mem::transmute(symbol(lib, "ib_mojo_gpu_free")?);
            let handle = init(CString::new(args[3].as_str())?.as_ptr());
            assert!(!handle.is_null());
            let result = measure(
                || {
                    let mut out = vec![0f32; 768];
                    let code = embed(handle, ids.as_ptr(), ids.len(), out.as_mut_ptr());
                    if code != 0 {
                        return Err(format!("Mojo status {code}").into());
                    }
                    Ok(out)
                },
                mark,
                &expected,
                "mojo",
            );
            free(handle);
            assert_eq!(dlclose(lib), 0);
            result
        } else {
            let mut backend = LlamaBackend::init()?;
            backend.void_logs();
            let model = LlamaModel::load_from_file(
                &backend,
                &args[2],
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
            let tokens: Vec<_> = ids.iter().copied().map(LlamaToken::new).collect();
            let mut batch = LlamaBatch::new(ids.len(), 1);
            batch.add_sequence(&tokens, 0, false)?;
            let result = measure(
                || {
                    ctx.clear_kv_cache();
                    ctx.decode(&mut batch)?;
                    Ok(ctx.embeddings_seq_ith(0)?.to_vec())
                },
                mark,
                &expected,
                "llama",
            );
            drop(ctx);
            drop(model);
            drop(backend);
            result
        };
        assert_eq!(dlclose(markers), 0);
        result?;
    }
    Ok(())
}
