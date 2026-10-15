# M4 구현 보고서

## 변경 요약

- `docs/onboarding-audit.md`에 초대 생성부터 첫 노트 확인까지 6단계, 화면 수, 코드 경로와 막히는 지점을 정리했다.
- 초대 다이얼로그에서 개별 초대 권한과 `New members`의 기존 `join_default`를 함께 선택할 수 있게 했다. 발송 성공 여부와 무관하게 초대 HTTPS 링크를 보여주고 복사할 수 있다.
- `onboardingTimer`가 초대 열기, 로그인, 초대 수락, 볼트 열기, 첫 실제 노트 동기화의 epoch 시각과 시작 기준 경과 ms를 localStorage에만 남긴다. 개인정보를 기록하거나 전송하지 않으며, 동기화할 노트가 없는 경우 완료 시간을 만들지 않는다.

## 검증

- `cd app && pnpm install` — 통과, lockfile 변경 없음.
- `cd app/apps/desktop && pnpm exec vitest run src/components/__tests__/invitePeopleDialog.test.ts src/lib/__tests__/onboardingTimer.test.ts src/lib/__tests__/inviteLink.test.ts src/lib/__tests__/inviteFlow.test.ts` — **4 files passed, 34 tests passed, 0 failed**.
- `cd app/apps/desktop && pnpm exec vitest run src/lib/sync/__tests__/docSessionVaultScope.test.ts src/lib/sync/__tests__/docSessionRetryDoc.test.ts` — **2 files passed, 48 tests passed, 0 failed**.
- `cd app/apps/desktop && pnpm exec tsc --noEmit` — 통과(exit 0).
- Windows simulator 실행 후 Windows·macOS 플랫폼 URL로 브라우저 시뮬레이션 — 두 플랫폼 모두 초대 다이얼로그 확인, 720×600에서 모달·필드·액션 버튼이 viewport 안에 위치함. 실제 Windows WebView2 검증은 아님.
- `git diff --check` — 통과.

## 남은 한계

- 이메일 provider, 이메일 미설정 셀프호스트, 설치 페이지에서 앱으로 돌아오는 OS 딥링크, 실제 서버와 첫 동기화 end-to-end는 실행하지 않았다. 기존 invitation 생성/preview/수락 및 HTTPS→딥링크 경로에 의존한다.
- 계측은 현재 한 건의 온보딩 실행을 localStorage에 보존하며 외부 로그 수집이나 보고 UI는 추가하지 않았다.
