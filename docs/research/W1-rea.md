# W1 — 설치 Baalda 0.1.83 / 현재 공개 소스 대조

## 결론

- [추정](신뢰도 상: 버전·식별자·Tauri 버전·114개 명령명·대표 청크명·업데이터 URL·OAuth 오류문구 일치) 설치본은 이 저장소와 같은 Baalda 소스 계열로 빌드된 것으로 판단한다.
- [확인](아래 자산 추출 실행 출력, `nm -gjU` 출력) **정확히 현재 파일 내용으로 빌드됐다는 확정은 불가**하다. 프론트엔드 내용 추출이 실패했고 export 목록은 `__mh_execute_header` 하나이며, 빌드 커밋/재현 빌드 해시도 확보하지 못했다. 일치하는 문자열은 함수 실행·보안 동작·전체 코드 동일성의 증명이 아니다.
- [확인](작업 명령 및 출력) 저장소와 실제 사용자 볼트에는 쓰지 않았고 앱을 실행하지 않았다. 보고서만 지정 경로에 생성했다. 현재 작업 디렉터리에는 `.git`이 없어 `git status`/`git rev-parse HEAD`가 `fatal: not a git repository`로 실패했다.

## 1. 대상·아키텍처·서명

| 항목 | 결과 / 일치 여부 | 근거 |
|---|---|---|
| 대상 | [확인] `/Applications/Baalda.app/Contents/MacOS/desktop`, 40,326,240 bytes | Python `Path.read_bytes()` 길이 |
| SHA-256 | [확인] `04c3b2023e5ecb445a2f4ad77ad14a1e8b3b1bb5891bcc51266ace933ee80b00` | REA `open_binary`, Python SHA-256 재확인 |
| Mach-O | [확인] thin arm64 / 64-bit, UUID `E75C6C3C-0372-3F44-A78C-5662775DC48C` | REA `inspect_macho`, Evidence `ev_28da2fc545927037c8abbc366b7fb40fc2ecd546dbdd6e8ec300bbb0fe77ae51` |
| 빌드 메타데이터 | [확인] minimum OS 11.0, SDK 26.5, linker tool version 1267.0 | 위 REA Evidence의 `build_metadata` |
| OS 하한 차이 | [확인] 소스/Info.plist의 10.15와 Mach-O의 11.0은 수치가 다름 | `app/apps/desktop/src-tauri/tauri.conf.json:47`, 설치 `Info.plist`의 `LSMinimumSystemVersion=10.15`, 위 REA Evidence |
| 하한 차이 해석 | [추정](신뢰도 상) arm64 macOS 빌드 타깃의 하한 차이로 보이며 소스 불일치 증거로 판단하지 않음 | arm64 단일 슬라이스와 11.0 빌드 메타데이터 |
| 네이티브 프레임워크 | [확인] WebKit, AppKit, Foundation, Security 등 16개 의존 항목 | 위 REA Evidence의 `dependencies` (dyld 포함) |
| 버전/ID | [확인] 양쪽 `0.1.83` / `com.baalda.context` 일치 | `plutil -p /Applications/Baalda.app/Contents/Info.plist`; `app/apps/desktop/src-tauri/tauri.conf.json:4` 및 `:5` |
| Tauri | [확인] 바이너리에 `tauri-2.11.5/src/plugin.rs` 문자열, lockfile 버전 2.11.5 일치 | 바이너리 offset 10892835; `app/apps/desktop/src-tauri/Cargo.lock:4318`–4319 |
| 서명 | [확인] Developer ID Application: Naveed Harri (`S3AT3TK8MR`), Apple Root CA, hardened runtime=true | REA `inspect_signature`, Evidence `ev_d9175a2b281abe251598bc32e88c23593a13feb10a65ef6662c4d079e1d4686d` |
| 서명 시각/CDHash | [확인] `Oct 13, 2026 at 7:28:48 PM`, `775dd58e9ccc30e6991bafd63f01a0ec8dc0976c` | 위 signature Evidence의 timestamp/CDHash; 시각은 도구 출력 그대로이며 시간대는 확정하지 않음 |
| Entitlements | [확인] allow-jit / allow-unsigned-executable-memory / device.audio-input 모두 true, 소스와 일치 | 위 signature Evidence; `app/apps/desktop/src-tauri/entitlements.plist:18`–23 |
| 서명 무결성 | [확인] `valid on disk`, `satisfies its Designated Requirement` | `codesign --verify --deep --strict --verbose=2 /Applications/Baalda.app` 실행 출력 |
| Notarization | [확인] `accepted`, `source=Notarized Developer ID` | `spctl --assess --type execute --verbose=4 /Applications/Baalda.app` 실행 출력 |
| Stapled ticket | [확인] `The validate action worked!` | `xcrun stapler validate /Applications/Baalda.app` 실행 출력 |

