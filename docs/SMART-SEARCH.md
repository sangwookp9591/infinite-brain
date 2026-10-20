# Smart search

Smart search finds notes by meaning, not only by shared words: "meeting agenda" finds a Korean note titled 회의록. It is opt-in, runs entirely on the device, and macOS only for now. Keyword search stays the answer whenever smart search is off, still downloading, or anything in it fails.

Code: `app/apps/desktop/src-tauri/src/semantic.rs` (everything below unless noted), the `note_vectors` table in `src-tauri/src/index.rs`, the blend call in `search_notes` (`src-tauri/src/commands.rs`), startup and exit hooks in `src-tauri/src/lib.rs` (`semantic::resume`, `semantic::shutdown`). UI: `src/components/SmartSearch.tsx` (+ `.css`), `src/lib/smartSearch.ts`, the `smart_search_*` commands in `src/lib/ipc.ts`, the Vault settings tab `smart-search`, the hint in `SearchPanel.tsx`, the first-run card mounted in `App.tsx`, Korean strings in `src/lib/i18n/ko/search.ts`.

Background and measurements: [`reports/B0-LLAMA-SPIKE.md`](reports/B0-LLAMA-SPIKE.md) (Korean). Requirements: PRD §5.8 in `superpowers/specs/2026-10-15-team-second-brain-prd.md`.

## How it works

1. **Turn on.** `enable()` refuses on a device with less than 6 GiB of RAM (`Limited("memory")`) or less than model size + 50 MB of free disk (`Limited("storage")`). Otherwise it downloads the model if it is not already there.
2. **Download and verify.** One pinned file, streamed from a Hugging Face `resolve/<revision>/` URL into `<app data>/models/embeddinggemma-2-Q8_0.gguf.part`. The app uses its own `reqwest` client (the attachment client refuses redirects, and the Hugging Face URL redirects to a CDN): 30 s connect timeout, 60 s read timeout, no overall timeout. The stream is hashed as it arrives; more bytes than `MODEL_BYTES`, a different size, or a SHA-256 other than `MODEL_SHA256` deletes the `.part` file and the model is not used. Only a verified file is renamed into place. Cancel (`smart_search_cancel`) stops between chunks.
3. **Warm up.** The first embed loads the model and compiles the Metal shaders (ggml compiles them at run time and the OS caches them; B0 saw about 10 s the first time). `enable()` does this once before it writes the `smart-search.on` marker, so the first search is not the slow one.
4. **Engine thread.** One thread named `smart-search-engine` owns llama.cpp (`LlamaBackend`, model, context). Callers send `Embed` or `Unload` over a channel and block on a reply. The model loads on the first `Embed`, and `Unload` drops it. llama.cpp can only be initialised once per process, so turning the feature off unloads the model but keeps the backend and the thread. Threads for the model are half the cores, clamped to 1–4; all layers go to the GPU (`n_gpu_layers` 999).
5. **Background indexing.** `start_indexer` runs a thread (`smart-search-index`) that calls `reconcile` in a loop: delete vector rows whose version differs from `INDEX_VERSION` or whose note is gone, then embed up to 8 notes whose `sha256` has no matching vector row, then write them in one transaction. It sleeps 50 ms after a batch that did work, 2 s when idle, 10 s after an error; three errors in a row while on (for example a model that will not load) show as Failed instead of retrying behind "On". The thread runs from launch even while the feature is off: then it only deletes rows of notes that are gone, and every row once the model is not on disk (F8.7, F8.8). Turning the feature off also tells the engine to refuse requests, so a pass already under way cannot load the model again. It takes the index lock only to read and to write, never while embedding, so a search is never blocked behind the model. If a note changed while it was being embedded, that note is skipped and the next pass redoes it. A note with no usable vector still gets an empty row, so it is not retried forever. It hooks nothing in the file watcher: it catches up to whatever the index knows.
6. **Search.** `search_notes` runs keyword search first, then `semantic::blend`. If smart search is ready and the query has at least 2 characters, the query is embedded, compared with every stored vector by dot product (vectors are unit length), the best chunk per note is kept, and notes scoring within `RELATIVE_MARGIN` (0.08) of the best one, at most 12, join the keyword list by reciprocal-rank fusion (`K = 60`, one row per note, the keyword row wins the slot because its snippet highlights the match). While the keyword list is not empty a vector-only note counts half, so it cannot push a keyword match down; ties keep keyword rank, then vector rank, so a query always lists the same way. A note whose file name stem equals the query stays first. Any error in this path logs a warning and returns the keyword results unchanged.
7. **Off and clear.** *Off* removes the marker and unloads the model; the download stays. *Clear* does that, deletes the model file, and deletes this vault's `note_vectors` rows.
8. **Exit.** `semantic::shutdown()` runs on `RunEvent::Exit`. It unloads the model and waits up to 5 s.

