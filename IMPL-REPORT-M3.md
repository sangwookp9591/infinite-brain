# M3 구현 보고서 — AI 변경 원장과 되돌리기

- 작업 경로: `/Users/iron/Project/psw/ib-wt/m3-ledger`
- 브랜치: `feat/m3-ledger`
- 기준 커밋: `ddeb700` (Baalda 0.1.83 가져오기)
- 서버 코드 커밋: `ce93038`
- 데스크톱 코드 커밋 / 검증 대상 HEAD: `39f727d`
- 상태: 구현·관련 회귀 검증 완료, push 없음. 이 보고서는 별도 문서 커밋으로 추가한다.

## 변경 내용

1. `056_ai_change_ledger.sql`: TEXT identity, 조직/볼트/문서 참조, 사용자, OAuth/토큰 연결 ID·라벨, 실제 툴, create/update/append/edit/delete/move, 전후 SHA-256·본문·경로·제목, 크기 요약, 시각과 복원자 필드.
2. 인증 경로에서 OAuth 클라이언트 ID/이름과 MCP 토큰 행 ID/라벨을 전달한다. 토큰 값과 비밀 키는 기록하지 않는다.
3. MCP 콘텐츠 변경은 문서별 잠금 안에서 전후 본문을 캡처하며 바이너리 Yjs 업데이트와 원장을 같은 Postgres 트랜잭션에 저장한다. 라이브 Hocuspocus 훅은 이 커밋을 기다리고 중복 저장하지 않는다. 이동·삭제도 registry 변경과 원장을 함께 저장한다. 새 빈 노트 생성도 기록한다. 채택한 기존 빈 노트를 채운 create는 `tool=create_note`, `op=update`여서 undo가 기존 노트를 삭제하지 않는다. 콘텐츠 no-op과 idempotent append 재시도는 원장을 중복 추가하지 않는다.
4. 세션 인증 API: 볼트별 목록(연결/문서/limit 필터), 권한을 재검사한 상세, 개별 되돌리기, `{connectionId,since}` 일괄 되돌리기. 목록은 본문을 제외하고 삭제 행을 고려하는 기존 권한 리졸버를 적용한 뒤 visible limit를 계산한다. 읽기 권한 없는 상세·복원은 404, 보기 권한만 있으면 복원 403이다.
5. 콘텐츠 복원은 `DocWriter.editContent` 안에서 변경 후 해시와 현재 본문을 검사하고 최소 구간 역편집을 적용한다. 이후 본문이 다르면 409와 전후/현재 diff를 반환한다. 생성은 soft delete, 삭제는 기존 trash restore, 이동은 원래 경로/제목 복원이며 대상 폴더 edit/root freeze를 따른다. 원장 행 잠금과 복원 표시가 반복·동시 요청을 직렬화한다. 일괄 복원은 최신순으로 진행하고 항목별 결과를 반환하며 이미 복원한 항목은 처리 한도에서 제외한다.
6. 기존 Activity 슬라이드아웃 안에 **AI 변경** 영역을 추가했다. 연결별 목록, 노트별 diff, 개별/최근 1시간 일괄 되돌리기 확인 대화상자, 409 diff와 항목별 결과를 표시한다. 네트워크는 기존 typed `ApiClient`, UI는 기존 AsyncButton/ConfirmDialog를 사용한다. React 텍스트 렌더링으로 diff 내용을 표시하며 HTML을 실행하지 않는다.
7. 브리지 테스트에 서버의 AI 역편집과 미전송 인간 편집이 함께 보존되고 디스크 echo가 재쓰기를 만들지 않는 시나리오를 추가했다. `doc_id`, 브리지 두 echo guard, 150/300ms 디바운스, 바이너리 노트 프로토콜은 유지했다.
8. 사용·API·저장·장애 한계를 `docs/AI-CHANGES.md`에 기록하고 README에 연결했다. 주석/placeholder를 완료 근거로 삼지 않았으며 DB 행, 실제 HTTP 응답, 실제 Hocuspocus 훅, Yjs 수렴, 렌더링 및 빌드로 확인했다.

## 검증 명령과 결과

루트 경로 기준이며 서버 명령은 모두 **전용 disposable DB**를 사용했다. 기본 `context` DB와 실행 중인 3010/3011 서버는 변경하지 않았다.

| 명령 | 결과 |
| --- | --- |
| `cd app && pnpm install` | 성공. 기존 lockfile 그대로, 새 의존성 추가 없음. |
| `docker exec context-pg createdb -U context m3_ledger_20261014` | 성공. 작업 전용 DB 생성. |
| `DATABASE_URL=postgres://context:context@localhost:5439/m3_ledger_20261014 pnpm --dir app/apps/server run migrate` | 성공. 056 포함 적용. 실제 실행은 server 디렉터리의 동등 명령. |
| `DATABASE_URL=postgres://context:context@localhost:5439/m3_ledger_20261014 pnpm --dir app/apps/server exec vitest run tests/ai-changes.test.ts tests/mcp.test.ts tests/mcp-doc-writer.test.ts tests/mcp-edits.test.ts tests/trash.test.ts tests/bulk-docs-batch.test.ts tests/sync-e2e.test.ts tests/mcp-oauth-consent.test.ts` | **8파일, 127통과 / 0실패**. |
| 마지막 시간 형식·권한 메모 보완 후 `DATABASE_URL=postgres://context:context@localhost:5439/m3_ledger_20261014 pnpm --dir app/apps/server exec vitest run tests/ai-changes.test.ts` | **1파일, 16통과 / 0실패**. 위 127개에 포함되는 스위트의 재확인이다. |
| `pnpm --dir app/apps/server exec tsc --noEmit` | 성공, 최종 서버 커밋 직전 재확인. |
| `pnpm --dir app/apps/desktop exec vitest run src/lib/__tests__/aiChanges.test.ts src/lib/__tests__/api.test.ts src/lib/bridge/__tests__/concurrent.test.ts src/lib/bridge/__tests__/echo.test.ts src/components/__tests__/activityHostRender.test.ts src/components/__tests__/activityRows.test.ts` | **6파일, 73통과 / 0실패**. |
| `pnpm --dir app/apps/desktop exec tsc --noEmit` | 성공. |
| `TAURI_ENV_PLATFORM=windows pnpm --dir app/apps/desktop run build` | 성공. TypeScript + Vite 프런트엔드 빌드. 기존 CodeMirror 동적/정적 import 및 500kB chunk 경고 있음. Windows 네이티브 설치 빌드의 증거는 아니다. |
| `git diff --check` | 성공. |

