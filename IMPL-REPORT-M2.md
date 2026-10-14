# M2 구현 보고서

## 변경 사항

- 서버 로컬 임베더를 NFC·소문자 기반 Unicode 문자/숫자 토큰으로 바꾸고, 한글·한자·가나 토큰에는 원 어절과 문자 bigram을 함께 넣었다. 벡터 차원은 256으로 유지하고 `local-hash-unicode-v2` 버전을 기록한다.
- `note_index`, `blob_text`에 `embed_version`을 추가했다. 시작 시 구버전 노트와 파일 텍스트 벡터를 다시 만들며, 파일 backfill은 100행 단위로 처리한다.
- 서버 키워드 boost를 NFC 정규화된 토큰/bigram substring 기준으로 계산하고, 점수가 0 이하인 노트·파일 후보를 제외한다. 파일 후보 2,000개 상한과 ACL 조건은 유지하고 개선 TODO를 남겼다.
- MCP `search_notes`는 빈 문자열을 입력 검증에서 보존해 서비스가 공백 질의를 `bad_request`로 거부하도록 했다. HTTP `/search`의 기존 400 동작과 맞춘다.
- 데스크톱 SQLite에 `notes_fts_tri`를 `CREATE IF NOT EXISTS`로 추가했다. 인덱스 초기화 시 기존 `notes_fts` 행을 채우고, 노트 변경·삭제에서도 동기화한다. 3자 이상 한글/CJK는 trigram FTS, 짧은 토큰은 LIKE로 보완하며 경로 stem도 조회한다. 기존 unicode61 검색은 유지한다.
- 서버/Rust synthetic 케이스에 한글 부분일치, 무관 질의 빈 결과, 영어 회귀, MCP·HTTP 공백 입력 검사를 추가했다.

## 검증

- `pnpm install` (`app/`): 완료, lockfile 변경 없음.
- `DATABASE_URL=postgres://context:context@localhost:5439/m2_search_8318f9cb pnpm run migrate`: 전용 DB에 001–056 적용.
- `DATABASE_URL=postgres://context:context@localhost:5439/m2_search_8318f9cb pnpm exec vitest run tests/index-engine.test.ts tests/unicode-search.test.ts tests/file-search.test.ts tests/graph.test.ts tests/mcp-files.test.ts`: 5개 파일, 41/41 통과.
- `DATABASE_URL=postgres://context:context@localhost:5439/m2_search_8318f9cb pnpm exec vitest run tests/file-search.test.ts`: 1개 파일, 6/6 통과(위 실행의 file-search를 포함해 zero-score 파일 회귀 추가 확인).
- `pnpm run build` (`app/apps/server/`): 통과.
- `pnpm exec vitest run src/components/__tests__/searchPanel.test.ts` (`app/apps/desktop/`): 1개 파일, 3/3 통과.
- `cargo test cjk_search_finds_substrings_and_korean_path_stems -- --nocapture`: 1/1 통과.
- `cargo test index::tests::`: 67/67 통과.
- `git diff --check`: 통과.

## 한계

- 형태소 분석은 추가하지 않았다. bigram 기반이라 한국어 의미/형태소 검색이나 오탈자 보정은 제공하지 않는다.
- 파일 검색은 기존대로 blob ID 순 상위 2,000개만 후보로 본다. 대규모 vault에서 뒤쪽 파일 누락 가능성은 TODO로 남았다.
- 전체 server/desktop 테스트와 Rust 전체 테스트는 실행하지 않았다. `cargo fmt -- --check`는 현재 Rust 툴체인에 `rustfmt`가 없어 실행할 수 없었다. Prettier도 저장소에 설치되어 있지 않다.
