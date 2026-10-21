// SPDX-License-Identifier: Apache-2.0
//! Isolated M5 host for existing AOT Mojo kernels. One command buffer / serial encoder per call.
use memmap2::Mmap;
use objc2::{
    rc::{Retained, autoreleasepool},
    runtime::ProtocolObject,
};
use objc2_foundation::{NSString, NSURL};
use objc2_metal::*;
use std::{
    collections::HashMap,
    ffi::{CStr, c_char, c_void},
    fs::File,
    path::Path,
    ptr::NonNull,
};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {}

type Obj<T> = Retained<ProtocolObject<T>>;
type Buffer = Obj<dyn MTLBuffer>;
type Pipeline = Obj<dyn MTLComputePipelineState>;
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Clone, Copy, Debug)]
struct Tensor {
    offset: usize,
    k: usize,
    d: usize,
    count: usize,
}

fn expected(i: usize) -> (usize, usize) {
    let mut k = 512;
    let mut d = 1;
    match i {
        0 => d = 262144,
        1 => d = 12288,
        4 => d = 768,
        5.. => {
            let layer = (i - 5) / 17;
            let head = if layer % 6 == 5 { 512 } else { 256 };
            match (i - 5) % 17 {
                1 => d = 4 * head,
                2 | 3 | 13 | 14 => d = 512,
                4 => {
                    k = 4 * head;
                    d = 512;
                }
                5 | 6 => k = head,
                9 | 10 => d = 2048,
                11 => {
                    k = 2048;
                    d = 512;
                }
                16 => k = 1,
                _ => {}
            }
        }
        _ => {}
    }
    (k, d)
}

fn validate(bytes: &[u8]) -> Result<Vec<Tensor>> {
    if bytes.len() < 16384 || &bytes[..8] != b"IBMOJO01" {
        return Err("invalid header".into());
    }
    let u64_at = |p: usize| u64::from_le_bytes(bytes[p..p + 8].try_into().unwrap()) as usize;
    if u64_at(8) != 413 || u64_at(16) != bytes.len() {
        return Err("invalid model extent".into());
    }
    let mut table = Vec::with_capacity(413);
    let mut end = 16384;
    for i in 0..413 {
        let at = 32 + i * 32;
        let t = Tensor {
            offset: u64_at(at),
            k: u64_at(at + 8),
            d: u64_at(at + 16),
            count: u64_at(at + 24),
        };
        let (k, d) = expected(i);
        if (t.k, t.d, t.count) != (k, d, k * d)
            || t.offset != end
            || t.count > (bytes.len() - end) / 4
        {
            return Err(format!("invalid tensor {i}: {t:?}").into());
        }
        end += t.count * 4;
        table.push(t);
    }
    if end != bytes.len() {
        return Err("unclaimed model bytes".into());
    }
    Ok(table)
}

fn alloc(device: &ProtocolObject<dyn MTLDevice>, bytes: usize) -> Result<Buffer> {
    device
        .newBufferWithLength_options(bytes.max(4), MTLResourceOptions::StorageModeShared)
        .ok_or_else(|| format!("Metal allocation failed ({bytes} bytes)").into())
}

struct Work {
    x: Buffer,
    z: Buffer,
    y: Buffer,
    ple: Buffer,
    q: Buffer,
    k: Buffer,
    v: Buffer,
    a: Buffer,
    qkv: Buffer,
    ff: Buffer,
    half: Buffer,
    pooled: Buffer,
    result: Buffer,
    ids: Buffer,
    pos: Buffer,
    starts: Buffer,
    lens: Buffer,
    offsets: Buffer,
    lengths: Buffer,
    partials: Buffer,
    args: Buffer,
    tokens: usize,
    seqs: usize,
}
impl Work {
    fn new(d: &ProtocolObject<dyn MTLDevice>, n: usize, s: usize) -> Result<Self> {
        Ok(Self {
            x: alloc(d, n * 512 * 4)?,
            z: alloc(d, n * 512 * 4)?,
            y: alloc(d, n * 512 * 4)?,
            ple: alloc(d, n * 12288 * 4)?,
            q: alloc(d, n * 2048 * 4)?,
            k: alloc(d, n * 512 * 4)?,
            v: alloc(d, n * 512 * 4)?,
            a: alloc(d, n * 2048 * 4)?,
            qkv: alloc(d, n * 3072 * 4)?,
            ff: alloc(d, n * 4096 * 4)?,
            half: alloc(d, n * 2048 * 2)?,
            pooled: alloc(d, s * 512 * 4)?,
            result: alloc(d, s * 768 * 4)?,
            ids: alloc(d, n * 4)?,
            pos: alloc(d, n * 4)?,
            starts: alloc(d, n * 4)?,
            lens: alloc(d, n * 4)?,
            offsets: alloc(d, s * 4)?,
            lengths: alloc(d, s * 4)?,
            partials: alloc(d, 4 * 512 * 2048 * 4)?,
            args: alloc(d, 2 * 1024 * 1024)?,
            tokens: n,
            seqs: s,
        })
    }
    fn resources(&self) -> [&Buffer; 21] {
        [
            &self.x,
            &self.z,
            &self.y,
            &self.ple,
            &self.q,
            &self.k,
            &self.v,
            &self.a,
            &self.qkv,
            &self.ff,
            &self.half,
            &self.pooled,
            &self.result,
            &self.ids,
            &self.pos,
            &self.starts,
            &self.lens,
            &self.offsets,
            &self.lengths,
            &self.partials,
            &self.args,
        ]
    }
}

