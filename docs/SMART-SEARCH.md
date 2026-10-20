# Smart search

Smart search finds notes by meaning, not only by shared words: "meeting agenda" finds a Korean note titled 회의록. It is opt-in, runs entirely on the device, and macOS only for now. An additional **Include images** switch searches local PNG, JPEG, WebP and GIF images, including images embedded in notes. Keyword search stays the answer whenever smart search is off, still downloading, or anything in it fails.

Code: `app/apps/desktop/src-tauri/src/semantic.rs` (everything below unless noted), `semantic_images.rs` (bounded decoding, image indexing and references), `semantic_vision.rs` (single-batch multimodal evaluation), the vector tables in `src-tauri/src/index.rs`, the blend call in `search_notes` (`src-tauri/src/commands.rs`), startup and exit hooks in `src-tauri/src/lib.rs` (`semantic::resume`, `semantic::shutdown`). UI: `src/components/SmartSearch.tsx` (+ `.css`), `src/lib/smartSearch.ts`, the `smart_search_*` commands in `src/lib/ipc.ts`, the Vault settings tab `smart-search`, the hint in `SearchPanel.tsx`, the first-run card mounted in `App.tsx`, Korean strings in `src/lib/i18n/ko/search.ts`.

Background and measurements: [`reports/B0-LLAMA-SPIKE.md`](reports/B0-LLAMA-SPIKE.md) (Korean). Requirements: PRD §5.8 in `superpowers/specs/2026-10-15-team-second-brain-prd.md`.

## How it works

1. **Turn on.** `enable()` refuses on a device with less than 6 GiB of RAM (`Limited`, reason `memory`) or less than model size + 50 MB of free disk (`Limited`, reason `storage`). Otherwise it downloads the model if it is not already there.
2. **Download and verify.** The text model and optional 555 MB projector stream from pinned Hugging Face `resolve/<revision>/` URLs into `<app data>/models/<filename>.part`. The app uses its own `reqwest` client because the URL redirects to a CDN: 30 s connect timeout, 60 s read timeout, no overall timeout. Each stream is hashed as it arrives; extra bytes, a different size, or a SHA-256 differing from the artifact's pinned value deletes the partial file. Only verified bytes are renamed into place. Cancel is checked during transfer, before committing the file, and before enabling; canceling an image download restores the previous text/image setting. Both artifacts share this machinery.
3. **Warm up.** The first embed loads the model and compiles the Metal shaders (ggml compiles them at run time and the OS caches them; B0 saw about 10 s the first time). `enable()` does this once before it writes the `smart-search.on` marker, so the first search is not the slow one.
4. **Engine thread.** One thread named `smart-search-engine` owns llama.cpp (`LlamaBackend`, model, context). Callers send `Embed` or `Unload` over a channel and block on a reply. The model loads on the first `Embed`, and `Unload` drops it. llama.cpp can only be initialised once per process, so turning the feature off unloads the model but keeps the backend and the thread. Text-model threads are half the cores, clamped to 1–4; all layers go to the GPU (`n_gpu_layers` 999). Image inputs run on this same thread; their lazy model is released after the image queue drains, while text queries continue with the text model.
5. **Background indexing.** `start_indexer` runs a thread (`smart-search-index`) that calls `reconcile` in a loop: delete vector rows whose version differs from `INDEX_VERSION` or whose note is gone, then embed up to 8 notes whose `sha256` has no matching vector row, then write them in one transaction. It sleeps 50 ms after a batch that did work, 2 s when idle, 10 s after an error; three errors in a row while on (for example a model that will not load) show as Failed instead of retrying behind "On". The thread runs from launch even while the feature is off: then it only deletes rows of notes that are gone, and every row once the model is not on disk (F8.7, F8.8). Turning the feature off also tells the engine to refuse requests, so a pass already under way cannot load the model again. It takes the index lock only to read and to write, never while embedding, so a search is never blocked behind the model. If a note changed while it was being embedded, that note is skipped and the next pass redoes it. A note with no usable vector still gets an empty row, so it is not retried forever. It hooks nothing in the file watcher: it catches up to whatever the index knows.
6. **Search.** `search_notes` runs keyword search first, then `semantic::blend`. If smart search is ready and the query has at least 2 characters, the query is embedded, compared with every stored vector by dot product (vectors are unit length), the best chunk per note is kept, and notes scoring within `RELATIVE_MARGIN` (0.08) of the best one, at most 12, join the keyword list by reciprocal-rank fusion (`K = 60`, one row per result identity, preserving keyword snippets while enriching matching files with image metadata). While the keyword list is not empty a vector-only note counts half, so it cannot push a keyword match down; ties keep keyword rank, then vector rank, so a query always lists the same way. A note whose file name stem equals the query stays first. Any error in this path logs a warning and returns the keyword results unchanged.
7. **Off and clear.** *Off* removes the main marker and unloads both models; downloaded files and derived caches stay. Turning off **Include images** keeps its download/cache but excludes image hits and frees its model. *Clear* removes both models, partial downloads, both markers, and this vault's note/image vectors and image references. Notes and image files stay. Writers recheck the enable flags under the index lock so an in-flight pass cannot restore rows after Off/Clear.
8. **Exit.** `semantic::shutdown()` runs on `RunEvent::Exit`. It waits for the engine acknowledgment after all text and vision model resources have been released; a cold vision load may take longer than five seconds.

