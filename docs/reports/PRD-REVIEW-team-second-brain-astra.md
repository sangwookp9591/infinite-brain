# 팀용 세컨드 브레인 PRD 독립 검토

검토일: 2026-10-15. 대상: `docs/superpowers/specs/2026-10-15-team-second-brain-prd.md`. 기준 브랜치: `docs/team-second-brain-prd`, 커밋 `28ac3954f5fedcb271ebbd66a303aaa55978c9e0`. 시작 시 작업 트리는 깨끗했다. `CLAUDE.md`, `README.md`, 관련 구현과 일부 기존 회귀 테스트의 내용을 읽었으며, UI 리디자인 문서는 문맥으로만 사용했다. 테스트 작성·실행, PRD 수정, 커밋·푸시는 하지 않았다.

이하 `S/`는 `app/apps/server/src/`, `D/`는 `app/apps/desktop/src/`, `R/`는 `app/apps/desktop/src-tauri/src/`를 뜻한다. 줄 번호는 위 커밋 기준이다. P2P는 신규 설계이므로 실패 시나리오는 구현에서 재현한 버그가 아니라 문서의 계약이 허용하는 위험이다. 초기 P2P 규모는 PRD의 2~15명, 사용자당 여러 기기, 장기간 오프라인 편집을 가정했다. 연결된 조직은 우선 같은 허브에 존재한다고 가정했다. 서로 다른 허브 간 연합까지 포함한다면 별도 신원·신뢰 설계가 필요하다.

## 요약 판정

**rework.** 허브와 P2P의 vault 단위 분리, 기존 Markdown/Yjs 유지, 로컬 의미 검색, 명시적 게스트 권한은 타당한 방향이다. 그러나 현재 문서는 서버가 하던 권한·순서·삭제·복구 판단을 전송 계층 교체로 대체할 수 있다고 과소평가한다. 특히 secsync의 중앙 순서 보장 전제, 동시 키 교체와 오프라인 변경 보존, 읽기 전용 게스트의 서명 권한 검증, 신뢰 가능한 스냅샷 선택이 해결되지 않았다. A의 범위를 줄이고 B의 실현 가능성을 먼저 확인하는 작업은 가능하지만, C~F의 제품 출시를 승인할 수준은 아니다. 아래 critical 항목과 허브의 권한 경로 누락을 PRD의 필수 계약으로 올린 뒤 세부 설계로 진행해야 한다.

## 사실 오류

### 수정해야 할 주장