// shortcut: pinned Mojo AIR ABI; regenerate and revalidate these layouts on compiler updates.
#[derive(Clone, Copy)]
struct Arg {
    words: [u64; 4],
    len: usize,
}
fn ptr(b: &Buffer) -> Arg {
    addr(b, 0)
}
fn addr(b: &Buffer, offset: usize) -> Arg {
    Arg {
        words: [b.gpuAddress() + offset as u64, 0, 0, 0],
        len: 8,
    }
}
fn int(i: usize) -> Arg {
    Arg {
        words: [i as u32 as u64, 0, 0, 0],
        len: 4,
    }
}
fn float(f: f32) -> Arg {
    int(f.to_bits() as usize)
}
fn tile(b: &Buffer, offset: usize, rows: usize, cols: usize) -> Arg {
    Arg {
        words: [
            b.gpuAddress() + offset as u64,
            rows as u64,
            cols as u64,
            cols as u64,
        ],
        len: 32,
    }
}

struct Encode<'a> {
    enc: Obj<dyn MTLComputeCommandEncoder>,
    args: &'a Buffer,
    pipelines: &'a HashMap<String, Pipeline>,
    cursor: usize,
    dispatches: usize,
    ended: bool,
}
impl Encode<'_> {
    fn end(&mut self) {
        self.enc.endEncoding();
        self.ended = true;
    }
    fn launch(&mut self, name: &str, args: &[Arg], threads: usize, block: usize) {
        self.enc.setComputePipelineState(&self.pipelines[name]);
        for (index, a) in args.iter().enumerate() {
            assert!(self.cursor + 256 <= self.args.length());
            unsafe {
                std::ptr::copy_nonoverlapping(
                    a.words.as_ptr().cast::<u8>(),
                    self.args.contents().as_ptr().cast::<u8>().add(self.cursor),
                    a.len,
                );
                self.enc
                    .setBuffer_offset_atIndex(Some(self.args), self.cursor, index);
            }
            self.cursor += 256;
        }
        self.enc.dispatchThreadgroups_threadsPerThreadgroup(
            MTLSize {
                width: threads.div_ceil(block),
                height: 1,
                depth: 1,
            },
            MTLSize {
                width: block,
                height: 1,
                depth: 1,
            },
        );
        // All data buffers are indirect GPU addresses, so dependencies need an explicit barrier.
        self.enc.memoryBarrierWithScope(MTLBarrierScope::Buffers);
        self.dispatches += 1;
    }

    fn mm(
        &mut self,
        a: &Buffer,
        b: &Buffer,
        bo: usize,
        c: &Buffer,
        m: usize,
        k: usize,
        n: usize,
        partials: &Buffer,
    ) {
        let gm = m.div_ceil(64);
        let gn = n.div_ceil(64);
        let sm = gm.next_power_of_two();
        let sn = gn.next_power_of_two();
        let strips = k.div_ceil(16);
        let tiles = gm * gn;
        if tiles <= 16 && strips >= 32 && strips >= 8 * tiles {
            let hint = (strips / 4).min(64 / tiles).max(2);
            let per = strips.div_ceil(hint);
            let splits = strips.div_ceil(per);
            assert!(splits * m * n * 4 <= partials.length());
            self.launch(
                "split_partial",
                &[
                    ptr(partials),
                    tile(a, 0, m, k),
                    tile(b, bo, n, k),
                    int(sm.ilog2() as usize),
                    int(sn.ilog2() as usize),
                    int(per * 16),
                ],
                sm * sn * splits * 128,
                128,
            );
            self.launch(
                "split_reduce",
                &[tile(c, 0, m, n), ptr(partials), int(splits)],
                m * n,
                256,
            );
        } else {
            self.launch(
                "matmul",
                &[
                    tile(c, 0, m, n),
                    tile(a, 0, m, k),
                    tile(b, bo, n, k),
                    int(sm.ilog2() as usize),
                    int(sn.ilog2() as usize),
                ],
                sm * sn * 128,
                128,
            );
        }
    }
}

