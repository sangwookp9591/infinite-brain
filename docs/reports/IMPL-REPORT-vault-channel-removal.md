# Vault channel 멤버 제거 계약 검증 및 수정

## 변경

- `VaultSyncEngine`이 서버의 `{t:"err"}` 프레임만으로 소켓을 분리하거나 재연결을 예약하지 않도록 수정했다. 서버는 진단 프레임 다음에 close code를 보내며, 이전 동작은 `closeSocket()`이 close handler를 대체해 뒤따르는 4401을 놓치고 거부된 자격 증명으로 재연결할 수 있었다. 회귀 테스트는 `err` 다음 4401을 전달해 `no-access` 종결 및 재시도 예약 없음까지 확인한다.
- 서버 e2e 멤버 제거 테스트를 per-document `drop` 기대에서 vault 채널 4401 종료 계약으로 갱신했다. 종료 후 문서 업데이트를 발행해 추가 binary 콘텐츠 프레임이 없음을 확인한다.
- 이력 조사: `git log -S'role === "none"'` 및 blame 결과, 전체 ACL 재평가에서 role이 `none`이면 4401로 종료하는 동작은 `835a041` (`feat(server): scope sync, bootstrap and vault channel for guests`)에서 도입됐다. `c10a7ea..ce13dc5` 구간의 서버 vault-channel 구현 변경은 없으며, A1 커밋이 이 동작을 바꾼 흔적도 없다. membership-ended PubSub 프레임 후 대상 사용자 연결을 4401로 닫는 경로도 같은 커밋 계열의 계약이다.
- 4401 close 자체는 채널 엔진을 `no-access`로 멈출 뿐 로컬 파일 삭제를 실행하지 않는다. 정상 멤버 제거는 별도의 `member-removed` 프레임으로 앱의 membership-loss 정리를 호출한다. 그 정리는 서버 조직 목록을 다시 확인한 뒤 실행되며, 폴더 stamp/path 검증 후 팀 vault를 영구 삭제하고 복구본은 만들지 않는 기존의 명시된 제품 결정이다. 개별 문서 ACL revoke/drop의 recovery 및 서버 acknowledged state-vector 게이트는 별도 registry reconciliation 경로에 남아 있고 이 변경으로 우회되지 않는다. vault 전체 제거는 문서별 drop과 같은 recovery 동작이 아니며 아래 한계로 기록한다.

## 검증

전용 PostgreSQL 16 컨테이너 `ib-test-vcfix` (127.0.0.1:55443, DB `ib_test`)만 사용했다. 테스트 helper가 전체 migration을 적용했으며 공유 `context` DB는 사용하지 않았다.

| 명령 | 결과 | 소요 |
| --- | --- | ---: |
| `DATABASE_URL=postgres://ib:ib@127.0.0.1:55443/ib_test pnpm exec vitest run tests/vault-channel*.test.ts tests/guest-vault-channel.test.ts` (`app/apps/server`) | 8 files 통과, 63 tests 통과, 실패 0 | 18.78초 |
| `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/lib/sync/__tests__` (`app/apps/desktop`) | 74 files 통과, 2 skipped; 1,011 tests 통과, 12 skipped, 실패 0 | 12.05초 |
| `pnpm exec tsc --noEmit` (`app/apps/server`) | 통과 | 약 5초 |
| `pnpm exec tsc --noEmit` (`app/apps/desktop`) | 통과 | 약 10초 |
| `git diff --check` | 통과 | 즉시 |

단독 회귀 확인으로 서버 `tests/vault-channel-e2e.test.ts` (1 file, 4 tests)와 데스크톱 `bulkChannel.test.ts` (1 file, 5 tests)도 각각 통과했다. 각 명령은 위 전체 관련 테스트 실행 전에 수행했다. CI 전반, native Tauri 실행은 이번 범위에서 미검증이다.

## 리뷰 결과 및 남은 점

- **Medium — 재현됨, 수정함:** `app/apps/desktop/src/lib/sync/vaultSyncEngine.ts:926`의 err 선행 처리로 4401 close 이벤트가 유실되어 재연결될 수 있었다. `bulkChannel.test.ts`의 회귀 테스트에서 기존 경로의 재연결 예약이 발생하는 구조를 검증했고, 수정 후 close code를 보존하며 `no-access`로 정지한다.
- **Low — 재현 테스트 미실행, 기존 정책 확인:** `app/apps/desktop/src/store.ts:4391` 및 `app/apps/desktop/src-tauri/src/commands.rs:831`의 멤버십 종료 정리는 미전송 로컬 편집이 있어도 팀 vault 폴더 전체를 복구 없이 지운다. 코드 주석에는 2026-10-09 제품 결정으로 명시돼 있고 이 작업은 해당 정책을 변경하지 않았다. 개별 문서 revoke/drop의 recovery 규칙과 전체 멤버십 상실 동작은 별도 계약으로 유지된다.
- 서버 테스트는 멤버 제거 후 채널 종료와 추가 콘텐츠 프레임 부재를 실제 DB/ACL resolver 경로에서 재현했다. timeout 또는 부하성 실패는 없었다.

## 커밋

- `3ae2354 fix(desktop): preserve vault channel close codes`
- `01219b7 test(server): assert vault channel closes on member removal`
- 이 보고서 커밋은 완료 시점에 추가한다.