| ID | PRD 위치·주장 | 코드·공식 자료에서 확인한 사실 | 수정 방향 |
|---|---|---|---|
| F01 | §1, F2: `shares.ts:394`, `397-404`를 근거로 모든 공유가 동일 조직·멤버로 제한된다고 설명 | 해당 부분은 `prepareSummary`와 `/orgs/:orgId/access/summary`이다. 오류 문자열은 실제로 395행이다. 실제 `POST /shares`는 472행부터이며, 524-540행은 대상 문자열과 일부 admin 제한을 확인할 뿐 대상의 멤버십을 일괄 강제하지 않고 575행에서 저장한다. | “권한 요약은 조직과 멤버에 제한된다”로 좁혀 기술하고, 실제 공유 생성·조회 경로를 별도로 감사한다. 이 사실만으로 비멤버의 전체 API 접근이 가능하다고 단정해서도 안 된다. |
| F02 | §1, F1.2: “이메일 인증이 꺼져 있다” | `S/auth/auth.ts:136`은 로그인 시 인증을 **필수로 요구하지 않는** 설정이다. 161-172행에는 메일 설정 시 인증 메일 발송과 인증 플로가 이미 있다. | “미인증 계정도 로그인할 수 있다”로 수정한다. 인증 플로 자체가 없는 것으로 다시 구현하지 않는다. |
| F03 | D1, F3: 허브 권한 회수는 즉시이며 연결 해제 직후 어떤 경로로도 다시 읽을 수 없음 | 온라인 ACL 재검사·소켓 종료는 가능하지만 이미 받은 평문을 회수할 수 없다. `S/blobs/s3-store.ts:170-189`는 기본 설정에서 직접 S3 다운로드 URL을 반환하며 `S/blobs/config.ts:225`의 기본 TTL은 300초다. 발급된 URL은 이후 앱의 ACL 검사 경로를 통과하지 않는다. | 새 요청·기존 연결·발급된 URL·로컬 사본의 회수 범위를 구분한다. 엄격한 온라인 회수가 필요하면 다운로드 프록시 등 별도 정책과 진행 중 전송의 처리까지 정한다. |
| F04 | D2: mDNS → 홀펀칭 → 중계 → 항상 켜진 노드 순서가 Iroh 연결 방식 | Iroh는 보통 relay로 먼저 연결한 뒤 직접 경로로 전환하며, 알려진 직접 주소로 relay 없이 연결할 수도 있다. 저장 노드는 연결 경로가 아니라 데이터를 가진 별도 피어다. 확인 시점 최신 crate는 1.3.0이며 “1.0”을 최신 고정 버전처럼 쓰는 것도 부정확하다. | Iroh 1.x의 주소 탐색·경로 선택에 맡기고, 연결할 피어의 선택과 저장 복제 정책을 분리한다. [Iroh 공식 crate 문서](https://docs.rs/crate/iroh/1.3.0) |
| F05 | D3: secsync 방식이므로 서버 없는 스냅샷/업데이트 교환에 적용 가능 | secsync는 스냅샷과 업데이트의 순서를 정하는 중앙 서버를 요구한다. 봉투 구조를 차용할 수는 있지만 P2P 순서·동시 스냅샷 해결까지 제공하지 않는다. | “secsync에서 암호화 봉투 형식의 일부를 참고한 신규 P2P 프로토콜”로 명시하고 합의·복구 설계를 선행한다. [secsync 서버 전제](https://www.secsync.com/docs/server/introduction) |
| F06 | D3: 업데이트 서명은 BFT CRDT 논문의 방식이므로 쓰지 않고 저장 전달에만 서명 | 논문의 핵심인 해시 그래프·충돌 없는 연산 ID와 일반적인 메시지 서명은 별개다. secsync 자체도 스냅샷·업데이트·일시 메시지를 서명한다. Yjs에 논문의 구조가 없다는 이유가 메시지 서명을 생략할 근거는 아니다. | BFT 보장 여부와 작성자 인증을 분리하고, 경로와 관계없이 영속 봉투의 서명을 검증한다. [secsync 명세](https://www.secsync.com/docs/specification), [BFT CRDT 논문 §3](https://martin.kleppmann.com/papers/bft-crdt-papoc22.pdf) |
| F07 | D5, F8.1: EmbeddingGemma 2가 텍스트 전용이고 메모리가 약 191MB | 모델은 멀티모달이며 텍스트 인코더만 선택해 실행할 수 있다. 191MB는 Pixel 11 Pro에서 양자화한 텍스트 가중치의 active RAM 수치로, 앱 전체나 임의의 Rust 런타임의 메모리 상한이 아니다. | “텍스트 전용 구성으로 사용”이라고 쓰고 아티팩트 크기·런타임·최대 RSS를 별도로 예산화한다. [Google 발표](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/?authuser=399) |
| F08 | F8 선행 확인: Apache 2.0 여부가 기사에만 의존하는 열린 문제 | 현재 Google 공식 모델 카드가 Apache 2.0을 명시한다. 같은 카드에 사용 정책 안내도 있으므로 원본 및 선택한 변환·양자화 아티팩트의 조건을 함께 기록해야 한다. | 기사 대신 공식 카드와 실제 배포 revision·라이선스 파일을 근거로 고정한다. [Google 모델 카드](https://huggingface.co/google/embeddinggemma-2) |
| F09 | F6: CSP의 localhost 허용이 로컬 MCP 제공의 근거 | `tauri.conf.json:28`의 `connect-src`는 WebView의 **발신** 연결 정책이다. HTTP listener를 만들거나 그 listener의 인증·권한·DNS rebinding 방어를 보장하지 않는다. | 이 문장을 구현·보안 근거에서 제거하고 endpoint와 인증 설계를 별도 요구사항으로 쓴다. |
| F10 | §1: 데스크톱은 bm25 순위만 사용 | 벡터가 없다는 결론은 맞지만, 짧은 CJK 검색에는 `LIKE` 분기가 있고 노트·파일을 합치는 별도 순위 처리가 있다. `R/index.rs:1857-1883,1952-1971`을 함께 봐야 한다. | “FTS5/bm25, trigram, 짧은 CJK 부분 문자열 및 파일 검색”으로 기술하고 새 하이브리드 검색의 회귀 기준에 포함한다. |
| F11 | §1: 감사 로그는 AI 변경 기록뿐 | 통합 보안 감사 체계가 없다는 취지는 타당하다. 다만 일반 편집 버전의 작성자 기록(`migrations/016_versioning.sql:9-18`), 멤버 활동(`S/http/routes/members.ts:240`), 초대 만료 이벤트(`invitations.ts:101`)가 존재한다. | “멤버·공유·정책 변경을 일관되게 기록하는 통합 보안 감사 로그가 없다”로 좁힌다. 기존 기록과 보존·조회 관계를 정의한다. |

### 코드 인용 대조 결과와 표현 한계

PRD의 명시적 코드 인용은 아래처럼 대조했다. “확인”은 정적 코드 사실이며 테스트 통과나 실제 배포 상태를 뜻하지 않는다.

| PRD 근거 | 판정 | 확인 범위 |
|---|---|---|
| `members.ts:424-427` | 대체로 정확 | 425-427행은 초대 역할을 member/admin으로 제한한다. owner를 포함한 역할 체계 전체의 유일한 근거는 아니다. guest 초대 미지원이라는 설명에는 맞는다. |
| `shares.ts:394`, `397-404` | 오류 | F01 참조. 생성 API의 검사가 아니라 요약 API의 검사다. |
| `orgs.ts:479-520` | 정확 | 조직당 기존 코드를 반환하거나 생성한다. 523-560행의 사용 경로에도 코드 만료 검사가 없다. 별도의 이메일 초대는 `expiresAt`을 이미 사용한다. |
| `embedder.ts:14-15`, `setEmbedder` | 정확 | 256차원 해시, `local-hash-unicode-v2`; Unicode 정규화와 CJK bigram이 있다. 저장소 검색에서 `setEmbedder` 호출은 정의 외 발견하지 못했다. |
| `index.rs:346-521,1896-1963` | 큰 결론 정확, 설명 불완전 | FTS 테이블과 검색 구현이며 의미 벡터 검색은 없다. CJK 추가 분기는 1971행까지 읽어야 한다. |
| `resolver.ts:1229`, `:376` | 정확 | 각각 `effectivePermission`, `loadAccessIndex`다. 다만 index는 조직 전체 데이터를 읽는 보조 구조로, 그 자체가 사용자 권한 판정은 아니다. |
| `vault-docs.ts`, `readable-cache.ts` | 정확 | 기재된 함수가 존재한다. `vaultAccess:73`, `listDocsInVault:297`은 role이 null이 아니면 조직 구성원으로 취급한다. 캐시 기본 TTL은 `readable-cache.ts:36`에서 10초다. |
| `http-gates.ts`, 첨부 3개 함수 | 정확 | `canReadAttachment`, `filterReadableBlobs`, `canWriteBlob`이 존재하며 문서·폴더·참조 노트와 연결된 gate다. role 문자열 추가만으로 완성되지 않는다. |
| `hocuspocus.ts:228` | 정확 | `onAuthenticate`; 275-293행은 DB의 `syncPermission`을 다시 확인한다. 휴지통 안의 유효 문서를 처리하는 `S/trash/access.ts:36-45`도 계약에 포함해야 한다. |
| `mcp/service.ts:613,651,1278,1346` | 정확 | 노트 목록·단건·검색·첨부 목록 권한 처리다. 토큰 인증과 조직 범위 검사 및 vault 목록은 이 네 지점에 포함되지 않는다. |
| `auth.ts:136` | 경로 축약·의미 수정 필요 | 실제 경로는 `S/auth/auth.ts:136`. F02 참조. |
| `/invite/<id>`, `infinitebrain://invite/<id>` | 기존 경로 유지 방향 타당 | `D/lib/inviteLink.ts`와 서버 `invitations.ts:79`에 대응한다. P2P ticket은 기존 invitation ID와 다른 형식·검증 규칙이 필요하다. |
| `attachments.rs:629` | 정확, 재사용 범위 제한 | 스트리밍·임시 파일·선택적 SHA-256 검증·rename이 있다. 634행 해시는 optional이다. 모델은 필수 해시가 필요하며, 기존 함수는 vault 내부 첨부/바이너리 경로만 허용하므로 모델 저장소나 Iroh 전송에 그대로 호출할 수 없다. |
| `tauri.conf.json:28` | 설정 사실만 정확 | F09 참조. |
| 키체인 기존 경로 | 정확 | `R/keychain.rs:29-100`의 OS secret store를 재사용할 수 있다. 현재 세션 토큰 저장 기능이지 기기 등록·복구 프로토콜은 아니다. |
| `app_local_data_dir`, `.context/index.sqlite` | 방향 정확 | `R/commands.rs:205-210`에서 이미 앱 데이터 디렉터리를 설정 fallback으로 사용한다. 모델용 하위 경로는 신규이며, SQLite에는 검색뿐 아니라 CRDT 상태도 들어 있다. |
| 150ms/300ms, 두 echo guard | 정확, 의미 명확화 필요 | `R/watcher.rs:46`, `D/lib/bridge/types.ts:207-208`, `noteBridge.ts:249,778-779`. 디스크-origin을 무시하는 것은 디스크로 다시 쓰는 egest이다. AI가 디스크를 바꾼 변경의 네트워크 전송까지 막으면 안 된다. |

도메인 자동 합류·가입 승인·연결된 vault·SSO/SCIM의 완성된 기능은 검토한 현재 설정과 경로에서 확인되지 않았다. 다만 이를 저장소 외부의 인증 프록시나 배포 환경에도 없다는 주장으로 확장하지 않았다. §2.2의 MLS 배제는 제품 범위 선택으로는 가능하지만 MLS는 이미 IETF Standards Track인 RFC 9420이다. 연구 단계라는 인상 대신 그룹 commit 순서와 전달 서비스 운용 비용 때문에 이번 범위에서 제외한다고 구분하는 편이 정확하다. [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html)

## 설계 위험

### R01 — critical: 스냅샷의 정본과 키 교체 권한이 정의되지 않았다 (§4 D3·D4, F5.3·F5.5)

서로 단절된 두 관리 기기가 같은 이전 스냅샷에서 다른 스냅샷과 새 vault 키를 만든다. 연결 후 두 기기는 상대 봉투를 복호화하지 못하거나 각각의 “최신 스냅샷”으로 다른 기록을 버린다. Yjs 업데이트의 교환 가능성이 멤버십 epoch와 키 교체의 충돌까지 해결하지는 않는다. secsync의 중앙 순서 보장 전제를 제거했으므로 이 문제를 새로 풀어야 한다.

권장안은 C 이전에 하나의 명시적 권한 변경 순서를 정하는 것이다. 초기에는 vault당 지정 관리자 권한으로 membership epoch를 발행하고, 그 관리자가 없으면 가입 승인·제거·키 교체를 대기시키되 기존 멤버의 일반 편집은 허용하는 단순한 계약이 가능하다. 관리자 승계·복구까지 함께 정의해야 한다. 여러 관리자의 단절 중 동시 변경을 요구한다면 충돌과 합의를 별도 설계하고 비용을 다시 산정한다. 스냅샷 작성자가 오프라인이어도 다른 기기가 **검증된 동일 이력**으로 스냅샷을 만들 수 있는 조건, 그렇지 않으면 보관·대기하는 조건을 명시한다.

### R02 — critical: “새 스냅샷 후 예전 봉투 폐기”는 오프라인 작업을 잃는다 (D4, F5.5)

Alice가 노트의 변경 A를 아직 받지 않은 채 키를 교체하고 옛 봉투를 폐기한다. 오프라인의 Bob은 변경 A를 기반으로 B를 작성했다. Bob이 돌아왔을 때 참조 스냅샷이 사라져 B를 적용할 수 없거나, 새 상태를 덮어쓰며 작업을 잃는다. 반대로 퇴출된 기기의 구 epoch 변경까지 무조건 재암호화해 주면 제거가 무의미해진다.

epoch 전환을 준비·배포·확정 단계로 나누고, 스냅샷이 포함한 변경의 watermark, 남은 기기의 키 수령 상태, 구 epoch 보존 기한을 기록한다. 현역 기기의 미전송 변경은 권한을 재검증한 뒤 새 epoch로 병합하거나 복구 사본으로 남긴다. 퇴출된 기기가 나중에 보내는 변경은 자동 수용하지 않는다. “모든 오프라인 변경 자동 보존”과 “퇴출 이후 변경의 즉시 차단”을 동시에 무조건 보장할 수 없으므로 어느 시점의 승인을 기준으로 삼는지 적어야 한다. 새 키 배포 중 장애나 중복 재시도도 원래 상태를 복구할 수 있어야 한다.

### R03 — critical: vault 키 소유와 읽기 전용 권한을 혼동한다 (F2 P2P, D3·D4)

전체 읽기 전용 게스트에게 vault 대칭 키를 주면 그 기기도 유효한 AEAD 암호문을 만들 수 있다. 수정한 클라이언트가 업데이트를 전송할 때 “복호화되므로 정당하다” 또는 “연결 기기 키가 맞으므로 정당하다”로 처리하면 문서·멤버십을 수정할 수 있다. 직접 받은 unsigned 변경을 다른 피어가 저장 전달할 때 작성자 증거도 사라진다.

읽기 키와 쓰기 권한을 분리한다. 관리자 서명으로 승인된 기기·역할·대상·epoch를 모든 수신자가 검증하고, 변경 봉투는 작성 기기 서명과 해당 시점의 write 권한을 확인한 후 Yjs에 적용한다. 이를 C의 최소 조건으로 올린다. 이 조건을 충족하기 전에는 P2P 읽기 전용 guest를 출시하지 않는다. 모든 멤버가 서로 정직한 클라이언트를 실행한다는 가정을 쓴다면 이를 기업 보안 기능으로 표현할 수 없다.

### R04 — high: 기존 허브의 제어 정보가 빠진 P2P 프로토콜이다 (F5.3, §10)

현재 동기화는 문서 업데이트만 보내지 않는다. `D/lib/sync/vaultProtocol.ts:72-141`에는 `empty`, `behind`, `revoked`, `tombstones`, `covered`가 있으며 `inbound.ts:90-136`의 삭제 제한 해제와 복구 판단에 연결된다. 서버의 “내가 전체 변경을 보관했다”는 응답을 불완전한 피어 목록으로 대체하면, 없는 파일을 삭제로 오인하거나 삭제된 노트를 새 `doc_id`로 되살릴 수 있다. 허브의 휴지통은 삭제된 노트에 오프라인 변경을 받아 보존하기도 한다(`S/trash/access.ts:36-45`).

암호화된 registry/control 계약에 노트·폴더 생성, rename/move, tombstone, restore, 권한 변경, 수신 확인과 보존 주체를 포함한다. 목록 누락은 삭제 증거가 아니어야 한다. 같은 경로에 서로 다른 `doc_id`, 대소문자·Unicode 충돌, 폴더 삭제 중 새 파일, 바이너리의 비 CRDT 충돌도 규칙이 필요하다. `.context/`는 로컬 저장소로만 쓰고 내부 파일을 통째로 동기화하지 않는다. 공유할 메타데이터를 별도 구조로 정의한다.

### R05 — high: bridge 재사용의 경계가 충분하지 않다 (F5.3)

새 P2P adapter가 `ORIGIN_DISK`를 네트워크 송신에서도 걸러 버리면 로컬 AI의 파일 변경이 동료에게 전달되지 않는다. 새 스냅샷을 Markdown 문자열로 다시 쓰고 별도의 Y.Doc에 seed하면 기존 연산 ID를 잃어 두 번 삽입되거나 외부 파일 편집이 삭제된다. `lastWrittenHash`는 로컬 디스크 echo 방지 값이지 네트워크 ACK나 스냅샷 동일성 증거가 아니다.

동일 `doc_id`의 동일 live Y.Doc에 binary update를 적용하고, remote origin·디스크 origin·persistence replay를 구분한다. 디스크 쓰기 완료 후 hash 갱신, `diskBase`와 recovery copy, 초기 pull-before-seed를 유지한다. 여러 peer의 부분 상태 중 첫 빈 응답을 “전역 빈 문서”로 보지 않도록 P2P의 bootstrap 완료 기준을 정의한다. 실제 구현의 동시 디스크 읽기 보호는 `D/lib/bridge/noteBridge.ts:712-728`에도 있으므로 두 echo guard만 복사해서는 충분하지 않다.

### R06 — high: 봉투 압축, Yjs GC, 이력 삭제가 하나의 “스냅샷”으로 섞였다 (D3·D4, F5.3)

스냅샷을 만든다는 이유로 CRDT 크기가 일정하게 유지되는 것은 아니다. 병합된 업데이트는 중복을 줄이지만 삭제 내용의 GC는 다른 작업이다. Markdown만으로 재생성하면 저장량은 줄어도 오래된 오프라인 연산이 참조하는 구조를 잃는다. [Yjs 업데이트 API](https://docs.yjs.dev/api/document-updates)

첫 버전은 Yjs 구조를 보존하는 binary state snapshot을 사용한다. 포함된 업데이트까지만 삭제하고, 작업 중 들어온 새 업데이트는 남겨야 한다. 기존 `R/index.rs:2440-2472`가 트랜잭션과 `up_to` watermark로 구현한 원리를 봉투 저장소에도 적용한다. 최대 문서 상태·로그 바이트·compaction 빈도·구버전 복귀 한도를 정하고, 강제 이력 재작성은 별도 migration/복구 기능으로 취급한다. 수년간 편집된 문서, 반복 AI 전체 수정, 장기간 미접속 기기를 용량·복귀 검증 범위에 넣는다.

### R07 — high: 재전송·rollback·분기 은폐를 검출할 계약이 없다 (D3, F5.3·F5.4)

암호문만 보관하는 노드가 정상 서명이 있는 과거 스냅샷을 새 기기에 제공하거나, 제거 전 멤버십을 되살리거나, 두 그룹에 서로 다른 최신 상태를 보여 줄 수 있다. AEAD와 서명은 내용의 변조를 잡지만 신선함과 완전성을 보장하지 않는다.

봉투의 인증 대상에 protocol version, vault/doc ID, epoch, snapshot 부모 증거, 작성 기기, 단조 counter, payload hash를 넣고 재사용 nonce를 막는다. 최신 확인 지점과 수신 counter를 재시작 후에도 유지하며, 복원된 기기와 신규 기기는 신뢰한 관리자/현역 기기로부터 현재 epoch를 확인한다. 누락·분기 시 조용히 성공 처리하지 말고 동기화 미완료로 표시한다. secsync도 부모 증거와 작성자별 update clock을 명세하므로 단순 snapshot ID 비교로 축소하면 안 된다. [secsync 명세](https://www.secsync.com/docs/specification)

단, 모든 경로가 상태를 숨기는 공격자에게 막혀 있을 때 최신 상태가 존재하지 않음을 증명할 수는 없다. 이 경우의 가용성 한계와, 악성 relay·악성 저장 노드·악성 편집 멤버 중 어느 위협까지 다루는지 구분해야 한다. 서명을 붙이는 것만으로 Yjs가 BFT CRDT가 되는 것은 아니다.

### R08 — high: 사용자와 기기, 키 분실과 복구가 정의되지 않았다 (F5.1·F5.5)

한 사용자가 PC 두 대를 쓰는데 한 대만 제거하면 나머지가 계속 접근할 수 있다. 유일한 관리자 기기를 분실하면 새 기기 초대와 키 회전이 불가능하며, 암호문 백업만으로는 내용을 복구하지 못한다. 디스크 복원으로 같은 기기 키·counter가 복제되면 nonce나 송신 순번 재사용 위험도 있다.

`user identity → approved devices → vault membership/role` 관계와 전체 사용자 제거·한 기기 제거를 구분한다. 기기 추가의 본인 확인, 관리자 승계, 마지막 관리자 제거 금지, 복구 키 또는 기존 승인 기기를 통한 재등록, 모든 키를 잃었을 때의 결과를 명시한다. 서명용 Ed25519 공개키에 막연히 “암호화”한다고 쓰지 말고 검증된 key wrapping 방식과 암호화 키의 생성·바인딩 규칙을 선택한다. OS 키체인은 저장 수단일 뿐 이 프로토콜을 대신하지 않는다.

### R09 — high: 메타데이터와 폴더 경계가 E2EE 설계에서 빠졌다 (D1·D4, F5.7)

본문만 암호화하고 registry의 `rel_path`, 제목, 첨부 filename, 폴더 이름을 평문으로 보내면 “인수검토/회사명/해고명단.xlsx”가 노드 운영자에게 노출된다. 폴더 guest가 전체 트리나 다른 문서로 향하는 backlink·검색 snippet을 받는 경우도 같다. 파일을 제한 폴더에서 공개 폴더로 옮기거나 여러 폴더에서 같은 첨부를 참조하면 파일 키의 접근 범위가 달라진다.

식별용 불투명 ID와 암호화할 payload 필드를 표로 명시한다. 제목·경로·파일명·멤버 프로필·presence·참조 관계도 보호 대상에 넣고, IP·연결 시각·트래픽 크기·기기 공개키 등 남는 관측 정보는 한계로 설명한다. mDNS는 로컬 네트워크에 기기 존재와 주소를 알리므로 사내망 전용 모드에서는 공개 DNS/relay 사용도 명시적으로 끌 수 있어야 한다. [Iroh mDNS 문서](https://docs.iroh.computer/connecting/local-address-lookup)

폴더 키는 이동·상속·재공유·첨부 중복·회전의 계약을 갖춘 뒤 도입한다. 회전 시 파일 키를 새 vault 키로 다시 감싸는 것만으로는 이전에 파일 키를 받은 사람의 **미래 파일 버전** 접근을 막지 못한다. 새 버전에는 필요에 따라 새 파일 키를 사용한다.

### R10 — high: 선택적 노드를 “화면 없는 같은 앱”으로 한정하기 어렵다 (F5.4)

정상 앱을 headless로 띄우기만 하면 자동 vault 열기, Markdown materialization, SQLite 검색 색인, 로그, 키체인 경로가 실행되어 복호화된 내용을 저장할 수 있다. 반대로 노드가 아무 검증 없이 ciphertext를 받아 두면 임의 업로더가 디스크를 채운다. 유일한 새 스냅샷 보유 기기가 ACK 전에 꺼지거나 디스크를 잃으면 다른 기기는 복구할 원본이 없다.

노드 역할은 content key를 보유하지 않고 본문 bridge/indexer를 실행하지 않는 ciphertext store로 제한한다. peer 저장 인증, quota, 보존·삭제 권한, checksum·서명 검증, durable ACK, replica 수와 저장 부족을 정한다. 같은 Rust 공통 코드를 활용하는 것은 좋지만 데스크톱 전체 초기화 경로를 재사용할 이유는 없다. transport relay는 이 저장소가 아니다. “로컬 저장”, “다른 기기 수신”, “항상 켜진 노드에 보존”을 서로 다른 상태로 표시한다.

### R11 — high: 모드 전환은 업로드 한 번과 flag 변경으로 끝나지 않는다 (F7, 단계 F)

일부만 동기화한 기기에서 허브로 전환하면 다른 오프라인 기기의 변경·첨부·삭제 기록이 빠진다. 다른 기기는 여전히 P2P로 편집하고 기존 기기는 허브에서 편집하면 서로 다른 이력이 생긴다. `doc_id`만 유지해도 CRDT 연산 이력을 Markdown으로 다시 만들면 수렴을 보장하지 못한다.

지원 기기 버전 확인, 관리자 권한과 대상 허브 TLS 신뢰 확인, migration ID, 바이너리 CRDT·registry·첨부 manifest의 단계적 업로드, 검증, cutover epoch, 재실행·실패 복구를 정의한다. 늦게 돌아온 기기의 미전송 변경 처리도 필요하다. 모드 전환으로 서버가 평문을 읽게 된다는 동의를 받으며, 혼합 운용을 금지하되 전환 중 중복 저장과 제한된 복구 상태는 명시적으로 허용한다. F는 C·A뿐 아니라 D의 키/첨부/보존 계약 완료에 의존해야 한다.

### R12 — high: 임베더 교체와 재색인 계약이 불완전하다 (F8.2·F8.3·F8.6)

`setEmbedder`만 새 모델로 바꿔도 `EMBED_VERSION`은 `local-hash-unicode-v2`로 남는다. 같은 256차원인 구 해시 벡터와 새 모델 query를 비교하면 오류 없이 잘못된 순위를 낸다. 현재 `Embedder.embed`는 동기 함수이고 문서와 query가 같은 함수를 사용한다(`S/index/embedder.ts:17-20,68-74`, `indexer.ts:119,133,246,423`). 대형 모델 실행을 그 자리에 넣으면 요청·sync 처리와 자원을 경쟁할 수 있다.

모델 revision, tokenizer, 입력 prefix, chunker, 차원, 양자화 구성을 하나의 색인 버전으로 기록한다. 모델 준비·실패·교체·재색인 중에는 다른 벡터 공간을 섞지 않고 키워드 검색으로 fallback한다. 검색 query와 문서의 입력을 구분하고 절단 후 정규화하며 유한한 벡터인지 검증한다. 서버 실행은 bounded queue/worker와 backpressure를 포함한 별도 단계로 잡는다. 단순히 서버의 기존 숫자 256과 맞추는 것은 벡터 호환성이 아니다. [모델 입력·절단 지침](https://huggingface.co/google/embeddinggemma-2#best-practices)

## 보안·권한

### S01 — critical: D6은 좋은 원칙이지만 출시 체크리스트로는 불완전하다 (D6, F2·F3)

guest를 `member.role`에 추가하면 `role !== null`로 판단하는 기존 코드가 조직 전체 공유를 자동 부여할 수 있다(`S/permissions/vault-docs.ts:73,297`). baseline과 creator만 제외해도 join snapshot, personal vault grant, org item share가 남는다(`resolver.ts:1314-1342`). guest가 이전 member였거나 자신이 만든 노트가 있는 경우도 있어야 한다. 쓰기 guest가 만든 노트를 다른 범위로 이동했을 때 creator 우회가 남지 않도록 읽기·쓰기·공유 관리 권한을 함께 정의한다.

다음 경로를 D6에 추가하고, 같은 사용자·리소스·epoch에 대한 기대 권한 표를 기준으로 설계한다.

| 추가 경계 | 실제 현재 근거 | 필요한 계약 |
|---|---|---|
| 멤버·vault 목록과 초대 preview | `S/http/routes/members.ts:79-104`, `mcp/service.ts:281-286`, `invitations.ts:114-119` | guest가 다른 사람의 이름·이메일·내부 vault 이름을 얻지 못하도록 별도 필터·거부. 자신의 공유 진입점은 제공. |
| Better Auth 및 모든 합류 경로 | `S/http/routes/orgs.ts:545-583`, `members.ts:441`, `auth/auth.ts`의 초대 hook | join-code의 role 결정은 현재 admin 외 모두 member로 바꾼다. guest 초대를 code로 수락해 member로 승격시키지 않아야 한다. 직접 Better Auth API·재초대·승인 경로에도 동일 정책 적용. |
| vault replication·presence·조직 이벤트 | `S/sync/vault-channel.ts:1132-1150`, `D/lib/sync/vaultProtocol.ts` | note Hocuspocus 인증 외에 전체 채널의 readable set·member-joined·metadata·presence 필터도 필요. 현재 member-joined는 모든 구독자에게 이름 전달. |
| MCP 인증·발급·scope·vault discovery | `S/mcp/tokens.ts:167-180`, `mcp/service.ts:225-234,281-286,643-644` | 토큰은 한 organization에 묶이며 현재 멤버십을 재검사한다. partner 권한을 resolver에만 넣으면 유효한 읽기가 앞단에서 거부된다. 호스트 member로 무조건 삽입하면 반대로 내부 목록이 새어 나갈 수 있다. |
| 검색·graph·휴지통·버전·bootstrap | `S/http/routes/graph.ts:27-35,124`, `trash/access.ts:36-55`, registry/bulk 경로 | 본문뿐 아니라 제목·snippet·참조·과거 버전·삭제 기록도 같은 권한. partner를 host org 멤버라고 가정하지 않기. |
| 캐시·발급된 capability·다중 서버 | `S/permissions/readable-cache.ts:36,112`, `blobs/s3-store.ts:182-189`, Hocuspocus 및 vault 채널 | ACL 변경 commit 후 캐시 무효화·모든 서버 인스턴스 세션 종료·신규 인증 거부를 전달. 이미 발급된 URL의 잔여 수명도 명시. |

권장 계약은 “활성 관계를 통해 해당 vault에 참여 가능한가”와 “그 리소스에서 무엇을 할 수 있는가”를 분리하는 것이다. guest/partner 모두 조직 전체 기본 권한과 관리 권한을 상속하지 않는다. 기존 `orgRole`에 partner를 억지로 member로 반환하는 방식은 피한다. `organizationId`와 `vaultId`를 교환하지 않아야 하며, 현재 vault-wide share의 resource ID는 실제로 organization ID라는 기존 계약도 명시해야 한다(`S/permissions/lookup.ts:40-57`).

### S02 — high: 연결된 vault의 권한 교집합과 수명주기가 빠졌다 (F3·F4)

B admin이 자사 멤버를 추가하는 동안 A가 연결을 해제하거나 B에서 사용자를 퇴사 처리하면 어떤 상태가 우선하는지 없다. 다른 조직으로도 연결된 사람이 “외부 접근 모두 회수” 후 남은 grant를 통해 읽을 수도 있다. 연결 재수락 시 옛 직접 share와 MCP token이 되살아나는지도 정해져 있지 않다.

호스트의 최대 권한, 활성 connection, partner 조직의 현역 membership, 명시적 참여자 선택, 리소스 grant의 교집합을 정의한다. 어느 쪽 admin도 상대 조직의 내부 권한을 관리할 수 없어야 한다. 연결 제거 시 그 연결에서 유래한 grant·초대·세션·토큰을 함께 무효화하도록 provenance와 connection generation을 기록한다. 두 조직의 정책이 충돌하면 더 제한적인 정책을 적용하고, 별도 직접 guest 관계를 유지할 수 있는지도 명시한다. 서로 다른 서버 간 연결은 초기 범위 밖으로 확정하는 것이 최소 구현이다.

### S03 — high: ticket의 “한 번 사용”과 짧은 코드가 성립할 조건이 없다 (F1.1·F1.3)

복사된 ticket을 두 기기가 서로 단절된 관리자에게 동시에 제출하면 각각 승인될 수 있다. 초대자가 오프라인이면 ticket 안의 주소만으로 승인을 대신 받을 수도 없다. 현재 `D/components/kit/CodeSlots.tsx:9-12`는 기본 8자리 영숫자이며 대소문자를 지우고 잘라 낸다. 공개키·주소·비밀을 담는 전체 ticket을 그대로 입력할 수 있는 UI가 아니다.

초대 issuer 서명, 충분한 무작위 비밀, vault/role/scope/epoch/만료/초대 ID의 결합, 승인 대상 기기 키 바인딩, 원자적 redemption과 재시도 idempotency를 정한다. 초기에는 초대 발급 기기 한 곳이 소비를 확정하도록 제한하고 오프라인이면 대기 상태를 표시할 수 있다. 링크·QR은 전체 ticket 전달용으로, 짧은 코드는 온라인 rendezvous 또는 별도 pairing 프로토콜이 필요한 기능으로 분리한다. 추측 방지·시도 제한·만료 시계·로그/clipboard/URL 노출도 처리한다. 7일은 만료 정책이지 1회용 보장의 대체물이 아니다.

### S04 — high: localhost만으로 로컬 MCP가 안전하거나 외부 AI에 연결되지는 않는다 (F6)

악성 웹사이트나 다른 로컬 프로세스가 인증 없는 endpoint에 요청하면 사용자의 모든 읽기·쓰기 권한을 행사할 수 있다. 반대로 원격 AI 서비스가 자기 서버에서 `127.0.0.1`에 접속하면 사용자의 PC에 도달하지 않는다. “외부 AI”를 로컬 MCP client를 실행하는 도구와 클라우드 connector로 구분해야 한다.

기본은 사용자가 활성화한 로컬 client만 지원하고 연결별 token과 최소 scope, vault 선택, 만료·철회, Origin/Host 검증, 요청 크기·동시 실행 한도를 둔다. wildcard CORS를 사용하지 않는다. 로컬 도구가 지원한다면 stdio도 후보이며, HTTP를 쓸 경우 현재 MCP 명세의 loopback binding·인증·Origin 검증 요구를 따른다. [MCP Streamable HTTP 보안](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#security--endpoint)

MCP의 변경은 동일 live Y.Doc과 ledger/revision 보호를 통해 반영한다. Rust가 파일을 쓰고 TypeScript가 나중에 별도로 ledger를 남기는 두 단계로 끝내면 실패 시 귀속이 사라질 수 있다. cloud AI로 내용이 전달될 수 있다는 사실도 G6의 로컬 처리 약속과 구분해서 표시한다.

### S05 — high: 도메인 자동 합류는 이메일 검증만으로 충분하지 않다 (F1.2·F1.3·F4)

아무 조직 admin이나 `company.com`을 등록할 수 있으면 같은 도메인을 잘못된 조직에 연결할 수 있다. 이미 같은 이메일로 초대된 guest가 자동 합류를 거쳐 member로 승격하거나, 승인 대기 정책이 도메인 경로에서 우회될 수도 있다. 검증 후 이메일 변경·도메인 변경·재초대 처리도 없으면 조건이 오래된 채로 남는다.

도메인 소유 확인, 중복 도메인 정책, 정확한 도메인 비교와 정규화, 서버가 확인한 현재 이메일 검증 상태를 요구한다. 공용 메일 도메인은 자동 가입 대상에서 제외하고, 이메일 변경 후 재검증·기존 계정 재확인·가입 시점 seat limit도 정한다. 기본은 자동 가입 비활성으로 두며 `external policy → identity verification → pending approval → role assignment`의 우선순위를 단일 계약으로 고정한다. F1의 모든 진입점이 이 계약을 사용해야 한다.

### S06 — high: 로컬 파일이 있다는 사실을 현재 접근 권한으로 사용할 수 없다 (F8.5, F6)

이전에 member였던 사용자가 guest로 강등되거나 권한 회수 중 클라이언트가 오프라인이면 과거 파일·SQLite·snippet·vector·백링크가 남는다. 직접 가져온 로컬 문서도 있어 “디스크에는 현재 허용된 노트만 있다”는 전제는 성립하지 않는다. 애플리케이션이 정직하게 로컬 사본을 지워도 사용자가 복사한 평문까지 회수할 수는 없다.

UI 검색과 MCP는 vault/계정 및 현재 알려진 권한 상태에 맞춰 결과를 필터하고, 삭제·회수 때 원문 FTS·chunk vector·캐시·추천 결과를 함께 정리한다. 재색인 작업이 회수 후 결과를 다시 넣지 못하도록 작업 시작 시점의 문서 revision과 access generation을 확인한다. 오프라인 상태에서 확인할 수 있는 권한의 한계와 보호할 수 없는 기존 사본을 명시한다. 이를 B의 후속 검증으로 미루지 말고 B의 색인 수명주기 설계에 포함한다.

### S07 — medium: “외부 공유 도메인 허용”과 익명 공개 링크가 충돌한다 (F4)

인증 없는 공개 링크는 방문자의 이메일 도메인을 확인할 수 없다. 따라서 `허용한 도메인만`에서 링크 생성만 허용하고 방문자 검사를 하지 않으면 정책 이름과 실제 보호가 다르다. 이 모드에서는 익명 공개 링크를 금지하거나 인증된 제한 공유 링크로 바꿔야 한다. 감사 로그에는 수행자·대상·이전/이후 권한·결과·시간·요청 상관관계를 남기고, 외부 접근 일괄 회수의 부분 실패와 완료 상태를 사용자가 알 수 있게 한다.

## 과하거나 불필요한 설계

첫 출시에서 모든 “팀 기능”을 A에 묶는 것은 과하다. 도메인 자동 합류와 양방향 조직 운영은 guest의 기본 권한 계약보다 복잡하다. 초대 만료·재발급, guest, 공유 정책과 최소 감사부터 끝내고 도메인 자동 합류를 후속으로 분리하는 것이 작은 완성 단위다. SSO/SCIM 제외는 유지하되 §3의 기업 사용자를 “이 PRD만으로 도입 요구를 모두 충족한다”고 해석하지 않도록 제약을 적는다.

모델 하나를 제공하는 데 범용 모델 marketplace나 임의 provider 설정은 필요하지 않다. 한 개의 검증된 텍스트 아티팩트와 내려받기/삭제/재시도, 키워드 fallback부터 제공한다. pause/resume을 유지하려면 Range·ETag·서버 지원 여부를 완료 기준에 넣는다. 서버 의미 검색과 관련 노트 추천은 로컬 검색 품질을 증명한 다음 추가할 수 있다. 다만 다운로드 무결성·경로 검증·디스크 부족 처리는 줄이면 안 된다.

P2P 첫 버전의 folder key와 connected organization을 동시에 풀 필요는 없다. 별도 협업 vault를 공유 경계로 사용하고 허브에서 세밀한 guest를 우선 지원하는 편이 단순하다. **전체 읽기 전용 P2P guest를 제공한다면 R03의 쓰기 검증은 생략할 수 없다.** 숨겨진 UI 버튼은 보안 경계가 아니다.

Iroh 위에서 mDNS와 연결 fallback을 직접 다시 구현하거나, 기존 256차원 상수에 새 모델을 맞추는 작업은 불필요한 결합이다. 반대로 key epoch, durable ACK, 데이터 복구는 “나중에 할 고급 기능”이 아니다. 이미 있는 bridge와 원자적 저장을 재사용하되 보장하지 않는 부분까지 재사용했다고 선언하지 않아야 한다.

NextGraph/MLS/Iroh 비교는 열린 질문을 장기간 유지할 사안이 아니다. C0에서 동일 요구로 작게 평가한다. Yjs binary history 보존, 순수 offline LAN, 라이선스, 지원 플랫폼, guest와 회수, 데이터 export가 필수 평가축이다. 이번 검토는 NextGraph의 SDK 호환성이나 해당 발표의 구현 성숙도를 직접 검증하지 않았으므로 채택·기각을 권고하지 않는다.

## 누락된 요구사항

| 영역 | PRD에 추가할 요구 |
|---|---|
| Export·탈출 경로 | Markdown·첨부·폴더·frontmatter·링크·안정 ID를 내보내고 다시 가져오는 계약. 사용자에게 제공할 문서 export와 CRDT/키/ACL을 포함한 운영 backup을 구분한다. `.context/` 전체를 다른 팀에 공유하는 방식은 금지한다. |
| Backup·복구 | RPO/RTO, 백업 주체·주기·암호화·복원 권한, 복구 훈련, 모든 키 분실, 불완전한 replica만 남은 경우. 동기화와 선택적 항상 켜진 노드는 백업의 대체물이 아니다. |
| Retention | 감사·AI 변경·문서 버전·휴지통·P2P 구 epoch·오프라인 미전송 변경의 보존 기간과 삭제 권한. 기업의 legal hold 요구를 지원할지 범위 밖으로 둘지 명시한다. |
| 기존 hub 데이터 | guest 도입 전 member와 기존 초대·code·baseline·join snapshot의 migration 기본값, 기존 서버/클라이언트 혼용, 기능 capability negotiation, rollout과 rollback. 기존 vault가 자동으로 guest 규칙을 잘못 상속하지 않아야 한다. |
| 기기 관리 | 기기 목록·마지막 접속·승인·분실·퇴사·승계·대량 회수·동일 사용자 여러 기기·계정 전환·공용 PC. P2P user identity와 허브 user ID의 migration mapping. |
| 조직 운영 | partner의 초대 수락 권한, 소유권 이전, 호스트 조직 폐쇄·탈퇴, 연결 해제 시 사본 처리, seat/billing 책임, 외부 접근의 provenance. |
| 용량·남용 | vault·문서·첨부·device·envelope·queue·relay 대역폭 상한, 압축 해제·파싱 한도, 미승인 연결 rate limit, 디스크 부족과 quota 초과 시 읽기·편집·동기화 상태. |
| 모델 배포 | 모델·tokenizer·변환 아티팩트·런타임의 revision과 라이선스/고지, 서명된 manifest, checksum 필수, 경로 탈출 방지, 실패 다운로드 정리, 폐쇄망 수동 설치, proxy, OS/CPU별 최소 지원 범위. |
| 검색 UX | chunk 길이·overlap·제목 문맥·긴 코드/표 분할, 동일 노트 결과 중복 제거, 언어별 품질, 이름/경로 정확 검색 보존, 색인 지연 표시, 모델 삭제 후 벡터 삭제 여부, 변경/삭제/회수와 재색인 경합. |
| Offline conflict UX | 본문 자동 병합과 파일명 충돌·폴더 move·바이너리 충돌·키 회전 후 미전송 변경의 수동 복구를 구분. 원본 사본·비교·선택 UI와 “아직 서버/peer에 저장되지 않음” 표시. |
| 네트워크·플랫폼 | 사내망 전용/no-egress 모드, 수동 peer 주소, 프록시·UDP 차단, 절전/재개, 방화벽 정책에 의해 안내창이 없는 경우, Linux 비밀 저장소/headless 운영, 자동 시작·업그레이드 호환성. |
| 개인정보·관측성 | 본문·ticket·키가 없는 진단 로그와 지원 번들, 사용자 동의 기반 측정, relay/node 운영자의 관측 정보, 로컬 index가 평문 파생 데이터라는 설명. E2EE는 분실 기기의 디스크 암호화를 대신하지 않는다. |

F4는 이미 감사 보존 기간을 언급하고 F8은 라이선스 확인을 언급한다. 위 항목은 이 요구들이 전혀 없다는 지적이 아니라, 구매·운영·출시 판단에 필요한 범위와 완료 기준이 아직 빠졌다는 지적이다.

## 로드맵·지표

### A–F 재배치 권장안

| 단계 | 판정 | 선행 조건·수정 |
|---|---|---|
| A | 범위가 크고 “의존 없음”은 부정확 | A0에서 역할·권한 진리표와 기존 데이터 migration을 고정한다. A1은 초대/code 개선·guest·정책·감사, A2는 검증된 도메인과 승인 정책으로 분리한다. 메일 제공이 없는 self-hosted 환경의 동작도 정한다. |
| B | A와 구현 병렬 가능, guest 완료는 독립 아님 | B0에서 배포 가능한 모델/런타임 하나를 선택하고 Windows/macOS/Linux CPU 메모리·속도 예산을 검증한다. B1에서 버전 있는 chunk 색인과 검색, 권한/삭제 수명주기를 완성한다. 서버 모델 연결은 별도 B2로 둔다. |
| C | 현 상태로 제품 출시 불가 | C0에서 위협 모델·기기 신원·membership epoch·스냅샷 경쟁·삭제/복구 계약과 기술 선택을 끝낸다. C1의 제한적 LAN 실험과 C2의 외부 네트워크 배포를 나눈다. 키 회전·기기 분실 대응·쓰기 권한 검증은 공개 베타 전에 필요하다. |
| D | 보안 필수 항목과 확장 기능이 혼재 | F5.5 키 회전 및 기본 복구는 C의 출시 조건으로 이동한다. node·folder key·로컬 MCP는 독립 확장 기능으로 분리한다. 첨부 미지원 C라면 새 텍스트 전용 vault로 제한하고 기존 첨부를 조용히 제외하지 않는다. |
| E | A만 끝났다고 바로 구현 가능하지 않음 | 같은 허브라는 범위를 명시하고 partner participation·MCP scope·billing·소유권·관계 해제 설계가 선행되어야 한다. A의 guest 권한 규칙을 재사용하되 host 조직 membership으로 대체하지 않는다. |
| F | 의존 관계 오류 | D의 첨부·키·보존·복구와 C의 protocol capability가 필요하다. export/backup과 검증된 cutover가 선행되어야 한다. 전환 전 모든 offline 기기 도착을 기다릴지, 기한 후 수동 복구로 전환할지 정한다. |

로드맵에 기간·담당 인력·지원 OS 하드웨어·현재 성능 baseline이 없으므로 일정의 현실성을 숫자로 판정할 수 없다. 현재 상태에서 “A~F는 각각 한 번의 구현 단계”로 견적 내면 위험하다. 특히 C/D는 네트워크 연결 구현보다 권한·복구·호환성 비용이 크다. A/B의 제한적 진행과 P2P 설계 검증을 분리하는 것이 권장안이다.

### 성공 지표의 측정 정의

| 현재 지표 | 문제 | 수정한 측정 계약 |
|---|---|---|
| 공유 시작 중앙값 5분 | 새 팀 생성과 새 팀원 합류가 혼재하며 초대자가 offline인 P2P, 승인 대기·이메일 검증 시간을 제외하는지 불명확 | 시작/끝 이벤트, 표본·cohort·모드·네트워크 조건을 고정한다. 설치 시작→두 번째 사람의 첫 편집 수신 등 실제 협업까지 측정하고 중앙값 외 p90과 실패율을 기록한다. 사용자 동의 없는 내용 수집은 하지 않는다. |
| guest 권한 누출 0건 | 테스트에서 누출을 못 찾은 것과 운영 누출 부재는 다르다 | 역할×리소스×경로×이력/삭제×회수×기존 토큰 표의 모든 기대 거부를 출시 gate로 둔다. 운영 사고 0건은 별도 결과 지표로 추적한다. |
| LAN p95 1초, 인터넷 p95 3초 | 연결 완료 상태와 cold discovery가 섞인다. 앱 편집·외부 디스크 편집·peer Y.Doc 적용·디스크 fsync의 끝점이 다르다 | 연결된 peer의 입력→상대 화면 적용, 입력→상대 durable 저장을 분리한다. cold connect/초대/절전 복귀는 별도 p95·실패율로 측정한다. peer가 online이고 네트워크 연결 가능한 조건을 붙인다. |
| 인터넷 없이 10초 내 교환 | 편집 전파 1초와 별개의 discovery 지표인지 불명확. AP isolation 환경은 internet fallback도 없을 수 있음 | 발견·연결 완료 10초 목표와 연결 후 편집 전파를 구분한다. 순수 LAN, client isolation, 수동 연결, UDP 차단의 성공/설명 가능한 실패를 나눈다. |
| 1만 노트 30분, 검색 p95 300ms | 노트 수만으로 작업량을 정의할 수 없고 cold model load·다운로드·chunk 수·CPU가 없음 | 최소 장비와 OS, 총 token·chunk 수·언어·길이 분포, 모델 revision/정밀도, cold/warm 조건을 고정한다. 최대 RSS·CPU·디스크·배터리 영향, 중단/재개, 편집 중 지연도 함께 측정한다. 목표 달성 여부는 현재 미검증이다. |
| 50쌍 Top-5 80% | 긍정 유의어 쌍만으로 실제 retrieval과 오탐을 평가하기 어렵다. 50개에서 한 건은 2%p라 작은 차이를 개선이라 보기 어렵다 | 독립 평가 query와 distractor corpus, 한국어/영어/혼합·코드·정확 이름·무정답을 포함한다. 같은 corpus에서 현재 검색과 비교하고 hit@5 정의, 중복 노트 처리, nDCG/MRR 또는 오탐률과 언어별 결과를 기록한다. 50쌍은 smoke benchmark로 유지한다. |
| relay/node 평문 0 | 임의 문자열 grep만으로 암호화·서명·메타데이터 비노출이 증명되지 않음 | 본문·제목·경로·첨부 canary의 저장/로그 노출 검사, 위변조·재전송·구 epoch 거부, node가 content key를 갖지 않는 구조 검토를 각각 gate로 둔다. 트래픽 메타데이터 노출은 별도 한계로 보고한다. |
| 데이터 손실 0 | 절대 목표만 있고 관측·복구 정의가 없음 | 반복·역순·중복 전달, offline edit+rotate, snapshot 중 crash, 디스크 부족, 기기 분실, migration 중 중단에서 acknowledged data가 복구되는 조건을 명세한다. durable ACK 전 로컬 유일 사본 분실은 별도 위험으로 표시한다. |

이 표는 향후 acceptance 요구의 제안이다. 이번 검토에서는 테스트나 성능 측정을 실행하지 않았다.

## PRD 수정 제안 목록

1. **§1, F2:** `shares.ts` 인용을 권한 요약과 실제 생성 API로 분리하고, 실제 `POST /shares` 대상 검증의 현 상태를 적는다. `auth.ts`를 정확한 경로로 표기하고 “인증 필수 아님”으로 고친다.
2. **§1, F8:** 기존 검색에 Unicode/bigram·짧은 CJK·파일 검색이 있음을 반영하고 현행 회귀 기준으로 보존한다. 기존 버전·활동 기록과 신규 보안 감사 로그도 구분한다.
3. **D1, G6, F3:** 허브 즉시 회수의 범위를 온라인 요청/세션으로 제한하고 S3 URL·오프라인 사본의 한계를 표시한다. “노트는 기기 밖으로 나가지 않는다”는 문장을 임베딩 계산의 외부 전송 금지로 좁힌다.
4. **D2, F5.2:** Iroh 1.x의 실제 경로 선택에 맡기고 relay와 저장 node를 구분한다. 순수 사내망 모드에서 공개 lookup/relay 사용 여부를 설정 계약에 넣는다.
5. **D3, §11 Q6:** secsync의 중앙 순서 보장 전제를 공개하고 C0의 필수 설계 산출물로 P2P snapshot 경쟁·proof·저장 순서·재전송 방어를 추가한다.
6. **D3, F2:** 메시지 서명과 BFT를 구분한다. 직접 연결을 포함한 모든 영속 변경의 작성자 서명·write 권한 검증을 의무화한다.
7. **D4, F5.5, 단계 C/D:** membership epoch, 키 교체 권한, offline 미전송 변경·구키 보존·복구·동시 교체 정책을 명시하고 기본 회수 기능을 C의 출시 gate로 이동한다.
8. **F5.1:** user/device 매핑, 기기 추가·분실·회수·관리자 승계·키 복구, signing/wrapping 키의 결합을 추가한다.
9. **F5.3, §7:** 암호화 registry/control 스키마를 추가한다. stable `doc_id`, `rel_path`/`folder_id`, case-insensitive 충돌, tombstone/restore, bulk ACK와 `.context/` 제외 계약을 명시한다.
10. **F5.3:** disk-origin은 egest만 억제한다고 명확히 쓰고, P2P bootstrap 완료·live Y.Doc 적용·durable hash·recovery copy 계약을 정의한다.
11. **D3·D4:** snapshot encoding, Yjs GC, watermark 기반 로그 폐기, 최대 상태 크기와 오프라인 복귀 한도를 구분한다. Markdown 재생성을 compaction으로 사용하지 않는다.
12. **F1.1·F1.3:** ticket 서명·issuer·소비 원자성·승인 기기 바인딩·만료·rate limit을 정의한다. 전체 ticket과 CodeSlots 짧은 code를 별도 방식으로 나눈다.
13. **D6, F2:** Better Auth·join-code·vault channel·MCP token/목록·graph·trash/version·bootstrap·캐시를 출시 권한 표에 포함한다. guest의 baseline뿐 아니라 join snapshot와 org share·creator·관리 기능 우회를 제거한다.
14. **F3:** 같은 허브의 조직 연결로 초기 범위를 고정하고 참여 권한 교집합, connection generation, grant provenance, 퇴사·연결 해제·재연결·billing 규칙을 적는다.
15. **F4:** 익명 public link와 도메인 제한의 충돌을 해결하고, 정책 우선순위·원자적 감사·일괄 회수의 부분 실패·다중 인스턴스 전파를 추가한다.
16. **F1.2:** 도메인 소유 확인·중복 등록·공용 도메인·이메일 변경 후 재검증·guest 승격 금지·승인 대기 우선순위를 요구한다.
17. **F5.4·F5.7:** node의 content key 비보유와 plaintext pipeline 비실행, 저장 quota·durable ACK·복제 상태를 정의한다. 첨부의 chunk 무결성·파일 키 회전·경로/크기 제한·resume을 포함한다.
18. **F6:** 로컬 MCP 지원 client의 범위를 정하고 token/scope/vault 선택·Origin/Host·요청 한도·철회·ledger 일관성을 추가한다. CSP를 endpoint 보안 근거에서 제거한다.
19. **F7, 단계 F:** binary CRDT와 첨부를 보존하는 resumable migration, cutover epoch, offline 기기 복귀, 검증·backup·rollback, 평문 서버 전송 동의를 정의한다. F의 의존성에 D를 추가한다.
20. **D5, F8.1·F8.2:** 공식 모델 카드와 배포 artifact revision을 고정하고, 텍스트 구성·조건부 메모리 수치로 정정한다. runtime/CPU/OS 적합성을 B0에서 먼저 검증한다.
21. **F8.2~F8.6:** 모델·전처리·chunk 버전, query/document 입력 구분, 절단 후 정규화, 재색인 전환·회수와의 경합을 추가한다. 서버 `setEmbedder` 연결은 별도 확장 단계로 둔다.
22. **§6·§7:** export, backup/RPO/RTO, 키 분실, retention, device admin, quota, protocol compatibility, offline conflict UX와 개인정보 진단 요구를 추가한다.
23. **§8·§9:** 위 단계 재배치와 측정 표를 반영하고 각 목표의 기준 장비·표본·측정 시작/끝·지원 조건·실패율을 명시한다. “테스트에서 0건”을 운영상 무결함 증명으로 표현하지 않는다.

작업 범위 확인: 시작 시 깨끗했던 작업 트리에 이 보고서 한 파일만 추가했다. 기존 추적 파일과 PRD에는 변경이 없으며, 문서 whitespace 검사에서 오류 출력은 없었다.

미실시: 코드 변경·테스트·빌드·실기기/네트워크 검증·성능 측정·배포 확인. 위험: 이 보고서는 정적 코드 및 공식 문서 검토이며, 신규 P2P의 안전성이나 구현 성능이 검증됐다는 뜻이 아니다.