## 2. 임베디드 프론트엔드: 존재 확인, 추출 2회 실패 후 중단

- [확인](REA 두 번의 `extract_artifact({})` 실행 출력) 1차는 실행파일을 `open_binary`한 뒤 추출했고, 2차는 `/Applications/Baalda.app`을 열고 추출했다. REA는 2차 앱 경로도 동일 실행파일로 정규화했다. 두 번 모두 `artifact_operation_failed`, category=`integrity_mismatch`, reason=`integrity`, message=`Artifact is invalid or has changed. Get a fresh copy and try again.`으로 실패했다. 이후 추가 추출·압축 해제는 수행하지 않았다.
- [확인](REA open_binary SHA-256 및 Python 재확인; 위 codesign 검증) 동일 바이너리 SHA-256과 유효 서명은 확인됐다. REA 오류만으로 설치 앱 변조를 단정할 수 없다.
- [확인] `rg --files /Applications/Baalda.app/Contents/Resources` 출력은 `icon.icns` 하나다. 현재 소스의 `frontendDist`는 `../dist`이고 로컬 `app/apps/desktop/dist`는 없었다. (근거: 해당 실행 출력, `app/apps/desktop/src-tauri/tauri.conf.json:10`)
- [확인] 전체 바이너리에서 `/assets/...` 패턴 115개와 `index.html`, `brotli-decompressor-5.0.3/src/decode.rs` 문자열을 발견했다. (근거: Python byte-regex, `index.html` offset 10905126 / `brotli` offset 10888711; 아래 청크 표)
- [추정](신뢰도 상: 대량 자산 경로 뒤 비텍스트 바이트와 Brotli 라이브러리 문자열) 프론트엔드가 압축된 형태로 실행파일 안에 임베디드된 것으로 보인다. 실제 압축 스트림 해제나 JS 본문 대조는 수행하지 못했다.

| 대표 청크 | 바이너리 offset | 대응 소스 | 판정 |
|---|---:|---|---|
| `/assets/AuthDialog-51Ae6DnZ.js` | 26337453 | `app/apps/desktop/src/components/AuthDialog.tsx:109` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/AccountSettings-BbV2xjw6.js` | 18513518 | `app/apps/desktop/src/components/AccountSettings.tsx:141` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/VaultPicker-BjpAgI1B.js` | 18564042 | `app/apps/desktop/src/components/VaultPicker.tsx:104` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/VaultSettingsDialog-CkUrwrO7.js` | 30858674 | `app/apps/desktop/src/components/VaultSettingsDialog.tsx:189` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/ShareDialog-DNgEQt8f.js` | 23596359 | `app/apps/desktop/src/components/ShareDialog.tsx:22` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/Editor-WqV4U8Qj.js` | 32940050 | `app/apps/desktop/src/components/Editor.tsx:331` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/GraphView-RR_C-Kxw.js` | 28076150 | `app/apps/desktop/src/components/GraphView.tsx:461` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/AudioView-C4TdS3fK.js` | 18417363 | `app/apps/desktop/src/components/viewers/AudioView.tsx:15` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/CsvView-eOALnCZG.js` | 34229544 | `app/apps/desktop/src/components/viewers/CsvView.tsx:25` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/XlsxView-GfLUy8JT.js` | 18606120 | `app/apps/desktop/src/components/viewers/XlsxView.tsx:78` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/DocxView-CyL8UYTZ.js` | 36501859 | `app/apps/desktop/src/components/viewers/DocxView.tsx:62` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/VideoView-DqZ2f_OV.js` | 30809493 | `app/apps/desktop/src/components/viewers/VideoView.tsx:33` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/CodeView-CQQVAT3_.js` | 35331326 | `app/apps/desktop/src/components/viewers/CodeView.tsx:52` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/Avatar-DG5KC6nP.js` | 36503002 | `app/apps/desktop/src/components/Avatar.tsx:85` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/DataTable-DljkyxB6.js` | 26336924 | `app/apps/desktop/src/components/viewers/DataTable.tsx:33` | [확인] 이름 대응; 내용 동일성 미확인 |
| `/assets/serverFailureMessage-Do1U9NMF.js` | 30684247 | `app/apps/desktop/src/components/serverFailureMessage.ts:13` | [확인] 이름 대응; 내용 동일성 미확인 |