impl Drop for Encode<'_> {
    fn drop(&mut self) {
        if !self.ended {
            self.enc.endEncoding();
        }
    }
}

pub struct Model {
    device: Obj<dyn MTLDevice>,
    queue: Obj<dyn MTLCommandQueue>,
    weights: Buffer,
    half_weights: Buffer,
    table: Vec<Tensor>,
    pipelines: HashMap<String, Pipeline>,
    work: Work,
    pub last_dispatches: usize,
}
impl Model {
    pub fn new(path: &Path) -> Result<Self> {
        let file = File::open(path)?;
        let map = unsafe { Mmap::map(&file)? };
        let table = validate(&map)?;
        let dir = std::env::var("E1_OUT").unwrap_or_else(|_| "/private/tmp/ib-engine-e1".into());
        let names: HashMap<String, String> =
            serde_json::from_slice(&std::fs::read(format!("{dir}/kernels.json"))?)?;
        for key in [
            "matmul",
            "split_partial",
            "split_reduce",
            "attention_full",
            "attention_local",
            "gather",
            "geglu_half",
            "half_copy",
            "l2",
            "normalize_copy",
            "normalize_half",
            "ple_half",
            "pool",
            "projected_rope_full",
            "projected_rope_local",
            "rms",
            "rms_residual",
        ] {
            if !names.contains_key(key) {
                return Err(format!("kernel manifest missing {key}").into());
            }
        }
        let device = MTLCreateSystemDefaultDevice().ok_or("Metal device unavailable")?;
        if !device.name().to_string().contains("Apple M5") {
            return Err("this prototype requires Apple M5".into());
        }
        let queue = device.newCommandQueue().ok_or("Metal queue unavailable")?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(&format!("{dir}/mojo.metallib")));
        let lib = device.newLibraryWithURL_error(&url)?;
        let mut pipelines = HashMap::new();
        for (key, name) in names {
            let f = lib
                .newFunctionWithName(&NSString::from_str(&name))
                .ok_or("missing kernel")?;
            pipelines.insert(key, device.newComputePipelineStateWithFunction_error(&f)?);
        }
        let weights = unsafe {
            device.newBufferWithBytes_length_options(
                NonNull::new(map.as_ptr() as *mut c_void).unwrap(),
                map.len(),
                MTLResourceOptions::StorageModeShared,
            )
        }
        .ok_or("weight allocation failed")?;
        let half_weights = alloc(&device, map.len() / 2)?;
        let work = Work::new(&device, 1, 1)?;
        let cb = queue.commandBuffer().ok_or("command buffer unavailable")?;
        cb.setLabel(Some(&NSString::from_str("E1 initialize FP16 weights")));
        let enc = cb
            .computeCommandEncoder()
            .ok_or("compute encoder unavailable")?;
        enc.useResource_usage(ProtocolObject::from_ref(&*weights), MTLResourceUsage::Read);
        enc.useResource_usage(
            ProtocolObject::from_ref(&*half_weights),
            MTLResourceUsage::Write,
        );
        let mut e = Encode {
            enc,
            args: &work.args,
            pipelines: &pipelines,
            cursor: 0,
            dispatches: 0,
            ended: false,
        };
        e.launch(
            "half_copy",
            &[ptr(&weights), ptr(&half_weights), int(map.len() / 4)],
            map.len() / 4,
            256,
        );
        e.end();
        cb.commit();
        cb.waitUntilCompleted();
        if cb.status() != MTLCommandBufferStatus::Completed {
            return Err(format!("Metal init: {:?}", cb.error()).into());
        }
        drop(e);
        Ok(Self {
            device,
            queue,
            weights,
            half_weights,
            table,
            pipelines,
            work,
            last_dispatches: 0,
        })
    }

    pub fn embed(&mut self, ids: &[i32], lengths: &[i32]) -> Result<Vec<f32>> {
        if lengths.is_empty()
            || lengths.len() > 100
            || lengths.iter().any(|&n| !(1..=2048).contains(&n))
        {
            return Err("invalid lengths".into());
        }
        let n: usize = lengths.iter().map(|&n| n as usize).sum();
        let s = lengths.len();
        if n > 16384 || ids.len() != n || ids.iter().any(|&id| !(0..262144).contains(&id)) {
            return Err("invalid tokens".into());
        }
        if n > self.work.tokens || s > self.work.seqs {
            self.work = Work::new(&self.device, n.max(self.work.tokens), s.max(self.work.seqs))?;
        }
        let w = &self.work;
        unsafe {
            std::ptr::copy_nonoverlapping(ids.as_ptr(), w.ids.contents().as_ptr().cast::<i32>(), n);
            std::ptr::copy_nonoverlapping(
                lengths.as_ptr(),
                w.lengths.contents().as_ptr().cast::<i32>(),
                s,
            );
            let mut start = 0;
            for (seq, &len) in lengths.iter().enumerate() {
                *w.offsets.contents().as_ptr().cast::<i32>().add(seq) = start as i32;
                for t in 0..len as usize {
                    *w.pos.contents().as_ptr().cast::<i32>().add(start + t) = t as i32;
                    *w.starts.contents().as_ptr().cast::<i32>().add(start + t) = start as i32;
                    *w.lens.contents().as_ptr().cast::<i32>().add(start + t) = len;
                }
                start += len as usize;
            }
        }
        let cb = self
            .queue
            .commandBuffer()
            .ok_or("command buffer unavailable")?;
        cb.setLabel(Some(&NSString::from_str("E1 paragraph forward")));
        let enc = cb
            .computeCommandEncoder()
            .ok_or("compute encoder unavailable")?;
        enc.setLabel(Some(&NSString::from_str("E1 all layers")));
        for b in w.resources() {
            enc.useResource_usage(
                ProtocolObject::from_ref(&**b),
                MTLResourceUsage::Read | MTLResourceUsage::Write,
            );
        }
        enc.useResource_usage(
            ProtocolObject::from_ref(&*self.weights),
            MTLResourceUsage::Read,
        );
        enc.useResource_usage(
            ProtocolObject::from_ref(&*self.half_weights),
            MTLResourceUsage::Read,
        );
        let mut e = Encode {
            enc,
            args: &w.args,
            pipelines: &self.pipelines,
            cursor: 0,
            dispatches: 0,
            ended: false,
        };
        let fw = |i: usize| addr(&self.weights, self.table[i].offset);
        let hw = |i: usize| self.table[i].offset / 2;
        e.launch(
            "gather",
            &[ptr(&w.x), fw(0), ptr(&w.ids), int(n)],
            n * 512,
            256,
        );
        e.launch(
            "half_copy",
            &[ptr(&w.x), ptr(&w.half), int(n * 512)],
            n * 512,
            256,
        );
        e.mm(
            &w.half,
            &self.half_weights,
            hw(1),
            &w.ple,
            n,
            512,
            12288,
            &w.partials,
        );
        e.launch(
            "rms",
            &[
                ptr(&w.ple),
                fw(2),
                int(n * 24),
                int(512),
                float(1.0 / 512f32.sqrt()),
            ],
            n * 24 * 32,
            128,
        );
        for layer in 0..24 {
            let i = 5 + layer * 17;
            let full = layer % 6 == 5;
            let d = if full { 512 } else { 256 };
            let qdim = 4 * d;
            e.launch(
                "normalize_half",
                &[ptr(&w.x), fw(i), ptr(&w.half), int(n)],
                n * 32,
                128,
            );
            e.mm(
                &w.half,
                &self.half_weights,
                hw(i + 1),
                &w.qkv,
                n,
                512,
                qdim + 1024,
                &w.partials,
            );
            e.launch(
                if full {
                    "projected_rope_full"
                } else {
                    "projected_rope_local"
                },
                &[
                    ptr(&w.qkv),
                    ptr(&w.q),
                    ptr(&w.k),
                    ptr(&w.v),
                    fw(i + 5),
                    fw(i + 6),
                    ptr(&w.pos),
                    int(n),
                    float(if full { 1e6 } else { 1e4 }),
                ],
                n * if full { 6 } else { 8 } * 32,
                128,
            );
            e.launch(
                if full {
                    "attention_full"
                } else {
                    "attention_local"
                },
                &[
                    ptr(&w.q),
                    ptr(&w.k),
                    ptr(&w.v),
                    ptr(&w.a),
                    ptr(&w.starts),
                    ptr(&w.lens),
                    int(n),
                ],
                n * 4 * 32,
                128,
            );
            e.launch(
                "half_copy",
                &[ptr(&w.a), ptr(&w.half), int(n * qdim)],
                n * qdim,
                256,
            );
            e.mm(
                &w.half,
                &self.half_weights,
                hw(i + 4),
                &w.y,
                n,
                qdim,
                512,
                &w.partials,
            );
            e.launch(
                "rms_residual",
                &[ptr(&w.x), ptr(&w.y), fw(i + 7), fw(i + 16), int(n), int(0)],
                n * 32,
                128,
            );
            e.launch(
                "normalize_half",
                &[ptr(&w.x), fw(i + 8), ptr(&w.half), int(n)],
                n * 32,
                128,
            );
            e.mm(
                &w.half,
                &self.half_weights,
                hw(i + 9),
                &w.ff,
                n,
                512,
                4096,
                &w.partials,
            );
            e.launch(
                "geglu_half",
                &[ptr(&w.ff), ptr(&w.half), int(n * 2048)],
                n * 2048,
                256,
            );
            e.mm(
                &w.half,
                &self.half_weights,
                hw(i + 11),
                &w.y,
                n,
                2048,
                512,
                &w.partials,
            );
            e.launch(
                "rms_residual",
                &[ptr(&w.x), ptr(&w.y), fw(i + 12), fw(i + 16), int(n), int(0)],
                n * 32,
                128,
            );
            e.launch(
                "half_copy",
                &[ptr(&w.x), ptr(&w.half), int(n * 512)],
                n * 512,
                256,
            );
            e.mm(
                &w.half,
                &self.half_weights,
                hw(i + 13),
                &w.z,
                n,
                512,
                512,
                &w.partials,
            );
            e.launch(
                "ple_half",
                &[
                    ptr(&w.z),
                    ptr(&w.ple),
                    ptr(&w.half),
                    int(n * 512),
                    int(layer),
                ],
                n * 512,
                256,
            );
            e.mm(
                &w.half,
                &self.half_weights,
                hw(i + 14),
                &w.y,
                n,
                512,
                512,
                &w.partials,
            );
            e.launch(
                "rms_residual",
                &[ptr(&w.x), ptr(&w.y), fw(i + 15), fw(i + 16), int(n), int(1)],
                n * 32,
                128,
            );
        }
        e.launch(
            "normalize_copy",
            &[ptr(&w.x), fw(3), ptr(&w.z), int(n)],
            n * 32,
            128,
        );
        e.launch(
            "pool",
            &[
                ptr(&w.z),
                ptr(&w.pooled),
                ptr(&w.offsets),
                ptr(&w.lengths),
                int(s),
            ],
            s * 512,
            256,
        );
        e.launch(
            "half_copy",
            &[ptr(&w.pooled), ptr(&w.half), int(s * 512)],
            s * 512,
            256,
        );
        e.mm(
            &w.half,
            &self.half_weights,
            hw(4),
            &w.result,
            s,
            512,
            768,
            &w.partials,
        );
        e.launch("l2", &[ptr(&w.result), int(s)], s, 128);
        self.last_dispatches = e.dispatches;
        e.end();
        cb.commit();
        cb.waitUntilCompleted();
        if cb.status() != MTLCommandBufferStatus::Completed {
            return Err(format!("Metal forward: {:?}", cb.error()).into());
        }
        let out = unsafe {
            std::slice::from_raw_parts(w.result.contents().as_ptr().cast::<f32>(), s * 768)
        }
        .to_vec();
        if out.iter().any(|v| !v.is_finite()) {
            return Err("nonfinite output".into());
        }
        Ok(out)
    }
}

