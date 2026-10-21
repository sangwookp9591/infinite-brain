# 사내 팀 폴더 동기화와 형상관리 경험 조사

조사일: 2026-10-21. 논문·저자 연구 노트·공식 프로젝트 문서와 GitHub만 사용했다. 외부 자료의 사실, 현재 저장소 관찰, 제품 설계 제안을 구분한다. 실행 코드 변경이나 성능·보안 검증은 수행하지 않았다.

## 1. 기존 동기화 코어를 교체해야 하는가?

### Takeaway

제안: Yjs와 Markdown bridge를 유지하고 발견·신뢰·전송·사내 호스트 운영 계층을 추가한다. LAN 사용과 비개발자 온보딩은 CRDT 교체만으로 해결되지 않는다.

### Cited Findings

- 2019년 Kleppmann·Wiggins·van Hardenberg·McGranaghan의 local-first 논문은 오프라인 작업, 소유권, 협업을 함께 다룬다. 파일 단위 동기화와 실시간 편집을 구분하고 CRDT 변경을 여러 통신 수단으로 운반할 수 있다고 설명한다. 논문 당시 프로토타입 관찰을 현재 제품의 정량 성능 근거로 사용하면 안 된다. — [논문 PDF](https://martin.kleppmann.com/papers/local-first.pdf)
- Yjs 업데이트는 binary이며 교환·결합·멱등 성질이 있다. 같은 업데이트 집합을 받으면 수렴하고 state vector로 누락분을 계산한다. binary 업데이트 병합만으로는 삭제된 데이터의 GC가 수행되지 않는다. — [Document Updates](https://docs.yjs.dev/api/document-updates)
- y-webrtc는 signaling 서버로 상대를 찾는다. 브라우저 연결 수에 제약이 있고 README는 규모가 커지면 동기화 보장에 한계가 있음을 경고한다. 그러므로 이것을 LAN 자동 발견 또는 기업용 사용자·폴더 권한 시스템으로 간주할 수 없다. — [y-webrtc](https://github.com/yjs/y-webrtc)
- Automerge는 change hash들의 그래프와 heads를 제공하며 과거 시점 조회와 fork/merge를 지원한다. 이것은 대안 엔진의 유용한 성질이지만 사람 식별·검토 승인까지 자동으로 제공한다는 뜻은 아니다. — [Tracking Changes and History](https://automerge.org/automerge-swift/documentation/automerge/changesandhistory/), [Automerge JS changeAt](https://automerge.org/automerge/api-docs/js/functions/changeAt.html)
- Yjs, Automerge는 MIT, Syncthing은 MPL-2.0, Keyhive는 Apache-2.0이다. 도입 시 본체뿐 아니라 실제 고정 버전과 전이 의존성의 고지·배포 조건을 확인해야 한다. — [Yjs LICENSE](https://github.com/yjs/yjs/blob/main/LICENSE), [Automerge](https://github.com/automerge/automerge), [Syncthing LICENSE](https://github.com/syncthing/syncthing/blob/main/LICENSE), [Keyhive](https://github.com/inkandswitch/keyhive)
- 현재 저장소는 Yjs 13.6.31, Hocuspocus 4.4.0을 잠금 파일에 사용한다. 문서 본문은 `Y.Text("content")`, Rust atomic disk write, Markdown ingest/egest, stable doc_id 계약을 이미 갖고 있다. — [lockfile](../../../app/pnpm-lock.yaml), [CLAUDE.md](../../../CLAUDE.md)

### Inferences

- **제안: 기존 서버를 사내 호스트 서비스로 제품화.** 발견은 주소를 자동으로 찾고, 가입은 사내 principal/device를 생성하며, 전송은 기존 Yjs binary protocol을 운반한다. 권한 판단과 이력은 호스트가 관리한다. 사람 PC가 호스트인 소규모 모드와 상시 가동 사내 호스트 모드를 명시적으로 구분한다.
- **제안: Syncthing을 동일 vault 위에 동시에 실행하지 않는다.** 두 엔진이 각각 watcher·삭제·충돌 사본·메타데이터를 해석하면 doc_id와 echo guard 계약을 깨뜨릴 위험이 있다. Syncthing의 충돌 보존·블록 검증·버전 관리 정책을 참고하고, 기존 note pipeline과 분리한 binary 전송을 설계한다.
- **제안: Automerge 전환은 별도 ADR/마이그레이션 과제로 분리.** heads와 fork 경험은 참고하되 문서 persistence, bridge, editor binding, undo, 서버 ACL, 기존 사용자 데이터 변환을 모두 바꾸는 비용을 근처 공유 기능의 필수 비용으로 만들지 않는다.
- MIT 사용의 허용성과 유지보수 지원 확보는 별개다. Yjs의 공식 지원 계약 안내를 참고해 사내 서비스에 필요한 취약점 대응 책임과 업그레이드 테스트를 정한다. — [Yjs 공식 프로젝트](https://github.com/yjs/yjs)

### Gaps

- 실제 사무실 VLAN/단말 수/보안 제품에서의 연결과 성능, Windows 서비스 배포, 호스트 복구 비용은 실험이 필요하다. 이번 조사에서 특정 장치 수를 보장할 근거는 확보하지 않았다.
- GitHub main의 최신 API와 실제 고정 버전 API를 혼동하면 안 된다. 예컨대 Yjs main의 attribution 설계 노트를 13.6.31에 그대로 구현 가능한 기능으로 취급하지 않는다. — [attributing-content.md](https://github.com/yjs/yjs/blob/main/attributing-content.md)

## 2. 비개발자에게 형상관리 경험을 어떻게 제공할 것인가?

### Takeaway

제안: V1은 자동 저장·동기화 위에 ‘이름 붙인 버전’, 변경 비교, 복원을 제공한다. 승인 전 비공개 초안과 배포 승인은 별도의 publication/branch 기능으로 정의해야 한다.

### Cited Findings

- Ink & Switch Patchwork의 Edit Groups는 직접 편집한 뒤 관련 변경을 묶고 이유를 적으며 diff와 되돌리기로 검토하는 실험이다. 승인·거절을 모든 편집의 선행 조건으로 요구하지 않는다. — [Edit Groups](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/05/)
- 같은 연구의 Simple branching은 공동 편집하면서도 대안을 별도 버전으로 시험하는 흐름을 탐구한다. 이는 edit group과 다른 작업 모델이다. 연구 프로토타입이지 검증된 사내 서비스 완제품은 아니다. — [Simple branching](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/06/)
- Universal Version Control 연구는 개발자 외 사용자를 위한 간단한 버전 관리 개념을 목표로 하며 여러 매체를 탐색한다. — [연구 개요](https://www.inkandswitch.com/universal-version-control/), [프로토타입 코드 tiny-essay-editor](https://github.com/inkandswitch/tiny-essay-editor)
- Syncthing 버전 관리는 기기별·폴더별 설정이며 기본은 보관하지 않음이다. 다른 기기에서 받아 덮어쓰거나 삭제할 때 이전 파일을 보관하고, 자기 기기에서 직접 덮어쓴 이전 파일은 보관하지 못한다. 자동 동기화 자체가 완전한 버전 관리 또는 백업임을 뜻하지 않는다. — [Syncthing File Versioning](https://docs.syncthing.net/users/versioning.html)
- 현재 저장소의 checkpoints는 vault 구조·문서 본문, 자동 일간·수동 capture, 최대 5개, blob pinning 등을 갖춘다. 복원은 오래된 Y.Doc 교체가 아니라 현재 문서에 앞으로 진행하는 편집을 적용하며 사전 복원 checkpoint를 남긴다. 여러 문서에 걸친 한 번의 ACID 원자 복원은 아니고 재실행 수렴을 의도한다. — [checkpoints.ts](../../../app/apps/server/src/versions/checkpoints.ts), [revert.ts](../../../app/apps/server/src/versions/revert.ts)

### Inferences

- **제안 V1 용어:** ‘버전 남기기’, ‘지난 버전과 비교’, ‘이 버전으로 복원’, ‘팀에 반영됨’. 일반 사용자가 commit/push/pull/merge를 배울 필요 없이 중요 시점을 이름으로 남긴다.
- **명시할 의미:** 공유 폴더의 자동 동기화를 켜면 편집은 권한 있는 팀원에게 바로 공개된다. 이름 붙인 버전은 이력의 표시점이며 ‘승인 대기’나 ‘다른 사람에게 아직 안 보임’을 의미하지 않는다.
- **제안 불변 manifest:** `checkpoint_id`, `vault_id`, `scope_root_ids`, `actor_id`, `created_at`, `label`, 호스트 기준 registry revision, 각 stable item ID/parent ID/path, 본문 digest/보관 reference, binary digest/bytes/version을 묶는다. 준비 중→완성 상태를 나누고 완성 뒤 manifest를 바꾸지 않는다. 미완전 캡처는 누락 목록을 표시한다. blob GC는 checkpoint 참조가 사라진 뒤만 허용한다.
- **기존 코드와 차이:** 현재 capture에는 구조만 잡힌 문서의 후속 top-up 동작이 있다. 현행 checkpoint가 이미 엄격 불변이라는 주장은 금물이다. 새 ‘확정 버전’은 pending 상태에서 내용을 확정하거나, capture 시점을 확정한 새 manifest로 분리해야 한다.
- **제안 복원:** 먼저 비교/영향 범위를 보여주고, 복원 직전 버전을 만들며, registry·본문·blob 단계별 작업 ID와 재시도 이력을 남긴다. Yjs history를 과거 binary로 덮어쓰지 않는다. V1 폴더 범위 복원은 현행 vault 전체 복원의 단순 UI 변경이 아니며 ACL과 경로 의존 관계를 다시 설계해야 한다.
- **제안 후속 단계:** 개인 초안/변경 제안은 공유 문서와 별도 문서 집합 또는 branch에 보관하고, 승인한 diff를 공유 head에 새 작업으로 적용한다. ‘공식 배포본’은 고정 checkpoint를 가리키고 ‘현재 공동 작업본’과 구분한다. V1에서 이런 격리 없이 승인 버튼만 추가하지 않는다.
- Yjs 공식 위협 모델도 제안 전용 사용자는 별도 fork에 쓰게 하고, 원본에 들어온 binary update를 부분 필터링해 권한을 강제하지 말라고 안내한다. 이 원칙은 branch/review 분리가 단지 UI 선택이 아님을 뒷받침한다. — [Yjs Threat Model](https://github.com/yjs/yjs/blob/main/THREAT_MODEL.md)

### Gaps

- checkpoint 보관 개수/기간, 중요 버전 영구 보존, 검토자 수, 그룹 간 배포 승인은 사용자 정책 결정이다. 기존 최대 5개를 기업 서비스의 최종 요건으로 채택할 근거는 없다.
- 최신 revert의 상단 주석에는 첨부 미지원 설명이 남지만 실제 하단에는 pinned binary 복원 경로가 있다. 기능 지원 범위는 테스트와 실행 경로를 추가로 확인해야 하며 이 조사에서 완전성을 검증하지 않았다.

## 3. 폴더 이동·삭제·권한 회수·Office 파일 충돌은 어떻게 다룰 것인가?

### Takeaway

제안: 본문 수렴, 구조 변경, 권한 변경, binary 변경을 서로 다른 규칙으로 다룬다. 닉네임은 표시 이름이며 권한과 이력은 불변 principal/device ID에 귀속한다.

### Cited Findings

- Kleppmann 외의 replicated tree 논문은 동시 폴더 이동이 사이클 등 구조 오류를 만들 수 있음을 보이고, 조정 없이 수렴하며 트리 유효성을 지키는 알고리즘을 증명한다. 텍스트 CRDT 채택이 임의의 폴더 이동을 자동으로 안전하게 만드는 것은 아니다. — [논문·저자 설명](https://martin.kleppmann.com/2021/10/07/crdt-tree-move-operation.html)
- Syncthing은 같은 파일이 서로 다르게 동시 수정되면 충돌 사본을 남기며, 삭제와 수정의 충돌도 사본으로 보존한다. 대소문자 경로 충돌은 다른 플랫폼에서 표현 불가능할 수 있어 별도 오류로 표시한다. — [Understanding Synchronization](https://docs.syncthing.net/users/syncing.html)
- BEP는 인증된 암호화 transport 위에서 동작하고 device certificate fingerprint와 사람이 보는 device name을 구분한다. 이름은 유일할 필요가 없고, deletion flag와 version vector를 데이터 모델에 둔다. — [BEP 사양](https://docs.syncthing.net/specs/bep-v1.html)
- Keyhive는 오프라인 접근 제어·권한 회수와 키 갱신을 연구하지만 현재 GitHub는 pre-alpha, 미감사, production 사용 금지를 명시한다. — [Keyhive README](https://github.com/inkandswitch/keyhive), [연구 개요](https://www.inkandswitch.com/project/keyhive/)
- Keyhive 위협 모델은 회수된 멤버가 이전에 본 키와 평문을 보유할 수 있으며 사람과 key를 연결하는 신원 기능이 별도 계층이라고 설명한다. 늦게 도착한 실제 오프라인 작업과 조작한 과거 작업의 구분에는 한계가 있다고 명시한다. 이는 목표 설계의 설명이며 감사된 보안 보장이 아니다. — [Keyhive Threat Model](https://github.com/inkandswitch/keyhive/blob/main/design/threat_model.md)
- Kleppmann의 2025년 강연은 peer-to-peer ACL 자체가 악성 조작에 안전해야 함을 지적한다. CRDT 수렴과 쓰기 권한 검증은 별개 문제다. — [Byzantine Eventual Consistency and Local-First Access Control](https://martin.kleppmann.com/2025/03/31/papoc-keynote-byzantine.html)
- 현재 registry tree-ops는 no cycles, no cross-vault parents, 경로 충돌, NFC+소문자 path key를 다룬다. 현재 inbound는 tombstone에 의한 삭제와 readable-set에서 벗어난 revocation을 구분하고 incomplete listing으로 인한 대량 삭제를 방어한다. — [tree-ops.ts](../../../app/apps/server/src/registry/tree-ops.ts), [inbound.ts](../../../app/apps/desktop/src/lib/sync/inbound.ts)

### Inferences

- **제안 구조 변경:** V1은 호스트를 registry/ACL 기준점으로 두고 `op_id + base_revision` 구조 작업을 직렬화한다. 오프라인 이동·이름 변경은 로컬 대기 상태로 보존하고 연결 뒤 현재 revision/권한/목적지/사이클/경로 충돌을 재검사한다. 경쟁 이동은 침묵 덮어쓰기 대신 선택을 요청한다. 완전 P2P 트리 CRDT는 후속 별도 과제다.
- **제안 그룹 공유:** GroupMembership과 FolderGrant를 분리하고 상속 규칙을 명시한다. 폴더 이동 시 원본·목적지 권한을 검사하고 자손 전체 readable/editable set을 재계산한다. 새 권한 대상에게만 내용 전송, 잃은 대상은 live connection 해지·캐시 제거 요청·후속 update 거절을 수행한다. 이력·검색·blob·presence도 같은 범위여야 한다.
- **회수의 한계:** 이미 전달된 평문, 내보내기, 화면 캡처의 원격 회수를 약속하지 않는다. 오프라인 단말은 회수를 통지받기 전까지 복사본을 볼 수 있다. 호스트는 재연결 시 최신 권한을 확인하고 회수된 단말의 pending write를 공유 원본에 반영하지 않는다. 보존/복구는 회사 정책과 읽기 권한에 맞게 처리한다.
- **제안 tombstone:** item ID, 삭제 revision, 삭제자, 시각을 명시한다. 서버를 못 찾거나 목록 페이지가 비어 있다는 이유로 삭제하지 않는다. 장기간 오프라인 단말의 재등록으로 삭제가 되살아나지 않도록 tombstone 보존과 만료 단말의 full bootstrap 규칙을 함께 설계한다. 휴지통 보존 기간과 tombstone 보존 기간은 같은 개념이 아니다.
- **제안 binary:** DOCX/XLSX/PPTX/PDF는 Y.Text로 병합하지 않는다. 불변 blob과 `base_blob_digest → new_blob_digest` 조건부 교체를 사용하고 동시 변경은 두 버전 모두 보존해 선택하도록 한다. 편집 중 표시는 안내이며 네트워크 분할에도 안전한 독점 잠금을 보장한다고 말하지 않는다. `.context/`, 임시 잠금 파일·OS 메타데이터는 공유 대상에서 제외한다.
- **제안 이력 신원:** 최초 닉네임과 부서/기기 별명은 UI에 표시한다. 감사 기록은 `actor_id`, `device_id`, 당시 표시 이름 snapshot, 호스트 수신 시각, 작업 ID에 귀속한다. 이름 변경이나 중복 닉네임이 기존 이력의 사람을 바꾸면 안 된다. Yjs clientID는 세션 식별자이지 사람 ID가 아니다. — [Y.Doc API](https://docs.yjs.dev/api/y.doc)
- **검증 제안:** 동시 rename/move·부모 삭제 중 자식 편집·네트워크 끊김 뒤 ACL 회수·닉네임 중복/변경·Office 동시 저장·checkpoint blob GC·복원 도중 종료·대소문자/한글 정규화 충돌을 최소 수용 시나리오로 둔다.

### Gaps

- 사내에서 누가 최초 관리자가 되는지, 단말 교체 시 동일 인물 확인, 퇴사자 로컬 보존 정책, 그룹 중첩/deny 우선순위는 별도 PRD 결정이 필요하다.
- 특정 E2EE 또는 P2P 암호 라이브러리를 채택하는 보안 심사와 성능 검증은 하지 않았다. Keyhive의 설계 아이디어와 현행 성숙도를 분리해야 한다.