## Files and the table

| What | Where |
|---|---|
| Model | `<app data>/models/embeddinggemma-2-Q8_0.gguf`, shared by every vault |
| Download in progress | `<app data>/models/embeddinggemma-2-Q8_0.gguf.part` |
| "On" marker | `<app data>/models/smart-search.on` (empty file). On means marker and model both exist |
| Image projector | `<app data>/models/mmproj-Q8_0.gguf` (and `.part` while downloading) |
| Image opt-in marker | `<app data>/models/smart-search-images.on` |
| Text vectors | `note_vectors` in each vault's `.context/index.sqlite` |
| Image vectors / references | `image_vectors` (path, content hash, file stamp, version, vector), `image_notes` (image path, stable note id) in the same private index |

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

Searches keep vectors of the open vault in memory (`CACHE`), loaded on the first search and dropped whenever the loop writes or deletes rows or the vault changes. Image vectors enter this cache only while Include images is on; changing that flag rebuilds the candidate set. `image_vectors` and `image_notes` are derived local data too, never synced or sent to the server.

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

The two text real-model tests are `#[ignore]`d. Point `IB_SMART_SEARCH_MODEL` at the GGUF (the pinned file, which you can take from `<app data>/models/` after turning smart search on, or from the Hugging Face URL above) and run each explicitly; the image tests below additionally require the projector and generated PNG fixtures:

```sh
IB_SMART_SEARCH_MODEL=/path/to/embeddinggemma-2-Q8_0.gguf cargo test --release --lib real_model_ranks_by_meaning -- --ignored --test-threads=1
IB_SMART_SEARCH_MODEL=/path/to/embeddinggemma-2-Q8_0.gguf cargo test --release --lib real_model_end_to_end -- --ignored --test-threads=1
```

- `real_model_ranks_by_meaning` — a Korean query ranks the Korean and the English note on its topic above an unrelated one, and the vectors are 768-d.
- `real_model_end_to_end` — notes on disk → index → vectors → a blended search that finds a note sharing no word with the query; an edit re-embeds only that note and a delete drops its vectors.

Both return immediately and pass if the variable is unset, so a green run without it proves nothing. The first run compiles llama.cpp and takes a while.

### Images: opt-in, bounded, and local

