<!-- SPDX-License-Identifier: Apache-2.0 -->
# 승인에서 vault 동기화까지의 화면 연결

2026-10-22. Spec 09 어댑터 계약 1–5를 실제 설정 → 사내 협업 화면에 연결했다. 커밋·푸시·서버 변경·번들 준비는 하지 않았다. 최초 작업 트리의 미추적 skill/scratchpad 파일은 그대로 보존했다.

## 동작과 책임

- `OfficeEntry`의 프로세스 연결 소유자는 별도 `new ApiClient()`를 만들고 `createOfficeJoin(onEvent, ports, api)`에 명시 주입한다. 승인 뒤에만 `getConnection()` → `api.getSession()` → `api.listVaults()`를 호출한다. 실제 조직에 속한 목록만 노출하고 `id`와 `organization_id`를 서로 복사하지 않는다.
- 화면은 허용 vault가 0개면 관리자에게 접근 권한 요청 안내, 1개면 이름과 **연결 확인**, 여러 개면 이름과 선택 버튼을 보여 준다. ID·주소·포트·지문·토큰은 표시하지 않는다. 승인만으로 동기화나 회사 저장 완료를 주장하지 않는다.
- 기존 `SyncManager.disable()`로 provider·채널·scope를 먼저 내린 뒤 열린 bridge의 `flushEgest()`와 `whenPersisted()`를 기다린다. 로컬 저장이 실패하면 API·폴더·허브 전환을 진행하지 않는다. 선택은 세션과 목록으로 재검사한 뒤 전역 API/session 및 명시 collection ID를 설치하고 기존 `enableSyncForVault()`를 사용한다.
- `.context`의 실제 `serverVaultId`가 선택 ID와 일치하는 현재 폴더·recents·managed root 폴더를 재사용한다. 조직 ID만으로 폴더를 고르지 않는다. 같은 폴더의 세션 갱신에서는 다시 열거나 현재 노트를 닫지 않는다. 식별 가능한 로컬 사본이 없으면 기존 `freeVaultFolder`로 충돌 없는 새 폴더만 만들며 `seedIfEmpty`는 전달하지 않는다.
- 설정 탭이 사라져도 연결 소유자는 살아 있다. 다른 서버·조직·로컬 vault로 나가는 경로는 정리를 기다린다. 실제 native 창 닫기는 provider 정지 → 로컬 저장 → `join.close()`를 기다리고 실패하면 창을 유지하며 사내 협업 안내를 연다. relay/discovery/pending pairing 정리 실패는 재시도 가능한 참조를 유지하고 다음 허브로 진행하지 않는다.
- 기존 `onFlushed → markSynced`의 실제 ACK만 회사 공유 저장 표시를 만든다. 편집 pending과 노트 전환은 그 표시를 지운다. 연결과 저장 위치를 별도로 표시하며 소켓 열림·승인을 ACK로 사용하지 않는다.

## 갱신과 오류

실제 서버 TTL은 `min(600, SYNC_TOKEN_TTL_SECONDS)`초다. 기존 Rust 계약은 relay를 열 때 기기 서명 challenge/session을 새로 발급하므로, coordinator의 명시 허가를 받아 `OfficeLinkEndpoint.expiresAt` 공개 필드만 가산적으로 추가했다. bearer는 native 메모리와 origin별 office keychain에 남고 일반 `session-v2`를 덮어쓰지 않는다.

연결 시 확정한 갱신 시점은 TTL의 20% 또는 60초 여유를 기준으로 하되 매우 짧은 TTL에는 남은 시간의 절반을 확보한다. 15초 이내 간격으로 세션 유효성도 확인한다. 갱신은 provider 정지·로컬 저장 → 이전 relay 종료 → 새 native 서명 session/relay → 동일 선택 vault 재검사 → 기존 enable 순서다. 오프라인/통신 실패는 로컬 자료를 보존하고 같은 pinned hub에 5초 뒤 재시도한다. 소켓 인증 거절도 이 경로를 요청한다. 갱신이 성공하지 않으면 연결 끊김/만료 안내를 표시하고, 회수·선택 vault 소멸은 정리 후 관리자에게 확인하도록 안내한다. 서버가 0개를 반환한 것을 로컬 삭제나 새 collection 생성으로 바꾸지 않는다.