| 추가 문자열 대조 | 바이너리 결과 | 소스 근거 / 해석 |
|---|---|---|
| `AccountMenu` | [확인] 전체 바이트 검색 미발견 | `app/apps/desktop/src/components/AccountMenu.tsx:95`; [추정](중) 압축/번들링 탓일 수 있어 삭제/미포함으로 단정 불가 |
| `ActivityFeed` | [확인] 미발견 | `app/apps/desktop/src/components/ActivityFeed.tsx:408`; 내용 확인 불가 |
| `WindowsControls` | [확인] 미발견 | `app/apps/desktop/src/components/WindowsControls.tsx:8`; 내용 확인 불가 |
| `An update is on its way.` | [확인] 미발견 | `app/apps/desktop/src/lib/updateMenuRow.ts:50`; 내용 확인 불가 |
| `unexpected sign-in callback (state mismatch)` | [확인] offset 37541599, 일치 | `app/apps/desktop/src-tauri/src/oauth.rs:274` |
| `Baalda is completing sign-in and will return to the front automatically. If it doesn't, open Baalda yourself.` | [확인] 전체 문장 바이트 일치 | `app/apps/desktop/src-tauri/src/oauth.rs:281`; 바이너리 offset 37541490 |

## 3. Tauri 명령 등록 목록 대조

- [확인](Python: `generate_handler![` 블록을 정규식으로 파싱한 114개 이름을 바이너리 전체 바이트에서 검색) **114/114 이름 발견, 미발견 0개**다. 아래 offset은 처음 발견된 문자열 위치다.
- [확인](검색 방식 및 `nm -gjU` 출력) 문자열은 NUL 구분 없이 이어 붙은 항목도 있고 `write_note`처럼 긴 이름의 부분 문자열로도 발견될 수 있다. 따라서 이 결과는 이름 문자열 대조이며 실제 dispatch 분기 114개를 디스어셈블해 검증한 결과가 아니다. `google_oauth_return_to_app` 등은 Rust 심볼 문자열에 나타날 수도 있다.
- [확인](분석 범위) 바이너리 명령 목록을 완전히 복원하지 않아 소스에 없는 추가 명령의 부재는 확정하지 않는다.

