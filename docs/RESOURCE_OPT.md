# Resource measurements and what we changed

Why this exists: a memory and load review (2026-10-19) that started from similar
problems other projects solved. The rule we took from db-tool's own
`RESOURCE_OPT.md`: **measure first, and adopt only what shows a consistent gain.**
Several plausible fixes are listed here as *not adopted*, with the numbers, so the
next person does not repeat the experiment.

Machine: Apple Silicon, 24 GB. Load average was 11–20 during the A/B (db-tool's
gate was ≤ 8), so **memory numbers are reliable, timings are only directional.**

## Baseline

| What | Result |
|---|---|
| Packaged app, welcome screen, 25 s after launch | host 41 MB footprint (104 MB RSS), WebContent 75 MB, GPU 32 MB RSS, Networking 12 MB RSS; about 200 MB total |
| Rust core, 2,000 notes (4.7 MB) | peak RSS 26 MB, peak footprint 16 MB, index rebuild 0.87 s, search 71 ms |
| Rust core, 20,000 notes (47 MB) | peak RSS 49 MB, peak footprint 35 MB, index rebuild 11 s, search 0.3 s |
| Galaxy graph, 20,000 notes (Chrome JS heap) | about 31 MB after GC; +3.7 MB after 6 s of interaction, no growth trend |
| Search index on disk | 560 MB for 47 MB of notes (about 12×); 72 MB for 4.7 MB. Disk, not memory |

Reproduce the Rust numbers (run the test binary directly; `cargo`'s own
`time -l` reports the compiler's 2 GB):

```sh
cd app/apps/desktop/src-tauri
cargo test --release --test data_volume_bench --no-run
INFINITE_BRAIN_BENCH_NOTES=20000 INFINITE_BRAIN_BENCH_REPEAT=5 \
  /usr/bin/time -l target/release/deps/data_volume_bench-<hash> --ignored --nocapture
```

`INFINITE_BRAIN_BENCH_REPEAT=N` repeats the index rebuild and prints the macOS
`footprint` after each round. A leak grows every round; freed-but-retained pages
(the macOS malloc behaviour db-tool hit) climb and stay.

## Allocator: mimalloc with `purge_delay=0` — not adopted

db-tool's host fixed a 696 → 63 MB climb (same query, 50 times) this way. Here the
same A/B, 20,000 notes, 5 rebuild rounds, 3 alternating runs per side:

| | system malloc | mimalloc, purge 0 |
|---|---:|---:|
| footprint after each round (MB) | 15–33 | 14–18 |
| peak footprint (MB) | 34.4 / 34.5 / 35.5 | 39.8 / 41.1 / 41.4 |
| index rebuild (s, load 11–20) | 11.4 / 12.3 / 13.9 | 14.0 / 14.5 / 14.7 |
| growth across rounds | none | none |

The system allocator never held more than 33 MB, so there is no retention problem
to fix here (db-tool's was 400 MB+). mimalloc steadies the footprint by a few MB
but raises the peak by about 6 MB and the rebuild by about 15%. Not worth a
dependency. Revisit if a workload ever streams large results through the host the
way a database client does.

## Server: size check on every sync message — changed

`beforeHandleMessage` runs for every sync message (every few keystrokes of every
editor) and measured the doc in bytes with `getText("content").toString()`: a full
copy of the note per message.

| note size | cost per message |
|---|---|
| 5,000 characters | 5 µs |
| 50,000 | 47 µs |
| 200,000 | 0.19 ms |
| 1,000,000 | 1.08 ms, about 2 MB of garbage |

Typical notes do not care. A big note edited by several people at once does (the
y-websocket reports of RSS climbing to 1.6 GB point at exactly this kind of
per-write churn). `noteSizeRefusalFor` now skips the copy when the unit count
proves the doc is under the cap: UTF-8 is at most 3 bytes per UTF-16 unit, so
`length × 3 ≤ cap` cannot be over it, and `Y.Text.length` is O(1). Anything that
could be near the cap is still measured in bytes, so the cap stays a wall for CJK
and emoji notes. `tests/note-size-shortcut.test.ts` checks the shortcut against
`noteSizeRefusal` for every script around the cap.

## Checked and already fine

- File tree: virtualized, so a huge vault does not put thousands of rows in the DOM.
- Lists that can grow: AI changes are capped at 200 per request, Activity has
  "Show more", note versions are pruned to the newest N by the server.
- Watcher: FSEvents with a 150 ms debounce and a 1 s window; SQLite in WAL mode.
- three.js: geometry and materials are disposed when the galaxy rebuilds.
- Server heap: `--max-old-space-size=512`, Hocuspocus unloads a doc when its last
  connection closes (library default, not overridden).

## Not measured yet

- WebContent memory in the packaged app with a real vault open for hours. Tauri's
  own maintainers say WKWebView memory is largely outside the app's control;
  the app-side levers are the ones above (bounded lists, virtualization).
- The server under a long, busy session (RSS over 24 h).
- Why the index is 12× the notes on disk (suspect the FTS trigram tables).

## Sources

- [Hoppscotch discussion](https://github.com/hoppscotch/hoppscotch/discussions/3775), [Terax #238](https://github.com/crynta/terax-ai/issues/238), [CodeNomad #553](https://github.com/NeuralNomadsAI/CodeNomad/issues/553): Tauri webview processes above 1 GB.
- [Tauri #5889](https://github.com/tauri-apps/tauri/issues/5889): memory benchmark scope, WebKit cost.
- [y-websocket #23](https://github.com/yjs/y-websocket/issues/23), [Yjs forum](https://discuss.yjs.dev/t/memory-issue-with-yjs/2568/3): server RSS growth, Node over-allocation, fewer small writes.
- [CPython #158972](https://github.com/python/cpython/issues/158972): `purge_delay=0` does not always return memory.
- db-tool's `docs/RESOURCE_OPT.md`: the measurement method and the allocator result.