## Files and the table

| What | Where |
|---|---|
| Model | `<app data>/models/embeddinggemma-2-Q8_0.gguf`, shared by every vault |
| Download in progress | `<app data>/models/embeddinggemma-2-Q8_0.gguf.part` |
| "On" marker | `<app data>/models/smart-search.on` (empty file). On means marker and model both exist |
| Vectors | `note_vectors` in each vault's `.context/index.sqlite` |

```sql
CREATE TABLE note_vectors (
    note_id TEXT NOT NULL,     -- the stable doc_id
    chunk   INTEGER NOT NULL,  -- 0-based, at most MAX_CHUNKS per note
    sha256  TEXT NOT NULL,     -- notes.sha256 when it was embedded
    version TEXT NOT NULL,     -- INDEX_VERSION when it was embedded
    text    TEXT NOT NULL,     -- the chunk, for the result snippet
    vec     BLOB NOT NULL,     -- 768 little-endian f32, unit length
    PRIMARY KEY (note_id, chunk)
);
```

`note_vectors` is **derived data**. Markdown on disk stays the truth; the table can be deleted at any time and the loop rebuilds it. It lives in `<vault>/.context/index.sqlite`, the private local metadata folder that is never walked as user content, synced or indexed, so nothing syncs it and it never reaches the server or Postgres. It is not part of the note CRDT pipeline, even though the same SQLite file also holds the CRDT log. A row is current only when its `sha256` equals the note's and its `version` equals `INDEX_VERSION`.

Searches keep every vector of the open vault in memory (`CACHE`), loaded on the first search and dropped whenever the loop writes or deletes rows or the vault changes.

## Constants and why

| Constant | Value | Why |
|---|---|---|
| `MODEL_URL` | `unsloth/embeddinggemma-2-GGUF` at revision `031f0d4b35536f69ab3509d4893c923264fcf253` | A revision, not `main`, so the bytes cannot change under the SHA |
| `MODEL_BYTES` / `MODEL_SHA256` | 309,855,520 / `6f1bd4ac…aed8bc` | Checked after download. B0 §3.2 matched it against the hub API |
| Quantization | **Q8_0**, not Q4 | Q8_0 averages 0.9998 cosine to BF16 and keeps the BF16 top-3 order on 23 of 24 test queries; Q4_K_XL kept it on 19 of 24 and is a third-party recipe we cannot rebuild. Speed on Metal is the same. Q4 (about 176 MB) stays a possible low-memory option after a real-notes evaluation (B0 §4.6, §6) |
| `N_CTX` (= batch = ubatch) | 2048 | The model's attention is not causal, so one input must fit one ubatch. Inputs are cut to this many tokens, never split across passes, which avoids the known `GGML_ASSERT` (B0 §5-8) |
| `CHUNK_CHARS` × `MAX_CHUNKS` | 1500 × 16 | Chunks split on blank lines where possible, mid-paragraph only when a paragraph is longer than 1500 characters. A note past 16 chunks (about 24,000 characters) is searched by meaning on its first 16 only; keyword search still covers all of it |
| Dimensions | 768 | The model's full output; stored whole so a later change to a shorter Matryoshka size would not need re-embedding. Vectors are L2-normalised by the app because llama.cpp does not (B0 §4.5), and a zero or non-finite vector is never stored |
| Prompts | `title: {title or "none"} \| text: {chunk}` for notes, `task: search result \| query: {q}` for queries | The model card's asymmetric prompts. Part of `INDEX_VERSION` |
| `SEMANTIC_HITS` | 12 | Unrelated text still scores about 0.6–0.7 in a 768-d cosine ranking (B0 §4.6), so the score is only used for rank, and more hits are mostly noise |
| `BATCH_NOTES` | 8 | Notes embedded per pass between index-lock releases |
| `MIN_MEMORY_BYTES` | 6 GiB | The model takes about 0.7 GB resident (Q8, B0 §4.4) on top of the app |