| 소스 등록 명령 | 소스 줄 (`app/apps/desktop/src-tauri/src/lib.rs`) | 바이너리 offset | 판정 |
|---|---:|---:|---|
| `detect_agents` | 209 | 11925749 | [확인] 이름 발견 |
| `run_agent` | 210 | 11925734 | [확인] 이름 발견 |
| `cancel_agent` | 211 | 11926998 | [확인] 이름 발견 |
| `query_notes` | 212 | 11925723 | [확인] 이름 발견 |
| `list_notes_by_tag` | 213 | 11925706 | [확인] 이름 발견 |
| `list_notes_by_property` | 214 | 11925684 | [확인] 이름 발견 |
| `dashboard_read_note` | 215 | 11925665 | [확인] 이름 발견 |
| `dashboard_mount_view` | 216 | 11925645 | [확인] 이름 발견 |
| `dashboard_unmount_view` | 217 | 11925618 | [확인] 이름 발견 |
| `mount_dashboard_link` | 218 | 11925545 | [확인] 이름 발견 |
| `update_dashboard_link` | 219 | 11925565 | [확인] 이름 발견 |
| `unmount_dashboard_link` | 220 | 11925543 | [확인] 이름 발견 |
| `clipboard_write` | 221 | 11925528 | [확인] 이름 발견 |
| `set_background_relaunch` | 222 | 11926965 | [확인] 이름 발견 |
| `launched_in_background` | 223 | 11927010 | [확인] 이름 발견 |
| `pick_vault` | 224 | 11871792 | [확인] 이름 발견 |
| `open_vault` | 225 | 10907912 | [확인] 이름 발견 |
| `get_last_vault` | 226 | 11926076 | [확인] 이름 발견 |
| `clear_last_vault` | 227 | 11871664 | [확인] 이름 발견 |
| `get_recent_vaults` | 228 | 11926059 | [확인] 이름 발견 |
| `remove_recent_vault` | 229 | 11926040 | [확인] 이름 발견 |
| `delete_vault` | 230 | 11926028 | [확인] 이름 발견 |
| `reset_vault_local_copy` | 231 | 11926006 | [확인] 이름 발견 |
| `delete_departed_vault` | 232 | 11925985 | [확인] 이름 발견 |
| `create_vault` | 233 | 11925973 | [확인] 이름 발견 |
| `is_vault` | 234 | 37557952 | [확인] 이름 발견 |
| `list_tree` | 235 | 11925964 | [확인] 이름 발견 |
| `list_children` | 236 | 11925951 | [확인] 이름 발견 |
| `read_note` | 237 | 11925675 | [확인] 이름 발견 |
| `note_exists` | 238 | 11925931 | [확인] 이름 발견 |
| `vault_root_state` | 239 | 11871648 | [확인] 이름 발견 |
| `write_trash_copy` | 240 | 11871632 | [확인] 이름 발견 |
| `copy_to_trash` | 241 | 11925918 | [확인] 이름 발견 |
| `rebind_note_id` | 242 | 11925904 | [확인] 이름 발견 |
| `write_note` | 243 | 11925855 | [확인] 이름 발견 |
| `write_note_if_missing` | 244 | 11925855 | [확인] 이름 발견 |
| `materialize_notes_batch` | 245 | 11925832 | [확인] 이름 발견 |
| `apply_bootstrap_batch` | 246 | 11925811 | [확인] 이름 발견 |
| `create_note` | 247 | 11925800 | [확인] 이름 발견 |
| `create_folder` | 248 | 11925787 | [확인] 이름 발견 |
| `ensure_folder` | 249 | 11925515 | [확인] 이름 발견 |
| `rename_path` | 250 | 11925502 | [확인] 이름 발견 |
| `delete_path` | 251 | 11925491 | [확인] 이름 발견 |
| `delete_file` | 252 | 11925462 | [확인] 이름 발견 |
| `delete_files_batch` | 253 | 11925462 | [확인] 이름 발견 |
| `delete_folder_if_empty` | 254 | 11925440 | [확인] 이름 발견 |
| `trash_note` | 255 | 11925430 | [확인] 이름 발견 |
| `search_notes` | 256 | 11925413 | [확인] 이름 발견 |
| `get_file_text` | 257 | 11925400 | [확인] 이름 발견 |
| `list_file_rows` | 258 | 11925386 | [확인] 이름 발견 |
| `get_backlinks` | 259 | 11926596 | [확인] 이름 발견 |
| `graph_edges` | 260 | 11926563 | [확인] 이름 발견 |
| `graph_edges_for` | 261 | 11926563 | [확인] 이름 발견 |
| `get_note_meta` | 262 | 11926550 | [확인] 이름 발견 |
| `resolve_wikilink` | 263 | 11871728 | [확인] 이름 발견 |
| `list_note_titles` | 264 | 11871712 | [확인] 이름 발견 |
| `append_yjs_update` | 265 | 11926533 | [확인] 이름 발견 |
| `load_yjs_state` | 266 | 11926519 | [확인] 이름 발견 |
| `save_yjs_snapshot` | 267 | 11926502 | [확인] 이름 발견 |
| `save_yjs_state_vectors` | 268 | 11926480 | [확인] 이름 발견 |
| `list_yjs_state_vectors` | 269 | 11926458 | [확인] 이름 발견 |
| `prune_yjs_docs` | 270 | 11926444 | [확인] 이름 발견 |
| `clear_yjs_doc` | 271 | 11926431 | [확인] 이름 발견 |
| `get_disk_base` | 272 | 11926418 | [확인] 이름 발견 |
| `set_disk_base` | 273 | 11926405 | [확인] 이름 발견 |
| `list_disk_drift` | 274 | 11926390 | [확인] 이름 발견 |
| `read_binary_file` | 275 | 11871696 | [확인] 이름 발견 |
| `file_stat` | 276 | 11926381 | [확인] 이름 발견 |
| `binary_exists` | 277 | 11926368 | [확인] 이름 발견 |
| `write_binary_file` | 278 | 11926351 | [확인] 이름 발견 |
| `write_tree_binary` | 279 | 11926334 | [확인] 이름 발견 |
| `list_attachments` | 280 | 11871680 | [확인] 이름 발견 |
| `list_binaries` | 281 | 11926321 | [확인] 이름 발견 |
| `upload_attachment` | 282 | 11926293 | [확인] 이름 발견 |
| `download_attachment` | 283 | 11926260 | [확인] 이름 발견 |
| `vault_stats` | 284 | 11926237 | [확인] 이름 발견 |
| `vault_checks` | 285 | 11926934 | [확인] 이름 발견 |
| `empty_trash` | 286 | 11926923 | [확인] 이름 발견 |
| `list_trash_copies` | 287 | 11926906 | [확인] 이름 발견 |
| `read_trash_copy` | 288 | 11926891 | [확인] 이름 발견 |
| `delete_trash_copy` | 289 | 11926874 | [확인] 이름 발견 |
| `rebuild_index` | 290 | 11926861 | [확인] 이름 발견 |
| `read_external_file` | 291 | 11926843 | [확인] 이름 발견 |
| `get_server_url` | 292 | 11926829 | [확인] 이름 발견 |
| `set_server_url` | 293 | 11926815 | [확인] 이름 발견 |
| `get_vaults_root` | 294 | 11926800 | [확인] 이름 발견 |
| `set_vaults_root` | 295 | 11926770 | [확인] 이름 발견 |
| `pick_vaults_root` | 296 | 11871792 | [확인] 이름 발견 |
| `reset_vaults_root` | 297 | 11926768 | [확인] 이름 발견 |
| `pick_folder` | 298 | 39963380 | [확인] 이름 발견 |
| `pick_files` | 299 | 39963185 | [확인] 이름 발견 |
| `save_file` | 300 | 11926748 | [확인] 이름 발견 |
| `import_paths` | 301 | 11926729 | [확인] 이름 발견 |
| `export_path` | 302 | 11926715 | [확인] 이름 발견 |
| `open_vault_in_root` | 303 | 11926697 | [확인] 이름 발견 |
| `folder_exists` | 304 | 11926684 | [확인] 이름 발견 |
| `peek_vault_stamp` | 305 | 11871776 | [확인] 이름 발견 |
| `list_vaults_root_dirs` | 306 | 11926663 | [확인] 이름 발견 |
| `get_vault_config` | 307 | 11871760 | [확인] 이름 발견 |
| `set_vault_config` | 308 | 11871744 | [확인] 이름 발견 |
| `get_vault_types` | 309 | 11926648 | [확인] 이름 발견 |
| `set_vault_types` | 310 | 11926633 | [확인] 이름 발견 |
| `list_property_keys` | 311 | 11926219 | [확인] 이름 발견 |
| `list_property_values` | 312 | 11926199 | [확인] 이름 발견 |
| `list_tags` | 313 | 11926190 | [확인] 이름 발견 |
| `get_note_ui_state` | 314 | 11926173 | [확인] 이름 발견 |
| `set_note_ui_state` | 315 | 11926149 | [확인] 이름 발견 |
| `get_vault_epoch` | 316 | 11926134 | [확인] 이름 발견 |
| `keychain_set` | 317 | 11926122 | [확인] 이름 발견 |
| `keychain_get` | 318 | 11926110 | [확인] 이름 발견 |
| `keychain_delete` | 319 | 11925762 | [확인] 이름 발견 |
| `google_oauth_listen` | 320 | 11926946 | [확인] 이름 발견 |
| `google_oauth_await` | 321 | 11926615 | [확인] 이름 발견 |
| `google_oauth_return_to_app` | 322 | 40066385 | [확인] 이름 발견 |

