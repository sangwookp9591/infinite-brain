# 사내 LAN 협업 아키텍처 선택과 현재 저장소 접점

조사일: 2026-10-21. 제품 코드 변경 없음. 아래 **사실**은 확인한 코드/공식 출처이며 **제안**은 이번 제품 요구를 위한 판단이다. 기존 문서는 설계이지 구현 증거가 아니다.

## 비개발자용 근처 공유는 어떤 연결·신뢰 구조가 적합한가?

### Takeaway

**제안:** 회사용 1차 경로는 ‘근처 자동 발견 + 앱이 관리하는 단일 권한 사내 허브’로 한다. 일반 직원은 앱 설치 → 별명 설정 → 발견된 회사 작업 공간 선택 → 관리자 승인만 거치며, Node·Postgres·IP·개발 명령을 다루지 않는다. 이후 같은 회사 신원과 데이터를 상시 켜진 회사 장비로 이전한다. 완전한 다중 마스터 P2P는 기존 C0 연구 경로로 남긴다.

### Cited Findings

- **사실:** mDNS는 일반 DNS 서버 없이 로컬 링크에서 이름을 찾는 표준이다. DNS-SD는 서비스 종류에 속한 이름 있는 인스턴스 목록을 DNS 레코드로 발견한다. ‘사람이 IP를 모른다’는 문제를 해소하는 기반이지, 회사 멤버 인증 프로토콜은 아니다. — [RFC 6762](https://www.rfc-editor.org/rfc/rfc6762), [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763)
- **사실:** Iroh 1.x의 로컬 탐색은 선택 기능이다. 공식 페이지는 같은 LAN에서 relay 없이 직접 연결 가능한 mDNS 구현을 제시하며, Wi-Fi/Ethernet/hotspot을 포함한다. `presets::N0`를 쓴 예제는 공용 DNS lookup과 relay도 함께 켠다고 명시한다. — [Iroh mDNS](https://docs.iroh.computer/connecting/local-address-lookup)
- **사실:** Iroh 1.3.0 `Builder::empty()`는 주소 탐색 서비스 없이 relay를 끈 빌더다. 기본 bind가 IPv4/IPv6 모든 인터페이스이며, 명시적인 bind로 인터페이스를 제한할 수 있다. — [Iroh Builder](https://docs.rs/iroh/1.3.0/iroh/endpoint/struct.Builder.html)
- **사실:** Syncthing은 TLS 인증서 지문과 승인된 기기 목록을 비교해 초대받지 않은 기기를 차단한다. 로컬 발견과 글로벌 발견, relay, 업데이트 확인은 별도 정보 노출 표면이다. 즉 암호화된 전송만으로 ‘외부 통신 없음’이 성립하지 않는다. — [Syncthing Security Principles](https://docs.syncthing.net/users/security.html)
- **사실:** Syncthing의 로컬 발견 패킷에는 기기 ID, 접속 주소, 인스턴스 ID가 들어간다. 프로토콜 문서는 주기적 UDP 광고와 다중 인터페이스 송신을 설명한다. — [Local Discovery v4](https://docs.syncthing.net/specs/localdisco-v4.html)

### Inferences

- **제안:** 목록 이름은 ‘근처 작업 공간’ 또는 ‘사내 작업 공간’. 설명은 ‘같은 네트워크에서 찾았어요’. 같은 SSID/사설 IP/발견 성공은 물리적으로 옆자리이거나 같은 회사 직원이라는 증거가 아니다. AP isolation, VLAN, 방화벽, 멀티캐스트 차단에 따라 발견과 접속 결과가 달라진다. **발견 성공 ≠ 실제 연결 성공**으로 UI 상태와 테스트를 분리한다.
- **제안:** 발견 대상은 모든 직원 PC가 아니라 공유를 시작한 허브다. 미승인 상태에서는 임시 인스턴스 ID·프로토콜 버전·연결 정보·중립적인 표시명만 광고하고 문서명/팀원 목록/폴더 구조/회사 인명록은 공개하지 않는다. 닉네임 공개는 사용자의 명시적 발견 모드에 한정한다.
- **제안:** 사람 표시에는 `별명 · 팀`을 쓰되, stable `person_id`, mutable nickname, `device_id`, 기기 공개키, company membership을 분리한다. 동명이인은 기기 별명과 짧은 식별 표식을 보조로 보여 준다. 별명 변경은 새 사용자를 만들지 않는다. 회사에 승인된 뒤부터 관리자가 확인한 팀 배지만 표시한다.
- **제안:** bootstrap 때 발견한 endpoint/key를 신뢰해 바로 가입하지 않는다. 임시 pairing session, 관리자 양방향 확인, 만료·일회성 초대, 승인된 person-device binding을 둔다. 같은 이름을 사칭한 허브/사람이 목록에 나타날 수 있으므로 표시 이름 자체에 보안 의미를 두지 않는다.
- **제안:** ‘연결 안 됨’ 대안은 내부 endpoint + 허브 키 지문을 담은 초대 파일/QR/링크다. 짧은 숫자 코드만으로는 대상 주소를 찾을 수 없으므로 발견/기존 내부 디렉터리가 없는 환경의 유일한 fallback으로 제시하지 않는다. 사내 정책이 peer 연결 자체를 막으면 초대 파일도 네트워크 차단을 우회하지 못한다.
- **제안:** LAN-only 프로파일은 Iroh 채택 시 `empty`에서 시작해 호환되는 로컬 lookup만 추가하고, relay/DNS/DHT/port mapping을 사용하지 않도록 별도 검증한다. 회사 네트워크 인터페이스 allowlist와 관리자 정책을 둔다. RFC1918 주소만 허용하는 것은 VLAN/VPN/원격 라우팅까지 포함할 수 있어 ‘회사 내부’ 판정의 충분조건이 아니다.

### Gaps

- 실제 사내망 토폴로지, 멀티캐스트 허용, 방화벽 설치 권한은 미확인이다. macOS/Windows 두 실기기에서 발견·승인·연결·절전 복귀와 사내망 egress 캡처를 검증해야 한다.
- mDNS 지원은 native Rust에서 구현할 수 있다는 기술적 근거이며 현재 앱에 구현되어 있다는 뜻이 아니다. Iroh는 필수 선택이 아니다. DNS-SD + 고정 지문 TLS transport도 비교할 수 있다. 현재 HTTP/WebSocket stack을 유지하려면 Iroh stream에 기존 요청/실시간 채널을 어떻게 연결할지 설계 및 성능 검증이 필요하다.
- 어느 pairing 프로토콜을 쓸지, nickname 공개 범위, 관리자의 회사 직원 확인 방식은 제품·보안 계약으로 확정해야 한다. 같은 망만으로 직원임을 자동 보증하는 근거는 없다.

## 단일 호스트와 다중 마스터, 기존 저장소 중 무엇을 재사용할 수 있는가?

### Takeaway

**제안:** 팀 그룹별 폴더 권한·퇴사자 차단·일관된 감사·버전 복원이 우선이므로 단일 권한 허브가 적합하다. Yjs 본문은 각 PC에서 오프라인 편집하되, 가입·ACL·경로 이동·체크포인트·감사 기록의 확정은 허브가 맡는다. 이것은 ‘개발자가 서버를 띄우는’ 현재 방식의 UI 포장이 아니라 설치/신원/전송/운영 계약을 추가하는 새 제품 모드다.

### Cited Findings

- **저장소 사실:** 기존 [팀 PRD](../../superpowers/specs/2026-10-15-team-second-brain-prd.md)는 허브와 P2P를 별도 vault 모드로 두며 P2P는 조직 단위 관리를 하지 않고 협업 vault를 공유 경계로 삼는다. 폴더 키와 P2P 게스트는 후속 단계다. [C0](../../superpowers/specs/2026-10-17-p2p-c0-design.md)는 새 텍스트-only vault, 2~3대, 숨은 실험을 범위로 한다. 이 두 문서는 초안/설계이며 구현 완료가 아니다.
- **저장소 사실:** 현재 Rust dependency/소스와 데스크톱 sync 경로의 `iroh`, `mdns` 검색에서 구현 근거를 찾지 못했다. 기존 sync는 React/TS HTTP와 Hocuspocus를 중심으로 하며, 서버는 Node/Hono/Better Auth/Postgres를 사용한다. — [CLAUDE.md](../../../CLAUDE.md), [server package](../../../app/apps/server/package.json)
- **저장소 사실:** 공유 API의 입력은 `principalType=user|org`, `permission=view|edit|locked|denied`다. 이 API의 `groups`는 조회할 리소스 묶음이며 팀 그룹 principal이 아니다. 현재 임의 팀 그룹 ACL 지원이라고 해석하면 안 된다. — [shares route](../../../app/apps/server/src/http/routes/shares.ts)
- **저장소 사실:** resolver는 개인별 vault 수준, 가입 시 snapshot, 명시 deny, 개인 grant, 조직 grant, 작성자/관리자 shortcut, lock cap 등 여러 분기를 가진다. ‘폴더는 그룹 권한만 보면 된다’고 새로 단순화하면 기존 경계를 깨뜨릴 수 있다. — [resolver](../../../app/apps/server/src/permissions/resolver.ts)
- **저장소 사실:** 현재 버전 API는 문서 버전 조회·복원과 vault checkpoint 생성·복원을 제공한다. 문서 복원에는 edit, vault checkpoint 작업에는 owner/admin 확인을 수행한다. — [versions route](../../../app/apps/server/src/http/routes/versions.ts)
- **저장소 사실:** stable `doc_id`, 이진 Yjs 업데이트, Markdown-disk / Y.Text-live 분리, Rust atomic writes, 두 echo guard, pull-before-seed, `.context/` 비공개는 현재 명시된 아키텍처 불변 조건이다. — [CLAUDE.md](../../../CLAUDE.md)
- **외부 사실:** AnySync는 암호화 DAG/CRDT와 서명된 변경, 별도 ACL consensus node, coordinator, sync/file node를 소개한다. 이는 ‘P2P이면 ACL 순서가 저절로 해결된다’는 근거가 아니며 별도 제어 계층의 선례다. — [AnySync README](https://github.com/anyproto/any-sync)
- **외부 사실:** NextGraph Framework는 공식 문서상 alpha early preview다. 해당 사실만으로 현 Yjs 기반 제품의 즉시 대체재라고 결론낼 수 없다. — [NextGraph Framework](https://docs.nextgraph.org/en/framework/)

### Inferences

- **제안 용어:** company/organization = 직원·기기·정책 경계 (`organizationId`), team group = 회사 내부의 사람 집합, vault = 노트 모음 (`vaultId`), folder = vault 안의 문서 구조와 ACL 대상, local path = 사용자 PC의 저장 위치. `organizationId`와 `vaultId`는 동일하지 않으며, 그룹은 vault/folder 그 자체가 아니다.
- **제안 데이터:** 새 `team_groups(id, organization_id, name)`, `group_members(group_id, person_id)`, 그룹 principal ACL, 승인된 devices, host instance identity, durable operation/outbox receipt, audit identity 확장이 필요하다. Better Auth user와 새 person을 병렬 신원으로 계속 운영하지 말고 안정된 회사 person 식별자를 기존 user와 어떻게 1:1 결합할지 migration에서 결정한다.
- **제안 권한:** 처음에는 그룹 중첩을 금지하고 그룹 여러 개 가입을 허용한다. user deny/lock, 기존 vault posture 및 grant와의 우선순위를 문서/표로 정한 뒤 **한 resolver**로 처리한다. 그룹 해제 시 캐시, listings, search, blob, MCP, 열린 sync socket을 모두 갱신한다. ACL은 UI의 선택적 동기화와 별개이며 체크 안 된 폴더도 권한이 있다면 접근 가능하다.
- **제안 동기화:** 본문은 현재 Yjs binary pipeline을 재사용한다. structural operation은 허브에서 permission 재검사 + idempotency key + transaction + ordered revision을 거친다. rename/move는 `doc_id`를 유지하고 폴더 이동은 대상 ACL을 다시 평가한다. 미전송 편집은 durable local outbox, 허브가 영속 저장을 확인한 뒤에만 ‘공유 완료’다. 연결 중/보냄/허브 저장됨/상대 저장됨을 혼동하지 않는다.
- **제안 회수:** 오프라인 기기는 회수를 알기 전 로컬 사본을 읽을 수 있다. 재접속 시 membership/ACL을 먼저 따라잡고 허가되지 않은 변경은 전송하지 않으며 복구 사본에 보존한다. 이미 받은 평문을 기술적으로 회수한다는 약속은 금지한다.
- **제안 이력:** V1은 자동 저장 + 누가 바꿨는지 + 문서 diff + 이름 있는 기준점 + forward restore다. CRDT 전송 이력과 사람이 이해하는 변경 단위를 구분한다. Git의 commit/branch/merge를 그대로 노출할 필요는 없고, 승인 전 문서 staging/검토는 별도 후속 요구다. 폴더 범위 기준점은 현재 vault checkpoint와 별도로 범위·원자성·병행편집 계약이 필요하다.
- **제안 단계:** A) 신원/발견/사내 단일 허브의 기술 spike 및 packaging 검증; B) 소규모 회사 beta와 팀 그룹 folder ACL, outbox/버전/백업; C) 상시 회사 host로 이전 및 관리 기능; D) C0 다중 마스터는 필요할 때 별도 연구. 이번 새 PRD는 C0의 보안 아이디어를 참고하되 **회사 내부 기본 경로의 우선순위를 재정의하며 C0를 구현 완료로 승계하지 않는다**고 명시한다.

### Gaps

- 조직/기기 신원 bootstrap, 그룹 ACL과 기존 resolver 우선순위, 변경 receipt/감사 transaction 경계는 새 구현이 필요하다. 현재 이메일 계정 인증을 삭제하고 별명만 저장하면 기기 키 기반 auth가 생기는 것이 아니다.
- 다중 마스터는 host 없이 일반 편집을 퍼뜨릴 수 있지만 folder ACL·멤버 제거·권한 변경·경로 충돌의 질서와 key rotation을 추가 설계해야 한다. 기존 C0도 하나의 권한 기기를 전제한다. 회사 그룹 요구 전체를 C0에 얹는 비용은 실측하지 않았다.
- AnySync/NextGraph는 고유 저장 모델과 lifecycle을 가진다. 기존 Yjs binary history를 손실 없이 얹기, 앱 크기, native bridge, folder ACL, LAN 무외부 동작까지 검증한 자료는 이번 조사에서 확보하지 못했다. 1차 제품 기반 교체를 권고할 근거가 부족하다.

## 비개발자 설치, 호스트 장애와 상시 회사 장비 이전을 어떻게 정직하게 설계할까?

### Takeaway

**제안:** 기능상 작은 사내 서버가 필요하더라도 사용자가 이를 설치·명령어 실행하지 않도록 앱이 수명주기를 관리해야 한다. 기존 서버와 실제 Postgres 번들을 우선적인 호환성 기준으로 검증하되, OS별 패키징·데이터 업그레이드·백업 비용을 포함한 gate를 통과하기 전 ‘설치만 하면 완성’으로 약속하지 않는다. PGlite는 즉시 대체재로 확정하지 않는다.

### Cited Findings

- **사실:** Tauri는 external binaries sidecar 번들을 지원하며 target triple별 binary를 준비해야 한다. 이것은 외부 실행 파일 동봉 수단이지 데이터베이스 업그레이드나 안전한 복원까지 대신하는 기능이 아니다. — [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)
- **사실:** PGlite는 단일 연결 DB다. socket server의 여러 동시 연결은 하나의 연결 위 multiplexer로 동작하며 공식 문서는 모든 use case가 보장되지 않는다고 한다. socket SSL도 미지원이다. — [PGlite socket](https://pglite.dev/docs/pglite-socket), [PGlite 시작하기](https://pglite.dev/docs/)
- **저장소 사실:** 현재 서버는 pg connection pool, transaction-scoped advisory lock뿐 아니라 migration/external revocation의 **session-scoped advisory lock**을 쓴다. — [pool](../../../app/apps/server/src/db/pool.ts), [migration runner](../../../app/apps/server/src/db/migrate.ts), [external revocation](../../../app/apps/server/src/permissions/external-revoke.ts)
- **사실:** Postgres는 minor upgrade와 major upgrade의 데이터 호환 계약이 다르며 major는 dump/restore, pg_upgrade 등의 절차가 필요하다. 백업은 SQL dump·filesystem backup·continuous archiving으로 구분된다. — [Postgres upgrades](https://www.postgresql.org/docs/current/upgrading.html), [Postgres backups](https://www.postgresql.org/docs/current/backup.html)
- **저장소 사실:** 서버는 private IPv4/IPv6 및 `.local`의 plain HTTP origin을 허용하는 코드가 있다. 이는 개발/연결 호환 기반이며 LAN 도청 방지 또는 앱 내 host 자동 실행의 증거가 아니다. — [config](../../../app/apps/server/src/config.ts)

### Inferences

- **제안 패키징:** 호스트 PC에서만 Node runtime + compiled server + native deps + Postgres binaries + 필요한 extension을 앱 배포물로 관리한다. PG는 loopback에만 bind하고 회사 네트워크에는 인증된 app transport만 연다. UI(WebView)에 DB 비밀번호/기기 private key를 넘기지 않는다. 기존 `.env`를 읽거나 덮어쓰는 개발 프로세스와 제품 host state를 분리한다.
- **제안 배포 검증:** Windows x64 / macOS arm64,x64에서 첫 설치, 제한 계정, 방화벽 알림, port collision, installer signature/notarization, native Argon2 로딩, 업그레이드 실패 rollback, 강제 종료 후 DB recovery, 백그라운드 종료 정책을 실제 실행한다. PG major version은 앱의 작은 업데이트와 분리해 고정한다. 자동 service 설치는 별도 정책/권한이 필요한 선택이며, ‘앱 창 닫기’와 ‘공유 종료’도 구분한다.
- **제안 PGlite gate:** 전체 migration, Better Auth pool, advisory locks, rollback, 동시 note update/ACL revoke, crash durability, backup/restore, 장시간 부하를 실험한다. 호환하지 않으면 현재 pg semantics를 줄여서 맞추지 말고 실제 PG 기준을 유지한다. ‘WASM이므로 가볍고 설치가 해결된다’는 추측을 아키텍처 결정으로 쓰지 않는다.
- **제안 외부 연결:** 회사 내부 모드의 auth/sync/discovery는 공용 relay·DNS·SMTP·OAuth·billing·AI API가 필수가 아니어야 한다. 기존 S3 blob/외부 모델 다운로드·업데이트 조회·링크 unfurl·MCP 외부 client metadata 조회는 별도 egress 표면을 조사해 차단하거나 관리자 정책으로 명시한다. 강한 ‘앱 외부 통신 0’ 약속은 sync-only claim과 다르므로 별도 acceptance gate와 내부/offline updater 배포가 필요하다.
- **제안 장애:** host가 잠들거나 앱이 종료되면 각자 로컬 편집은 계속할 수 있으나 타인과 동기화·새 가입·ACL 변경·새 공유 checkpoint 확정은 중단된다. host 저장 전 변경은 그 편집 PC에만 있다. UI는 ‘이 컴퓨터에 저장됨 · 회사 공유 대기’를 보여 준다. 자동 leader promotion은 V1에 넣지 않는다.
- **제안 이전 절차:** 관리자가 이전 시작 → 새 가입/구조/ACL 변경 잠시 동결 → host가 durable receipt 경계를 정하고 DB+Yjs+registry+blobs+ACL+identity mapping+audit의 일관 snapshot/export 생성 → 새 host import/검증 → old host fencing 및 새 host generation 서명 → 고객 앱은 동일 회사 identity와 새 generation/endpoint를 확인하여 전환 → 기존 로컬 outbox를 새 host 권한으로 재전송. doc/person/group/vault IDs는 유지한다. private key 이전은 암호화된 전용 절차로 다루며 초대 파일에 키를 넣지 않는다.
- **제안 재해복구:** old host 접근 불가 시 자동 승격 대신 관리자 복구 자격과 마지막 백업으로 명시 복원을 한다. 과거 호스트가 돌아오면 쓰기 권한 generation 검사로 fence한다. 백업 이후 ACK된 변경도 원본/다른 사본에 없으면 손실될 수 있으므로 RPO/RTO를 제품에 표시한다. 동기화 사본은 deletion/corruption도 전파하므로 백업을 대신하지 않는다.
- **제안 백업 범위:** Postgres dump 또는 지원되는 consistent backup, blob data, encryption/recovery material, host config/schema version을 묶는다. 개인 PC의 Markdown만 옮겨서는 ACL·감사·Yjs identity·회사 member를 복원할 수 없다. 첫 beta 전 복원 drill을 통과해야 한다.

### Gaps

- 번들 크기, idle 메모리, PC 성능에 따른 동시 사용 한도, 지원 가능한 Postgres 배포 소스/라이선스 고지, OS background process 지속성은 미측정이다. 수치 약속을 하지 않는다.
- 기존 production server의 이메일/결제/AI/외부 OAuth 의존이 company-offline profile에서 실제로 얼마나 제거 가능한지 전체 호출 그래프 감사는 이번 조사 범위를 넘는다. ‘서버 주소만 바꾸면 내부망 전용’이라고 결론낼 수 없다.
- host 이전/fencing/recovery protocol은 제안이며 코드에 없다. 장기 상시 host는 Linux 회사 장비 또는 지원되는 Windows/macOS service로 운영할 수 있겠지만 지원 OS/관리 범위를 먼저 확정해야 한다.
