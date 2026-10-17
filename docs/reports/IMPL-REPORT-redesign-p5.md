# IMPL-REPORT — 리디자인 P5 다이얼로그·설정·공유

브랜치 `sangwookpark/ib-redesign-p5`. Orbit 토큰과 기존 화면 동작을 유지하며 P5 영역의 다이얼로그·설정 패널 스타일을 다듬었다. 컴포넌트 props, IPC, 서버 요청, 권한 판정은 변경하지 않았다.

## 변경

- **설정 모달**: 시트 radius 토큰을 적용하고, 설정 내비게이션의 활성 항목을 accent pill로 정리했다. 설정 행과 목록에 구분선·hover 피드백을 더했다.
- **공유·멤버**: 공유 옵션 행의 높이와 모서리, 멤버 표 머리글의 위계를 정리했다. 720px에서 공유 행을 두 줄로 배치하고 게시 토글을 설명 아래 오른쪽에 놓았다.
- **보안·초대·확인·빌링**: 외부 공유 설정을 표면 카드와 단일 열 레이블로 정리하고, 확인·초대 버튼과 빌링 카드를 Orbit radius로 맞췄다.
- **좁은 창**: 760px 이하에서 설정 모달 너비를 뷰포트 안에 제한하고 `min-width: 0`으로 설정했다. 공유·확인·초대·좌석 관리·업그레이드 모달에 뷰포트 최대 크기와 내부 스크롤을 적용했다.
- **색과 접근성**: 새 하드코딩 색은 추가하지 않았다. 배경·텍스트·경계·hover는 테마 토큰을 소비한다. 기존 포커스 링과 reduced-motion 규칙을 유지했다.

## 검증

모두 `app/apps/desktop`에서 실행했다.

| 명령 / 확인 | 결과 |
|---|---|
| `pnpm install --frozen-lockfile` (`app/`) | 성공, lockfile 변경 없음 |
| `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --maxWorkers=2 src/components/__tests__/invitePeopleDialog.test.ts src/components/__tests__/memberProfilePage.test.ts src/components/__tests__/memberAccessBoard.test.ts src/components/__tests__/membersAccessTab.test.ts src/components/__tests__/externalSharing.test.ts src/components/SecurityHistoryTab.test.ts src/components/__tests__/confirmDialogPortal.test.ts src/lib/__tests__/inviteFlow.test.ts src/lib/__tests__/membersAccess.test.ts src/lib/__tests__/shareLink.test.ts` | 10개 파일, 107 테스트 통과 |
| `pnpm exec tsc --noEmit` | 통과 |
| `pnpm exec eslint src/components src/lib --no-cache` | 오류 0, 경고 37 (기존 코드 포함; 새 TS 변경 없음) |
| `git diff --check` | 통과 |
| window-simulator, Windows 설정·공유 화면 light/dark × 1440/720 | 화면을 확인하고 아래 8개 캡처 저장. 720px 설정 패널은 양쪽 여백 12px, 너비 696px로 확인 |
| window-simulator, macOS 플랫폼 설정 화면 light/dark × 1440/720 | 레이아웃과 좁은 창을 확인하고 아래 캡처 저장 |

시뮬레이터 스크린샷은 `/private/tmp/ib-redesign/p5/`에 있다.

- 설정: `settings-windows-{light,dark}-{1440,720}.png`, `settings-macos-{light,dark}-{1440,720}.png`
- 공유: `share-windows-{light,dark}-{1440,720}.png`

다크 스크린샷은 시뮬레이터의 실효 테마 설정이 fixture의 계정 설정에 의해 다시 칠해지는 점을 고려해, 캡처 직전에 문서의 `data-theme`만 어둡게 설정했다. 이 변경은 캡처용 브라우저 메모리에만 적용했다.

## 미검증 및 남은 일

- 패키지 앱 빌드와 실행은 하지 않았다.
- Windows 기본 앱의 WebView2 및 네이티브 창 동작은 검증하지 않았다. Windows 플랫폼 분기를 브라우저 시뮬레이터에서 확인했다.
- 접근성 대비 수치는 토큰 색을 유지했으나, 변경한 각 화면의 대비를 별도 자동 측정하지 않았다.
- 보안 기록과 외부 액세스 회수 화면은 기존 테스트 및 공통 설정 스타일을 확인했다. 시뮬레이터의 기본 흐름에서 이 개별 하위 화면 캡처는 만들지 않았다.
- **토큰 승격 후보**: 설정 본문 카드에 둔 국소 `--p5-inner-radius: 22px`를 향후 공통 Orbit 반경 토큰으로 검토한다.

## 커밋

- `feat(desktop): refine Orbit dialogs and settings surfaces`
- `docs: report redesign P5 implementation`