## 4. URL / OAuth 대조

| URL 또는 경로 | 설치본 바이트 결과 | 현재 소스 / 판정 |
|---|---|---|
| `https://api.baalda.com` | [확인] `api.baalda.com` 포함 전체 바이트 검색 미발견 | `app/apps/desktop/src/lib/api.ts:58`; [확인] 소스에는 프로덕션 기본값이 있으나 설치본 기본값은 이번 조사로 미확인 |
| `https://github.com/naveedharri/baalda/releases/latest/download/latest.json` | [확인] offset 11905543 | `app/apps/desktop/src-tauri/tauri.conf.json:56`; 일치 |
| `http://localhost:1420/` | [확인] URL 문자열 발견 | `app/apps/desktop/src-tauri/tauri.conf.json:8` devUrl과 trailing slash 제외 대응; [추정](중) 설정 잔존 문자열이며 실제 프로덕션 접속 여부를 의미하지 않음 |
| `http://127.0.0.1:${port}/cb?state=...` | [확인] `127.0.0.1:0` offset 37541643; `/cb?` 미발견 | `app/apps/desktop/src-tauri/src/oauth.rs:52`, `app/apps/desktop/src/lib/auth/authManager.ts:133`; Rust loopback 주소는 일치, TS 조합 URL은 미확인 |
| `${serverUrl}/api/desktop-auth/finish?redirect=...` | [확인] `desktop-auth` 미발견 | `app/apps/desktop/src/lib/auth/authManager.ts:134`; 소스만 확인 |
| `/api/auth/sign-in/social` | [확인] 소스에 존재, 설치본 문자열 미확인 | `app/apps/desktop/src/lib/api.ts:1800` |
| `/api/desktop-auth/exchange` | [확인] 소스에 존재, 설치본 문자열 미확인 | `app/apps/desktop/src/lib/api.ts:1813` |
| Google authorize URL | [확인] 소스는 서버 응답 `data.url`을 사용 | `app/apps/desktop/src/lib/api.ts:1797`–1806; 설치본의 Google URL 하드코딩 여부는 미확인 |
| `https://cdnjs.cloudflare.com`, `https://cdn.jsdelivr.net`, `https://unpkg.com` | [확인] offset 37551648, 37551677, 37551702 | `app/apps/desktop/src-tauri/src/dashboard.rs:21`; dashboard CSP 허용 출처와 일치 |
| `https://fonts.googleapis.com`, `https://fonts.gstatic.com` | [확인] offset 37551826, 37551865 | 같은 `dashboard.rs:21`; CSP 허용 출처와 일치 |
| `http(s)://asset.localhost`, `http(s)://baalda-view.localhost`, `http://ipc.localhost` | [확인] 바이너리에 문자열 존재 | `app/apps/desktop/src-tauri/tauri.conf.json:28`, `dashboard.rs:21`; 로컬 프로토콜/CSP 문자열과 대응 |

