// SPDX-License-Identifier: Apache-2.0
use std::{
    env,
    ffi::{c_char, c_void, CStr, CString},
    fs,
};

unsafe extern "C" {
    fn dlopen(path: *const c_char, flags: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn dlerror() -> *const c_char;
    fn dlclose(handle: *mut c_void) -> i32;
}
type Init = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type Embed = unsafe extern "C" fn(*mut c_void, *const i32, usize, *mut f32) -> i32;
type Free = unsafe extern "C" fn(*mut c_void);

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 4 {
        return Err("ffi-smoke LIBRARY MODEL REFERENCE.json".into());
    }
    let library = CString::new(args[1].as_str())?;
    let path = CString::new(args[2].as_str())?;
    let reference: serde_json::Value = serde_json::from_slice(&fs::read(&args[3])?)?;
    unsafe {
        let lib = dlopen(library.as_ptr(), 2);
        if lib.is_null() {
            return Err(CStr::from_ptr(dlerror())
                .to_string_lossy()
                .into_owned()
                .into());
        }
        let symbol = |name: &str| -> Result<*mut c_void, Box<dyn std::error::Error>> {
            let ptr = dlsym(lib, CString::new(name)?.as_ptr());
            if ptr.is_null() {
                return Err(format!("missing {name}").into());
            }
            Ok(ptr)
        };
        let prefix = env::var("IB_MOJO_PREFIX").unwrap_or_else(|_| "ib_mojo".into());
        let init: Init = std::mem::transmute(symbol(&format!("{prefix}_init"))?);
        let embed: Embed = std::mem::transmute(symbol(&format!("{prefix}_embed"))?);
        let free: Free = std::mem::transmute(symbol(&format!("{prefix}_free"))?);
        assert!(init(CString::new("/nonexistent/embedding-model")?.as_ptr()).is_null());
        assert_eq!(
            embed(
                std::ptr::null_mut(),
                std::ptr::null(),
                0,
                std::ptr::null_mut()
            ),
            -1
        );
        let handle = init(path.as_ptr());
        assert!(!handle.is_null(), "model initialization failed");
        let mut min_cosine = 1.0_f64;
        let mut sum = 0.0;
        let rows = reference["rows"].as_array().ok_or("missing rows")?;
        for row in rows {
            let ids: Vec<_> = row["ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_i64().unwrap() as i32)
                .collect();
            let mut output = [0.0_f32; 768];
            assert_eq!(
                embed(handle, ids.as_ptr(), ids.len(), output.as_mut_ptr()),
                0
            );
            let norm = output
                .iter()
                .map(|v| f64::from(*v).powi(2))
                .sum::<f64>()
                .sqrt();
            assert!((norm - 1.0).abs() < 1e-5);
            let expected = row["vector"].as_array().unwrap();
            let en = expected
                .iter()
                .map(|v| v.as_f64().unwrap().powi(2))
                .sum::<f64>()
                .sqrt();
            let cosine = output
                .iter()
                .zip(expected)
                .map(|(a, b)| f64::from(*a) * b.as_f64().unwrap())
                .sum::<f64>()
                / norm
                / en;
            assert!(cosine >= 0.99, "cosine {cosine}");
            min_cosine = min_cosine.min(cosine);
            sum += cosine;
        }
        free(handle);
        assert_eq!(dlclose(lib), 0);
        println!(
            "{}",
            serde_json::json!({"ffi":"Rust -> Mojo C ABI","cases":rows.len(),"cosine_min":min_cosine,"cosine_mean":sum/rows.len() as f64})
        );
    }
    Ok(())
}
