// SPDX-License-Identifier: Apache-2.0
//! Single-batch image embeddings; the generic mtmd eval_chunks helper loses pooling.

use super::{normalize, N_CTX};
use llama_cpp_sys_2 as sys;
use std::{ffi::CString, path::Path, ptr::NonNull};

pub(super) struct Owned<T>(NonNull<T>, unsafe extern "C" fn(*mut T));
impl<T> Owned<T> {
    pub(super) fn new(ptr: *mut T, free: unsafe extern "C" fn(*mut T)) -> Result<Self, String> {
        NonNull::new(ptr).map(|ptr| Self(ptr, free)).ok_or("null native handle".into())
    }
    pub(super) fn ptr(&self) -> *mut T {
        self.0.as_ptr()
    }
}
impl<T> Drop for Owned<T> {
    fn drop(&mut self) {
        // SAFETY: each handle is created once and freed before its parent handle.
        unsafe { (self.1)(self.ptr()) }
    }
}

pub(super) unsafe fn context(model: &Owned<sys::llama_model>) -> Result<Owned<sys::llama_context>, String> {
    let mut params = sys::llama_context_default_params();
    params.n_ctx = N_CTX as u32;
    params.n_batch = N_CTX as u32;
    params.n_ubatch = N_CTX as u32;
    params.n_threads = 4;
    params.n_threads_batch = 4;
    params.embeddings = true;
    params.pooling_type = sys::LLAMA_POOLING_TYPE_MEAN;
    params.attention_type = sys::LLAMA_ATTENTION_TYPE_NON_CAUSAL;
    Owned::new(sys::llama_init_from_model(model.ptr(), params), sys::llama_free)
}

pub(super) unsafe fn add_position(batch: &Owned<sys::llama_batch_ext>, index: i32, pos: i32) -> Result<(), String> {
    if index < 0
        || !sys::llama_batch_ext_set_pos(batch.ptr(), index, &pos)
        || !sys::llama_batch_ext_set_output_embd(batch.ptr(), index, true)
    {
        return Err("could not add a positioned output token".into());
    }
    Ok(())
}

pub(super) unsafe fn decode(
    ctx: &Owned<sys::llama_context>,
    batch: &Owned<sys::llama_batch_ext>,
) -> Result<Vec<f32>, String> {
    let ret = sys::llama_process(ctx.ptr(), sys::LLAMA_PROCESS_TYPE_DECODE, batch.ptr());
    if ret != 0 {
        return Err(format!("single decode failed: {ret}"));
    }
    let ptr = sys::llama_get_embeddings_seq(ctx.ptr(), 0);
    if ptr.is_null() {
        return Err("no pooled embedding".into());
    }
    normalize(std::slice::from_raw_parts(ptr, 768).to_vec()).ok_or("invalid embedding".into())
}

pub(super) struct Model {
    ctx: Owned<sys::llama_context>,
    vision: Owned<sys::mtmd_context>,
    _model: Owned<sys::llama_model>,
}

