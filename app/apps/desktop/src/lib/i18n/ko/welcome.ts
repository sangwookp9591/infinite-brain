// SPDX-License-Identifier: Apache-2.0
// Korean strings: Welcome screen and sign-in.
export const welcome: Record<string, string> = {
  // Welcome screen (VaultPicker)
  "Opening your vault…": "볼트를 여는 중…",
  "Enter your team's join code": "팀의 참여 코드를 입력하세요",
  "Ask a teammate for it — Vault settings → Members and access.":
    "팀원에게 물어보세요 — 볼트 설정 → 멤버 및 접근 권한.",
  "Cancel": "취소",
  "Joining…": "참여하는 중…",
  "Join team": "팀 참여",
  "Name your vault": "볼트 이름을 정하세요",
  "Untitled Vault": "제목 없는 볼트",
  "in {path}": "{path} 안에",
  "Creating…": "만드는 중…",
  "Create vault": "볼트 만들기",
  "New vault": "새 볼트",
  "Opening…": "여는 중…",
  "Open existing": "기존 항목 열기",
  "Join a team": "팀에 참여하기",
  "Recent vaults": "최근 볼트",
  "Show all ({count})": "모두 보기 ({count})",
  "A vault is any folder of {md} files.": "볼트는 {md} 파일이 들어 있는 모든 폴더예요.",
  "Open by path": "경로로 열기",
  "Have an account? {signIn} to sync and collaborate.":
    "계정이 있나요? {signIn}하면 동기화하고 함께 작업할 수 있어요.",
  "Type the full path of a folder of {md} files. This also works for a drive root or mounted volume the folder picker can't select, like {win} or {mac}.":
    "{md} 파일이 들어 있는 폴더의 전체 경로를 입력하세요. 폴더 선택기로 선택할 수 없는 드라이브 루트나 마운트된 볼륨에도 쓸 수 있어요. 예: {win} 또는 {mac}",
  "Folder path": "폴더 경로",
  "Open": "열기",
  "All vaults": "모든 볼트",
  "Synced vaults": "동기화된 볼트",
  "On this device only": "이 기기에만",
  "Remote": "원격",
  "Synced": "동기화됨",
  "Not on this device yet": "아직 이 기기에 없어요",
  "Remove {name} from recents": "최근 목록에서 {name} 제거",
  "Remove from recents": "최근 목록에서 제거",
  "just now": "방금 전",
  "{n}m ago": "{n}분 전",
  "{n}h ago": "{n}시간 전",
  "{n}d ago": "{n}일 전",
  "{n}mo ago": "{n}개월 전",
  "{n}y ago": "{n}년 전",
  '"{name}" was synced under a different account. Sign in with that account to open it.':
    '"{name}"은(는) 다른 계정으로 동기화됐어요. 열려면 그 계정으로 로그인하세요.',

  // Sign-in dialog (AuthDialog)
  "That doesn't look like a server address — try https://notes.example.com":
    "서버 주소처럼 보이지 않아요 — https://notes.example.com 형식으로 입력해 보세요",
  "Couldn't enable Remember password on this device.":
    "이 기기에서 비밀번호 기억을 켜지 못했어요.",
  "Couldn't remove the saved password from the OS keychain. Unlock it and try again.":
    "OS 키체인에서 저장된 비밀번호를 지우지 못했어요. 잠금을 풀고 다시 시도하세요.",
  "You're signed in, but the password couldn't be saved in the OS keychain.":
    "로그인했지만 비밀번호를 OS 키체인에 저장하지 못했어요.",
  "Where do your notes live?": "메모를 어디에 둘까요?",
  "Connect to {host}?": "{host}에 연결할까요?",
  "Reset your password": "비밀번호 재설정",
  "Welcome back": "다시 오신 것을 환영해요",
  "Create your account": "계정 만들기",
  "Your account and your team live on one server. Pick the managed service, or your team's own.":
    "계정과 팀은 하나의 서버에 있어요. 관리형 서비스나 팀의 자체 서버를 고르세요.",
  "Infinite Brain managed service": "Infinite Brain 관리형 서비스",
  "Hosted for you at {host}": "{host}에서 호스팅해 드려요",
  "Your own server": "내 서버",
  "Self-hosted — enter the address your team gave you":
    "자체 호스팅 — 팀에서 받은 주소를 입력하세요",
  "Connect": "연결",
  "Your account and notes for this device will live on this server.":
    "이 기기의 계정과 메모는 이 서버에 있게 돼요.",
  "A teammate": "팀원",
  "{inviter} invited you to join {org}. Sign in — or create an account — with {email} to accept.":
    "{inviter}님이 {org}에 참여하도록 초대했어요. 수락하려면 {email} 주소로 로그인하거나 계정을 만드세요.",
  "Sign up": "가입",
  "Waiting for your browser…": "브라우저를 기다리는 중…",
  "Continue with Google": "Google로 계속",
  "or": "또는",
  "Reset link sent to {email}. Check your inbox (and spam) — the link is valid for one hour. Setting a new password there brings you back here to sign in.":
    "재설정 링크를 {email} 주소로 보냈어요. 받은편지함(스팸함도)을 확인하세요 — 링크는 1시간 동안 유효해요. 거기서 새 비밀번호를 설정하면 여기로 돌아와 로그인할 수 있어요.",
  "Back to sign in": "로그인으로 돌아가기",
  "Enter your email and we'll send a link to choose a new password.":
    "이메일을 입력하면 새 비밀번호를 정할 수 있는 링크를 보내 드려요.",
  "Email": "이메일",
  "Email me a reset link": "재설정 링크를 이메일로 받기",
  "Name": "이름",
  "Password": "비밀번호",
  "Remember password": "비밀번호 기억",
  "Forgot password?": "비밀번호를 잊었나요?",
  "Create account": "계정 만들기",
  "This invitation was sent to {email}. Use that address, or it can't be accepted.":
    "이 초대는 {email} 주소로 보냈어요. 그 주소를 사용하세요. 그렇지 않으면 수락할 수 없어요.",
  "Continue": "계속",
  "Invalid email or password.": "이메일 또는 비밀번호가 올바르지 않아요.",
  "Signed up with Google? Use Continue with Google, or reset your password.":
    "Google로 가입했나요? Google로 계속을 사용하거나 비밀번호를 재설정하세요.",
  "An account with this email already exists. {signIn}.":
    "이 이메일로 만든 계정이 이미 있어요. {signIn}",
  "An account with this email already exists. {signIn} or {reset}.":
    "이 이메일로 만든 계정이 이미 있어요. {signIn} 또는 {reset}",
  "Sign in instead": "대신 로그인",
  "reset your password": "비밀번호 재설정",
  "Resetting your password on {host}": "{host}에서 비밀번호를 재설정하는 중",
  "Signing in to {host}": "{host}에 로그인하는 중",
  "Creating your account on {host}": "{host}에 계정을 만드는 중",
  "Use a self-hosted server": "자체 호스팅 서버 사용",
  "Change": "변경",
  "Couldn't reach the server at {host}. An account is for working with a team and needs an Infinite Brain server. You can keep using your notes on this computer without one.":
    "{host} 서버에 연결할 수 없어요. 계정은 팀과 함께 쓸 때 필요하고, Infinite Brain 서버가 있어야 해요. 계정 없이도 이 컴퓨터에서 메모를 계속 쓸 수 있어요.",
};
