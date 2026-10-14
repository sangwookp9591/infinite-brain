# M4 — 초대부터 첫 노트 동기화까지

## 현재 경로

| 단계 | 화면/전환 | 코드 경로 | 막히는 지점 |
|---|---|---|---|
| 1. 초대 생성 | Vault Settings → Members → Invite people 다이얼로그 | `InvitePeopleDialog` → `api.inviteMany` → `POST /orgs/:orgId/invitations`; 서버는 `invitation_access`에 개별 접근 수준을 저장 | 이메일 설정이 꺼져 있거나 발송 실패 시 기존에는 링크를 결과 행에서 복사해야 했음. 초대 생성 자체는 이메일 미설정에서도 동작 |
| 2. 링크 열기 | HTTPS `/invite/:id` 랜딩 페이지 → `baalda://invite/:id?server=…` → 앱 | `account-pages.ts` → `deepLink.ts` → `openInviteLink` → `previewInvitation` | 앱이 없으면 설치 페이지로 이동한 뒤 링크를 다시 열어야 함. 링크 서버가 현재 서버와 다르면 사용자가 서버 전환을 승인해야 함 |
| 3. 로그인/가입 | 앱 AuthDialog의 초대 컨텍스트 | `queueInvite` → `invitePrompt`; `signIn`, OAuth 또는 `signUp`이 끝나면 `consumeQueuedInvite` 실행 | 초대 주소와 다른 이메일로 로그인하면 서버가 수락을 거부함. 링크를 연 상태에서 인증이 끝나지 않으면 수락도 시작되지 않음 |
| 4. 수락 | 별도 선택 화면 없이 자동 수락 | `acceptInvitation` → 서버 invitation accept; 초대에 저장된 접근 권한은 서버 membership 적용 경로에서 소비 | 만료·취소·이미 사용된 링크는 일반적인 링크 만료 안내로 종료. 서버 권한/네트워크 오류는 재시도가 필요 |
| 5. 볼트 열기 | 별도 볼트 선택 화면 없이 초대된 볼트로 바로 이동 | `acceptInvitation` → `setActiveOrganization` → 기존 로컬 폴더 재사용 또는 vault root 아래 자동 폴더 생성 → `applyVaultFolder` → sync enable | 폴더 접근 권한/디스크 오류면 폴더 선택 안내로 빠짐. 볼트가 매우 크거나 네트워크가 느리면 동기화 완료가 늦음 |
| 6. 첫 노트 동기화 | 메인 vault 화면과 기존 동기화 상태 표시 | `docSession`의 pull/seed/flush 경로가 note를 확인한 뒤 `markPushed` 및 synced 표시 | 읽기 권한이 없거나 서버/네트워크가 끊기면 첫 note 확인은 완료되지 않음. 노트가 하나도 없는 vault는 첫 note 기준 시간이 끝나지 않음 |

## 단계·화면 수

- 완료 기준 단계: **6단계**(초대 생성 → 링크 열기 → 로그인/가입 → 수락 → 볼트 열기 → 첫 노트 동기화).
- 전체 흐름에서 보는 주요 화면: **4개**(보내는 사람의 Invite people, HTTPS 초대 랜딩, 앱 인증 화면, 앱 vault 화면). 동기화 상태는 마지막 화면 안에 표시된다. 받는 사람 기준은 **3개**이며 설치 여부에 따라 외부 다운로드 화면이 추가된다.
- 인증 완료 후에는 수락과 볼트 착지를 자동 수행한다. 별도의 볼트 선택 단계를 만들지 않는다.

## M4 변경

- 초대 다이얼로그 안에서 초대별 접근 수준과 기존 `join_default`의 New members 기본값을 함께 선택한다. 초대별 기본은 New members 값을 상속하고, 새 기본값 변경은 기존 `GET/PUT access-default` API를 이용한다.
- 초대 결과에 이메일 발송 여부와 관계없이 HTTPS 초대 링크 및 Copy를 제공한다. 서버 이메일 설정이 비어 있어도 기존 invitation 생성/preview/deep-link 경로로 공유할 수 있다.
- 앱이 초대 링크를 받은 시점부터 로그인, 수락, vault 착지, 첫 노트 확인까지의 단계명·epoch timestamp·경과 ms를 `localStorage`의 `baalda.onboarding-log.v1`에 기록한다. 사용자/볼트/이메일/초대 ID는 기록하지 않고 네트워크로 전송하지 않는다.

## 확인 범위

코드 경로 조사 기준이며, 브라우저의 설치 페이지 handoff, 실제 이메일 provider, 패키징된 앱의 OS 딥링크, 셀프호스트 서버를 이용한 end-to-end 검증은 별도 실행이 필요하다.