- [확인](바이너리 ASCII URL 정규식 검색) `https?://[printable...]` 후보 79개가 나왔으나 Brotli 사전 및 Rust 연속 문자열 때문에 `http://dictionaryperception...`, `http://www.css...` 같은 조각도 섞였다. 이 후보 개수는 실제 엔드포인트 개수가 아니며, CSP 출처도 실제 네트워크 요청 관측이 아니다.

## 5. 직접 앱 소스에 없는 문자열 / 별도 표시

| 항목 | 구분 | 근거와 한계 |
|---|---|---|
| `https://docs.rs/rustls/latest/rustls/#cryptography-providers` | [확인] 바이너리 문자열, 앱 자체 소스의 URL 목록과 직접 대응하지 않음 | offset 37971751; `app/apps/desktop/src-tauri/Cargo.lock:3586`에 rustls 의존성. [추정](상) 의존 라이브러리 진단문구이며 앱 서비스 endpoint로 볼 근거 없음 |
| `https://github.com/tauri-apps/muda` 및 Tauri/wry/WHATWG issue 링크 | [확인] 바이너리 문자열, 앱 자체 기능 URL과 별도 | `muda` URL offset 10930525; Cargo.lock의 muda:2518 / wry:6173. [추정](상) 프레임워크 의존성의 문서/오류 링크 |
| Apple certificate/CRL/OCSP 주소 (`certs.apple.com/devidg2.der`, `crl.apple.com/root.crl`, `ocsp.apple.com/...`) | [확인] 바이너리 URL 후보에서 발견 | 위 코드서명 authorities도 Apple 체인. [추정](상) 서명 인증서 메타데이터로 보이며 앱 업무 API로 볼 근거 없음 |
| 추가 비공개 앱 코드/endpoint | [확인] 이번 제한된 검색에서 독자 앱 endpoint로 분류할 명확한 추가 후보를 찾지 못함 | JS 미추출·디스어셈블 미수행이므로 존재하지 않는다는 판정은 불가 |

