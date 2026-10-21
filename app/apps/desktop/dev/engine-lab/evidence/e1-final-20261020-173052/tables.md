# Engine laboratory results

Independent process is the resampling/test unit; pooled call quantiles are descriptive. CI: median of process medians, 10,000 percentile-bootstrap draws, seed 20261020.

## Accuracy gate

| Engine | Processes | Min cosine | Mean cosine | Max abs diff | Mixed min cosine |
| --- | --- | --- | --- | --- | --- |
| llama-cpp-q8-metal | 5 | 1.000000000 | 1.000000000 | 0.000000000 | 0.999999711 |
| rust-metal-mojoair-fp16-one | 5 | 0.999708434 | 0.999928371 | 0.002856224 | 0.999700407 |

## SingleStream

| Engine | Mean ms | p50 ms | p90 ms | IQR ms | Process median CI95 ms | Calls | Processes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| llama-cpp-q8-metal | 16.236 | 15.875 | 18.706 | 1.993 | 14.755–18.756 | 150 | 5 |
| rust-metal-mojoair-fp16-one | 11.465 | 11.087 | 12.797 | 1.342 | 10.615–12.171 | 150 | 5 |

## Offline (100 paragraphs/trial)

| Engine | Batch | Mean paragraphs/s | Process SD | p50 trial ms |
| --- | --- | --- | --- | --- |
| llama-cpp-q8-metal | 1 | 56.301 | 1.706 | 1769.438 |
| llama-cpp-q8-metal | 4 | 95.078 | 7.766 | 1022.516 |
| llama-cpp-q8-metal | 8 | 103.965 | 4.903 | 957.869 |
| llama-cpp-q8-metal | 16 | 101.040 | 3.310 | 986.051 |
| llama-cpp-q8-metal | 32 | 97.997 | 6.354 | 1008.412 |
| llama-cpp-q8-metal | 64 | 89.547 | 6.896 | 1108.556 |
| llama-cpp-q8-metal | 100 | 82.513 | 4.926 | 1220.549 |
| rust-metal-mojoair-fp16-one | 1 | 83.585 | 5.341 | 1180.433 |
| rust-metal-mojoair-fp16-one | 4 | 122.397 | 7.728 | 819.037 |
| rust-metal-mojoair-fp16-one | 8 | 126.175 | 7.509 | 797.870 |
| rust-metal-mojoair-fp16-one | 16 | 128.436 | 6.836 | 770.246 |
| rust-metal-mojoair-fp16-one | 32 | 125.429 | 7.663 | 804.797 |
| rust-metal-mojoair-fp16-one | 64 | 123.099 | 7.911 | 820.185 |
| rust-metal-mojoair-fp16-one | 100 | 122.896 | 9.629 | 821.820 |

## Server (open-loop Poisson, one serialized engine worker)

| Engine | Target QPS | Completed QPS | p50 ms | p99 ms | p99 ≤50ms |
| --- | --- | --- | --- | --- | --- |
| llama-cpp-q8-metal | 5.0 | 5.278 | 26.445 | 60.372 | FAIL |
| llama-cpp-q8-metal | 10.0 | 10.507 | 26.831 | 57.328 | FAIL |
| llama-cpp-q8-metal | 20.0 | 20.716 | 33.700 | 93.966 | FAIL |
| llama-cpp-q8-metal | 30.0 | 29.722 | 34.644 | 117.058 | FAIL |
| llama-cpp-q8-metal | 40.0 | 37.937 | 45.474 | 154.111 | FAIL |
| llama-cpp-q8-metal | 50.0 | 44.497 | 58.725 | 174.755 | FAIL |
| llama-cpp-q8-metal | 60.0 | 48.317 | 76.702 | 209.243 | FAIL |
| llama-cpp-q8-metal | 80.0 | 50.331 | 115.280 | 289.049 | FAIL |
| llama-cpp-q8-metal | 100.0 | 53.758 | 144.704 | 321.740 | FAIL |
| rust-metal-mojoair-fp16-one | 5.0 | 5.286 | 17.063 | 53.421 | FAIL |
| rust-metal-mojoair-fp16-one | 10.0 | 10.531 | 17.825 | 47.060 | PASS |
| rust-metal-mojoair-fp16-one | 20.0 | 20.943 | 18.023 | 47.118 | PASS |
| rust-metal-mojoair-fp16-one | 30.0 | 31.238 | 18.919 | 51.915 | FAIL |
| rust-metal-mojoair-fp16-one | 40.0 | 41.211 | 15.137 | 41.513 | PASS |
| rust-metal-mojoair-fp16-one | 50.0 | 49.267 | 16.989 | 84.900 | FAIL |
| rust-metal-mojoair-fp16-one | 60.0 | 55.315 | 23.962 | 179.731 | FAIL |
| rust-metal-mojoair-fp16-one | 80.0 | 68.182 | 31.437 | 209.408 | FAIL |
| rust-metal-mojoair-fp16-one | 100.0 | 70.267 | 50.399 | 243.173 | FAIL |