## 변경 파일별 불변식

| 파일/영역 | 변경과 보존한 경계 |
|---|---|
| `components/office/OfficeEntry.tsx`, `OfficePanel.tsx`, `OfficeScreens.tsx` | 연결 소유자와 선택 단계, 실제 창 정리, 개발 전용 가짜 시나리오. 본문·Yjs·디스크를 직접 다루지 않음 |
| `lib/officeAdapters.ts`, `officeJoin.ts`, `officeFlow.ts`, `officeLink.ts` | 직렬 생명주기, 갱신과 상태, retryable close. 별도 API 주입, 공개 expiry 외 자격 비노출 |
| `store.ts` | stop/save, 명시 vault 설치·폴더 재사용, 기존 enable 호출과 ACK 전달. local-save 실패를 무시하지 않음 |
| `sync/docSession.ts` | 선택 ID가 있을 때만 prime/reconcile에 가산 전달. ID가 없으면 기존 호출 형태 그대로 |
| `sync/registry.ts` | 명시 ID의 조직/목록/디스크 stamp 검증. 선택이 없으면 기존 결정 그대로, 선택이 사라지면 생성·seed·config 쓰기 전에 실패 |
| `auth/authManager.ts` | device sentinel의 세션 거절로 기존 계정 keychain을 삭제하지 않음. 일반 계정의 거절 동작 유지 |
| `ipc.ts`, Rust `office_device.rs`, `office_link.rs` | native 서명 세션의 공개 만료 시각만 추가. 기존 relay TLS pin·Origin·capability·binary 통로와 bearer 주입 유지 |
| `i18n/ko/office.ts` | 이름만 표시하는 선택·연결·다음 행동 문구. 내부 식별자 비노출 |
| 신규 `officeConnection.test.ts`, `officeRegistry.test.ts`, `officeStore.test.ts` 및 기존 office 시험 | 0/1/N, 승인 전 비조회, 선택/회수/만료/오프라인, 짧은 TTL 갱신과 retry, 정지/저장 실패 시 전환 거부, 다른 collection stamp 거부, 실제 ACK 경계, 갱신 중 열린 노트 보존 |
| `CLAUDE.md`, spec 09 | 실제 구현 상태와 공개 expiry/갱신 경계를 갱신. 어댑터 계약 1–5는 유지 |

Bridge/Markdown/Yjs 변환 코드는 편집하지 않았다. `doc_id`, binary sync, disk-origin egest 및 `lastWrittenHash` ingest echo guards, 150/300ms 타이밍, tombstone·revocation·불완전 listing·bulk 삭제 가드는 그대로다. 같은 vault에 기존 노트/폴더가 있으면 기존 local prime → network reconcile/bootstrap → note provider의 서버 pull → 여전히 빈 orphan만 기존 정책에 따라 다루는 경로를 탄다. 참여를 새 vault 생성으로 취급하거나 starter/빈 orphan을 먼저 seed하는 새 경로를 만들지 않았다.

## 검증 기록

최종 `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --maxWorkers=2`는 **364 files passed / 2 files skipped, 3,743 tests passed / 12 skipped, 실패 0**, exit 0이다. 최종 `pnpm exec tsc --noEmit`과 `git diff --check`도 exit 0이다. 모든 desktop 실행은 전체 suite이며 일부 파일만 실행하지 않았다.

