<!-- SPDX-License-Identifier: Apache-2.0 -->
# B0-a llama.cpp 내장 실험

앱(`src-tauri`)과 분리된 독립 crate다. 결과와 해석은 `docs/reports/B0-LLAMA-SPIKE.md`에 있다.

```sh
# 1) 모델은 저장소 밖에 둔다(~/.cache/infinite-brain-b0/models). 보고서의 revision·SHA-256 표 참고.
# 2) cmake가 필요하다(예: python venv에 `pip install cmake`).
./scripts/vendor-llama.sh                                   # vendor/ 생성(커밋 안 됨)
B0_NO_METAL=1 cargo build --release --target-dir target/cpu --bin bench   # CPU 전용
cargo build --release --target-dir target/metal --bin bench               # macOS: Metal 포함
./scripts/run-bench.sh target/metal/release/bench <model.gguf> 99 4       # GPU 전 층
./scripts/matrix.sh                                                       # 전체 행렬
```
