#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# llama-cpp-sys-2 0.1.160은 llama.cpp 2026-10-05 시점(d8123504)을 번들하는데, 이 시점에는
# gemma-embedding2 아키텍처가 없다(지원 커밋 4fbc76dec5는 10-06). 그래서 crate를 복사해
# llama.cpp 소스만 지정한 태그로 바꾼다. 결과는 vendor/ 에만 생기며 커밋하지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."
LLAMA_TAG="${LLAMA_TAG:-v0.7.0}"
SYS_VER=0.1.160
SRC=$(ls -d ~/.cargo/registry/src/*/llama-cpp-sys-2-$SYS_VER | head -1)
rm -rf vendor && mkdir -p vendor
cp -R "$SRC" vendor/llama-cpp-sys-2
chmod -R u+w vendor/llama-cpp-sys-2
rm -rf vendor/llama-cpp-sys-2/llama.cpp
mkdir -p vendor/llama-cpp-sys-2/llama.cpp
curl -sL "https://github.com/ggml-org/llama.cpp/archive/refs/tags/$LLAMA_TAG.tar.gz" \
  | tar -xz --strip-components=1 -C vendor/llama-cpp-sys-2/llama.cpp

# llama-cpp-2 래퍼도 새 llama.cpp의 llama_perf_context_data(n_reallocs_*) 필드를 모른다. 한 곳만 고친다.
WRAP=$(ls -d ~/.cargo/registry/src/*/llama-cpp-2-0.1.160 | head -1)
cp -R "$WRAP" vendor/llama-cpp-2
chmod -R u+w vendor/llama-cpp-2
sed -i '' 's/^\( *\)n_reused,$/\1n_reused,\n\1n_reallocs_diff: 0,\n\1n_reallocs_same: 0,/' vendor/llama-cpp-2/src/timing.rs
# macOS에서는 llama-cpp-sys-2가 Metal을 항상 켠다(`metal` feature는 효과 없음). CPU 전용 빌드를 비교하려고
# 환경변수 B0_NO_METAL=1 일 때 GGML_METAL=OFF 와 Metal 프레임워크 링크 생략을 하는 스위치를 build.rs에 넣는다.
python3 -I - <<'PY'
p = "vendor/llama-cpp-sys-2/build.rs"
s = open(p).read()
a = 'if matches!(target_os, TargetOs::Apple(AppleVariant::WatchOS)) {\n        config.define("GGML_METAL", "OFF");'
assert a in s
s = s.replace(a, 'println!("cargo:rerun-if-env-changed=B0_NO_METAL");\n    if std::env::var("B0_NO_METAL").is_ok() {\n        config.define("GGML_METAL", "OFF");\n    }\n    ' + a)
b = 'if !matches!(variant, AppleVariant::WatchOS) {'
assert b in s
s = s.replace(b, 'if !matches!(variant, AppleVariant::WatchOS) && std::env::var("B0_NO_METAL").is_err() {')
open(p, "w").write(s)
PY

echo "vendored llama.cpp $LLAMA_TAG into vendor/ (llama-cpp-sys-2 + patched llama-cpp-2)"