**Vault settings → Smart search → Include images** downloads `mmproj-Q8_0.gguf` from the same Unsloth revision as the text model (`031f0d4b35536f69ab3509d4893c923264fcf253`). It is **554,821,120 bytes**, SHA-256 **`90e7b0238009e2954f856f2081dcf7f35af026b64c765e98f4777053e1754460`**, verified against the [revision's blob metadata](https://huggingface.co/api/models/unsloth/embeddinggemma-2-GGUF/revision/031f0d4b35536f69ab3509d4893c923264fcf253?blobs=true) and the downloaded bytes. Settings shows the shared download/cancel controls, image progress, and combined space used; Clear removes the projector too.

The image index combines supported image files in the existing vault file index with local inline Markdown `![](path)` and wiki `![[file.png]]` references. References resolve relative to the note or vault root; a unique indexed basename also resolves wiki-style embeds. URL-escaped paths, angled destinations, and nested parentheses are supported. Remote/data URLs, paths escaping the canonical vault root, and `.context` paths (including symlinks into it) are excluded. Reference-style Markdown and HTML image tags are not associated with their containing note; a supported image file still indexes on its own.

Rust reads at most **32 MB** per file, checks header dimensions before pixel decoding (**24 million pixels** maximum), applies decoder allocation/dimension limits, and downscales to at most **1024×1024**. Alpha is composited on white; GIF uses its first frame. Corrupt or over-limit images get an empty derived row and are skipped until their file stamp changes. The content SHA-256 is stored with each vector; size/mtime changes schedule re-embedding, and the file stamp is rechecked before commit. No image is uploaded or fetched remotely for smart search.

`image_vectors` uses its own `semantic_images::VERSION`, covering the text model, projector/hash, llama.cpp version, single-decode mean pooling, context size, decoder/downscale limits and 768 dimensions. Mismatched rows are pruned. Text `INDEX_VERSION` stays unchanged: production text prompts, evaluation and persisted text vector semantics did not change, and image vectors live in a sibling table.

Images and notes rank in the same [768-dimensional space](https://huggingface.co/google/embeddinggemma-2). A matching image joins the existing rank blend; the result uses the existing scoped asset protocol to show a thumbnail. `imagePath` is the vault-relative thumbnail path and `path` is the click target: the first containing note by path, or the image itself if standalone. `image_notes` preserves all containing-note links by stable note id. A keyword hit for that same file is enriched with its thumbnail and note target rather than duplicated. The CSP is unchanged.

#### Correct multimodal evaluation

The generic `MtmdInputChunks::eval_chunks` helper is unsuitable here: it separately decodes text/image/text chunks, and each decode replaces the pooled sequence output. The first spike produced effectively identical vectors for three different images (all pairwise cosines `0.9999999`, every query tied). This was a rejected call pattern, not a limitation of the multimodal model.

The implementation follows llama.cpp v0.7.0's `tools/server/server-context.cpp` mixed-batch path: tokenize the bare media marker, encode image chunks, add text tokens and image embeddings to **one extended batch**, mark every position for embedding output, and call `llama_process` **once** with non-causal attention and mean pooling. Total tokens must fit the 2048 batch/ubatch. The safe binding does not expose mixed batches or its loaded model pointer, so the implementation uses the same pinned `llama-cpp-sys-2` API and owns a second backbone only while image indexing needs it. Text queries use the original text engine.

On 2026-10-20, three generated 384×384 PNGs (a red circle, sea/sky, and a printed page) ranked correctly for all queries; vectors were normalized and 768-dimensional:

| Query | Expected image, mixed-batch score | Next-best image score | Image-only top score |
|---|---|---|---|
| a red circle | Circle, 0.7563081 | Sea, 0.62940544 | 0.69328505 |
| the sea | Sea, 0.72128123 | Circle, 0.6032968 | 0.65178674 |
| a page of text | Page, 0.67894113 | Sea, 0.62970114 | 0.6325838 |

The real-engine temporary-vault integration also covers reference changes, image edits/deletion, standalone opening, keyword deduplication, opt-out candidate caches, corrupt images and derived-data clear. The isolated headless pipeline measured text-only peak RSS **493,993,984 bytes**, image-indexing peak **1,339,523,072 bytes**, and resident RSS after lazy image unload **399,753,216 bytes**. The final four-model regression process measured a higher image-indexing peak of **1,495,482,368 bytes** (about **1.50 GB**), with text-only peak 535,855,104 and resident RSS after image unload 653,672,448. These are Apple-silicon test-process measurements, not full GUI memory, Intel-Mac results, or a real-photo retrieval evaluation.

Reproduce with generated PNGs named `circle.png`, `sea.png`, and `document.png` in a fixture directory:

```sh
IB_SMART_SEARCH_MODEL=/path/to/embeddinggemma-2-Q8_0.gguf \
IB_SMART_SEARCH_MMPROJ=/path/to/mmproj-Q8_0.gguf \
IB_SMART_SEARCH_IMAGES=/path/to/generated-pngs \
CARGO_TARGET_DIR=/private/tmp/infinitebrain-smart-search-e2e-target \
cargo test --release --lib semantic -- --ignored --nocapture --test-threads=1
```

`real_model_images_single_decode` prints image-only and mixed-batch rankings. `real_model_image_pipeline` exercises the real engine/index/search/lifecycle and prints memory measurements. Both require all three variables and fail when they are absent. Normal library tests cover vault confinement, parsing, corrupt input, alpha/downscale, first-frame GIF, and a forged oversized PNG header without loading a model.

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
> Smart search runs on your device. Your notes and images are not sent to Google, Unsloth, Hugging Face or anyone else for it; the only network activity is downloading the opted-in model files.
