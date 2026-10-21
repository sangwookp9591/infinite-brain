// SPDX-License-Identifier: Apache-2.0
use std::{ffi::{CString,c_void},fs};
extern "C" {
    fn ib_engine_init(path: *const i8) -> *mut c_void;
    fn ib_engine_embed(e: *mut c_void, ids: *const i32, n: usize, out: *mut f32) -> i32;
    fn ib_engine_stats(e: *mut c_void, buffers: *mut u32, dispatches: *mut u32) -> i32;
    fn ib_engine_free(e: *mut c_void);
}
fn main() -> Result<(),Box<dyn std::error::Error>> {
    let args:Vec<_>=std::env::args().collect();
    if args.len()!=4 {return Err("zig-static-smoke WEIGHTS TOKENS.bin VECTOR.bin".into());}
    let tokens:Vec<_>=fs::read(&args[2])?.chunks_exact(4).map(|x|i32::from_le_bytes(x.try_into().unwrap())).collect();
    let expected:Vec<_>=fs::read(&args[3])?.chunks_exact(4).map(|x|f32::from_le_bytes(x.try_into().unwrap())).collect();
    assert_eq!(expected.len(),768);assert!(!tokens.is_empty());
    unsafe {
        let e=ib_engine_init(CString::new(args[1].as_bytes())?.as_ptr());assert!(!e.is_null());
        let mut out=[0f32;768];assert_eq!(ib_engine_embed(e,tokens.as_ptr(),tokens.len(),out.as_mut_ptr()),0);
        let norm=out.iter().map(|x|f64::from(*x).powi(2)).sum::<f64>().sqrt();
        let en=expected.iter().map(|x|f64::from(*x).powi(2)).sum::<f64>().sqrt();
        let cosine=out.iter().zip(expected).map(|(a,b)|f64::from(*a)*f64::from(b)).sum::<f64>()/norm/en;
        assert!(cosine>=0.999 && (norm-1.).abs()<1e-5);
        let(mut buffers,mut dispatches)=(0,0);assert_eq!(ib_engine_stats(e,&mut buffers,&mut dispatches),0);
        assert_eq!((buffers,dispatches),(1,367));ib_engine_free(e);
        println!("static Rust -> Zig -> ObjC -> MSL: cosine={cosine:.10}, buffers={buffers}, dispatches={dispatches}");
    }
    Ok(())
}
