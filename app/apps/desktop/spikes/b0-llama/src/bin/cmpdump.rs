// SPDX-License-Identifier: Apache-2.0
//! 두 `bench --dump` 결과(같은 입력, 다른 양자화)의 벡터별 코사인 유사도를 비교한다.
//! 사용: cmpdump <ref.txt> <other.txt>
fn rows(p: &str) -> Vec<Vec<f32>> {
    std::fs::read_to_string(p)
        .unwrap()
        .lines()
        .map(|l| l.split_whitespace().map(|x| x.parse().unwrap()).collect())
        .collect()
}
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (x, y) = (rows(&a[1]), rows(&a[2]));
    let cs: Vec<f32> = x
        .iter()
        .zip(&y)
        .map(|(p, q)| {
            let d: f32 = p.iter().zip(q).map(|(u, v)| u * v).sum();
            d / (p.iter().map(|u| u * u).sum::<f32>().sqrt() * q.iter().map(|u| u * u).sum::<f32>().sqrt())
        })
        .collect();
    let min = cs.iter().cloned().fold(f32::MAX, f32::min);
    println!("n={} cos_min={min:.5} cos_avg={:.5}", cs.len(), cs.iter().sum::<f32>() / cs.len() as f32);
}
