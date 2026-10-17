# B0 implementation report

## Changes

- Added a standalone Rust `llama-cpp-2` / Metal embedding prototype, pinned GGUF download and SHA-256 check, synthetic multilingual retrieval corpus, and Python baseline evaluator under `app/apps/desktop/dev/semantic-b0/`.
- Compared semantic cosine search against source-level ports of server Unicode/bigram-hash ranking and desktop FTS5/trigram ranking. The final run reported hit@5/MRR of 1.000/1.000 for semantic (15 answerable queries), 0.933/0.888 for server (14/15), and 0.200/0.200 for desktop (3/15); each returned at least one result for the no-answer query except desktop.
- Recorded runtime choice, Apache-2.0 candidate licenses, BGE-m3-ko Q8_0 artifact revision and hash, speed, memory, probe binary size, per-category quality, and first-run copy in [B0-MEASUREMENT.md](B0-MEASUREMENT.md).
- Product files and product build configuration were not changed. Model and build artifacts are gitignored and removed after measurements.

## Verification

- `cargo fmt --check` in `app/apps/desktop/dev/semantic-b0/` — passed.
- `PATH="$PWD/tools/cmake/cmake/data/bin:$PATH" cargo build --release` — passed on Apple M4 / macOS 27.0.1, arm64; the CMake install used for this build was local to the experiment directory.
- `python3 bench.py` — passed, verified the model SHA-256, generated actual GGUF embeddings through Rust/Metal, and computed all three retrieval metrics.
- Corpus and Python syntax validation — passed (23 documents, 16 queries, one no-answer query).
- No desktop or server test suite was run because this change has no product code or integration path.

## Unverified and remaining work

- Actual Tauri app bundle size delta, minimum-supported device behavior, battery, sustained CPU, editor latency, and larger vault performance remain unverified. The reported 8.74 MiB binary increase compares a standalone probe against an empty Rust executable, not the packaged app.
- Windows and Linux runtime/build metrics are unverified. LiteRT-LM was not implemented or measured.
- The 23-note corpus is a smoke test, not a statistically valid quality benchmark. Production needs a larger independent corpus, a no-answer rejection threshold, and hybrid ranking.
- Before redistribution, include the applicable Apache-2.0 texts/notices and confirm model artifact attribution; model repositories declare Apache-2.0 but do not ship standalone license files.

## Commits

1. `feat(desktop): add standalone semantic B0 harness`
2. `docs: record B0 runtime and retrieval measurements`