## 검증 경계 및 재현

- [확인](사용한 도구 목록) REA MCP 도구는 이미 노출돼 있어 ToolSearch 호출 없이 `mcp__rea__open_binary`, `inspect_macho`, `inspect_signature`, `extract_artifact`, `close_binary`를 직접 사용했다. REA native inspection의 provenance는 `file`, `lipo`, `otool`, `nm`, `dyld_info`, `dwarfdump`, `vtool`, `codesign` 실행을 기록한다.
- [확인](위 실행 및 결과) 핵심 독립 검증: `codesign --verify --deep --strict --verbose=2 /Applications/Baalda.app`, `spctl --assess --type execute --verbose=4 /Applications/Baalda.app`, `xcrun stapler validate /Applications/Baalda.app`, `plutil -p /Applications/Baalda.app/Contents/Info.plist`.
- [확인](검색 스크립트) 명령명은 `lib.rs`의 `generate_handler` 블록에서 `\w+::(\w+)`로 추출하고 `binary.find(name.encode())`로 검사했다. 자산명은 `rb'/assets/[A-Za-z0-9_./-]+\.(?:js|css|woff2|svg|png)'`로 탐색했다. 표의 offset은 실행파일 시작 기준 decimal file offset이다.
- [확인](수행 범위) 앱 실행·로그인·실제 네트워크 요청·사용자 볼트 읽기/쓰기·재현 빌드·JS 압축 내용 복원은 수행하지 않았다. REA 세션은 `close_binary`로 닫았다.
- [추정](신뢰도 상) 보고서 판정은 **소스 계열 일치**까지다. **정확한 현재 소스 빌드 인증 또는 숨겨진 코드 부재 인증**으로 사용하면 검증 범위를 넘어선다.
