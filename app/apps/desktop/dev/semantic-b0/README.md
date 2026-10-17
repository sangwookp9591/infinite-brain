# Semantic search B0 experiment

This directory is standalone and is not connected to desktop or server product code. See `../../../../../docs/reports/B0-MEASUREMENT.md` for the decision and results.

Requires Apple Silicon, Rust, clang/Xcode tools, Python 3, and network access. If CMake is not installed, install its binary within this experiment directory:

```sh
cd app/apps/desktop/dev/semantic-b0
python3 -m pip install --target tools/cmake cmake
```

Then download the pinned BGE-m3-ko Q8_0 artifact (605 MiB), build the standalone Rust prototype, and run the corpus comparison:

```sh
mkdir -p model
curl -L --fail -o model/BGE-m3-ko.Q8_0.gguf 'https://huggingface.co/CHKH01/BGE-m3-ko-GGUF/resolve/87d6f395b1fcefdfdd6bef326a2da1921ed226d9/BGE-m3-ko.Q8_0.gguf'
PATH="$PWD/tools/cmake/cmake/data/bin:$PATH" cargo build --release
python3 bench.py
```

`bench.py` verifies the model SHA-256 before inference. The model file, build target, temporary input, output, and local CMake installation are excluded by `.gitignore`. The corpus and script contain synthetic notes only. The Rust program uses `llama-cpp-2` with its `metal` feature and emits local vectors and runtime measurements.