`INDEX_VERSION` is `embeddinggemma-2@031f0d4/Q8_0/llama.cpp-v0.7.0/doc:title|text/ctx2048/chunk1500x16/d768`. It names everything that changes what a stored vector means: model revision and quantization, bundled llama.cpp version, the prompt shape, context size, chunking and dimension. **Change any of those and change this string**; every old row is deleted on the next pass and re-embedded. Never mix versions in a search.

## Limits and known risks

- **In-process abort.** llama.cpp runs inside the app. A `GGML_ASSERT`/`GGML_ABORT` (a driver error, out of memory, an input past the ubatch) ends the whole app, losing unsaved editor state (B0 §5-13). Inputs are capped to one ubatch for the one known assert. Disk writes stay atomic. A sidecar process is the upgrade if crashes ever show up (`ponytail:` comment in the engine).
- **Unload before exit.** A model still loaded when the process exits trips `GGML_ASSERT([rsets->data count] == 0)` in a ggml-metal static destructor, which turns every quit into a crash report. `shutdown()` must keep running on `RunEvent::Exit`, and the ignored real-model tests end with `unload_and_wait()` for the same reason.
- **Brute-force search.** Every search scans every chunk in memory (about 3 KB each: 768 × 4 bytes). It is fine to a few tens of thousands of chunks; past that, add an ANN index. Index size and search time at real scale have not been measured.
- **Polling indexer.** It queries for work every 2 s while idle. A watcher hook is the upgrade if that ever shows in a profile.
- **Indexing speed on real notes is an estimate.** B0 measured about 58–112 short paragraphs per second on Metal; real chunks are 1500 characters, so a first index of a large vault takes longer. The UI shows progress (`indexed` of `total` notes).
- **Other vaults lose their vectors only once opened.** Clear deletes the open vault's rows; another vault's rows go the next time it is opened in this app (the indexer sees no model). Until then they sit in that vault's `.context/index.sqlite`.
- **Quality is not evaluated on real notes.** B0's smoke test was 24 queries over a small, easy corpus. PRD §11 metrics (hit@5, nDCG, code and exact-name queries) are not measured, and the output was not compared with the reference sentence-transformers implementation.
- **Cold model load** from a cold disk cache was not measured.

### macOS only

`engine::SUPPORTED` is `true` only under `cfg(target_os = "macos")`; elsewhere `engine` is a stub, `status()` returns `Unsupported`, and the UI shows that. `llama-cpp-2` is a macOS-only dependency in `Cargo.toml`. B0 measured only Apple silicon with Metal. Why not Windows or Linux yet (B0 §5):

- A default x86 build has no AVX2/FMA/F16C (`GGML_NATIVE` is off), so CPU speed would be far below the Mac numbers; turning on `+avx2` for the whole app makes older CPUs die at startup with `SIGILL` (§5-9).
- Turning on Vulkan links the Vulkan loader into the app itself, so a machine without one (VM, remote desktop, some Windows on ARM) might not start the app at all (§5-10).
- The Windows CRT setting of llama.cpp must match the Tauri app's (§5-11); the release matrix gets longer and needs cmake, libclang and the Vulkan SDK on every runner (§5-12); the Windows installer is not code-signed, so more native code and a big download raise SmartScreen and antivirus risk (§5-14).

Intel Macs: the code is enabled on every macOS target, and the universal `.dmg` contains the x86_64 slice, but no Intel Mac has been measured. It has the same no-AVX2 build question as above.