impl Model {
    /// Called only on the existing engine thread, after LlamaBackend::init.
    pub(super) fn load(path: &Path, projector: &Path) -> Result<Self, String> {
        let path = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let projector = CString::new(projector.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        // SAFETY: handles are checked and children are freed before the model.
        unsafe {
            let mut params = sys::llama_model_default_params();
            params.n_gpu_layers = 999;
            // shortcut: vision owns a second backbone, share it when the safe binding exposes mixed batches and its model pointer.
            let model = Owned::new(sys::llama_model_load_from_file(path.as_ptr(), params), sys::llama_model_free)?;
            if sys::llama_model_n_embd_out(model.ptr()) != 768 || sys::llama_model_n_embd_inp(model.ptr()) != 512 {
                return Err("unexpected vision model dimensions".into());
            }
            let vision = Owned::new(
                sys::mtmd_init_from_file(projector.as_ptr(), model.ptr(), sys::mtmd_context_params_default()),
                sys::mtmd_free,
            )?;
            if !sys::mtmd_support_vision(vision.ptr()) || sys::mtmd_decode_use_mrope(vision.ptr()) {
                return Err("unsupported image projector".into());
            }
            let ctx = context(&model)?;
            Ok(Self { ctx, vision, _model: model })
        }
    }

    pub(super) fn embed(&mut self, image: &image::RgbImage) -> Result<Vec<f32>, String> {
        let (width, height) = image.dimensions();
        if width == 0 || height == 0 || width > 1024 || height > 1024 {
            return Err("image must be downscaled before embedding".into());
        }
        // SAFETY: RGB image dimensions/length are owned and bounded; all native
        // pointers are checked, and encoded buffers outlive the single decode.
        unsafe {
            let bitmap =
                Owned::new(sys::mtmd_bitmap_init(width, height, image.as_raw().as_ptr()), sys::mtmd_bitmap_free)?;
            let chunks = Owned::new(sys::mtmd_input_chunks_init(), sys::mtmd_input_chunks_free)?;
            let marker = sys::mtmd_default_marker();
            let text = sys::mtmd_input_text {
                text: marker,
                text_len: std::ffi::CStr::from_ptr(marker).to_bytes().len(),
                add_special: true,
                parse_special: true,
            };
            let bitmap_ptr = bitmap.ptr() as *const sys::mtmd_bitmap;
            if sys::mtmd_tokenize(self.vision.ptr(), chunks.ptr(), &text, &bitmap_ptr, 1) != 0 {
                return Err("could not tokenize image".into());
            }
            let total = sys::mtmd_helper_get_n_tokens(chunks.ptr());
            if total == 0 || total > N_CTX {
                return Err("image exceeds one embedding batch".into());
            }
            let memory = sys::llama_get_memory(self.ctx.ptr());
            if !memory.is_null() {
                sys::llama_memory_clear(memory, true);
            }
            let batch = Owned::new(sys::llama_batch_ext_init(self.ctx.ptr()), sys::llama_batch_ext_free)?;
            let mut pos = 0;
            let mut encoded = Vec::new();
            for i in 0..sys::mtmd_input_chunks_size(chunks.ptr()) {
                let chunk = sys::mtmd_input_chunks_get(chunks.ptr(), i);
                match sys::mtmd_input_chunk_get_type(chunk) {
                    sys::MTMD_INPUT_CHUNK_TYPE_TEXT => {
                        let mut count = 0;
                        let tokens = sys::mtmd_input_chunk_get_tokens_text(chunk, &mut count);
                        if count == 0 {
                            continue;
                        }
                        if tokens.is_null() {
                            return Err("missing image text tokens".into());
                        }
                        for token in std::slice::from_raw_parts(tokens, count) {
                            let index = sys::llama_batch_ext_add_token(batch.ptr(), 0, *token);
                            add_position(&batch, index, pos)?;
                            pos += 1;
                        }
                    }
                    sys::MTMD_INPUT_CHUNK_TYPE_IMAGE => {
                        let count = sys::mtmd_input_chunk_get_n_tokens(chunk);
                        if count == 0 || count > N_CTX || sys::mtmd_encode_chunk(self.vision.ptr(), chunk) != 0 {
                            return Err("could not encode image".into());
                        }
                        let ptr = sys::mtmd_get_output_embd(self.vision.ptr());
                        if ptr.is_null() {
                            return Err("missing encoded image".into());
                        }
                        encoded.push(std::slice::from_raw_parts(ptr, count * 512).to_vec());
                        for row in encoded.last().unwrap().chunks_exact(512) {
                            let index = sys::llama_batch_ext_add_embd(
                                batch.ptr(),
                                0,
                                sys::llama_embd { data: row.as_ptr(), n_rows: 1, n_embd: 512 },
                            );
                            add_position(&batch, index, pos)?;
                            pos += 1;
                        }
                    }
                    _ => return Err("unexpected media type".into()),
                }
            }
            decode(&self.ctx, &batch)
        }
    }
}