Highest passing **tested** QPS: {"rust-metal-mojoair-fp16-one": 40.0, "llama-cpp-q8-metal": null}. Each pair/point has 150 requests; this is not sustained capacity proof.

## Comparisons

| Engine | Scenario | Batch | QPS | MWU p | Holm p | Cliff delta latency |
| --- | --- | --- | --- | --- | --- | --- |
| rust-metal-mojoair-fp16-one | Offline | 1 | 0.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Offline | 4 | 0.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Offline | 8 | 0.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Offline | 16 | 0.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Offline | 32 | 0.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Offline | 64 | 0.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Offline | 100 | 0.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Server | 1 | 5.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Server | 1 | 10.0 | 0.015873 | 0.134921 | -0.920 |
| rust-metal-mojoair-fp16-one | Server | 1 | 20.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Server | 1 | 30.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Server | 1 | 40.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Server | 1 | 50.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Server | 1 | 60.0 | 0.015873 | 0.134921 | -0.920 |
| rust-metal-mojoair-fp16-one | Server | 1 | 80.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | Server | 1 | 100.0 | 0.00793651 | 0.134921 | -1.000 |
| rust-metal-mojoair-fp16-one | SingleStream | 1 | 0.0 | 0.00793651 | 0.134921 | -1.000 |

All contrasts are one Holm family across candidates and levels; each candidate uses its adjacent baseline processes (five per pair). Negative delta means lower candidate latency. Small n=5 cannot support fine p-value resolution. Smoke runs omit inferential tests.

## Prediction before timing

Optimistic concurrent aggregate floor estimate: max(aggregate kernel floor, CPU commit cost), eta=1, host/gap/readback=0. It assumes measured copy BW/MPS peak act as ceilings; it is not a hardware-proven bound, a sum of per-kernel maxima, or a calibrated full-latency forecast. The separately labeled nonoverlap Amdahl illustration is an assumption, not a measured removable fraction. Q8 dequantization is not FP16 GEMM.

| Engine | Predicted floor ms | Measured p50 ms | Error | Amdahl illustration (nonoverlap) | Diagnostic |
| --- | --- | --- | --- | --- | --- |
| rust-metal-mojoair-fp16-one | unknown | 11.087 | N/A | unknown | candidate model not supplied |
| llama-cpp-q8-metal | 1.567 | 15.875 | +912.8% | 1.006 | Trace required |

Measured copy BW: 118.872 GB/s; best median MPS FP16 GEMM: 14.755 TFLOP/s; CPU commit cost: 3.312 µs; tiny-kernel depth-1 completion: 415.062 µs. These are microbenchmark observations, not vendor peak ratings.

## Factor coverage and limitations

Known original combinations are MSL/llama host/Q8/coalesced and Mojo/DeviceContext/FP16/per-operation. Arbitrary candidate factors and predictions are unknown unless independently supplied; names alone do not establish factor levels. A–D effects/interactions are not estimated by this harness. Batch E is measured across seven levels. Multiple candidates retain separate adjacent-baseline pairs. Optional command-buffer counters are blank when the engine lacks stats; trace-derived prediction counts are not runtime counters.
