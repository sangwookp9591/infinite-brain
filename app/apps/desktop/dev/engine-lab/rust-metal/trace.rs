// SPDX-License-Identifier: Apache-2.0
use ib_rust_metal::Model;
use std::{path::Path, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = std::env::args().collect();
    if a.len() != 3 {
        return Err("trace-e1 WEIGHTS REFERENCE".into());
    }
    let reference: serde_json::Value = serde_json::from_slice(&std::fs::read(&a[2])?)?;
    let ids: Vec<i32> = reference["rows"][0]["ids"]
        .as_array()
        .ok_or("ids")?
        .iter()
        .map(|v| v.as_i64().unwrap() as i32)
        .collect();
    assert_eq!(ids.len(), 82);
    objc2::rc::autoreleasepool(|_| -> Result<(), Box<dyn std::error::Error>> {
        let mut model = Model::new(Path::new(&a[1]))?;
        for _ in 0..10 {
            model.embed(&ids, &[82])?;
        }
        std::thread::sleep(std::time::Duration::from_secs(3));
        let mut ms = vec![];
        for _ in 0..30 {
            let start = Instant::now();
            let vector = model.embed(&ids, &[82])?;
            ms.push(start.elapsed().as_secs_f64() * 1000.0);
            let expected = reference["rows"][0]["vector"].as_array().ok_or("vector")?;
            let cosine: f64 = vector
                .iter()
                .zip(expected)
                .map(|(a, b)| f64::from(*a) * b.as_f64().unwrap())
                .sum();
            assert!(cosine >= 0.999);
        }
        ms.sort_by(f64::total_cmp);
        println!(
            "{}",
            serde_json::json!({"median_ms":(ms[14]+ms[15])/2.0,"command_buffers_per_call":1,
            "encoders_per_call":1,"dispatches_per_call":model.last_dispatches,"calls":40})
        );
        Ok(())
    })
}