원장 전용 16개 검증은 MCP update 기록·실제 연결 라벨, undo 성공·반복/동시 요청, 인간 후속 편집 409 보존, create/delete/move 복원, 빈 create·append 중복 제거·edit, 접근 불가 미노출·viewer 복원 거절, 일괄 역순/개별 충돌, UTF-8 크기 상한, adopted create, 후속 구조/휴지통 편집 충돌, frozen root, 영구 정리 시 원장 삭제, 200개 넘는 비공개 후보 뒤의 읽기 가능 항목 조회, 실제 라이브 Hocuspocus 중복 저장 방지, 원장 INSERT 실패 시 detached CRDT 롤백, 입력 검증을 포함한다.

중간 실행에는 테스트 시드의 필수 인자/권한 정책 오류와 append의 op 태그 오류가 있었고 수정했다. 별도 실행 두 개가 전용 DB에서 잠깐 겹쳐 초기 두 항목에 FK/unknown-note 실패가 난 실행도 있었다. 이후 서버 검증을 직렬로 실행했으며 위 최종 결과는 모두 0실패다.

## Windows/macOS UI 확인

`window-simulator` 및 `ego-browser` 스킬을 사용했다. 1425에서 이 worktree의 실제 React 앱과 합성 IPC/API fixture를 실행했다. 두 플랫폼은 동일 fixture를 사용한다. 노트별 diff, 연결 선택, 확인 대화상자, 409 안내 및 충돌 diff, 일괄 되돌림 결과를 조작했다. 1600×1000, 720×600에서 AI 영역 가로 overflow가 없고 닫기 버튼·버튼 정렬·diff 줄바꿈·스크롤을 확인했다. Windows 패널 위에 caption 버튼이 겹치지 않는 것을 화면에서 확인했다.

스크린샷은 tracked 파일 밖에 저장했다:

- `/tmp/m3-windows-wide.png`
- `/tmp/m3-windows-narrow-conflict.png`
- `/tmp/m3-macos-wide.png`
- `/tmp/m3-macos-narrow.png`

이것은 **브라우저 시뮬레이션**이다. 실제 계정/OAuth 제공자 또는 실제 볼트에서 UI를 조작한 증거는 아니다. 작업용 Vite 프로세스는 종료했다. 전용 DB는 재검증용으로 남겼다.

## 남은 한계

- 본문은 기존 `note_texts`와 같은 평문 DB 경계다. 전후 각각 UTF-8 **1MiB**를 초과하면 해시/요약만 기록하고 상세 diff와 복원을 제공하지 않는다. 볼트 삭제는 CASCADE, 휴지통 영구 정리는 해당 노트 원장을 제거한다.
- 목록은 최대 2,000개 후보, 응답 최대 200개(앱은 최근 100개)를 처리한다. 앱 연결 선택은 표시된 최근 목록을 필터링한다. 일괄 작업은 서버에서 선택 연결과 since를 조회하고 미복원 최대 200개를 처리한다. `truncated`는 추가 작업이 있음을 알린다.
- 작업 지시의 보수적 기준에 따라 **전체 변경 후 본문**이 달라지면 충돌로 본다. 다른 구간의 후속 편집도 자동 복원하지 않는다. 서버에 아직 도착하지 않은 동시 편집은 CRDT 연산으로 병합되는 것을 테스트했다.
- 새 노트 registry 등록과 초기 콘텐츠 저장은 기존처럼 별도 단계다. 콘텐츠 역편집 또는 trash restore와 원장의 복원 완료 표시는 별도 저장 단계다. 프로세스/DB 장애가 그 사이에 발생하면 콘텐츠 변경은 남고 완료 표시가 누락될 수 있으며, 재요청은 현재 본문 가드로 재덮어쓰기를 거부한다. 라이브 DB 실패 후 이미 전파된 메모리 CRDT를 자동 취소하지 않는다.
- 네이티브 Windows/macOS WebView·설치 앱·실제 OAuth 제공자, 다중 인스턴스 Redis 및 프로세스 중단 장애 주입은 미실행이다. Rust 변경이 없어서 cargo test와 설치 빌드는 실행하지 않았다. 전체 워크스페이스 테스트는 실행하지 않았다.
- 설치된 기존 `yjs@13.6.31`의 Endor dependency-reviewer package-risk 조회는 인증 정보 없음으로 실패했다. 위험 판정은 UNKNOWN이며 의존성 안전성 통과로 주장하지 않는다. 인증이나 의존성 버전을 변경하지 않았다.

## 다음 단계

코디네이터가 서버 `ce93038` → 데스크톱 `39f727d` → 이 보고서 커밋 순서로 통합하고 마이그레이션을 적용할 수 있다. 네이티브 운영 검증과 장애 시 완료 표시의 원자성 개선은 위 한계에 따라 별도로 확인해야 한다. push·배포·외부 채널 전송은 하지 않았다.
