---
type: report
product: Infinite Brain
stage: C0 독립 검증
date: 2026-10-16
target: docs/superpowers/specs/2026-10-16-c0-p2p-design.md (커밋 a400bd8)
basis: PRD v2 §4 D1~D4·D7, §5.5, §5.7, §9 C0, §12 / PRD-REVIEW-team-second-brain-astra.md / CLAUDE.md 불변식
verifier: Opus (설계 문서 작성에 참여하지 않음)
---

# C0 P2P 설계 독립 검증

## 판정: 수정 후 승인

기술 선택(Iroh 1.x 위에 직접 구현)과 큰 구조(단일 권한 기기 체인, 서명된 봉투, 부재≠삭제, 브리지 무변경)는 근거가 맞고 PRD·리뷰 요구를 대부분 덮는다. 다만 아래 **상 4건은 C1 착수 전에 설계 문서에 반영**해야 한다. 넷 다 재설계가 아니라 명세 보강으로 닫힌다.

- H1. KeyPackage 인증이 없다. 제거된 멤버가 가짜 키를 먼저 심을 수 있다.
- H2. 멤버십 분기 선택 규칙과 되돌리기 방어 규칙이 서로 모순된다. 예비 권한 기기와 복구 키가 무제한 롤백 수단이 된다.
- H3. 복구 키가 탈퇴자 손에 남는다. 미래 epoch가 모두 복구 공개키로도 감싸지므로 post-compromise가 깨진다.
- H4. watermark 삭제 뒤 작성자 체인의 연속성을 증명할 방법이 없다. 새 기기는 영구히 "누락"을 보거나 누락 탐지를 꺼야 한다.

## 1. 확인된 사실 주장

2026-10-16에 crates.io·npm API, 공식 문서, 저장소에서 다시 확인했다.

| 주장 | 결과 | 출처 |
|---|---|---|
| iroh 1.3.0(2026-09-28), 1.0.0(2026-06-15), MIT OR Apache-2.0 | 확인 | https://crates.io/api/v1/crates/iroh |
| 1.0이 wire 프로토콜·API 안정성을 약속, Swift·Kotlin 바인딩 | 확인. 공식 지원 언어는 Python·Node.js·Swift·Kotlin 넷이다 | https://iroh.computer/blog/v1 |
| `iroh-mdns-address-lookup` 0.6.0(2026-09-28), n0 공식 crate, 기본 꺼짐, 키와 로컬 주소를 같은 망에 알림 | 확인. 저장소 n0-computer/iroh-address-lookups | https://docs.iroh.computer/connecting/local-address-lookup |
| `RelayMode` = Disabled / Default / Staging / Custom(RelayMap) | 확인 | https://docs.rs/iroh/1.3.0/iroh/endpoint/enum.RelayMode.html |
| iroh-gossip·iroh-docs 0.101.0, iroh-tickets 1.0.0(모두 2026-06-15) | 확인 | crates.io API |
| 보안 수정: iroh-blobs(블로그 10-08), 1.1.0(09-01), 1.0.2 relay(07-07) | 확인. 날짜는 블로그 기준이다. crate 게시일은 각각 10-06, 08-25, 07-06 | https://www.iroh.computer/blog |
| blinded address lookup은 개념 증명이고, 공개키를 비밀로 만드는 것은 로드맵에 없다 | 확인(2026-10-13 글) | https://iroh.computer/blog/blinded-address-lookup |
| NextGraph v0.1.2-alpha.1(2025-11-08) "you cannot share documents with other users", 형식 변경 시 데이터 손실 경고, alpha.2(2026-03-02)는 ORM만 다룸, 그 뒤 릴리스 없음 | 확인 | Gitea API `/repos/NextGraph/nextgraph-rs/releases` |
| NextGraph는 모든 앱에 broker가 필요하고, 운영 broker는 nextgraph.eu뿐이며, 클라이언트는 broker와 클라이언트-서버 방식으로 통신 | 확인 | https://docs.nextgraph.org/en/getting-started/ · /en/network/ |
| NextGraph verifier `yrs = "0.19.2"`, `automerge = "0.5.11"`, crates.io 0.1.1-alpha.2(2025-05-01), `app/shell/src-tauri`, main 최근 커밋 2026-10-01, MIT/Apache-2.0 | 확인 | 저장소 `engine/verifier/Cargo.toml`, crates.io |
| p2panda-net·-auth·-encryption 0.7.1(2026-08-21), MIT OR Apache-2.0, iroh ^1.0.3, iroh-gossip ^0.101.0 | 확인 | https://crates.io/api/v1/crates/p2panda-net/0.7.1/dependencies |
| p2panda "API는 아직 프로덕션에 쓸 만큼 안정적이지 않다", encryption "보안 감사 없음, 고위험 용도 비권장", auth Pull/Read/Write/Manage와 strong removal, Tauri 앱 Toolkitty·Dash Chat | 확인 | crate README, https://p2panda.org |
| samod 0.15.0(2026-09-30, MIT, "don't use this anywhere serious yet"), automerge 0.12.0 / npm 3.5.0, keyhive_core 0.7.0(2026-10-13, Apache-2.0, pre-alpha, 감사 없음, BeeKEM), subduction_core 0.19.0(2026-10-07, "very unstable API", Iroh 전송) | 확인 | crates.io, github.com/alexjg/samod, inkandswitch/keyhive, inkandswitch/subduction |
| Automerge 계열은 Yjs 이력을 보존할 수 없다 | 사실상 확인. Yjs→Automerge 변환 도구를 npm과 웹에서 찾지 못했고, Automerge 문서에 Yjs 가져오기가 없다. 증명이 아니라 부재 확인이다 | npm 검색, automerge.org 문서 |
| yjs 13.6.33(2026-09-23), yrs 0.28.0(2026-09-17, MIT) | 확인 | npm, crates.io |
| secsync 0.5.0(2024-06-04), y-sync 0.4.0(2023-11-17), iroh-willow 0.0.1(2025-02-07) | 확인 | npm, crates.io |
| hpke 0.14.1(2026-09-06, MIT/Apache-2.0), ed25519-dalek·x25519-dalek 3.0.0(2026-07-06, BSD-3-Clause) | 확인. 모두 Apache-2.0 프로젝트와 호환 | crates.io |
| macOS 15부터 로컬 네트워크 승인, 권한 창이 뜨지 않는 포럼 사례 | 확인. 같은 스레드에 macOS 27 정식판에서도 재현된다는 보고가 있다(C1 환경에 27을 넣을 것) | TN3179, https://developer.apple.com/forums/thread/814226 |
| 코드 인용(§4~§8의 `R/`·`D/` 줄 번호) | 확인. 아래 §3 표 참고 | 저장소 a400bd8 (코드는 c10a7ea와 같음) |

