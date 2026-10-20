// SPDX-License-Identifier: Apache-2.0
// Korean strings: settings screens.
export const settings: Record<string, string> = {
  // Vault settings: shell and tab names
  "Local vault settings": "로컬 볼트 설정",
  "Local vault": "로컬 볼트",
  "Vault": "볼트",
  "Close settings": "설정 닫기",
  "Close (Esc)": "닫기 (Esc)",
  "Settings sections": "설정 섹션",
  "Turn on sync to unlock": "동기화를 켜면 열 수 있어요",
  "AI (Beta)": "AI (베타)",
  "General": "일반",
  "Dashboards": "대시보드",
  "AI connections": "AI 연결",
  "Versioning": "버전 관리",
  "Import / Export": "가져오기 / 내보내기",
  "Billing": "결제",
  "Usage": "사용량",
  "Security": "보안",

  // Locked tab gate
  "{label} unlocks with sync": "{label}은(는) 동기화를 켜면 열려요",
  "Turn on sync for this vault to invite people, set sharing and permissions, and connect AI clients.":
    "이 볼트의 동기화를 켜면 사람을 초대하고, 공유와 권한을 설정하고, AI 클라이언트를 연결할 수 있어요.",
  "Turn on sync & sharing →": "동기화 및 공유 켜기 →",

  // General tab
  "Couldn't turn on sync — {message}": "동기화를 켜지 못했어요 — {message}",
  "You're viewing a local folder. Turn on sync to keep this vault on your account and across devices.":
    "로컬 폴더를 보고 있어요. 동기화를 켜면 이 볼트를 내 계정에 보관하고 여러 기기에서 쓸 수 있어요.",
  "This vault lives only on this computer. Turn on sync to reach it from other devices — or invite people to it.":
    "이 볼트는 이 컴퓨터에만 있어요. 동기화를 켜면 다른 기기에서도 쓰거나 사람을 초대할 수 있어요.",
  "Turn on sync & sharing": "동기화 및 공유 켜기",
  "Keeps the notes and folders already here — nothing to re-import. Enables live collaboration and lets you invite people. Everyone in the vault can edit by default; you choose who sees what.":
    "여기 있는 메모와 폴더를 그대로 유지하므로 다시 가져올 필요가 없어요. 실시간 협업을 켜고 사람을 초대할 수 있어요. 기본적으로 볼트의 모든 사람이 편집할 수 있고, 누가 무엇을 볼지는 직접 정해요.",
  "Checking your account…": "계정을 확인하는 중…",
  "Sign in to turn on": "로그인하고 켜기",
  "You'll need to sign in first — this button will prompt you.":
    "먼저 로그인해야 해요. 이 버튼을 누르면 안내해 드려요.",
  "Folder on disk": "디스크의 폴더",

  // General tab: danger zone
  "Danger zone": "위험 구역",
  "Reset local copy": "로컬 복사본 초기화",
  "Delete the {folder} folder on this device and download a fresh copy from {host}. Nothing changes for your team.":
    "이 기기의 {folder} 폴더를 삭제하고 {host}에서 새 복사본을 내려받아요. 팀에는 아무 변화도 없어요.",
  "Delete this vault's folder on this device and download a fresh copy from {host}. Nothing changes for your team.":
    "이 기기의 이 볼트 폴더를 삭제하고 {host}에서 새 복사본을 내려받아요. 팀에는 아무 변화도 없어요.",
  "Make this vault local only": "이 볼트를 로컬 전용으로 바꾸기",
  "Keep the {folder} folder on this device and remove its synced copy from {host}.":
    "이 기기의 {folder} 폴더는 그대로 두고, {host}의 동기화된 복사본을 제거해요.",
  "Keep the local folder on this device and remove its synced copy from {host}.":
    "이 기기의 로컬 폴더는 그대로 두고, {host}의 동기화된 복사본을 제거해요.",
  "The server copy of {notes} and {files}, version history, and sharing will be deleted.":
    "{notes}와 {files}의 서버 복사본, 버전 기록, 공유가 삭제돼요.",
  "{count} file": "파일 {count}개",
  "{count} files": "파일 {count}개",
  "{count} teammate": "팀원 {count}명",
  "{count} teammates": "팀원 {count}명",
  "{teammates} lose access.": "{teammates}이 접근 권한을 잃어요.",
  "No teammates currently have access.": "현재 접근 권한이 있는 팀원이 없어요.",
  "Checking what will be removed…": "제거될 항목을 확인하는 중…",
  "Make local only": "로컬 전용으로 바꾸기",

  // Make-local-only confirm
  "Couldn't make the vault local only — {message}": "볼트를 로컬 전용으로 바꾸지 못했어요 — {message}",
  "Make {name} local only?": "{name}을(를) 로컬 전용으로 바꿀까요?",
  "Your files stay where they are.": "파일은 그대로 남아 있어요.",
  "{folder} on this device keeps every note and attachment as ordinary files.":
    "이 기기의 {folder}에는 모든 메모와 첨부 파일이 일반 파일로 남아요.",
  "This device keeps every note and attachment as ordinary files.":
    "이 기기에는 모든 메모와 첨부 파일이 일반 파일로 남아요.",
  "Deleted from {host}, permanently:": "{host}에서 영구적으로 삭제돼요:",
  "Counting what would be deleted…": "삭제될 항목을 세는 중…",
  "{notes} and {files}, with all of their edit history": "{notes}와 {files}, 그리고 모든 편집 기록",
  "{notes} and {files}, with all of their edit history and {checkpoints}":
    "{notes}와 {files}, 그리고 모든 편집 기록과 {checkpoints}",
  "{count} version checkpoint": "버전 체크포인트 {count}개",
  "{count} version checkpoints": "버전 체크포인트 {count}개",
  "{teammates} lose access immediately; their own local copies are kept":
    "{teammates}이 즉시 접근 권한을 잃어요. 각자의 로컬 복사본은 유지돼요",
  "{count} public share link": "공개 공유 링크 {count}개",
  "{count} public share links": "공개 공유 링크 {count}개",
  "{links} stop working": "{links}가 작동하지 않게 돼요",
  "{count} MCP token": "MCP 토큰 {count}개",
  "{count} MCP tokens": "MCP 토큰 {count}개",
  "{tokens} stop working — AI clients lose access": "{tokens}가 작동하지 않게 돼요 — AI 클라이언트가 접근 권한을 잃어요",
  "Pro ends on {date} — until then you can move the subscription to another vault from Billing.":
    "Pro는 {date}에 끝나요. 그때까지는 결제에서 구독을 다른 볼트로 옮길 수 있어요.",
  "Pro ends when the current period does — until then you can move the subscription to another vault from Billing.":
    "Pro는 현재 기간이 끝나면 함께 끝나요. 그때까지는 결제에서 구독을 다른 볼트로 옮길 수 있어요.",
  "This cannot be undone. Teammates cannot get the vault back from us.":
    "되돌릴 수 없어요. 팀원도 저희를 통해 볼트를 되찾을 수 없어요.",
  "Type {name} to confirm": "확인하려면 {name}을(를) 입력하세요",

  // Freeze vault root
  "Freeze vault root": "볼트 최상위 고정",
  "Stops anything new being created at the top level of this vault — new notes and folders have to go inside an existing folder. Applies to everyone, including you; only an owner or admin can turn it off. Nothing already at the root is moved, renamed, or hidden.":
    "이 볼트의 최상위에 새 항목이 만들어지지 않게 해요. 새 메모와 폴더는 기존 폴더 안에 만들어야 해요. 나를 포함한 모든 사람에게 적용되고, 소유자나 관리자만 끌 수 있어요. 최상위에 이미 있는 항목은 이동하거나 이름을 바꾸거나 숨기지 않아요.",
  "Only an owner or admin can change this": "소유자나 관리자만 바꿀 수 있어요",

  // Usage (team billing) tab
  "bytes": "바이트",
  "Files": "파일",
  "in this vault": "이 볼트 안",
  "of {vaults} on this account": "이 계정에서 {vaults}개 중",
  "of {vaults} on this account · includes vaults you had before": "이 계정에서 {vaults}개 중 · 이전부터 있던 볼트 포함",
  "Usage isn't available for this vault right now.": "지금은 이 볼트의 사용량을 볼 수 없어요.",
  "Open Plan & Billing": "요금제 및 결제 열기",
  "Bill it on your own account instead.": "대신 내 계정으로 결제해요.",
  "Move to my account": "내 계정으로 옮기기",
  "Move {name} to your account?": "{name}을(를) 내 계정으로 옮길까요?",
  "Its people and limits will count on your account from now on, and it stops counting on the account it is on today. Notes, members and access stay exactly as they are.":
    "이 볼트의 사람과 한도는 지금부터 내 계정에 집계되고, 지금 속한 계정에서는 더 이상 집계되지 않아요. 메모, 멤버, 접근 권한은 그대로 유지돼요.",
  "{name} is now on your account.": "{name}은(는) 이제 내 계정에 있어요.",
  "The vault": "볼트",
  "Couldn't move the vault — {message}": "볼트를 옮기지 못했어요 — {message}",

  // Billing tab (per-vault model)
  "the vault": "볼트",
  "Pro moved to {name}.": "Pro를 {name}에 옮겼어요.",
  "Couldn't move the subscription — {message}": "구독을 옮기지 못했어요 — {message}",
  "Subscription for {name} canceled.": "{name}의 구독을 취소했어요.",
  "Couldn't cancel the subscription — {message}": "구독을 취소하지 못했어요 — {message}",
  "Billing isn't enabled on this server.": "이 서버에서는 결제가 켜져 있지 않아요.",
  "Nowhere to move it — you need another vault you own that isn't already on Pro.":
    "옮길 곳이 없어요 — 이미 Pro가 아닌, 내가 소유한 다른 볼트가 필요해요.",
  "Transfer": "이전",
  "Move {name}'s subscription to another vault": "{name}의 구독을 다른 볼트로 옮기기",
  "Move Pro from {name}": "{name}에서 Pro 옮기기",
  "Move Pro to {name}": "Pro를 {name}에 옮기기",
  "Move subscription": "구독 옮기기",
  "Choose the vault that becomes Pro. It keeps the same billing period and price. {source} drops to Free — its members and notes stay, but its attachments stop syncing. Every local copy remains available on its device.":
    "Pro가 될 볼트를 선택하세요. 결제 기간과 가격은 그대로 유지돼요. {source}은(는) 무료로 바뀌어요. 멤버와 메모는 그대로 남지만 첨부 파일은 더 이상 동기화되지 않아요. 모든 로컬 복사본은 각 기기에서 계속 쓸 수 있어요.",
  "Destination vault": "대상 볼트",
  "{used} of {limit} member · Free": "멤버 {limit}명 중 {used}명 · 무료",
  "{used} of {limit} members · Free": "멤버 {limit}명 중 {used}명 · 무료",
  "Only vaults you own that aren't already on Pro are listed.": "이미 Pro가 아닌, 내가 소유한 볼트만 표시돼요.",
  "This vault isn't synced, so it has no plan of its own. The vaults on your account are listed below.":
    "이 볼트는 동기화되지 않아서 자체 요금제가 없어요. 내 계정의 볼트는 아래에 있어요.",
  "Attachment sync is active across devices and with your team.":
    "첨부 파일 동기화가 기기 간에, 그리고 팀과 함께 켜져 있어요.",
  "Access until": "이용 가능 기간",
  "Renews": "갱신일",
  "Your subscription is set to cancel at the end of the current period.":
    "현재 기간이 끝나면 구독이 취소되도록 설정되어 있어요.",
  "Manage subscription": "구독 관리",
  "Ask an owner or admin to manage the subscription.": "소유자나 관리자에게 구독 관리를 요청하세요.",
  "Members": "멤버",
  "{used} of {limit}": "{limit} 중 {used}",
  " · full": " · 가득 참",
  "Includes {count} pending invitation.": "대기 중인 초대 {count}개를 포함해요.",
  "Includes {count} pending invitations.": "대기 중인 초대 {count}개를 포함해요.",
  "Upgrade to Pro unlocks": "Pro로 업그레이드하면 열려요",
  "Ask an owner or admin to upgrade this vault.": "소유자나 관리자에게 이 볼트의 업그레이드를 요청하세요.",
  "{used} of {limit} member": "멤버 {limit}명 중 {used}명",
  "{used} of {limit} members": "멤버 {limit}명 중 {used}명",
  "Billed to {name}": "청구 대상: {name}",
  "Current": "현재",
  "Manage": "관리",
  "Subscriptions": "구독",
  "No vaults on this account yet.": "이 계정에는 아직 볼트가 없어요.",
  "From deleted vaults": "삭제된 볼트에서",
  "These subscriptions belonged to vaults that were deleted. They still bill until they end — move one to a vault to use the time you've paid for, or cancel it now.":
    "이 구독들은 삭제된 볼트에 속해 있었어요. 끝날 때까지 계속 결제돼요. 결제한 기간을 쓰려면 구독을 다른 볼트로 옮기거나, 지금 취소하세요.",
  "Deleted vault": "삭제된 볼트",
  "Deleted {date}": "{date} 삭제됨",
  "Cancel now": "지금 취소",
  "Free vaults": "무료 볼트",
  "{used} of {limit} used": "{limit}개 중 {used}개 사용",
  "Cancel the subscription for {name}?": "{name}의 구독을 취소할까요?",
  "Cancel subscription": "구독 취소",
  "Billing stops now and the rest of the period is given up. There is no vault left to use it on, so nothing else is lost.":
    "결제가 지금 중단되고 남은 기간은 포기돼요. 남은 기간을 쓸 볼트가 없으니 그 밖에 잃는 것은 없어요.",
  "If you'd rather keep the time you've paid for, move it to another vault instead.":
    "결제한 기간을 유지하고 싶다면 대신 다른 볼트로 옮기세요.",

  // Versioning tab
  "Manual checkpoint · {ago}": "수동 체크포인트 · {ago}",
  "Daily checkpoint · {ago}": "일일 체크포인트 · {ago}",
  "Vault reverted — {changed} notes changed, {restored} restored, {removed} removed":
    "볼트를 되돌렸어요 — 메모 {changed}개 변경, {restored}개 복원, {removed}개 제거",
  "A checkpoint captures every note in this vault — content and folder structure. One is taken automatically each day the vault changes; the vault keeps its 5 most recent. Reverting rolls every member's vault back and broadcasts live.":
    "체크포인트는 이 볼트의 모든 메모를 내용과 폴더 구조까지 저장해요. 볼트가 바뀐 날마다 자동으로 하나씩 만들고, 최근 5개를 남겨요. 되돌리면 모든 멤버의 볼트가 되돌아가고 바로 반영돼요.",
  "Create checkpoint": "체크포인트 만들기",
  "Label (optional) — e.g. Before the big reorg": "이름 (선택) — 예: 대규모 정리 전",
  "Checkpoints": "체크포인트",
  "No checkpoints yet. One is captured automatically within a day of the vault changing, or create one above.":
    "아직 체크포인트가 없어요. 볼트가 바뀌면 하루 안에 자동으로 하나 만들어지고, 위에서 직접 만들 수도 있어요.",
  "No checkpoints yet. One is captured automatically within a day of the vault changing.":
    "아직 체크포인트가 없어요. 볼트가 바뀌면 하루 안에 자동으로 하나 만들어져요.",
  "by {name}": "작성: {name}",
  "Revert": "되돌리기",
  "Only a vault owner or admin can revert to a checkpoint.": "볼트 소유자나 관리자만 체크포인트로 되돌릴 수 있어요.",
  "Revert the entire vault?": "볼트 전체를 되돌릴까요?",
  "Every note goes back to {title} ({ago}) — content, names and folders — for every member, live. Notes created since then are moved to trash. Attachments are not reverted. A checkpoint of the current state is taken first, so this can be undone.":
    "모든 메모가 {title}({ago}) 상태로 돌아가요. 내용, 이름, 폴더가 모든 멤버에게 바로 적용돼요. 그 뒤에 만든 메모는 휴지통으로 이동해요. 첨부 파일은 되돌리지 않아요. 먼저 현재 상태의 체크포인트를 만들기 때문에 이 작업은 되돌릴 수 있어요.",
  "Revert vault": "볼트 되돌리기",

  // AI connections tab
  "Clipboard unavailable. Select and copy the text manually.": "클립보드를 쓸 수 없어요. 텍스트를 직접 선택해서 복사하세요.",
  "Couldn't create the MCP token — {message}": "MCP 토큰을 만들지 못했어요 — {message}",
  "MCP needs an active vault — create or switch to one first.":
    "MCP를 쓰려면 활성 볼트가 필요해요. 먼저 볼트를 만들거나 전환하세요.",
  "Connect an AI to this vault. Choose its access when you sign in; your existing sharing permissions still apply.":
    "이 볼트에 AI를 연결하세요. 접근 권한은 로그인할 때 고르고, 기존 공유 권한은 그대로 적용돼요.",
  "Choose your AI": "사용할 AI 선택",
  "ChatGPT (Advanced · Developer mode)": "ChatGPT (고급 · 개발자 모드)",
  "Claude Code / Codex (Advanced)": "Claude Code / Codex (고급)",
  "In claude.ai, open Settings → Connectors → Add custom connector. Team/Enterprise owners first add it in Organization settings → Connectors.":
    "claude.ai에서 Settings → Connectors → Add custom connector를 열어요. Team/Enterprise 소유자는 먼저 Organization settings → Connectors에서 추가해요.",
  "Name it Infinite Brain and paste the connector URL below. Choose Connect to open the sign-in page.":
    "이름을 Infinite Brain으로 짓고 아래 커넥터 URL을 붙여 넣어요. Connect를 눌러 로그인 페이지를 열어요.",
  "Sign in, select this vault and approve the access you want. Ask Claude to list your notes, then check the connection below.":
    "로그인한 뒤 이 볼트를 선택하고 원하는 접근 권한을 승인해요. Claude에게 메모 목록을 보여 달라고 한 다음, 아래에서 연결을 확인해요.",
  "Advanced: use ChatGPT on the web. Enable Developer mode in Settings → Apps → Advanced Settings; your plan and workspace role must allow it.":
    "고급: 웹에서 ChatGPT를 써요. Settings → Apps → Advanced Settings에서 Developer mode를 켜요. 요금제와 워크스페이스 역할이 허용해야 해요.",
  "Create a custom app in Apps (workspace admins: Workspace settings → Apps → Create). Paste this connector URL and select OAuth authentication.":
    "Apps에서 커스텀 앱을 만들어요(워크스페이스 관리자: Workspace settings → Apps → Create). 이 커넥터 URL을 붙여 넣고 OAuth 인증을 선택해요.",
  "Sign in, choose this vault and approve access. Enable the app in a chat, list your notes, then check the connection below.":
    "로그인한 뒤 이 볼트를 선택하고 접근을 승인해요. 채팅에서 앱을 켜고 메모 목록을 불러온 다음, 아래에서 연결을 확인해요.",
  "Open your personal ~/.cursor/mcp.json (or Cursor Settings → MCP).":
    "개인 ~/.cursor/mcp.json(또는 Cursor Settings → MCP)을 열어요.",
  "Copy the settings JSON below. Create a token in Advanced and replace YOUR_MCP_TOKEN, or remove headers to use OAuth sign-in. Keep credentials out of shared project files.":
    "아래 설정 JSON을 복사해요. 고급에서 토큰을 만들어 YOUR_MCP_TOKEN을 바꾸거나, headers를 지워 OAuth 로그인을 써요. 자격 증명은 공유 프로젝트 파일에 두지 마세요.",
  "Save and restart Cursor. Enable Infinite Brain in Agent, list your notes, then check the connection below.":
    "저장하고 Cursor를 다시 시작해요. Agent에서 Infinite Brain을 켜고 메모 목록을 불러온 다음, 아래에서 연결을 확인해요.",
  "In VS Code, run MCP: Open User Configuration. Paste the settings JSON below into your user MCP configuration.":
    "VS Code에서 MCP: Open User Configuration을 실행해요. 아래 설정 JSON을 사용자 MCP 설정에 붙여 넣어요.",
  "Create a token in Advanced and replace YOUR_MCP_TOKEN in the Authorization header. Keep the configuration personal and out of source control.":
    "고급에서 토큰을 만들어 Authorization 헤더의 YOUR_MCP_TOKEN을 바꿔요. 설정은 개인용으로 두고 소스 관리에는 올리지 마세요.",
  "Open Copilot Chat in Agent mode, enable the server's tools and list your notes. Check the connection below.":
    "Copilot Chat을 Agent 모드로 열고 서버의 도구를 켠 뒤 메모 목록을 불러와요. 아래에서 연결을 확인해요.",
  "Advanced: install Claude Code or Codex yourself. Copy the Claude Code command below; without a token, run /mcp in Claude Code to sign in with OAuth.":
    "고급: Claude Code나 Codex는 직접 설치해요. 아래 Claude Code 명령을 복사해요. 토큰이 없으면 Claude Code에서 /mcp를 실행해 OAuth로 로그인해요.",
  "For Codex, use the TOML below in ~/.codex/config.toml and set INFINITE_BRAIN_MCP_TOKEN in your shell to a token created in Advanced.":
    "Codex는 아래 TOML을 ~/.codex/config.toml에 쓰고, 셸에서 INFINITE_BRAIN_MCP_TOKEN을 고급에서 만든 토큰으로 설정해요.",
  "List your notes in the CLI, then check the connection below. Keep tokens out of URLs and source control.":
    "CLI에서 메모 목록을 불러온 다음, 아래에서 연결을 확인해요. 토큰은 URL이나 소스 관리에 넣지 마세요.",
  "Connector URL": "커넥터 URL",
  "Copied ✓": "복사됨 ✓",
  "Copy URL": "URL 복사",
  "Copy settings": "설정 복사",
  "Copy Codex settings": "Codex 설정 복사",
  "Advanced · Access tokens": "고급 · 액세스 토큰",
  "A token authenticates the client and scopes it to you in this vault. Add it as an {header} header. Revoke any time.":
    "토큰은 클라이언트를 인증하고, 이 볼트에서 내 권한 범위로 제한해요. {header} 헤더로 추가하세요. 언제든 폐기할 수 있어요.",
  "Token access": "토큰 접근 권한",
  "Read + write": "읽기 + 쓰기",
  "Read + write + delete/move": "읽기 + 쓰기 + 삭제/이동",
  "Manage team access (off by default)": "팀 접근 권한 관리 (기본은 꺼짐)",
  "Token name": "토큰 이름",
  "Token name, e.g. Claude Desktop": "토큰 이름 (예: Claude Desktop)",
  "Create token": "토큰 만들기",
  "Copy your token now — it won't be shown again": "지금 토큰을 복사하세요 — 다시 표시되지 않아요",
  "Connections": "연결",
  "OAuth and token connections. Disconnect to stop their next request. Status reflects recent requests, not a live socket.":
    "OAuth 연결과 토큰 연결이에요. 연결을 해제하면 다음 요청부터 막혀요. 상태는 최근 요청을 기준으로 하며 실시간 연결 상태가 아니에요.",
  "No connections yet.": "아직 연결이 없어요.",
  "Connected": "연결됨",
  "Disconnected": "연결 안 됨",
  "{count} call": "호출 {count}회",
  "{count} calls": "호출 {count}회",
  "last active {ago}": "마지막 활동 {ago}",
  "never used": "사용한 적 없음",
  "Full access (legacy)": "전체 접근 권한 (이전 방식)",
  "Hide tools": "도구 숨기기",
  "Tools · {count}": "도구 · {count}",
  "Disconnect": "연결 해제",
  "read": "읽기",
  "delete": "삭제",
  "write": "쓰기",
  "Unknown client": "알 수 없는 클라이언트",
  "Node client": "Node 클라이언트",
  "{n}s ago": "{n}초 전",

  // Import / Export tab
  "{count} skipped": "{count}개 건너뜀",
  "Exported the vault.": "볼트를 내보냈어요.",
  "Import": "가져오기",
  "Bring existing files and folders into this vault — any format. Markdown and text become notes; everything else is kept as-is, with its folder structure. Existing names are never overwritten.":
    "기존 파일과 폴더를 이 볼트로 가져와요. 형식은 상관없어요. Markdown과 텍스트는 메모가 되고, 나머지는 폴더 구조와 함께 그대로 보관돼요. 이미 있는 이름은 덮어쓰지 않아요.",
  "Importing…": "가져오는 중…",
  "You can also right-click any folder in the sidebar, or drag files straight onto it.":
    "사이드바에서 폴더를 오른쪽 클릭하거나 파일을 폴더 위로 끌어다 놓아도 돼요.",
  "Export": "내보내기",
  "Save a copy of this whole vault to a folder on your computer. The hidden {context} index is skipped.":
    "이 볼트 전체의 복사본을 컴퓨터의 폴더에 저장해요. 숨겨진 {context} 색인은 제외돼요.",
  "Exporting…": "내보내는 중…",
  "Export entire vault…": "볼트 전체 내보내기…",

  // Appearance tab
  "the server refused \"{key}\"": "서버가 \"{key}\"을(를) 거부했어요",
  "the server refused a value": "서버가 값을 거부했어요",
  "Couldn't save the vault's appearance, so it was put back: {reason}.":
    "볼트의 화면 설정을 저장하지 못해 원래대로 되돌렸어요: {reason}.",
  "Defaults for everyone in this vault": "이 볼트 모든 사람의 기본값",
  "Set by the vault owner": "볼트 소유자가 설정함",
  "People can still override these in their own Appearance settings.": "각자의 화면 설정에서 이 값을 바꿀 수 있어요.",
  "Reset to defaults": "기본값으로 되돌리기",
};
