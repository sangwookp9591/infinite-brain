# B0: on-device semantic search runtime measurement

Date: 2026-10-17. Scope: standalone experiment at `app/apps/desktop/dev/semantic-b0/`; no product source, dependency manifest, or runtime path changed.

## Decision

The runtime prototype uses `llama-cpp-2` 0.1.160, with its `metal` feature, statically linked into a standalone Rust CLI. This demonstrates a viable in-process Rust/llama.cpp route on Apple Silicon. The crate follows a fast-moving llama.cpp API and needs a pinned release plus ongoing binding review before production adoption.

B0 selection: first choice BGE-m3-ko Q8_0 (GGUF) for Korean-heavy vaults; use Nomic Embed Text v2 MoE Q4_K_M as the smaller general-multilingual alternative when broader language coverage matters. EmbeddingGemma 2 remains the PRD-aligned candidate, but was not run through this prototype. The chosen BGE artifact is pinned to model repository revision `87d6f395b1fcefdfdd6bef326a2da1921ed226d9`. It is a 567M-parameter XLM-R model, 1024 output dimensions, with an 8,192-token context and CLS pooling. The model card reports 605 MiB for Q8_0 and 1.1 GiB for F16. Its repository declares Apache-2.0; the upstream Korean-tuned model also declares Apache-2.0. The model is a Korean-specialized candidate and does not replace the need to evaluate general multilingual performance on representative vaults.