## 2. 틀리거나 부정확한 사실 (정정)

| 위치 | 문서 | 정정 | 출처 |
|---|---|---|---|
| §3.2 표, §13 p2panda-net | "mDNS 지원(개인정보 때문에 기본 꺼짐)" | **기본은 passive다.** `iroh_mdns` feature가 기본 feature에 들어 있고, `MdnsDiscoveryMode` 기본값은 Passive(광고는 하지 않고 수신만 함)다. 그리고 p2panda-net 0.7.1은 `iroh-mdns-address-lookup ^0.5.0`에 의존하므로, 우리가 쓸 0.6.x와 맞지 않는다 | `p2panda-net/src/iroh_mdns/config.rs` ("By default this is set to "passive""), crates.io dependencies |
| A6, §13 Yjs | "Yjs 14는 아직 베타다", next 14.0.0-8 / beta 14.0.0-16 | 태그 값은 맞지만 둘 다 2025년에 멈춘 태그다. v14 개발은 **`@y/y` 패키지**로 옮겨 갔다(latest 14.0.0-rc.7, beta 14.0.0-rc.29, 2026-10-15). A6의 재평가 대상은 `@y/y`다 | https://registry.npmjs.org/@y/y |
| §3.3 근거 2 | "0.1.0 이후 0.x로만 12개 버전" | 0.1.0을 포함해 모두 12개다(2024-12-06부터). auth·encryption은 2025-07-07 0.4.0부터 8개 | crates.io |
| §6.2 "평문으로 남는 것" | "… 작성 기기 공개키, 시각" | 헤더 표에는 시각 필드가 없고, 작성 시각은 payload 안에 있다(같은 절). 둘 중 하나로 맞춘다 | 문서 내부 불일치 |

그 밖의 버전·날짜·라이선스 주장에서는 틀린 곳을 찾지 못했다.

