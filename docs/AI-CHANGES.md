# AI 변경 원장과 되돌리기

Activity 패널의 **AI 변경**에서 MCP 노트 변경을 연결별로 확인하고, 항목을 눌러 변경 전후 diff를 볼 수 있다. 되돌리기는 모든 동기화 참여자에게 적용된다. 연결을 선택하면 최근 1시간 변경을 최신순으로 일괄 되돌릴 수 있으며, 성공과 충돌을 항목별로 표시한다.

## 저장 및 연결 식별

마이그레이션 `056_ai_change_ledger.sql`이 `ai_change_ledger`를 만든다. 기록 대상은 MCP의 노트 create/update/append/edit/delete/move이다. `doc_id`는 기존 노트 identity를 그대로 사용한다. OAuth는 클라이언트 ID와 이름, 토큰은 토큰 행 ID와 라벨을 기록한다. 인증 토큰이나 비밀 키는 기록하지 않는다. 삭제한 연결의 과거 라벨은 원장에 남는다.

`DocWriter`는 문서 잠금 안에서 전후 텍스트를 캡처한다. MCP 콘텐츠 변경의 바이너리 Yjs 업데이트와 원장 행은 같은 Postgres 트랜잭션에 커밋한다. 라이브 Hocuspocus의 `onChange`는 이 커밋을 기다리며 동일 업데이트를 중복 저장하지 않는다. 이동·삭제의 registry 변경과 원장도 함께 커밋한다. 변경이 없는 콘텐츠 요청과 중복 append는 추가 원장 행을 만들지 않는다. 기존 노트를 채택해 빈 본문을 채운 create는 `tool=create_note`, `op=update`로 기록해 되돌리기가 기존 노트를 삭제하지 않도록 한다.

본문 스냅샷은 기존 `note_texts`처럼 서버 DB에 평문으로 저장한다. 전후 각각 **UTF-8 1MiB**까지 저장하며 초과 시 해시와 크기 요약만 남기고 diff/되돌리기는 제공하지 않는다. 볼트 삭제는 CASCADE, 휴지통 영구 정리는 해당 노트 원장을 제거한다. 노트 프로토콜과 CRDT 저장은 계속 바이너리 Yjs 업데이트를 사용한다.

## API

모든 경로는 데스크톱 세션 인증을 요구한다. 응답 원장 필드는 SQL 컬럼과 같은 snake_case이다.

| 경로 | 동작 |
| --- | --- |
| `GET /api/vaults/:vaultId/ai-changes?connection=&doc=&limit=` | 해당 볼트에서 읽을 수 있는 문서의 변경 요약. 기본 50, 최대 200. 본문은 제외한다. |
| `GET /api/ai-changes/:id` | 읽기 권한을 재검사한 상세 스냅샷. 접근 불가 항목은 404. |
| `POST /api/ai-changes/:id/revert` | 문서 edit 권한을 재검사하고 역편집 또는 구조 복원을 적용한다. |
| `POST /api/vaults/:vaultId/ai-changes/revert-batch` | `{connectionId, since}`. 읽을 수 있는 미복원 항목 최대 200개를 최신순 처리하고 개별 결과와 `truncated`를 반환한다. |

조회는 삭제 행을 고려하는 기존 권한 리졸버를 사용한다. 잠금·개인 차단·청구 계정의 읽기 전용 정책을 그대로 따른다. 권한을 잃은 문서의 본문이나 충돌 diff를 반환하지 않는다. 목록은 최대 2,000개 후보를 검사하고 읽기 권한 필터 이후에 visible limit를 적용한다. 상한에 도달하면 `truncated=true`이다.

## 되돌리기 가드

- update/append/edit: `DocWriter.editContent`의 현재 텍스트로 변경 후 해시를 검사하고 최소 변경 구간의 Y.Text 역연산을 적용한다.
- create: 변경 후 텍스트·경로·제목·삭제 상태가 일치하면 soft delete로 휴지통에 넣는다.
- delete: 동일 가드를 통과하면 기존 trash restore를 사용한다. 경로가 점유되었을 때는 기존 복원 함수의 이름 변경 정책을 따른다.
- move: 동일 가드를 통과하면 원래 경로와 제목으로 이동한다. 대상 폴더 edit 권한과 root freeze를 검사한다.

현재 텍스트가 변경 후 스냅샷과 다르면 **409 `conflict`**와 `{expected,current,before,expectedPath,currentPath}` diff를 반환한다. 이 구현은 다른 구간에서 일어난 후속 편집도 보수적으로 충돌로 처리한다. 원장 행의 잠금과 `reverted_at/reverted_by`로 동시·반복 요청을 직렬화한다. 재실행한 일괄 작업은 이미 되돌린 항목을 제외한다.

## 확인 범위와 운영 한계

서버 DB/API 및 실제 Hocuspocus 훅, 데스크톱 순수 로직, CRDT 동시 역편집과 디스크 echo guard를 테스트한다. Windows/macOS 레이아웃 확인은 합성 API/IPC를 사용하는 브라우저 시뮬레이터이며 네이티브 WebView2/WKWebView 검증과 구별한다.

새 노트의 registry 등록과 초기 콘텐츠 쓰기는 기존처럼 별도 단계다. 또한 콘텐츠 되돌리기·trash restore와 원장의 복원 완료 표시는 별도 저장 단계여서 프로세스가 그 사이에 중단되면 완료 표시가 남지 않을 수 있다. 이 경우 현재 본문 가드가 재덮어쓰기를 거부하며 사용자가 실제 문서 상태를 확인해야 한다. MCP 라이브 문서의 DB 실패 시 이미 전파된 메모리 CRDT를 자동 역연산으로 취소하지 않는다. 다중 서버 간 쓰기 직렬화는 기존 Hocuspocus/Redis 모델에 따르며 장애 주입 및 다중 인스턴스 재시도 검증은 별도 운영 검증으로 남는다.