// These names deliberately match the existing verify.py GPU ABI, so the shared gate stays unchanged.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ib_mojo_gpu_init(path: *const c_char) -> *mut Model {
    if path.is_null() {
        return std::ptr::null_mut();
    }
    autoreleasepool(|_| {
        let result = std::panic::catch_unwind(|| {
            let path = unsafe { CStr::from_ptr(path) }.to_str()?;
            Model::new(Path::new(path))
        });
        match result {
            Ok(Ok(m)) => Box::into_raw(Box::new(m)),
            Ok(Err(e)) => {
                eprintln!("E1 init: {e}");
                std::ptr::null_mut()
            }
            Err(_) => std::ptr::null_mut(),
        }
    })
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ib_mojo_gpu_embed_batch(
    h: *mut Model,
    ids: *const i32,
    lengths: *const i32,
    count: usize,
    out: *mut f32,
) -> i32 {
    if h.is_null()
        || ids.is_null()
        || lengths.is_null()
        || out.is_null()
        || !(1..=100).contains(&count)
    {
        return -1;
    }
    let lens = unsafe { std::slice::from_raw_parts(lengths, count) };
    if lens.iter().any(|&n| !(1..=2048).contains(&n)) {
        return -1;
    }
    let n: usize = lens.iter().map(|&n| n as usize).sum();
    if n > 16384 {
        return -1;
    }
    let ids = unsafe { std::slice::from_raw_parts(ids, n) };
    if ids.iter().any(|&id| !(0..262144).contains(&id)) {
        return -2;
    }
    autoreleasepool(|_| {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            unsafe { &mut *h }.embed(ids, lens)
        }));
        match result {
            Ok(Ok(v)) => {
                unsafe { std::ptr::copy_nonoverlapping(v.as_ptr(), out, v.len()) };
                0
            }
            Ok(Err(e)) => {
                eprintln!("E1 forward: {e}");
                -4
            }
            Err(_) => -4,
        }
    })
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ib_mojo_gpu_embed(
    h: *mut Model,
    ids: *const i32,
    n: usize,
    out: *mut f32,
) -> i32 {
    if !(1..=2048).contains(&n) {
        return -1;
    }
    unsafe { ib_mojo_gpu_embed_batch(h, ids, &(n as i32), 1, out) }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ib_mojo_gpu_free(h: *mut Model) {
    if !h.is_null() {
        unsafe { drop(Box::from_raw(h)) };
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ib_engine_init(path: *const c_char) -> *mut Model {
    unsafe { ib_mojo_gpu_init(path) }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ib_engine_embed(
    h: *mut Model,
    ids: *const i32,
    n: usize,
    out: *mut f32,
) -> i32 {
    unsafe { ib_mojo_gpu_embed(h, ids, n, out) }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ib_engine_embed_batch(
    h: *mut Model,
    ids: *const i32,
    lens: *const usize,
    nseq: usize,
    out: *mut f32,
) -> i32 {
    if lens.is_null() || !(1..=100).contains(&nseq) {
        return -1;
    }
    let lengths = unsafe { std::slice::from_raw_parts(lens, nseq) };
    if lengths.iter().any(|&n| !(1..=2048).contains(&n)) {
        return -1;
    }
    let lengths: Vec<i32> = lengths.iter().map(|&n| n as i32).collect();
    unsafe { ib_mojo_gpu_embed_batch(h, ids, lengths.as_ptr(), nseq, out) }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ib_engine_stats(h: *mut Model, cb: *mut u32, dispatches: *mut u32) -> i32 {
    if h.is_null() || cb.is_null() || dispatches.is_null() {
        return -1;
    }
    unsafe {
        *cb = 1;
        *dispatches = (*h).last_dispatches as u32;
    }
    0
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ib_engine_free(h: *mut Model) {
    unsafe { ib_mojo_gpu_free(h) }
}
#[unsafe(no_mangle)]
pub extern "C" fn ib_engine_name() -> *const c_char {
    c"rust-metal-mojoair-fp16-one".as_ptr()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_model_layout_corruption_before_gpu_allocation() {
        assert!(validate(&[0; 16384]).is_err());
        assert_eq!(expected(0), (512, 262144));
        assert_eq!(expected(5 + 5 * 17 + 1), (512, 2048));
        assert_eq!(expected(5 + 4 * 17 + 4), (1024, 512));
        assert_eq!(expected(5 + 23 * 17 + 16), (1, 1));
        unsafe {
            assert_eq!(
                ib_mojo_gpu_embed(
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    0,
                    std::ptr::null_mut()
                ),
                -1
            );
            assert_eq!(
                ib_mojo_gpu_embed_batch(
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null(),
                    101,
                    std::ptr::null_mut()
                ),
                -1
            );
        }
    }
}