## 3. 브리지 불변식 대조 (코드 a400bd8)

| 불변식 | 코드 | 설계와 충돌 |
|---|---|---|
| stable `doc_id` | `R/index.rs:1424` `Uuid::new_v4()`, `reuse_id` 재사용 | 없음 |
| 디스크 Markdown이 영속 진실 | 원자적 쓰기 + egest. `resolve_in_vault`(`R/vault.rs:183-210`)가 `..`와 절대경로를 거부 | 없음. 단 registry 입력 검증을 명시해야 한다(M8) |
| `Y.Text("content")`가 실시간 진실 | `noteBridge.ts:190`, `applyRemote`는 `ORIGIN_REMOTE`(`:1267-1268`) | 없음 |
| 에코 가드 1 (디스크 origin은 egest하지 않음) | `noteBridge.ts:249` | 없음 |
| 디스크 origin은 네트워크로 보냄 | Hocuspocus provider 4.4.0 `documentUpdateHandler`는 `origin === this`만 거른다 | 문서 주장이 맞다 |
| 에코 가드 2 (`lastWrittenHash`) | `:778`, 쓰기가 확인된 뒤 갱신(`:1041-1057`) | 없음 |
| 150/300ms | `R/watcher.rs:46`, `types.ts:207-208` | 없음 |
| pull-before-seed | `noteBridge.ts:340-346` | 없음 |
| `.context/` 비공개 | `R/vault.rs:10`, `:82-86`, `rel_path_is_ignored` | 없음 |
| 대량 가드 | `inbound.ts:376-398` (`trashCap` max(5,20%), `renameCap` max(20,30%)) | 인용은 맞다. 다만 악성 멤버에 대한 효과를 과장한다(M5) |
| 키체인 대체본 감지 | `R/keychain.rs:43-62` | **문제 있음(M7).** `UntilReboot`도 "영속"으로 친다 |

불변식 자체와 정면으로 부딪치는 곳은 없다. 다만 통합 지점 설명에 빈칸이 둘 있다(M1, M2).

## 4. 설계 결함

### 상