### Dependency pin

`llama-cpp-2` is a git dependency on `willsheldon/llama-cpp-rs` at commit `cb98c630d0fec934a8a379db4fd63cd3622f6984` (utilityai/llama-cpp-rs PR #1175), with `default-features = false` (the default pulls OpenMP, which macOS does not ship). Every crates.io release up to 0.1.160 bundles llama.cpp v0.6.0, which rejects the `gemma-embedding2` architecture; the PR moves the bundle to v0.7.0. The rev is a full commit SHA so the fork cannot change under us. **Move back to a crates.io version once #1175 ships** in a release, and update `INDEX_VERSION` if the bundled llama.cpp version changes. Building needs cmake (`brew install cmake`).

## How to test

From `app/apps/desktop/src-tauri/`:

```sh
cargo test --lib semantic
```

Runs the unit tests: chunking (size and count limits), normalisation (zero and NaN refused, blob round trip), reciprocal-rank merge (dedupe, exact name first, keyword order kept and the same order every time), and the model-card prompts. They need no model.

The two real-model tests are `#[ignore]`d. Point `IB_SMART_SEARCH_MODEL` at the GGUF (the pinned file, which you can take from `<app data>/models/` after turning smart search on, or from the Hugging Face URL above) and include ignored tests:

```sh
IB_SMART_SEARCH_MODEL=/path/to/embeddinggemma-2-Q8_0.gguf cargo test --release --lib semantic -- --ignored --test-threads=1
```

- `real_model_ranks_by_meaning` — a Korean query ranks the Korean and the English note on its topic above an unrelated one, and the vectors are 768-d.
- `real_model_end_to_end` — notes on disk → index → vectors → a blended search that finds a note sharing no word with the query; an edit re-embeds only that note and a delete drops its vectors.

Both return immediately and pass if the variable is unset, so a green run without it proves nothing. The first run compiles llama.cpp and takes a while.

## Upgrade paths

The places the code marks with `ponytail:` (a deliberate simplification with a known ceiling):

| Where | Now | Upgrade when |
|---|---|---|
| Indexer loop | Polls every 2 s | The idle query shows up in a profile: hook the watcher instead |
| `CACHE` | Brute-force dot products over all chunks in memory | A vault passes a few tens of thousands of chunks: an ANN index |
| Engine thread | llama.cpp in the app process | Crashes from a ggml abort show up: move it to a sidecar process |
| `RELATIVE_MARGIN` | 0.08 below the best vector hit | The B1 retrieval evaluation gives a better cut |

Other upgrades noted in B0 §6: a Q4 model for low-memory devices once evaluated on real notes, a configurable search dimension, and measurements on Windows, Linux and Intel Mac.

## Notices (draft, needs legal review)

Draft only. Not added to any `LICENSE` or `NOTICE` file. B0 §3.2 lists the legal questions to settle first: whether the model card's Prohibited Use Policy condition binds users and must be passed on in the app terms; whether a mirror of the model would count as redistribution under Apache-2.0 §4; how the "Gemma" name may appear in the UI; and where the notices below go. As shipped, the app downloads the model straight from Hugging Face and does not host it.

> **Third-party software and models used by Smart search**
>
> **llama.cpp** — https://github.com/ggml-org/llama.cpp. Copyright (c) The ggml authors. Released under the MIT License; the full license text accompanies the source. It is linked into the application through the `llama-cpp-2` Rust bindings (MIT OR Apache-2.0).
>
> **EmbeddingGemma 2** — by Google, https://huggingface.co/google/embeddinggemma-2. Released under the Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Smart search downloads the GGUF conversion published by Unsloth (https://huggingface.co/unsloth/embeddinggemma-2-GGUF) when you turn it on; the model is not bundled with the application and no changes were made by Infinite Brain. Use of the model must adhere to the Gemma Prohibited Use Policy, https://ai.google.dev/gemma/prohibited_use_policy. Gemma is a trademark of Google LLC.
>
> Smart search runs on your device. Your notes are not sent to Google, Unsloth, Hugging Face or anyone else for it; the only network request is the one-time model download.
