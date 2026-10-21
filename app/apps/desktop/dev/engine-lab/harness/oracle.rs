// SPDX-License-Identifier: Apache-2.0
use llama_cpp_2::{
    llama_backend::LlamaBackend,
    model::{params::LlamaModelParams, LlamaModel},
};
use std::{env, ffi::CString, fs};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = env::args().collect();
    if a.len() != 4 {
        return Err("oracle MODEL INPUTS OUTPUT".into());
    }
    let mut backend = LlamaBackend::init()?;
    backend.void_logs();
    let model = LlamaModel::load_from_file(
        &backend,
        &a[1],
        &LlamaModelParams::default().with_n_gpu_layers(0),
    )?;
    let input: Vec<String> = serde_json::from_slice(&fs::read(&a[2])?)?;
    if input.len() != 20 {
        return Err("20 fixtures required".into());
    }
    let ids: Vec<Vec<i32>> = input
        .iter()
        .map(|s| {
            model
                .vocab()
                .tokenize(s.as_bytes(), true, false)
                .iter()
                .map(|t| t.0)
                .collect()
        })
        .collect();
    drop(model);
    drop(backend);
    let handle = unsafe { ib_llama::ib_engine_init(CString::new(a[1].as_str())?.as_ptr()) };
    if handle.is_null() {
        return Err("oracle init failed".into());
    }
    let result = (|| -> Result<_, Box<dyn std::error::Error>> {
        let mut rows = vec![];
        for (text, ids) in input.iter().zip(ids) {
            let mut out = vec![0f32; 768];
            let rc = unsafe {
                ib_llama::ib_engine_embed(handle, ids.as_ptr(), ids.len(), out.as_mut_ptr())
            };
            if rc != 0 {
                return Err(format!("oracle embed {rc}").into());
            }
            rows.push(serde_json::json!({"text":text,"ids":ids,"vector":out}));
        }
        Ok(serde_json::json!({"rows":rows,"model":a[1],"benchmark_tokens":82}))
    })();
    unsafe { ib_llama::ib_engine_free(handle) };
    fs::write(&a[3], serde_json::to_vec_pretty(&result?)?)?;
    Ok(())
}