- 첫 기본 병렬 전체 실행: 3 failed / 3,725 passed / 12 skipped, 364 files. 기존 CodeMirror media/image 렌더링 2개가 간헐 실패했고 새 `getToken` 호출이 기존 좁은 auth mock과 충돌하는 1개를 수정했다.
- 두 번째 기본 병렬 전체 실행: 1 failed / 3,738 passed / 12 skipped, 366 files. 편집하지 않은 기존 `editor/folding.test.ts` 1개가 간헐 실패했다.
- 초기 TypeScript 확인에서 새 시험의 문자열 literal 추론과 ES target 밖의 `Array.at` 사용이 실패했다. 시험 타입/접근 방식을 수정했고 최종 전체 `tsc --noEmit`은 통과했다.
- 전체 `--maxWorkers=2` 확인 과정: 3,740 → 3,741 → 3,742 passed, 매번 실패 0 / 12 skipped. 이후 같은 vault 갱신 중 열린 노트 보존 회귀를 추가했다. 기존 store/sync 시험은 수정하지 않았다.
- `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake cargo test --lib office_link`: 최종 **7 passed / 1 ignored**, 실패 0. 공개 endpoint가 expiry 외 session bearer를 내보내지 않는 시험 포함. ignored는 `OFFICE_RUNTIME_ROOT` 번들을 요구하는 기존 실제 번들 시험이다.
- 같은 CMAKE의 기본 target `cargo check`: 통과, 기존 `semantic_hits` dead-code 경고 1개. coordinator의 별도 x86_64 target을 사용하지 않았다.

## 시뮬레이터와 미검증 경계

Vite는 desktop에서 `pnpm exec vite --mode simulator --host 127.0.0.1 --port 1425 --strictPort`로 띄웠다. coordinator의 CDP 예제를 바탕으로 별도 임시 Chrome 프로필에서 설정 → 사내 협업 탭을 열었다. 캡처는 저장소 밖 `/private/tmp/claude-501/-Users-psw-Projects-infinite-brain/dfd91508-7593-4c5f-8916-83573c10dea3/scratchpad/office-ui5/`에만 둔다. `vault-select`, `vault-single`, `vault-empty`, `connected`, `revoked`, `expired`, `offline` 개발 전용 fake를 사용하며 실제 계정·서버·vault에 접속하지 않는다.

실제 두 대 PC, native Windows/WebView2, 서명 설치본, 실제 허브에서 이 화면을 조작한 시험은 미검증이다. 기존 `office-device-sessions.md`의 실제 허브 sync E2E 30/30 통과는 이전 작업의 검증 기록이며 이번 UI 변경 뒤 재실행한 결과로 주장하지 않는다. 앱 재시작 뒤 허브 복원, native pinned account bootstrap UI, office 세션의 attachment 위임 제한은 기존 후속 범위다.


최종 화면은 **7개 상태 × Windows/macOS × light/dark × 1440×900/720×600 = 56장**이다. `final-log.json`에서 56/56 상태·테마 일치와 수평 페이지 overflow 0을 확인했다. 8개 contact sheet로 모든 배치를 눈으로 비교하고 원본의 선택 목록·연결 필·회수/만료 안내를 확인했으며, 창 상단 컨트롤과 제목/상태 간격·목록 버튼·좁은 창의 문구/다음 행동에 잘림이나 겹침이 없었다. 기본 설정 화면이 테마를 재적용하므로 촬영 직전에 요청 테마를 명시 적용했고, 개발 HMR로 화면이 닫혔던 1장은 최종 소스로 재촬영했다. 이 capture의 이름과 수치는 실제 두 플랫폼 렌더 분기 검증이며 native Windows 검증을 뜻하지 않는다.

캡처 디렉터리에 `vitest-default-1.log`, `vitest-default-2.log`, `vitest-final.log`, `cargo-check.log`, `rust-relay-final.log`도 함께 보관했다. 전용 Vite simulator와 캡처용 Chrome은 작업 후 종료했다.

Simulator 종료의 exit 143은 작업자가 해당 Vite 프로세스에 SIGTERM을 보낸 의도적 종료다. 실행 중 기존 `public/dashboard-templates/ib-daily.html?raw` import 경고가 있었으나 이 파일/경고는 이번 범위에서 변경하지 않았고, 요청한 사내 협업 화면은 정상 렌더링됐다.
