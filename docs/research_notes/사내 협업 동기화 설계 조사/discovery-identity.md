# 사내 LAN 자동 발견과 닉네임 기반 신원

## IP를 모르는 직원이 주변 동료와 작업 공간을 찾을 수 있는가?

### Takeaway
가능하다. 네트워크에서는 mDNS/DNS-SD로 주소를 찾고 화면에서는 사람이 정한 별명과 팀을 보여주면 된다. 다만 발견은 통신 가능한 후보를 찾는 절차이며, 회사 구성원임을 인증하거나 폴더 접근 권한을 주는 절차가 아니다.

### Cited Findings
- RFC 6762의 mDNS는 일반 DNS 서버 없이 local link에서 이름을 해석한다. IPv4 multicast 224.0.0.251와 UDP 5353을 사용한다. 인터넷이나 여러 라우터를 자동으로 가로지르는 발견 프로토콜이 아니다. — [RFC 6762](https://www.rfc-editor.org/rfc/rfc6762.html)
- DNS-SD는 PTR로 서비스 목록, SRV로 host/port, TXT로 보조 정보를 제공한다. mDNS 및 일반 unicast DNS 모두와 결합할 수 있다. 즉 사용자에게 IP를 받지 않고 이름 있는 서비스 목록을 제공할 표준 기반이 있다. — [RFC 6763 §4–6](https://www.rfc-editor.org/rfc/rfc6763.html)
- LocalSend Protocol v2.2는 외부 서버 없는 REST 프로토콜을 목표로 하며 multicast 발견 메시지에 alias, version, deviceType, fingerprint, port, protocol을 싣는다. HTTP 등록 fallback도 정의되어 있다. 해당 프로토콜은 파일 전송 사례이며 장기 협업의 권한·감사·버전 관리를 해결해 주지는 않는다. — [LocalSend protocol](https://github.com/localsend/protocol/blob/main/README.md)
- Rust `mdns-sd`는 browse/register API와 이름 충돌 알림을 제공한다. 확인 당시 문서는 multicast 전용이며 unicast 송수신은 지원하지 않는다고 명시한다. — [mdns-sd 공식 API 문서](https://docs.rs/mdns-sd/latest/mdns_sd/)

### Inferences
- **제안:** 발견 서비스 타입을 `_ib-vault._tcp.local.` 같은 제품 전용 타입으로 정의한다. 앱에서 발견한 주소를 Rust가 연결하고, React에는 안전하게 정리된 후보와 연결 상태만 typed IPC로 전달한다. 서비스명 등록·길이 및 Bonjour 플랫폼 지원은 구현 전에 검증한다.
- **제안:** 최초 설정은 `표시 이름(예: 지수)`과 선택적 `기기 별명(예: 회사 노트북)`만 받는다. `근처 작업 공간` 카드에는 `디자인팀 · 지수가 연 작업 공간 · 참여 요청`을 표시한다. 근처는 물리적 거리 측정이 아니라 접근 가능한 사내 네트워크의 의미다.
- **제안:** 발견은 사용자가 `근처에서 찾기` 또는 `참여 허용`을 켠 동안 활성화하고, TXT에는 문서명·폴더경로·전체 사원 명단·토큰을 싣지 않는다. 공개 광고에 실명/팀명을 노출할지는 사내 정책으로 정한다. 이름이 민감하면 광고에는 일반 이름과 임시 식별자만 넣고 승인 후 프로필을 공개한다.
- **제안:** 기존 팀원 목록은 허브의 인증된 구성원 디렉터리로 제공한다. 사내 모든 직원이 항상 자신의 장치를 multicast 광고하게 하는 방식은 기본값으로 삼지 않는다.

### Gaps
- 실제 회사의 VLAN, 무선 격리, 허용 포트, VPN 정책은 조사하지 못했다. 네트워크 발견을 보장하는 문구는 쓰면 안 된다.
- `mdns-sd`의 Windows/macOS 패키징·다중 NIC·절전 복귀·IPv6 동작은 이 조사에서 실행 검증하지 않았다. 라이브러리 후보이지 채택 완료가 아니다.

## 닉네임만으로 누군지 식별하고 안전하게 가입시킬 수 있는가?

### Takeaway
닉네임은 알아보기 위한 표시 이름으로 적합하지만 인증 수단으로는 부족하다. 바뀌지 않는 사람 ID, 장치 키, 관리자가 승인한 소속과 접근 권한을 따로 둬야 한다.

### Cited Findings
- Syncthing은 최초 실행 시 키를 생성하며 장치 ID는 인증서 DER 데이터의 SHA-256에서 만든다. 연결 시 TLS peer 인증서로 계산한 장치 ID를 예상된 ID와 대조한다. 확인한 현행 문서는 v2.0.0 이후 Ed25519를 명시한다. 이전 문서의 ECDSA 설명을 그대로 인용하면 현재 구현을 잘못 설명한다. — [Understanding Device IDs](https://docs.syncthing.net/dev/device-ids.html)
- Syncthing은 TLS와 승인한 장치 fingerprint 목록으로 초대받지 않은 장치의 참여를 막는다. local discovery의 장치 ID/포트는 LAN 관찰자가 볼 수 있으며, 키·설정 파일 접근자는 장치로 가장할 수 있다. — [Syncthing Security Principles](https://docs.syncthing.net/users/security.html)
- DNS-SD는 이름·레코드 사용 규칙이며 인증이 필요할 때 별도 DNS 보안이 필요하다고 설명한다. 서비스 이름 자체는 직원 신원 보증이 아니다. — [RFC 6763 §15](https://www.rfc-editor.org/rfc/rfc6763.html#section-15)
- SPAKE2는 짧은 공유 비밀에서 비밀을 직접 공개하지 않고 공유 키를 만드는 PAKE 방법이다. RFC 9382는 Informational이며 Internet Standards Track 규격이 아니다. — [RFC 9382](https://www.rfc-editor.org/rfc/rfc9382.html)
- Magic Wormhole은 사람이 옮기는 짧은 코드와 PAKE를 사용하는 사례다. 다만 기본 설계는 mailbox/rendezvous 서버를 사용하며, 공식 API는 개발자가 자체 mailbox 서버를 운영할 수 있다고 설명한다. 따라서 그대로 도입하면서 외부 서버가 없다고 주장할 수 없다. — [Magic Wormhole 공식 API](https://github.com/magic-wormhole/magic-wormhole/blob/master/docs/api.rst), [프로젝트](https://github.com/magic-wormhole/magic-wormhole)

### Inferences
- **제안 데이터 구분:** `member_id`는 회사 허브 안의 사람, `device_id`는 공개키에서 연결되는 장치, `display_name`은 수정 가능한 닉네임, `device_label`은 기기 구분, `membership`은 팀·권한이다. IP, 닉네임, Yjs presence client ID를 영속 사용자 ID나 권한 키로 쓰지 않는다.
- **제안 UX:** 초기 프로필에 별명 `지수`를 입력하면 개인 메모를 즉시 쓴다. 팀 연결 시 관리자에게 `지수 · 회사 노트북 · 새 기기`가 참여를 요청한다. 관리자가 실제 동료임을 확인하고 승인한 뒤 `승인된 구성원`으로 표시한다. 사용자가 입력한 부서명은 승인 전까지 소속 인증으로 취급하지 않는다.
- **제안 표시 신뢰:** 이니셜, 아바타, 별명은 사용자가 정한 프로필이며 검증된 직원 배지가 아니다. 승인 전 발견 응답으로 문서·폴더·구성원 목록을 내려주지 않는다. 승인 배지는 허브가 확인한 membership과 취소 상태에서만 계산한다.
- **제안 중복 이름 처리:** 별명 중복을 허용하되 카드에 팀, 기기 별명, 자동 생성 짧은 식별 표시를 함께 둔다. 예: `지수 · 디자인팀 · 회사 노트북 · 7K4M`. 짧은 표시는 사람이 구별하는 보조값이며 완전한 공개키 fingerprint 대조를 대체하지 않는다. 별명 변경은 ID/폴더 권한/변경 이력을 바꾸지 않는다.
- **제안 페어링:** 기본 경로는 앱이 생성한 단회 초대 링크 또는 초대 파일을 전달하고 관리자 승인으로 완료한다. 링크에는 허브 ID, 실제 연결 후보, 프로토콜 버전, 허브 공개키 pin, 만료되는 충분한 무작위 토큰을 담는 방식이 가능하다. URL/파일 원문에는 민감한 가입 비밀이 있으므로 진단 로그에서는 가린다.
- **제안 짧은 코드:** LAN에서 이미 발견한 허브와 매칭하는 경우에 한해 검증된 PAKE 또는 채널에 묶인 인증 비교를 검토한다. 숫자 코드를 HTTP로 그대로 보내는 자체 암호 프로토콜은 설계하지 않는다. 만료·횟수 제한·단회 사용·승인 대상을 묶는다. 인증 비교 문자열과 사용자가 입력하는 공유 비밀은 다른 절차다.
- **제안 신뢰 변경:** 동일 닉네임/주소에서 키가 바뀌면 자동 신뢰하지 않는다. 새 기기 추가·키 회전·복구는 기존 승인 기기나 관리자 승인으로 처리하고, 분실 기기는 취소한다. 이미 받아 간 파일을 원격 취소만으로 회수할 수 있다고 약속하지 않는다.
- **제안 복수 기기:** 두 번째 기기의 첫 실행을 새 사람 가입으로 고정하지 않는다. `기존 구성원으로 기기 추가` 경로에서 허브 member ID와 새 device ID를 승인해 연결한다.

### Gaps
- PAKE 라이브러리와 감사 이력, 키 보관·회전·복구 절차는 별도 위협 모델과 구현 검토가 필요하다. 이번 조사는 특정 암호 구현을 승인하지 않는다.
- 닉네임/별명은 법적 실명이나 고용 신원 증명이 아니다. 회사가 이를 요구하면 관리자 확인 또는 사내 IdP 연동이 추가로 필요하다.

## 회사 네트워크와 비개발자 환경에서 어떤 운영 방식과 초기 연결 UX가 현실적인가?

### Takeaway
일반 직원에게는 `앱 설치 → 별명 설정 → 팀 선택/초대 열기 → 승인`만 요구하고 서버·포트·IP 설정은 노출하지 않는 방향이 적합하다. 사내 상시 허브를 정식 경로로 두고 근처 공유는 작은 팀의 간편 시작 경로로 분리하는 것이 안정적이다.

### Cited Findings
- RFC 7558은 mDNS가 설계상 라우터를 넘지 않으며, 기업의 무선 클라이언트와 유선 서버가 서로 다른 subnet에 있는 경우를 명시한다. 과도한 multicast가 Wi-Fi에 부담을 줄 수도 있다고 설명한다. — [RFC 7558](https://www.rfc-editor.org/rfc/rfc7558.html)
- Cisco의 WLAN peer-to-peer 차단은 같은 WLAN 클라이언트 사이 직접 통신을 제어하며 해당 기능은 multicast에는 적용되지 않는다. 따라서 발견 성공과 실제 동기화 연결 성공은 별도로 확인해야 한다. 이 동작은 해당 Cisco 제품군의 문서 근거이며 모든 제조사에 일반화하면 안 된다. — [Cisco Catalyst 9800 공식 가이드](https://www.cisco.com/c/en/us/td/docs/wireless/controller/9800/17-16/config-guide/b_wl_17_16_cg/peer-to-peer-client-support.html)
- macOS 15부터 local network privacy가 적용되며 Bonjour 등록/탐색/해석과 multicast/broadcast는 로컬 네트워크 접근 대상이다. macOS에는 iOS용 multicast entitlement가 필요하지 않다. 사용자는 시스템 설정에서 권한을 관리하며 앱은 거절과 권한 응답 전 실패를 처리해야 한다. — [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- Windows Firewall은 기본 inbound 차단이며 앱/관리자 예외 규칙이 필요하다. 비관리자 사용자의 프롬프트 대응만으로 해결되지 않을 수 있고, 회사가 local policy merge를 끄면 규칙 중앙 배포가 필요하다. — [Microsoft Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)
- Syncthing의 global discovery와 public relay는 외부 서비스와 통신하며 각각 끌 수 있다. LAN 전용 제품에서 기본값을 그대로 따라서는 외부 통신 없는 모드가 되지 않는다. — [Syncthing Security Principles](https://docs.syncthing.net/users/security.html)
- Kumar·Saxena·Uzun의 `Alice Meets Bob`은 두 사람이 각자 기기를 소유한 페어링을 연구했다. 40명, 주로 대학생인 실험에서 두 화면의 문구 비교(Phrase-DD)는 평균 11.44초, 숫자 비교는 12.5초였다. 표본이 작고 기술 친숙한 젊은 층 중심이므로 한국 직장인의 예상 성공률로 사용하면 안 된다. — [논문 원문, §4–5](https://arxiv.org/pdf/0907.4743)

### Inferences
- **권고 구조 A / 사내 상시 허브:** 관리자 1회 설치한 사내 PC/서버/VM가 팀 디렉터리, 접근 권한, 동기화 중계, 복구 가능한 저장소를 맡는다. 일반 직원은 outbound 연결만 수행할 수 있게 한다. 허브는 mDNS로 발견하며, 라우팅이 허용되지만 multicast가 안 되는 구간에서는 사내 DNS 이름이 포함된 초대 링크/파일 또는 관리자 배포 설정으로 연결한다. 구성원이 모두 서로 inbound 포트를 열 필요가 없다.
- **보조 구조 B / 한 사람의 앱이 임시 호스트:** 소규모 시작에 유용하지만 그 컴퓨터 종료·절전·퇴근·교체가 가용성에 영향을 준다. 화면에 `지수의 컴퓨터에서 공유 중 · 이 컴퓨터가 켜져 있을 때 동기화`를 명확히 보여준다. 자동 리더 교체/다중 복제 허브는 별도 합의·권한·감사 설계를 필요로 하므로 MVP에서 약속하지 않는다.
- **권고 연결 fallback 순서:** 자동 발견 → 기존 허브 기억/재해석 → 초대 링크 또는 초대 파일 열기 → 관리자 도움. 짧은 코드에는 주소가 없으므로 multicast도 없고 사전에 알려진 허브도 없으면 그것만으로 상대를 찾을 수 없다. 이 경우 사내 directory/rendezvous가 있어야 하며 외부 public rendezvous를 몰래 사용하면 안 된다.
- **권고 QR 위치:** 카메라가 없는 업무용 PC가 많을 수 있으므로 QR을 유일 경로로 삼지 않는다. 복사 가능한 초대 링크와 파일을 우선하고 QR은 같은 정보를 옮기는 추가 수단으로 둔다. 사용자의 IP 수동 입력은 일반 경로에서 없앤다.
- **제안 진단 상태:** `로컬 네트워크 접근 허용 필요`, `작업 공간을 찾는 중`, `발견했지만 연결되지 않음`, `관리자 승인 대기`, `연결됨`, `공유 컴퓨터 오프라인`을 구분한다. 여러 원인 중 하나를 확신할 수 없을 때 `회사 네트워크가 차단했습니다`로 단정하지 않는다. 관리자용 진단 복사에는 주소/포트/오류가 포함되지만 사용자는 이를 알아야 할 필요가 없다.
- **제안 LAN 정책:** 외부 discovery/relay/STUN/TURN/UPnP/NAT-PMP를 기본 비활성화하고 자동으로 활성화하지 않는다. 참여 허브 allowlist와 관리자 승인한 인터페이스/주소 정책을 둔다. RFC1918 IP만 검사해서 회사임을 인증하면 안 된다. 회사 VPN을 허용할지 별도 정책으로 정한다. 앱 업데이트·원격 이미지·텔레메트리까지 포함한 완전 무외부 통신 여부는 별도 검증한다.
- **논문에서 가져올 실용적 통찰:** 두 직원은 각자 자기 기기만 조작하고, 필요할 때 같은 짧은 문구를 서로 확인하게 한다. 최초 연결을 끝내려 기기를 넘겨주거나 상대 IP를 읽게 하지 않는다. 한국어 확인 단어/숫자 방식의 실제 이해도는 직장인 대상 사용성 테스트로 확인한다.
- **제안 수용 기준:** IP 입력 없이 신규 직원 연결, 별명 중복 구분, 별명 변경 후 동일 작성자 유지, 허브 위조 이름 거절, 키 변경 경고, 관리자 승인 없는 폴더 접근 거절, multicast 차단 시 링크 연결, TCP 차단 시 정확한 연결 실패, macOS 권한 거절/복구, Windows 비관리자/회사 방화벽 정책, IPv4/IPv6·유선/무선·절전 복귀, 외부 DNS/HTTP 호출 없는 협업을 검증한다.

### Gaps
- 실제 사내망의 클라이언트 격리와 허브 접근 ACL을 확인하지 않았다. 링크/QR도 네트워크 차단을 뚫어 주지 않는다. 허브조차 접근 불가능하면 IT 정책 변경 없이는 동기화할 수 없다.
- 로컬 네트워크 권한과 방화벽은 실제 서명된 배포 앱에서 Windows/macOS 각각 테스트해야 한다. 브라우저 시뮬레이터로는 검증되지 않는다.
- `Alice Meets Bob` arXiv 메타데이터는 2009 제출이며 PDF 표지에는 2018 날짜가 보인다. 연도를 엄격히 다룰 때 arXiv 제출 정보를 사용하고 문서 날짜 차이를 숨기지 않는다. 문구 비교의 보안성을 문자열이 짧다는 이유만으로 일반화하지 않는다.
