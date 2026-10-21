// SPDX-License-Identifier: Apache-2.0
use llama_cpp_2::{
    context::{
        params::{LlamaAttentionType, LlamaContextParams, LlamaPoolingType},
        LlamaContext,
    },
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, LlamaModel},
    token::LlamaToken,
};
use std::{
    ffi::{c_char, c_void, CStr},
    num::NonZeroU32,
    panic::{catch_unwind, AssertUnwindSafe},
    slice,
};
// Fields drop in order: context must die before its boxed model and backend.
struct Engine {
    ctx: Option<LlamaContext<'static>>,
    model: Box<LlamaModel>,
    _backend: LlamaBackend,
    size: usize,
    capacity: usize,
}
#[no_mangle]
pub unsafe extern "C" fn ib_engine_init(path: *const c_char) -> *mut c_void {
    catch_unwind(|| -> Option<*mut c_void> {
        if path.is_null() {
            return None;
        }
        let path = CStr::from_ptr(path).to_str().ok()?;
        let mut backend = LlamaBackend::init().ok()?;
        backend.void_logs();
        let model = Box::new(
            LlamaModel::load_from_file(
                &backend,
                path,
                &LlamaModelParams::default().with_n_gpu_layers(999),
            )
            .ok()?,
        );
        Some(
            Box::into_raw(Box::new(Engine {
                ctx: None,
                model,
                _backend: backend,
                size: 0,
                capacity: 0,
            }))
            .cast(),
        )
    })
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}
unsafe fn run(e: *mut c_void, tokens: *const i32, lens: &[usize], out: *mut f32) -> i32 {
    if e.is_null()
        || tokens.is_null()
        || out.is_null()
        || lens.is_empty()
        || lens.len() > 100
        || lens.iter().any(|&n| n == 0 || n > 2048)
    {
        return -1;
    }
    let total: usize = lens.iter().sum();
    if total > 16384 {
        return -1;
    }
    let e = &mut *e.cast::<Engine>();
    let tokens = slice::from_raw_parts(tokens, total);
    if tokens.iter().any(|&t| t < 0 || t >= e.model.n_vocab()) {
        return -2;
    }
    if lens.len() > e.size || total > e.capacity || (lens.len() == 1 && e.size != 1) {
        e.ctx = None;
        // The box address is stable and ctx is dropped first; calls are serialized by the ABI.
        let model: &'static LlamaModel = &*(&*e.model as *const LlamaModel);
        let capacity =
            ((256 * lens.len()).max(2048).max(total).div_ceil(lens.len()) * lens.len()) as u32;
        let p = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(capacity))
            .with_n_batch(capacity)
            .with_n_ubatch(capacity)
            .with_n_seq_max(lens.len() as u32)
            .with_kv_unified(true)
            .with_embeddings(true)
            .with_pooling_type(LlamaPoolingType::Mean)
            .with_attention_type(LlamaAttentionType::NonCausal)
            .with_n_threads(4)
            .with_n_threads_batch(4);
        match model.new_context(&e._backend, p) {
            Ok(ctx) => e.ctx = Some(ctx),
            Err(_) => return -4,
        };
        e.size = lens.len();
        e.capacity = capacity as usize;
    }
    let mut b = LlamaBatch::new(total, lens.len() as i32);
    let mut offset = 0;
    for (seq, &n) in lens.iter().enumerate() {
        let ids: Vec<_> = tokens[offset..offset + n]
            .iter()
            .map(|&t| LlamaToken(t))
            .collect();
        if b.add_sequence(&ids, seq as i32, false).is_err() {
            return -4;
        }
        offset += n;
    }
    let ctx = e.ctx.as_mut().unwrap();
    ctx.clear_kv_cache();
    if ctx.decode(&mut b).is_err() {
        return -4;
    }
    let out = slice::from_raw_parts_mut(out, 768 * lens.len());
    for i in 0..lens.len() {
        let Ok(v) = ctx.embeddings_seq_ith(i as i32) else {
            return -4;
        };
        if v.len() != 768 {
            return -3;
        }
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if !norm.is_finite() || norm <= 0.0 {
            return -3;
        }
        for (a, b) in out[i * 768..(i + 1) * 768].iter_mut().zip(v) {
            *a = *b / norm;
        }
    }
    0
}
#[no_mangle]
pub unsafe extern "C" fn ib_engine_embed(
    e: *mut c_void,
    t: *const i32,
    n: usize,
    o: *mut f32,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| run(e, t, &[n], o))).unwrap_or(-4)
}
#[no_mangle]
pub unsafe extern "C" fn ib_engine_embed_batch(
    e: *mut c_void,
    t: *const i32,
    l: *const usize,
    n: usize,
    o: *mut f32,
) -> i32 {
    if l.is_null() || n == 0 || n > 100 {
        return -1;
    }
    catch_unwind(AssertUnwindSafe(|| {
        run(e, t, slice::from_raw_parts(l, n), o)
    }))
    .unwrap_or(-4)
}
#[no_mangle]
pub unsafe extern "C" fn ib_engine_free(e: *mut c_void) {
    if !e.is_null() {
        drop(Box::from_raw(e.cast::<Engine>()));
    }
}
#[no_mangle]
pub extern "C" fn ib_engine_name() -> *const c_char {
    b"llama-cpp-q8-metal\0".as_ptr().cast()
}
