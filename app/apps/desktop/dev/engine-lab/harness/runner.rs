// SPDX-License-Identifier: Apache-2.0
use libloading::Library;
use serde::Deserialize;
use std::{
    env,
    error::Error,
    ffi::{c_char, c_void, CStr, CString},
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
type Result<T> = std::result::Result<T, Box<dyn Error>>;
type Init = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type Embed = unsafe extern "C" fn(*mut c_void, *const i32, usize, *mut f32) -> i32;
type Batch = unsafe extern "C" fn(*mut c_void, *const i32, *const usize, usize, *mut f32) -> i32;
type Free = unsafe extern "C" fn(*mut c_void);
type Stats = unsafe extern "C" fn(*mut c_void, *mut u32, *mut u32) -> i32;
const LOCK: &str = "/private/tmp/ib-gpu-bench.lock";
struct GpuLock;
impl GpuLock {
    fn acquire() -> Result<Self> {
        loop {
            match fs::create_dir(LOCK) {
                Ok(()) => return Ok(Self),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    thread::sleep(Duration::from_millis(500))
                }
                Err(e) => return Err(e.into()),
            }
        }
    }
}
impl Drop for GpuLock {
    fn drop(&mut self) {
        if let Err(e) = fs::remove_dir(LOCK) {
            eprintln!("lock cleanup: {e}");
        }
    }
}
struct Engine {
    handle: *mut c_void,
    embed: Embed,
    batch: Option<Batch>,
    free: Free,
    stats: Option<Stats>,
    name: String,
    _lib: Library,
}
impl Drop for Engine {
    fn drop(&mut self) {
        unsafe { (self.free)(self.handle) }
    }
}
impl Engine {
    unsafe fn load(lib: &str, model: &str) -> Result<Self> {
        let lib = Library::new(lib)?;
        let init: Init = *lib.get(b"ib_engine_init")?;
        let embed: Embed = *lib.get(b"ib_engine_embed")?;
        let free: Free = *lib.get(b"ib_engine_free")?;
        let name: unsafe extern "C" fn() -> *const c_char = *lib.get(b"ib_engine_name")?;
        let name_ptr = name();
        if name_ptr.is_null() {
            return Err("NULL engine name".into());
        }
        let name = CStr::from_ptr(name_ptr).to_str()?.to_owned();
        if name.is_empty() || name.contains([',', '\n', '\r']) {
            return Err("invalid CSV engine name".into());
        }
        let batch = lib.get::<Batch>(b"ib_engine_embed_batch").ok().map(|f| *f);
        let stats = lib.get::<Stats>(b"ib_engine_stats").ok().map(|f| *f);
        let handle = init(CString::new(model)?.as_ptr());
        if handle.is_null() {
            return Err("engine init failed".into());
        }
        Ok(Self {
            handle,
            embed,
            batch,
            free,
            stats,
            name,
            _lib: lib,
        })
    }
    fn call(&self, tokens: &[i32], lens: &[usize], out: &mut [f32]) -> Result<()> {
        if lens.is_empty()
            || lens.iter().sum::<usize>() != tokens.len()
            || out.len() != 768 * lens.len()
        {
            return Err("invalid packed input".into());
        }
        unsafe {
            if lens.len() == 1 {
                let rc = (self.embed)(self.handle, tokens.as_ptr(), lens[0], out.as_mut_ptr());
                if rc != 0 {
                    return Err(format!("embed returned {rc}").into());
                }
            } else if let Some(batch) = self.batch {
                let rc = batch(
                    self.handle,
                    tokens.as_ptr(),
                    lens.as_ptr(),
                    lens.len(),
                    out.as_mut_ptr(),
                );
                if rc != 0 {
                    return Err(format!("batch returned {rc}").into());
                }
            } else {
                let mut offset = 0;
                for (i, &n) in lens.iter().enumerate() {
                    let rc = (self.embed)(
                        self.handle,
                        tokens[offset..].as_ptr(),
                        n,
                        out[i * 768..].as_mut_ptr(),
                    );
                    if rc != 0 {
                        return Err(format!("fallback returned {rc}").into());
                    }
                    offset += n;
                }
            }
        }
        Ok(())
    }
    fn counters(&self, nseq: usize) -> (String, String) {
        if nseq > 1 && self.batch.is_none() {
            return (String::new(), String::new());
        }
        let (mut a, mut b) = (0, 0);
        if let Some(stats) = self.stats {
            if unsafe { stats(self.handle, &mut a, &mut b) } == 0 {
                return (a.to_string(), b.to_string());
            }
        }
        (String::new(), String::new())
    }
}
#[derive(Deserialize)]
struct Row {
    ids: Vec<i32>,
    vector: Vec<f32>,
}
#[derive(Deserialize)]
struct Reference {
    rows: Vec<Row>,
}
fn compare(actual: &[f32], expected: &[f32]) -> Result<(f64, f64)> {
    if actual.len() != 768
        || expected.len() != 768
        || actual.iter().chain(expected).any(|v| !v.is_finite())
    {
        return Err("invalid embedding".into());
    }
    let norm = |v: &[f32]| v.iter().map(|&x| f64::from(x).powi(2)).sum::<f64>().sqrt();
    let (a, b) = (norm(actual), norm(expected));
    if (a - 1.0).abs() > 1e-4 || b < 1e-12 {
        return Err(format!("invalid vector norm {a}/{b}").into());
    }
    let cos = actual
        .iter()
        .zip(expected)
        .map(|(&x, &y)| f64::from(x) * f64::from(y))
        .sum::<f64>()
        / a
        / b;
    let diff = actual
        .iter()
        .zip(expected)
        .map(|(&x, &y)| (f64::from(x) - f64::from(y)).abs())
        .fold(0.0, f64::max);
    if cos < 0.999 {
        return Err(format!("accuracy gate cosine {cos}").into());
    }
    Ok((cos, diff))
}
fn capture(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd)
        .args(args)
        .output()
        .map(|o| {
            if o.status.success() {
                String::from_utf8_lossy(&o.stdout).trim().to_owned()
            } else {
                format!("unavailable: {}", String::from_utf8_lossy(&o.stderr).trim())
            }
        })
        .unwrap_or_else(|e| format!("unavailable: {e}"))
}
fn sha256_bytes(bytes: &[u8]) -> Result<String> {
    let mut child = Command::new("shasum")
        .args(["-a", "256"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or("missing hash stdin")?
        .write_all(bytes)?;
    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err("SHA-256 failed".into());
    }
    let hash = String::from_utf8(output.stdout)?
        .split_whitespace()
        .next()
        .ok_or("missing SHA-256")?
        .to_owned();
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid SHA-256".into());
    }
    Ok(hash)
}
fn model_fingerprint(path: &Path) -> Result<(String, serde_json::Value)> {
    if path.is_file() {
        let output = Command::new("shasum")
            .args(["-a", "256"])
            .arg(path)
            .output()?;
        if !output.status.success() {
            return Err("model SHA-256 failed".into());
        }
        let hash = String::from_utf8(output.stdout)?
            .split_whitespace()
            .next()
            .ok_or("missing model SHA-256")?
            .to_owned();
        return Ok((hash, serde_json::Value::Null));
    }
    fn walk(dir: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_symlink() {
                return Err("model tree symlinks require a materialized snapshot".into());
            }
            if kind.is_dir() {
                walk(&entry.path(), files)?;
            } else if kind.is_file() {
                files.push(entry.path());
            }
        }
        Ok(())
    }
    let mut files = vec![];
    walk(path, &mut files)?;
    files.sort();
    if files.is_empty() {
        return Err("empty model directory".into());
    }
    let mut entries = vec![];
    for file in files {
        let (hash, _) = model_fingerprint(&file)?;
        entries.push(serde_json::json!({"path":file.strip_prefix(path)?.to_str().ok_or("non-UTF8 model path")?,"sha256":hash}));
    }
    let manifest = serde_json::json!({"algorithm":"ib-model-tree-v1","files":entries});
    Ok((sha256_bytes(&serde_json::to_vec(&manifest)?)?, manifest))
}
fn redact_hardware(text: &str) -> String {
    text.lines()
        .filter(|line| {
            !["Serial Number", "Hardware UUID", "Provisioning UDID"]
                .iter()
                .any(|key| line.contains(key))
        })
        .collect::<Vec<_>>()
        .join("\n")
}
fn env_record() -> serde_json::Value {
    serde_json::json!({"hardware":redact_hardware(&capture("system_profiler",&["SPHardwareDataType","SPDisplaysDataType"])),"os":capture("sw_vers",&[]),"rust":capture("rustc",&["-Vv"]),"cargo":capture("cargo",&["-V"]),"clang":capture("clang",&["--version"]),"xcode":capture("xcodebuild",&["-version"]),"power":capture("pmset",&["-g","batt"]),"swap":capture("sysctl",&["vm.swapusage"]),"vm_stat":capture("vm_stat",&[]),"thermal":capture("pmset",&["-g","therm"]),"thermal_process_info":capture("./build/thermal",&[]),"mojo":capture("/private/tmp/ib-mojo-spike/venv/bin/mojo",&["--version"])})
}
fn poisson(seed: &mut u64, qps: f64) -> f64 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    let u = ((*seed >> 11) as f64 + 0.5) / (1u64 << 53) as f64;
    -u.ln() / qps
}
fn main() -> Result<()> {
    let a: Vec<_> = env::args().collect();
    if a.len() != 7 {
        return Err("runner LIB MODEL REFERENCE OUT_PREFIX PROCESS CALLS".into());
    }
    let process: usize = a[5].parse()?;
    let calls: usize = a[6].parse()?;
    if calls == 0 {
        return Err("calls must be positive".into());
    }
    let reference: Reference = serde_json::from_slice(&fs::read(&a[3])?)?;
    if reference.rows.len() != 20
        || reference
            .rows
            .iter()
            .any(|r| r.ids.is_empty() || r.ids.len() > 2048)
    {
        return Err("invalid 20-case fixture".into());
    }
    let ids = &reference.rows[0].ids;
    let (model_hash, model_manifest) = model_fingerprint(Path::new(&a[2]))?;
    let mut meta = serde_json::json!({"library":fs::canonicalize(&a[1])?,"model":fs::canonicalize(&a[2])?,"model_sha256":model_hash,"model_manifest":model_manifest,"library_sha256":capture("shasum",&["-a","256",&a[1]]),"reference_sha256":capture("shasum",&["-a","256",&a[3]]),"process":process,"pid":std::process::id(),"calls":calls,"warmup":10,"tokens":ids.len(),"environment_before":env_record(),"started_unix_s":SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs_f64(),"gate_passed":false});
    fs::write(format!("{}.json", a[4]), serde_json::to_vec_pretty(&meta)?)?;
    eprintln!("waiting for GPU bench lock");
    let _lock = GpuLock::acquire()?;
    eprintln!("GPU bench lock acquired");
    meta["environment_before"] = env_record();
    let e = unsafe { Engine::load(&a[1], &a[2])? };
    meta["engine"] = e.name.clone().into();
    meta["native_batch"] = e.batch.is_some().into();
    let mut accuracy = vec![];
    for r in &reference.rows {
        let mut out = vec![0.0; 768];
        e.call(&r.ids, &[r.ids.len()], &mut out)?;
        let (c, d) = compare(&out, &r.vector)?;
        accuracy.push(serde_json::json!({"cosine":c,"max_abs_diff":d}));
    }
    let lens: Vec<_> = reference.rows.iter().map(|r| r.ids.len()).collect();
    let packed: Vec<_> = reference.rows.iter().flat_map(|r| r.ids.clone()).collect();
    let mut out = vec![0.0; 768 * 20];
    e.call(&packed, &lens, &mut out)?;
    let mut mixed = vec![];
    for (i, r) in reference.rows.iter().enumerate() {
        let (c, d) = compare(&out[i * 768..(i + 1) * 768], &r.vector)?;
        mixed.push(serde_json::json!({"cosine":c,"max_abs_diff":d}));
    }
    meta["accuracy"] = accuracy.into();
    meta["mixed_batch_accuracy"] = mixed.into();
    meta["gate_passed"] = true.into();
    let factors: serde_json::Value =
        serde_json::from_str(&env::var("IB_ENGINE_FACTORS").unwrap_or_else(|_| "{}".into()))?;
    let factor_values: Vec<_> = ["kernel", "host", "precision", "submission"]
        .iter()
        .map(|key| factors[key].as_str().unwrap_or("unknown").to_owned())
        .collect();
    if factor_values.iter().any(|s| s.contains([',', '\n', '\r'])) {
        return Err("invalid CSV factor value".into());
    }
    let factor_csv = factor_values.join(",");
    meta["factors"] = factors;
    let mut csv = File::create(format!("{}.csv", a[4]))?;
    writeln!(csv,"engine,process,scenario,batch_size,qps,iteration,service_ms,latency_ms,throughput,command_buffers,dispatches,factor_kernel,factor_host,factor_precision,factor_submission")?;
    let mut out = vec![0.0; 768];
    for _ in 0..10 {
        e.call(ids, &[ids.len()], &mut out)?;
    }
    for i in 0..calls {
        let start = Instant::now();
        e.call(ids, &[ids.len()], &mut out)?;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        let (c, d) = e.counters(1);
        writeln!(
            csv,
            "{},{process},SingleStream,1,0,{i},{ms},{ms},{},{c},{d},{factor_csv}",
            e.name,
            1000.0 / ms
        )?;
    }
    eprintln!("{} process {} SingleStream complete", e.name, process);
    // Each Offline sample processes exactly 100 independent paragraphs including its remainder group.
    for size in [1usize, 4, 8, 16, 32, 64, 100] {
        let packed: Vec<_> = (0..size).flat_map(|_| ids.iter().copied()).collect();
        let lengths = vec![ids.len(); size];
        let mut output = vec![0.0; size * 768];
        for _ in 0..10 {
            e.call(&packed, &lengths, &mut output)?;
        }
        for v in output.chunks_exact(768) {
            compare(v, &reference.rows[0].vector)?;
        }
        for i in 0..calls {
            let start = Instant::now();
            let (mut cb, mut dispatch, mut known) = (0u64, 0u64, true);
            let mut counter_time = Duration::ZERO;
            for from in (0..100).step_by(size) {
                let count = size.min(100 - from);
                e.call(
                    &packed[..count * ids.len()],
                    &lengths[..count],
                    &mut output[..count * 768],
                )?;
                let counter_started = Instant::now();
                let (c, d) = e.counters(count);
                if let (Ok(c), Ok(d)) = (c.parse::<u64>(), d.parse::<u64>()) {
                    cb += c;
                    dispatch += d;
                } else {
                    known = false;
                }
                counter_time += counter_started.elapsed();
            }
            // Optional stats must not penalize engines that expose instrumentation.
            let ms = (start.elapsed() - counter_time).as_secs_f64() * 1000.0;
            let (c, d) = if known {
                (cb.to_string(), dispatch.to_string())
            } else {
                (String::new(), String::new())
            };
            writeln!(
                csv,
                "{},{process},Offline,{size},0,{i},{ms},{ms},{},{c},{d},{factor_csv}",
                e.name,
                100000.0 / ms
            )?;
        }
        for v in output.chunks_exact(768) {
            compare(v, &reference.rows[0].vector)?;
        }
        // Validate after workspace growth and remainder execution, outside the timed samples.
        e.call(ids, &[ids.len()], &mut out)?;
        compare(&out, &reference.rows[0].vector)?;
        csv.flush()?;
        eprintln!(
            "{} process {} Offline batch {} complete",
            e.name, process, size
        );
    }
    for qps in [5.0, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 80.0, 100.0] {
        for _ in 0..10 {
            e.call(ids, &[ids.len()], &mut out)?;
        }
        let mut seed = 0x1b2026u64 + process as u64;
        let mut due = 0.0;
        let epoch = Instant::now();
        for i in 0..calls {
            due += poisson(&mut seed, qps);
            let target = epoch + Duration::from_secs_f64(due);
            let now = Instant::now();
            if now < target {
                thread::sleep(target - now);
            }
            let start = Instant::now();
            e.call(ids, &[ids.len()], &mut out)?;
            let end = Instant::now();
            let service = end.duration_since(start).as_secs_f64() * 1000.0;
            let latency = end.duration_since(target).as_secs_f64() * 1000.0;
            let (c, d) = e.counters(1);
            writeln!(
                csv,
                "{},{process},Server,1,{qps},{i},{service},{latency},{},{c},{d},{factor_csv}",
                e.name,
                ((i + 1) as f64) / epoch.elapsed().as_secs_f64()
            )?;
        }
    }
    if model_fingerprint(Path::new(&a[2]))?.0
        != meta["model_sha256"].as_str().ok_or("missing model hash")?
    {
        return Err("model artifact changed during process".into());
    }
    meta["environment_after"] = env_record();
    meta["finished_unix_s"] = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_secs_f64()
        .into();
    fs::write(format!("{}.json", a[4]), serde_json::to_vec_pretty(&meta)?)?;
    csv.flush()?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn optional_batch_fallback_preserves_offsets_and_errors() {
        unsafe extern "C" fn embed(_: *mut c_void, t: *const i32, _: usize, out: *mut f32) -> i32 {
            if *t < 0 {
                return -2;
            }
            *out = *t as f32;
            0
        }
        unsafe extern "C" fn free(_: *mut c_void) {}
        unsafe extern "C" fn stats(_: *mut c_void, a: *mut u32, b: *mut u32) -> i32 {
            *a = 1;
            *b = 2;
            0
        }
        let engine = Engine {
            handle: std::ptr::null_mut(),
            embed,
            batch: None,
            free,
            stats: Some(stats),
            name: "fallback-test".into(),
            _lib: unsafe { Library::new("/usr/lib/libSystem.B.dylib").unwrap() },
        };
        let mut out = vec![0.; 768 * 3];
        engine
            .call(&[5, 6, 7, 8, 9, 10], &[1, 2, 3], &mut out)
            .unwrap();
        assert_eq!([out[0], out[768], out[1536]], [5., 6., 8.]);
        assert_eq!(engine.counters(3), (String::new(), String::new()));
        assert_eq!(engine.counters(1), ("1".into(), "2".into()));
        assert!(engine.call(&[-1], &[1], &mut out[..768]).is_err());
        assert!(engine.call(&[1, 2], &[1], &mut out[..768]).is_err());
    }
    #[test]
    fn hashes_model_directory_and_redacts_identifiers() {
        let dir = PathBuf::from("build").join(format!(
            "hash-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join("weights")).unwrap();
        fs::write(dir.join("weights/a"), b"a").unwrap();
        fs::write(dir.join("Manifest.json"), b"{}").unwrap();
        let (before, manifest) = model_fingerprint(&dir).unwrap();
        assert_eq!(before.len(), 64);
        assert_eq!(manifest["files"].as_array().unwrap().len(), 2);
        assert_eq!(before, model_fingerprint(&dir).unwrap().0);
        fs::write(dir.join("weights/a"), b"b").unwrap();
        assert_ne!(before, model_fingerprint(&dir).unwrap().0);
        fs::remove_dir_all(dir).unwrap();
        assert_eq!(redact_hardware("Chip: M5\nSerial Number: private\nHardware UUID: private\nProvisioning UDID: private\nMemory: 24 GB"),"Chip: M5\nMemory: 24 GB");
    }
    #[test]
    fn rejects_nan_and_nonunit() {
        let mut x = vec![0.0; 768];
        x[0] = 1.0;
        assert!(compare(&x, &x).is_ok());
        let mut y = x.clone();
        y[1] = f32::NAN;
        assert!(compare(&y, &x).is_err());
        y[1] = 0.0;
        y[0] = 0.5;
        assert!(compare(&y, &x).is_err());
    }
    #[test]
    fn deterministic_poisson_mean() {
        let mut seed = 1;
        let mean = (0..100000).map(|_| poisson(&mut seed, 20.0)).sum::<f64>() / 100000.0;
        assert!((mean - 0.05).abs() < 0.001);
    }
}
