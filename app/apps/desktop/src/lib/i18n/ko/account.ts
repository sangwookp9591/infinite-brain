// SPDX-License-Identifier: Apache-2.0
// Korean strings: account profile, appearance, notifications, and about.
export const account: Record<string, string> = {
  "Display name": "표시 이름",
  "Your name": "이름",
  "Email confirmed ✓": "이메일을 확인했어요 ✓",
  "Not confirmed yet — check your inbox for the confirmation email.": "아직 확인하지 않았어요. 받은 편지함에서 확인 이메일을 찾아보세요.",
  "Sending…": "보내는 중…",
  "Sent ✓": "보냈어요 ✓",
  "Resend it": "다시 보내기",
  "Saving…": "저장하는 중…",
  "Or pick a character": "캐릭터를 선택하거나",
  "Character": "캐릭터",
  "Your default character": "기본 캐릭터",
  "Show Home section": "홈 섹션 표시",
  "Use Infinite Brain": "사용 방식",
  "Personal hides members, billing, security history and office collaboration on this device. Access on the server does not change.":
    "혼자 쓰기를 고르면 이 기기에서 멤버, 결제, 보안 기록, 사내 협업 메뉴를 숨겨요. 서버의 접근 권한은 바뀌지 않아요.",
  "Turning this off unsets your Home and stops it opening at startup on this device.": "끄면 홈 설정이 해제되고 이 기기를 시작할 때 홈이 열리지 않아요.",
  "Reset to vault default": "볼트 기본값으로 되돌리기",
  "Mention chime": "멘션 알림음",
  "Play a sound when a teammate pings you.": "팀원이 멘션하면 소리를 재생해요.",
  "Installed agents": "설치된 에이전트",
  "Detection is unavailable in this preview.": "이 미리보기에서는 설치 여부를 확인할 수 없어요.",
  "Checking installed clients…": "설치된 클라이언트를 확인하는 중…",
  "No supported CLI detected. Install Claude or Codex and sign in from your terminal, then restart Infinite Brain.": "지원되는 CLI를 찾지 못했어요. Claude 또는 Codex를 설치하고 터미널에서 로그인한 다음 Infinite Brain을 다시 시작해 주세요.",
  "Signed in": "로그인됨",
  "Sign-in not confirmed": "로그인 여부를 확인하지 못했어요",
  "Detection refreshes when Infinite Brain restarts. Dashboard updates use the selected CLI and its signed-in account.": "설치 여부는 Infinite Brain을 다시 시작할 때 새로 확인해요. 대시보드 업데이트에는 선택한 CLI와 로그인된 계정을 사용해요.",

  // Shell tooltips and account vaults (Korean-mode gap pass)
  "Your status shows next to your cursor for teammates working in the same note.":
    "같은 메모에서 작업하는 팀원에게 내 상태가 커서 옆에 표시돼요.",
  "Online": "온라인",
  "Active and available": "활동 중이고 연락할 수 있어요",
  "Not at the keyboard right now": "지금은 자리에 없어요",
  "Please do not disturb": "방해하지 말아 주세요",
  "Invisible": "숨김",
  "Appear offline to teammates": "팀원에게 오프라인으로 보여요",
  "The Infinite Brain server this device syncs against — currently":
    "이 기기가 동기화하는 Infinite Brain 서버는 현재",
  ". Use the managed service or point at your own. Your account is per-server, so switching signs you in to that server's session instead.":
    "예요. 관리형 서비스를 쓰거나 직접 운영하는 서버를 지정할 수 있어요. 계정은 서버마다 따로라서, 서버를 바꾸면 그 서버의 로그인 세션으로 전환돼요.",
  "Save & reconnect": "저장하고 다시 연결",
  "Reconnected.": "다시 연결했어요.",
  "Checking for updates…": "업데이트를 확인하는 중…",
  "Version {v} found — starting the download…": "{v} 버전을 찾았어요. 다운로드를 시작해요…",
  "Downloading {v} — {pct}%": "{v} 다운로드 중 — {pct}%",
  "Downloading {v}…": "{v} 다운로드 중…",
  "Installing {v}…": "{v} 설치하는 중…",
  "Version {v} is installed — restarting shortly.":
    "{v} 버전을 설치했어요. 곧 다시 시작해요.",
  "An update is on its way.": "업데이트가 곧 도착해요.",
  "Couldn't check for updates: {message}": "업데이트를 확인하지 못했어요: {message}",
  "Couldn't install version {v}": "{v} 버전을 설치하지 못했어요",
  "Invitations ({count})": "초대 ({count})",
  "Synced vaults ({count})": "동기화된 볼트 ({count})",
  "Switch here": "여기로 전환",
  "Switch": "전환",
  "Open here": "여기서 열기",
  "{name}, current vault": "{name}, 현재 볼트",
  "{name}, current folder": "{name}, 현재 폴더",
  "Open {name}": "{name} 열기",
  "More actions for {name}": "{name}의 더 많은 작업",
  "· folder created on first open": "· 처음 열 때 폴더가 만들어져요",
  "Free includes {vaults} on this account.": "무료 플랜에는 이 계정에 {vaults}가 포함돼요.",
  "Free includes {vaults} on this account (includes vaults you had before).":
    "무료 플랜에는 이 계정에 {vaults}가 포함돼요 (이전에 쓰던 볼트 포함).",
  "Local folders on this computer ({count})": "이 컴퓨터의 로컬 폴더 ({count})",
  "Vault folder location": "볼트 폴더 위치",
  "Not available": "사용할 수 없음",
  "The active vault is also linked at \"current\", so tools like Claude Desktop can point at one fixed path.":
    "현재 볼트는 \"current\"로도 연결돼 있어서, Claude Desktop 같은 도구가 항상 같은 경로를 가리킬 수 있어요.",
  "Change…": "변경…",
  "Reset to default": "기본값으로 되돌리기",
  "New vaults are created inside this folder.": "새 볼트는 이 폴더 안에 만들어져요.",
  "Vaults view": "볼트 보기 방식",
  "List view": "목록 보기",
  "Grid view": "격자 보기",
  "Remove from list": "목록에서 제거",
  "Remove this folder from the list. Files stay on disk.":
    "이 폴더를 목록에서 제거해요. 파일은 디스크에 남아 있어요.",
  "Delete vault": "볼트 삭제",
  "Delete this vault — moves its folder and all its notes to the Trash":
    "이 볼트를 삭제해요. 폴더와 모든 메모가 휴지통으로 이동해요",
  "Remove from device": "이 기기에서 제거",
  "Stop syncing this vault here; server data is kept":
    "여기서 이 볼트의 동기화를 멈춰요. 서버의 데이터는 그대로 남아요",
  "Delete this device's copy of the vault and download a fresh one":
    "이 기기의 볼트 사본을 삭제하고 새로 내려받아요",
  "Leave vault": "볼트 나가기",
  "Leave this vault — you lose access and it is removed from this device":
    "이 볼트에서 나가요. 접근 권한을 잃고 이 기기에서도 제거돼요",
  "Delete this vault from the server and keep its files on this device":
    "서버에서 이 볼트를 삭제하고 파일은 이 기기에 남겨 둬요",
  "Permanently delete this vault and all its notes for everyone":
    "이 볼트와 모든 메모를 모두에게서 영구 삭제해요",
  "Locate folder…": "폴더 찾기…",
  "Point Infinite Brain at this vault's folder where it is now":
    "이 볼트의 폴더가 지금 있는 위치를 Infinite Brain에 알려 줘요",
  "Restore here": "여기에 복원",
  "This vault's folder is missing.": "이 볼트의 폴더를 찾을 수 없어요.",
  "It was moved, renamed or deleted.": "폴더가 이동되거나 이름이 바뀌었거나 삭제됐어요.",
  "This vault's folder is gone from this device.": "이 기기에서 이 볼트의 폴더가 사라졌어요.",
  "Vault deleted. Pro ends on {date} — move it from Billing if you want to keep it.":
    "볼트를 삭제했어요. Pro는 {date}에 끝나요. 유지하려면 결제에서 다른 볼트로 옮겨 주세요.",
  "Vault deleted. Pro ends when the current period does — move it from Billing if you want to keep it.":
    "볼트를 삭제했어요. Pro는 현재 결제 기간이 끝나면 종료돼요. 유지하려면 결제에서 다른 볼트로 옮겨 주세요.",
  "Couldn't delete the vault — {message}": "볼트를 삭제하지 못했어요 — {message}",
  "Couldn't leave the vault — {message}": "볼트에서 나가지 못했어요 — {message}",
  "Leave {name}?": "{name}에서 나갈까요?",
  "You lose access to this vault on all your devices right away, and the owner is told that you left.":
    "모든 기기에서 이 볼트에 대한 접근 권한을 바로 잃고, 소유자에게 나갔다고 알려요.",
  "Its folder on this device, {folder}, is permanently deleted, including any changes that haven't synced. It does not go to the Trash.":
    "이 기기의 폴더 {folder}는 아직 동기화되지 않은 변경 내용까지 포함해 영구 삭제돼요. 휴지통으로 이동하지 않아요.",
  "Nothing from it is stored on this device.": "이 기기에는 저장된 내용이 없어요.",
  "The vault itself and everyone else's access are unchanged.":
    "볼트 자체와 다른 사람들의 접근 권한은 그대로예요.",
  "To come back later, you'll need a new invitation or join code.":
    "나중에 다시 들어오려면 새 초대나 참여 코드가 필요해요.",
  "Delete {name}?": "{name}을(를) 삭제할까요?",
  "Every note, folder and attachment in this vault is deleted for everyone, and this device's folder moves to the Trash. This can't be undone.":
    "이 볼트의 모든 메모, 폴더, 첨부 파일이 모두에게서 삭제되고 이 기기의 폴더는 휴지통으로 이동해요. 되돌릴 수 없어요.",
  "This vault's folder and all its notes move to the Trash.":
    "이 볼트의 폴더와 모든 메모가 휴지통으로 이동해요.",
  "This vault is on Pro.": "이 볼트는 Pro예요.",
  "This vault is on Pro, ending {date}.": "이 볼트는 Pro이고 {date}에 끝나요.",
  "This vault is on Pro, renewing {date}.": "이 볼트는 Pro이고 {date}에 갱신돼요.",
  "Deleting it stops the subscription at the end of the current period. You won't be charged again, and until then you can move the subscription to another vault from Billing.":
    "삭제하면 현재 결제 기간이 끝날 때 구독이 중단돼요. 다시 청구되지 않고, 그때까지는 결제에서 구독을 다른 볼트로 옮길 수 있어요.",
  "Every note, folder and attachment in this vault is deleted for everyone, and this device's folder moves to the Trash. That part can't be undone.":
    "이 볼트의 모든 메모, 폴더, 첨부 파일이 모두에게서 삭제되고 이 기기의 폴더는 휴지통으로 이동해요. 이 부분은 되돌릴 수 없어요.",
  "Reset this vault on this device?": "이 기기에서 이 볼트를 초기화할까요?",
  "Infinite Brain permanently deletes this vault's folder on this device and downloads a fresh copy from the Remote Vault. Nothing changes for your team.":
    "Infinite Brain이 이 기기의 볼트 폴더를 영구 삭제하고 원격 볼트에서 새 사본을 내려받아요. 팀에는 아무 변화도 없어요.",
  "1 note has changes that haven't reached the server. They will be lost.":
    "메모 1개의 변경 내용이 아직 서버에 도달하지 않았어요. 이 변경 내용은 사라져요.",
  "{count} notes have changes that haven't reached the server. They will be lost.":
    "메모 {count}개의 변경 내용이 아직 서버에 도달하지 않았어요. 이 변경 내용은 사라져요.",
  "Delete and reset": "삭제하고 초기화",
  "1 more belongs to another account.": "1개는 다른 계정에 속해 있어요.",
  "{count} more belong to other accounts.": "{count}개는 다른 계정에 속해 있어요.",
  "← Vaults": "← 볼트",
  "Stats": "통계",
  "Details": "상세 정보",
  "Usage is shown for vaults on your account.": "내 계정의 볼트에 대해서만 사용량이 표시돼요.",
  "Open this vault in the sidebar.": "사이드바에서 이 볼트를 열어요.",
  "Open Vault Settings": "볼트 설정 열기",
  "Members and access, appearance and more.": "멤버와 접근 권한, 모양 등을 설정해요.",
  "Switch to this vault first: it has no folder on this device yet.":
    "먼저 이 볼트로 전환해 주세요. 이 기기에는 아직 이 볼트의 폴더가 없어요.",
  "note": "메모",
  "notes": "메모",
  "files": "파일",
  "stored": "저장됨",
  "Your role": "내 역할",
  "Plan": "플랜",
  "Folder on this device": "이 기기의 폴더",
  "Not on this device": "이 기기에 없음",
  "Created": "만든 날짜",
  "On your Team account": "내 Team 계정에 속해 있어요",
  "On your Free account": "내 Free 계정에 속해 있어요",
  "On your account": "내 계정에 속해 있어요",
  "On {name}'s account": "{name}님의 계정에 속해 있어요",
  "On the owner's account": "소유자의 계정에 속해 있어요",
};