**H1. KeyPackage 인증과 키 확인이 없다 (§5.3, §4.4 승인)**
- 시나리오: X가 제거된다. X는 남은 기기 V의 HPKE 공개키를 이미 알고 있다(옛 멤버십 본문). HPKE Base 모드에는 송신자 인증이 없으므로(RFC 9180 §5.1.1), X는 공격자가 고른 키 K′를 `{rotation_id, device_id=V}`로 감싸 V에게 먼저 보낸다. V는 `(rotation_id, device_id)`로 중복을 거르므로 **먼저 온 가짜가 이기고 진짜가 버려진다.** V는 K′를 e+1 키로 믿고 곧바로 e+1로 쓰기 시작하며(§5.3 "곧바로"), X는 V의 제거 이후 내용을 모두 읽는다. 바뀐 `rotation_id` 하나로 진짜 교체를 방해하는 서비스 거부도 된다.
- 권고: KeyPackage에 권한 기기 서명을 붙인다. HPKE `info`에 `vault_id‖rotation_id‖key_id‖epoch‖recipient`를 묶는다. `RotateBegin`에 키 commitment(예: `BLAKE3-keyed(K, "ib/p2p/keycommit/v1")`)를 넣는다. 받은 키는 commitment가 맞고 권한 기기가 서명한 `RotateBegin` 본문을 열 수 있을 때만 받아들인다. 중복 제거는 검증을 통과한 패키지에만 적용한다. §4.4의 "모든 epoch 키 전달"과 예비 권한 기기·복구용 패키지에도 같은 규칙을 쓴다. C1 부정 테스트(§10.4 #3)에 "위조 KeyPackage 선착"을 추가한다.

**H2. 멤버십 분기 선택이 되돌리기 방어와 모순되고, 롤백에 상한이 없다 (§5.5, §6.3 규칙 1, §9.2)**
- 모순: §6.3 규칙 1은 "멤버십 head보다 오래된 체인은 받지 않는다"이다. §5.5는 "같은 seq에서 복구 키·예비 기기 인수 레코드가 이긴다"이다. 권한 기기 A가 오프라인 상태로 seq n..n+3을 썼고, 일부 기기가 head n+3을 받아들였다고 하자. 예비 기기 S가 seq n에서 인수하면, S 쪽 체인(head n)은 이 기기들에게 "더 오래된" 체인이다. 규칙 1을 따르면 거부하고 §5.5를 따르면 채택한다. 기기마다 다른 체인을 따르게 되고 분기가 영구화된다.
- 롤백: 인수·복구 레코드가 **어느 seq에서든** 이긴다면, 예비 기기를 훔친 공격자는 제거 레코드보다 앞선 seq에서 분기해 이미 제거된 기기를 되살릴 수 있다. 예비 기기는 "관리자의 명시적 조작으로 즉시 인수"하고 모든 epoch 키도 받는다. 그런데 §2.4-3의 루트 목록에는 예비 기기가 없다.
- 권고: (1) 분기 선택을 길이가 아니라 "서명자 우선순위 + 공통 조상" 규칙으로 명시하고, 규칙 1을 "내 head의 조상이 아닌 체인은 분기 규칙으로만 판정한다"로 고친다. (2) 인수·복구 레코드는 인수자가 아는 최신 head를 `prev_hash`로 가리켜야 한다. 이미 확정된 `RemoveDevice`·`RemoveUser`·`RotateCommit`보다 앞에서 분기할 수 없게 한다. (3) 예비 기기 인수는 공지 후 지연시킨다(예: 24시간, 그동안 권한 기기가 취소 가능). 즉시 인수는 복구 키를 함께 서명할 때만 허용한다. (4) §2.4-3에 예비 권한 기기를 루트와 같은 등급으로 넣는다.

**H3. 복구 키의 post-compromise 실패와 보관 주체 문제 (§4.5, §5.3)**
- 시나리오: 복구 코드는 종이나 파일로 vault를 만든 관리자 개인이 보관한다. 그 관리자가 퇴사해 `RemoveUser`가 되어도 복구 키는 바뀌지 않는다. 교체는 "할 수 있다"일 뿐이다. 모든 새 epoch 키는 복구 공개키로도 감싸지므로(§5.3 준비), 퇴사자는 암호문만 얻으면(공모 멤버, D의 노드) 미래 내용을 계속 읽는다. 게다가 복구 키 레코드는 같은 seq에서 이기므로(§5.5) 언제든 권한을 가져갈 수 있다. 사진으로 찍혀 새어 나간 복구 코드도 같다. 아무도 모르게 영구적인 읽기 권한이 생긴다.
- 권고: 복구 코드를 본 적 있는 사용자(생성자와 이후 열람자)를 체인에 기록한다. 그 사용자를 제거하면 `RecoveryRotate`를 의무로 하고 키 교체와 같은 트랜잭션에서 수행한다. 새 복구 코드는 남은 admin에게 다시 안내한다. 정기 교체 알림을 둔다. §2.4에 "탐지되지 않은 복구 코드 유출은 다음 RecoveryRotate까지 모든 epoch를 연다"를 명시한다.

**H4. watermark 삭제 뒤 작성자 체인의 연속성을 증명할 수 없다 (§6.3 규칙 2, §6.4, §6.6, §7.6)**
- 시나리오: 작성자 A의 카운터는 vault 전체에서 하나로 증가하고, `prev`가 직전 봉투를 가리킨다. 문서 d1의 업데이트 1~500이 스냅샷으로 덮여 지워진 뒤 새 기기 N이 합류한다. N이 받는 것은 스냅샷과 남은 봉투(카운터 501~)뿐이고, 501의 `prev`가 가리키는 봉투는 어디에도 없다. 규칙 2를 따르면 N은 영구히 "일부 변경을 아직 받지 못했습니다"를 띄운다. 규칙을 완화하면 노드나 피어가 봉투를 빼돌리는 누락 공격을 다시 허용한다. 다른 문서의 봉투만 지워진 경우에도 같다. 카운터가 vault 단위이기 때문이다. §5.2-4의 "그 체인 위에 있는 봉투인가" 검사도 지워진 조상을 거쳐서는 할 수 없다.
- 권고: 스냅샷이나 별도의 서명된 checkpoint 봉투에 작성자별 `(counter, envelope_id)` frontier와 "이 frontier 이하에서 문서별로 덮인 카운터 집합"을 넣는다. 체인 검증은 그 checkpoint에서 다시 시작한다. 새 기기가 checkpoint를 믿는 근거(권한 기기의 `HeldAck`나 서로 다른 두 기기의 일치)를 §7.6에 넣는다. C1에는 "가지치기 뒤 새 기기 합류"를 반드시 넣는다.

### 중

| # | 결함 | 구체적 시나리오 | 권고 |
|---|---|---|---|
| M1 | 통합 지점이 `HocuspocusProvider` 한 곳만 적혀 있다(§8.1) | 허브 동기화는 열린 노트의 `DocSync`(`syncManager.ts:259`)만으로 되지 않는다. vault 채널 `VaultSyncEngine`과 `VaultDocStore`(hot 100개, cold는 임시 headless bridge, `vaultDocStore.ts:1-26`), 7.5천 줄의 `docSession.ts`(pull 재조정, 대량 업로드 `contentUpload.ts`)가 함께 돈다. 닫힌 노트를 AI가 고친 디스크 변경은 cold 경로(`handleLocalFileChanged`)로만 간다. P2P 세션을 provider 자리에만 끼우면 닫힌 노트의 수신과 송신이 빠진다 | §8.1에 `DocUpdateSink`/vault 엔진 자리를 추가한다. C1 #5에 "닫힌 노트의 외부·AI 편집 전파"와 "cold 노트의 원격 수신"을 넣는다 |
| M2 | §8.3의 복구 방식이 남의 연산을 내 서명으로 보낸다 | `Y.encodeStateAsUpdate(doc, sv)`는 sv에 없는 **모든 clientID**의 struct와 **전체 delete set**을 쓴다(`yjs@13.6.31 utils/encoding.js:504-507`). "봉투로 만든 SV"에 받은 원격 연산이 빠져 있으면 동료 연산이 내 서명으로 다시 나간다. §8.2의 "남의 연산을 내 서명으로 보내지 않는다"와 모순된다. 디스크 병합 경로(`noteBridge.ts:950`)도 같은 함수를 쓴다 | 봉투 SV를 "로컬 SV에서 원격 수신분을 반영한 값"으로 정의한다. 또는 자기 clientID만 담는 diff로 제한한다. delete set은 작성자 귀속이 불가능하다는 점(Yjs의 삭제 범위에는 삭제한 사람이 없다)을 §2.4-7에 명시한다 |
| M3 | Yjs clientID가 작성 기기에 묶여 있지 않다 | 악성 editor M이 피해자 V의 현재 clientID를 관찰한 뒤, V의 다음 clock 범위로 자기 서명 업데이트를 먼저 보낸다. 피어들은 같은 ID를 가진 V의 진짜 연산을 중복으로 버린다. **조용한 손실이고 되돌릴 수도 없다.** 작성자 해시 체인은 같은 작성자 안의 분기만 보므로 탐지하지 못한다 | 수신 측이 clientID를 처음 쓴 작성 기기에 고정한다(clientID → author 표, 봉투 저장과 같은 트랜잭션). 다른 작성자가 같은 clientID를 쓰면 격리한다. Rust 쪽에서 Yjs struct를 파싱해야 하므로 `yrs` 의존과 버전 호환(JS 13.6 v1 인코딩)을 §3.3 "쓰는 구성"에 넣는다 |
| M4 | 이중 발행 처리에서 "나중에 받은 가지"를 격리한다(§4.3-3, §6.3-3) | 수신 순서는 기기마다 다르다. 정직한 피어 P1은 가지 a를, P2는 가지 b를 격리해 정직한 기기끼리 상태가 갈린다. 그리고 "누락이 있어도 적용"하므로 먼저 온 가지는 이미 Yjs에 들어가 있다 | 둘 다 격리하거나 envelope_id 순으로 결정적으로 고른다. 이미 적용된 가지는 "되돌릴 수 없음"으로 관리자에게 보여 준다 |
| M5 | 대량 변경 가드는 악성 멤버를 막지 못한다(§7.4) | 가드는 한 번에 들어온 묶음 단위로 센다. 악성 editor가 연결할 때마다 4개씩 지우면 가드에 걸리지 않는다. 휴지통은 30일 뒤 지워지므로 아무도 모르면 손실로 끝난다 | 작성자별·기간별 누적 상한(예: 24시간 동안 max(5, 20%))과 관리자 알림을 둔다. §7.4의 "악성 멤버를 막는 장치"라는 표현을 "고장과 큰 사고를 늦추는 장치"로 낮춘다 |
| M6 | `HeldAck`가 허브 `ackedSv`의 "줄어들지 않음" 전제를 물려받았다(§7.3, §7.5, §9.3) | `ackedSv`는 "server never forgets ops"를 전제로 한다(`ackedSv.ts:13-14`). P2P에서 B는 HeldAck를 보낸 뒤 제거될 수 있고, 제거되면 봉투 저장소를 지운다(§7.5). 디스크를 잃을 수도 있고 악성 멤버라면 거짓으로 확인할 수도 있다. 기기 A는 B의 HeldAck만 믿고 삭제 게이트를 통과시켜 복구 사본 없이 휴지통으로 보낸다 | 삭제 게이트용 HeldAck는 권한 기기의 확인이나 서로 다른 사용자 둘 이상의 확인만 인정한다. 확인한 기기가 제거되면 그 기기의 HeldAck를 무효로 하고 다시 계산한다 |
| M7 | Linux 대체본 감지가 P2P에 충분하지 않다(§4.1) | `store_persists()`는 `UntilReboot`도 영속으로 친다(`R/keychain.rs:43-48`). 지금 빌드 feature는 Secret Service뿐이라 당장은 안전하다. 그러나 `linux-native`(keyutils)를 다시 켜면 재부팅마다 기기 마스터 비밀이 사라지고, 기기 신원이 조용히 바뀐다 | P2P는 `UntilDelete`만 허용한다고 명시하고, 이를 테스트로 고정한다 |
| M8 | 자동 승인 기기가 제거된 뒤에도 살아남는다(§4.2) | 노트북 L을 훔친 공격자가 "같은 사용자 보증이면 자동 승인"을 이용해 L2를 추가한다. 관리자가 L만 `RemoveDevice`하면 L2는 남는다 | C에서는 자동 승인을 끈다. 켤 경우 `RemoveDevice` 확인 화면에 그 기기가 보증한 기기를 함께 보여 주고, 기본값으로 함께 제거한다 |
| M9 | 제거 직후의 유출 범위가 "확정 전"보다 넓다(§2.2, §5.3, C1 #6) | 오프라인 기기 O는 제거 사실을 모른 채 epoch e로 계속 쓰고, 제거된 X의 연결도 받아 준다(멤버십을 아직 모르므로). O와 X가 같은 망에서 먼저 만나면 제거 이후 O의 편집이 X에게 간다. C1 #6의 "제거된 기기는 이후 내용을 열지 못한다"는 바로 이 구성(1대 오프라인)에서 설계상 거짓이 될 수 있다 | §2.4에 "각 기기가 제거를 알기 전까지"를 남는 위험으로 적는다. 연결할 때는 `Heads`로 멤버십을 먼저 맞추고, 상대 head가 더 새 것이면 내용 교환 전에 멤버십부터 받는다. C1 #6의 기준을 "새 키를 받은 기기가 쓴 내용"으로 좁히고, O→X 경로를 측정해 보고한다 |
| M10 | 진 가지 epoch 키의 배포가 정의되지 않았다(§5.5) | A의 무효 가지에서 K_A(e+1)을 받은 기기의 편집은 이긴 가지의 기기들이 열지 못한다. 반대로 S가 K_A(e+1)을 모두에게 다시 보내면, A의 가지에서 제외됐던 X도 받는다 | 진 가지의 키는 이긴 가지의 현재 멤버 중 진 가지에서도 멤버였던 기기에게만 다시 감싸 보낸다. 진 가지가 했던 제거는 이긴 쪽에서 즉시 다시 처리하도록 요구한다 |
| M11 | 새 기기가 받은 스냅샷을 검증할 수단이 없다(§6.5-3) | 새 기기는 가진 업데이트가 없어 멱등 검사를 할 수 없다. 악성 editor의 스냅샷은 다른 사람의 clientID로 된 위조 연산을 담을 수 있고, 새 멤버는 그것을 정본으로 받아들인다 | §7.6에 "스냅샷 ID를 권한 기기의 HeldAck나 서로 다른 두 기기와 맞춘 뒤 채택"을 넣는다(H4의 checkpoint와 함께) |

### 하

- L1. registry 입력 검증을 명시하지 않았다. Rust에 `resolve_in_vault`가 있어 경로 이탈은 막힌다. 하지만 `.context/`·`.git` 같은 무시 경로(`rel_path_is_ignored`), Windows 예약 이름(`R/checks.rs`), 노트 확장자 목록, 경로 길이를 받는 쪽에서 거부한다는 문장이 필요하다.
- L2. `ReplaceDevice` 때 미수령 KeyPackage와 모든 epoch 키를 새 HPKE 키로 다시 감싸야 한다는 문장이 없다. `AddDevice`에만 있다.
- L3. PRD D4 준비 단계의 "새 스냅샷 watermark 기록"을 제거 기준점으로 바꿨는데, §11.1 반영 제안에 이 변경이 없다.
- L4. 원격 합류는 "요청자 이름만 보여 준다"(§4.4). 이름은 요청자가 스스로 적는 값이라, 링크를 훔친 사람이 이름을 사칭하면 관리자가 승인할 수 있다. 원격 합류에도 짧은 지문(그림 4개)을 보여 주고, 초대한 사람이 다른 경로로 확인하게 안내한다.
- L5. 전송 키를 vault마다 두면 Iroh endpoint와 mDNS 광고도 vault 수만큼 생긴다. 같은 망에서 한 기기가 가진 vault 수가 드러나고 소켓도 늘어난다. 구현 비용과 노출을 §3.3에 적는다.
- L6. 봉투의 `suite`와 `version`에 하한 정책이 없다. vault 정책보다 낮은 suite는 거부한다고 적는다.
- L7. Yjs clientID는 32비트 무작위이고 문서를 열 때마다 새로 만든다. 문서 하나에서 세션 수가 수만이 되면 충돌 확률을 무시할 수 없다. 충돌하면 §4.3·§6.3의 "범위 겹침"이 정직한 기기를 이중 발행으로 판정할 수 있다. C1 보고서에 이 확률을 추정해 넣는다.

## 5. 위협 모델의 빈칸

- 자산: 초대 티켓 비밀(링크 자체), 격리 저장소, 미수령 KeyPackage 보관소, 진단 번들과 로그(C1 #4에만 나온다), 멤버십 헤더의 시각 패턴(키 교체 횟수는 곧 제거 사건이 일어났다는 메타데이터다)이 자산 표에 없다.
- 공격자: 초대 링크를 가로챈 사람(L4), 예비 권한 기기 탈취(H2), 퇴사자가 가진 복구 코드(H3), 업데이트 채널(A3이 바이너리를 신뢰하므로 앱 updater가 루트다. 범위 밖이라고 명시한다), 정상 멤버의 저장·대역폭 고갈(작성자별 quota가 없다)이 빠졌다.
- 신뢰 경계: 저장 노드의 **다운로드** 인증이 없다. §5.3은 "구 epoch 봉투를 멤버가 아닌 상대에게 전달하지 않는다"를 근거로 삼는데, D의 노드가 아무에게나 내려 주면 이 근거가 무너진다. D 범위라도 신뢰 규칙은 여기서 정한다고 했으므로(§1.1) 한 줄 넣는다.

## 6. Q1·Q4·Q5와 C1 계획 평가

**Q1 (동의).** 평가 기준이 같고 판정 근거가 출처로 확인된다. 다만 "직접 구현"의 비용에 Rust 쪽 Yjs 파싱(M3, §5.2-7), checkpoint(H4), KeyPackage 인증(H1)이 더해진다. p2panda는 mDNS 기본값 정정(§2)과 함께, 의존하는 mDNS crate 버전(0.5)이 우리 쪽(0.6)과 다르다는 점을 재평가 메모에 남긴다.

**Q4 (조건부 동의).** 동시 다중 권한을 피하는 판단은 맞다. 그러나 예비 권한 기기는 "즉시 인수 + 모든 키 보유 + 같은 seq에서 이김"이라 사실상 두 번째 루트다. H2의 지연 인수와 분기 제한이 없으면 공격면만 늘어난다. 재검토 지표(24시간 대기 비율, 인수 횟수)는 측정할 수 있어 좋다.

**Q5 (동의, 표현 수정).** "30일은 본문 보관 정책이고 키는 vault 수명 동안 보존한다"는 R02를 제대로 닫는다. 다만 §9.3의 "잃는 것은 검토 기회뿐"은 사실과 다르다. 격리된 봉투(제거 기기가 기준점 이후에 쓴 정직한 편집, 이중 발행으로 판정된 가지)는 30일 뒤 **내용이 지워진다**(§7.5). 이것도 데이터 손실 경계로 적고 "관리자가 검토하지 않으면 사라진다"고 고지한다. 오래 오프라인이던 기기의 재봉인은 M2 방식으로 하면 남의 연산까지 다시 서명하게 되므로, M2를 고친 뒤에 성립한다.

**C1 성공 기준의 측정 가능성**

| # | 평가 | 보완 |
|---|---|---|
| 1 수렴 | 측정 가능. 다만 state vector가 같아도 delete set이 다를 수 있다 | `Y.encodeStateAsUpdate` 정규화 해시나 delete set 비교를 더한다. 실행 횟수와 seed를 고정해 기록한다(예: 500회) |
| 2 손실 없음 | 측정 가능. 판정에 쓸 기준 기록(oracle)이 필요하다 | 편집마다 ID를 붙인 기록과 비교한다. HeldAck 거짓 확인(M6)과 격리 만료(Q5)를 행렬에 넣는다 |
| 3 부정 테스트 | 측정 가능(100%) | 위조 KeyPackage 선착(H1), 가지치기 뒤 체인 검증(H4), clientID 사칭(M3), 예비 기기의 롤백 분기(H2), 경로 이탈·무시 경로 registry(L1), 거대 업데이트, 제거된 기기의 HeldAck를 추가한다 |
| 4 평문 비노출 | 측정 가능 | 그대로 |
| 5 브리지 | 측정 가능. 다만 범위가 좁다 | cold·닫힌 노트 경로(M1)를 넣는다. "1회"는 "1회 이하"로 쓴다(egest 묶음) |
| 6 키 교체 | **기준이 설계와 충돌한다** | M9대로 기준을 좁히고 O→X 유출 경로를 측정 항목으로 둔다 |
| 7 설명 가능한 실패 | 30초 기준은 측정 가능. 그러나 "수동 주소 입력으로 연결되는 경로"는 중계를 끈 C1에서 AP isolation·UDP 차단 조건이면 **물리적으로 불가능하다**(Iroh는 QUIC/UDP뿐이다) | 그 두 조건은 "설명 가능한 실패만"을 기준으로 한다 |
| 8 비개발자 과제 3 | 기록 항목만 있고 **통과 기준이 없다** | PRD §0.1 "5명이 끝낸다"를 그대로 기준(5/5)으로 쓰거나, 수치(예: 4/5 이상, 중앙값 N분 이하)를 미리 고정한다 |

중단 기준(§10.7)은 구체적이고 측정할 수 있다. 측정 항목(§10.5)도 p50/p95와 실패율로 정의돼 있어 충분하다.

## 7. 리뷰 항목 대응 확인

R01·R02·R03·R05·R06·R07·R08·R09·S03은 이 문서가 실질적으로 다룬다. 다만 R01은 H2가, R07은 H4와 M11이, R02는 Q5 표현이 남는다. R04는 M6, R10은 §5의 노드 다운로드 인증이 남는다. R11은 형식 호환(Yjs 바이트)만 맞추고 절차는 F 단계로 미뤘는데, PRD가 정한 범위와 일치한다.

## 8. 검증 방법과 한계

- 웹 확인: crates.io·npm API, docs.rs, iroh.computer 블로그, docs.iroh.computer, NextGraph Gitea API와 문서, p2panda 저장소의 소스(`iroh_mdns/config.rs`)와 README, Apple TN3179와 포럼. 모두 2026-10-16에 확인했다.
- 코드 확인: `noteBridge.ts`, `types.ts`, `readOnlyDocs.ts`, `syncManager.ts`, `vaultDocStore.ts`, `inbound.ts`, `ackedSv.ts`, `vaultProtocol.ts`, `R/index.rs`, `R/vault.rs`, `R/watcher.rs`, `R/keychain.rs`, `R/checks.rs`, `Cargo.toml`. Hocuspocus provider 4.4.0과 yjs 13.6.31의 배포 소스도 확인했다.
- 하지 않은 것: 프로토타입, 테스트 실행, 암호 crate 감사 여부 확인. 설계 문서에는 코드 변경이 없으므로 `pnpm test`·`cargo test`는 돌리지 않았다.
