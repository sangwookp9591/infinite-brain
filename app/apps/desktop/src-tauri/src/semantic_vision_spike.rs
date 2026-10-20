// SPDX-License-Identifier: Apache-2.0
//! Compare image-only and the server's single-decode mixed-batch path.

use super::vision::{add_position, context, decode, Owned};
use super::{dot, query_text, N_CTX};
use llama_cpp_sys_2 as sys;
use std::{ffi::CString, path::PathBuf};

enum Part {
    Text(Vec<i32>),
    Image(Vec<f32>),
}

#[test]
#[ignore]
fn real_model_images_single_decode() {
    let model_path = CString::new(std::env::var("IB_SMART_SEARCH_MODEL").expect("set IB_SMART_SEARCH_MODEL")).unwrap();
    let projector = CString::new(std::env::var("IB_SMART_SEARCH_MMPROJ").expect("set IB_SMART_SEARCH_MMPROJ")).unwrap();
    let images = PathBuf::from(std::env::var("IB_SMART_SEARCH_IMAGES").expect("set IB_SMART_SEARCH_IMAGES"));
    let mut backend = match llama_cpp_2::llama_backend::LlamaBackend::init() {
        Ok(backend) => Some(backend),
        // Serial ignored tests may already have started the shared engine thread.
        Err(llama_cpp_2::LlamaCppError::BackendAlreadyInitialized) => None,
        Err(error) => panic!("llama backend failed: {error}"),
    };
    if let Some(backend) = backend.as_mut() {
        backend.void_logs();
    }
    // SAFETY: trusted, tiny synthetic inputs; all returned pointers are checked,
    // encoded buffers stay alive through decode, and children drop before parents.
    let outcome = unsafe {
        (|| -> Result<(), String> {
            let mut params = sys::llama_model_default_params();
            params.n_gpu_layers = 999;
            let model =
                Owned::new(sys::llama_model_load_from_file(model_path.as_ptr(), params), sys::llama_model_free)?;
            if sys::llama_model_n_embd_out(model.ptr()) != 768 {
                return Err("wrong output dimensions".into());
            }
            let dim = usize::try_from(sys::llama_model_n_embd_inp(model.ptr())).map_err(|e| e.to_string())?;
            if dim == 0 || dim > 4096 {
                return Err("unexpected input dimensions".into());
            }
            let vision = Owned::new(
                sys::mtmd_init_from_file(projector.as_ptr(), model.ptr(), sys::mtmd_context_params_default()),
                sys::mtmd_free,
            )?;
            if sys::mtmd_decode_use_mrope(vision.ptr()) {
                return Err("unexpected M-RoPE projector".into());
            }
            let mut text_vectors = Vec::new();
            let queries = ["a red circle", "the sea", "a page of text"];
            for query in queries {
                let ctx = context(&model)?;
                let batch = Owned::new(sys::llama_batch_ext_init(ctx.ptr()), sys::llama_batch_ext_free)?;
                let text = CString::new(query_text(query)).unwrap();
                let mut tokens = vec![0; text.as_bytes().len() + 8];
                let count = sys::llama_tokenize(
                    sys::llama_model_get_vocab(model.ptr()),
                    text.as_ptr(),
                    text.as_bytes().len() as i32,
                    tokens.as_mut_ptr(),
                    tokens.len() as i32,
                    true,
                    false,
                );
                if count <= 0 || count as usize > N_CTX {
                    return Err(format!("tokenize failed: {count}"));
                }
                for (pos, token) in tokens[..count as usize].iter().enumerate() {
                    let index = sys::llama_batch_ext_add_token(batch.ptr(), 0, *token);
                    add_position(&batch, index, pos as i32)?;
                }
                text_vectors.push(decode(&ctx, &batch)?);
            }

            let names = ["circle.png", "sea.png", "document.png"];
            let mut vectors: [Vec<Vec<f32>>; 2] = [Vec::new(), Vec::new()];
            for name in names {
                let file = CString::new(images.join(name).to_str().unwrap()).unwrap();
                let bitmap = sys::mtmd_helper_bitmap_init_from_file(
                    vision.ptr(),
                    file.as_ptr(),
                    false,
                    sys::mtmd_helper_init_opt_default(),
                );
                let bitmap = Owned::new(bitmap.bitmap, sys::mtmd_bitmap_free)?;
                let chunks = Owned::new(sys::mtmd_input_chunks_init(), sys::mtmd_input_chunks_free)?;
                let input = sys::mtmd_input_text {
                    text: sys::mtmd_default_marker(),
                    text_len: 0,
                    add_special: true,
                    parse_special: true,
                };
                let input =
                    sys::mtmd_input_text { text_len: std::ffi::CStr::from_ptr(input.text).to_bytes().len(), ..input };
                let bitmap_ptr = bitmap.ptr() as *const sys::mtmd_bitmap;
                if sys::mtmd_tokenize(vision.ptr(), chunks.ptr(), &input, &bitmap_ptr, 1) != 0 {
                    return Err("multimodal tokenization failed".into());
                }
                let total = sys::mtmd_helper_get_n_tokens(chunks.ptr());
                if total == 0 || total > N_CTX {
                    return Err(format!("input exceeds one ubatch: {total}"));
                }
                let mut parts = Vec::new();
                for i in 0..sys::mtmd_input_chunks_size(chunks.ptr()) {
                    let chunk = sys::mtmd_input_chunks_get(chunks.ptr(), i);
                    match sys::mtmd_input_chunk_get_type(chunk) {
                        sys::MTMD_INPUT_CHUNK_TYPE_TEXT => {
                            let mut count = 0;
                            let ptr = sys::mtmd_input_chunk_get_tokens_text(chunk, &mut count);
                            if count > 0 {
                                if ptr.is_null() {
                                    return Err("missing text tokens".into());
                                }
                                parts.push(Part::Text(std::slice::from_raw_parts(ptr, count).to_vec()));
                            }
                        }
                        sys::MTMD_INPUT_CHUNK_TYPE_IMAGE => {
                            let count = sys::mtmd_input_chunk_get_n_tokens(chunk);
                            if count == 0 || count > N_CTX || sys::mtmd_encode_chunk(vision.ptr(), chunk) != 0 {
                                return Err("image encoding failed".into());
                            }
                            let ptr = sys::mtmd_get_output_embd(vision.ptr());
                            if ptr.is_null() {
                                return Err("missing encoded image".into());
                            }
                            parts.push(Part::Image(std::slice::from_raw_parts(ptr, count * dim).to_vec()));
                        }
                        _ => return Err("unexpected media type".into()),
                    }
                }
                for (mode, corpus) in vectors.iter_mut().enumerate() {
                    let ctx = context(&model)?;
                    let batch = Owned::new(sys::llama_batch_ext_init(ctx.ptr()), sys::llama_batch_ext_free)?;
                    let mut pos = 0;
                    for part in &parts {
                        match part {
                            Part::Text(tokens) if mode == 1 => {
                                for token in tokens {
                                    let index = sys::llama_batch_ext_add_token(batch.ptr(), 0, *token);
                                    add_position(&batch, index, pos)?;
                                    pos += 1;
                                }
                            }
                            Part::Image(rows) => {
                                for row in rows.chunks_exact(dim) {
                                    let index = sys::llama_batch_ext_add_embd(
                                        batch.ptr(),
                                        0,
                                        sys::llama_embd { data: row.as_ptr(), n_rows: 1, n_embd: dim },
                                    );
                                    add_position(&batch, index, pos)?;
                                    pos += 1;
                                }
                            }
                            _ => {}
                        }
                    }
                    eprintln!(
                        "mode={}, image={name}, one-decode tokens={pos}, causal={}",
                        ["image-only", "mixed"][mode],
                        sys::llama_get_causal_attn(ctx.ptr())
                    );
                    corpus.push(decode(&ctx, &batch)?);
                }
            }
            let mut mixed_passes = true;
            for (mode, corpus) in vectors.iter().enumerate() {
                eprintln!(
                    "mode={}, cross-cosines={:?}",
                    ["image-only", "mixed"][mode],
                    [dot(&corpus[0], &corpus[1]), dot(&corpus[0], &corpus[2]), dot(&corpus[1], &corpus[2])]
                );
                for (expected, query) in queries.iter().enumerate() {
                    let mut ranks: Vec<_> =
                        corpus.iter().enumerate().map(|(i, v)| (i, dot(&text_vectors[expected], v))).collect();
                    ranks.sort_by(|a, b| b.1.total_cmp(&a.1));
                    eprintln!(
                        "mode={}, query={query:?}, ranking={:?}",
                        ["image-only", "mixed"][mode],
                        ranks.iter().map(|(i, s)| (names[*i], s)).collect::<Vec<_>>()
                    );
                    if mode == 1 && ranks[0].0 != expected {
                        mixed_passes = false;
                    }
                }
            }
            if !mixed_passes {
                return Err("mixed single-decode image ranking failed".into());
            }
            Ok(())
        })()
    };
    drop(backend);
    outcome.unwrap();
}