| Candidate | Korean / multilingual fit | GGUF size | License / commercial distribution |
|---|---|---:|---|
| BGE-m3-ko Q8_0 (selected for B0) | Korean retrieval fine-tune on multilingual BGE-M3; model publisher reports Korean MIRACL cosine Accuracy@5 0.8732 and MRR@10 0.7262. Publisher-reported values, not independently re-run here. | 605 MiB | Apache-2.0 is declared by [GGUF repo](https://huggingface.co/CHKH01/BGE-m3-ko-GGUF) and [upstream model](https://huggingface.co/dragonkue/BGE-m3-ko); permits commercial use subject to [Apache-2.0 terms](https://www.apache.org/licenses/LICENSE-2.0). |
| Nomic Embed Text v2 MoE Q4_K_M | 101 languages; publisher reports MIRACL 65.80 (benchmark value from its model card). Broader multilingual coverage, not Korean-specialized. | 328.1 MiB (344,120,288 bytes) at revision `ffbcf4c99e5d617dda10ec8c0e9f75754b0cbb80` | [Model repo card](https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe-GGUF) declares Apache-2.0; see [license text](https://www.apache.org/licenses/LICENSE-2.0). |
| EmbeddingGemma 2 UD-Q4_K_XL / Q8_0 | PRD's preferred family; multimodal, 740M total parameters (270M text backbone). A current text-only GGUF listing exists; separate multimodal projector files are not needed for text-only use. | At Unsloth repo revision `031f0d4b35536f69ab3509d4893c923264fcf253`: UD-Q4_K_XL 167.5 MiB, Q8_0 295.5 MiB. Text-only files; no multimodal projector is needed. | [Google model card](https://gemma.ai/models/embeddinggemma/model-card-v2/) declares Apache-2.0; see [license text](https://www.apache.org/licenses/LICENSE-2.0). Pin the converted artifact and its exact notices before redistribution. |

Model files are runtime downloads, are excluded by the experiment `.gitignore`, and are not committed. Only BGE-m3-ko Q8_0 was downloaded for this experiment (605 MiB), below the 2 GB combined-download limit.

## Corpus and evaluation

`corpus.json` contains 23 synthetic notes, 16 queries (15 with known answers and one intentionally unanswerable), and distractors. Categories cover Korean, English, mixed-language, code, exact identifier/path, and no-answer cases. Metrics are hit@5 and MRR over answerable queries; no-answer false positives count queries where any result is returned in top 5. This small, hand-built set is a smoke comparison, not a statistically representative quality claim.

The Rust model embeds each query and each title+body chunk locally; rankings use cosine similarity. The baseline harness ports the current server `tokenize`/FNV bigram hash and scoring formula, and uses SQLite FTS5 `unicode61` plus `trigram` with the current desktop CJK substring / prefix-query rules. It is an algorithm-level source port, not a production server or desktop app invocation; baseline tie ordering and SQLite library version can differ from the product build. The synthetic corpus is small and the perfect model score is not a general quality claim. Semantic-only retrieval returns a result for the no-answer query; production needs a calibrated rejection threshold and hybrid ranking.

| Search path | hit@5 | MRR | No-answer queries returning any top-5 result |
|---|---:|---:|---:|
| Semantic BGE-m3-ko Q8_0 | 1.000 (15/15) | 1.000 | 1/1 |
| Desktop FTS5 + trigram source port | 0.200 (3/15) | 0.200 | 0/1 |
| Server Unicode + bigram hash source port | 0.933 (14/15) | 0.888 | 1/1 |

Per-category results (hit@5 / MRR; queries per category in parentheses):

| Category | Semantic | Desktop source port | Server source port |
|---|---:|---:|---:|
| Korean (6) | 1.00 / 1.00 | 0.17 / 0.17 | 1.00 / 1.00 |
| English (4) | 1.00 / 1.00 | 0.00 / 0.00 | 0.75 / 0.77 |
| Mixed language (2) | 1.00 / 1.00 | 0.50 / 0.50 | 1.00 / 0.63 |
| Code (1) | 1.00 / 1.00 | 0.00 / 0.00 | 1.00 / 1.00 |
| Exact identifier (2) | 1.00 / 1.00 | 0.50 / 0.50 | 1.00 / 1.00 |
| No answer (1) | returned a hit | no hit | returned a hit |

## Device/runtime measurements

Device: Apple M4, 24 GiB unified memory, macOS 27.0.1, arm64. Prototype is built in release mode with llama.cpp Metal enabled. Reproduction: `PATH="$PWD/tools/cmake/cmake/data/bin:$PATH" cargo build --release`; `python3 bench.py`. Final run: model-load call in a fresh process 474.2 ms; immediate unload/reload in the same process 446.3 ms; first synchronized inference batch 476.7 ms; three later synchronized batches 370.1, 372.2, 348.6 ms (mean 363.6 ms). Each batch embeds 888 tokens across 39 sequences (16 queries + 23 note chunks). Amortized across 23 document chunks, the warm batch is 63.3 chunks/s or 15.8 ms/chunk; this is a simultaneous batch measure, not single-chunk latency. Peak process RSS was 1,707,168 KiB (about 1.63 GiB). The model file was 634,554,176 bytes (605.1 MiB). The release probe binary was 9,504,512 bytes versus a 336,080-byte empty Rust executable, a measured probe delta of 9,168,432 bytes (8.74 MiB). The second model load is same-process warm-file access; cold-disk load was not isolated. Windows/Linux were not measured.

A standalone CLI is only a proxy for added packaged application size; the desktop Tauri app was not modified or rebuilt. The 8.74 MiB delta is relative to an empty Rust executable, not the actual Tauri app bundle. Packaged app size delta and minimum-hardware memory/speed remain unverified. Battery, sustained CPU, and editor latency were not measured. The 39-sequence benchmark represents only a tiny synthetic workload, not a vault-scale chunk corpus.

## First-run copy draft

> **스마트 검색을 켤까요?**
>
> 뜻이 비슷한 노트도 찾아드려요. 약 **635MB**를 내려받습니다. 검색할 때 노트 내용을 인터넷으로 보내지 않아요.
>
> **[켜기]**  **[나중에]**

This uses plain-language benefit, size, privacy, and explicit deferral. Settings can later show installed size and offer turn-off/removal. If the device cannot run the model, explain the reason and keep word search available.

## Reproduction

See `app/apps/desktop/dev/semantic-b0/README.md`. Requires Apple Silicon, Rust, clang/Xcode tools, CMake, Python 3.11 or later, and network access for the model. The model repo card declares Apache-2.0 but does not contain a standalone `LICENSE` file; any eventual redistribution should include the license text and required notices and pin the exact model artifact. Model repo revision: `87d6f395b1fcefdfdd6bef326a2da1921ed226d9`; artifact SHA-256: `b00170a20bd8f6d0515a52111af331242af65509f8b73884903e64740929c3a4`; crate: `llama-cpp-2 0.1.160`; corpus and commands are committed with the experiment.

## Scope and caveats

No model/runtime is connected to the app. No download manifest, vector index, search UI, or permission lifecycle was implemented. LiteRT-LM remains a PRD-defined alternative; this work did not build or benchmark it. Windows/Linux figures and behavior are unverified.
