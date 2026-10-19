// SPDX-License-Identifier: Apache-2.0
// Korean strings: App shell: banners, update prompts, what's new, toasts raised from App.tsx.
export const app: Record<string, string> = {
  // Banners and toasts
  "Dismiss": "닫기",
  "Couldn't recover the vault folder — {message}": "볼트 폴더를 복구하지 못했어요 — {message}",
  "Files changed while Infinite Brain was closed. Edits were merged; renames, moves and deletes made while closed were not applied. Keep Infinite Brain open when reorganising.":
    "Infinite Brain이 닫혀 있는 동안 파일이 바뀌었어요. 편집 내용은 합쳐졌지만, 닫혀 있는 동안 한 이름 바꾸기, 이동, 삭제는 적용되지 않았어요. 정리할 때는 Infinite Brain을 열어 두세요.",
  "joined the vault": "님이 볼트에 참여했어요",
  "Couldn't finish indexing this vault — search and backlinks may be incomplete.":
    "이 볼트의 색인을 끝내지 못했어요 — 검색과 백링크가 완전하지 않을 수 있어요.",

  // Switching vault
  "Switching to {name}": "{name}(으)로 전환하는 중",
  "Opening its folder and catching up on sync…": "폴더를 열고 동기화를 따라잡는 중…",
  "Opening its folder…": "폴더를 여는 중…",

  // Vault folder prompt
  "Set up {name}": "{name} 설정하기",
  "Choose the local folder this vault syncs to. Each vault keeps its own folder — separate from your other vaults.":
    "이 볼트가 동기화할 로컬 폴더를 고르세요. 볼트마다 다른 볼트와 따로 떨어진 자기 폴더를 써요.",
  "Open System Settings": "시스템 설정 열기",
  "Try again": "다시 시도",
  "Open a folder…": "폴더 열기…",
  "Start with an empty folder": "빈 폴더로 시작",
  "Choose another folder…": "다른 폴더 고르기…",

  // Update gate
  "Updating {name}": "{name} 업데이트하는 중",
  "Update required": "업데이트가 필요해요",
  "Checking for the update…": "업데이트를 확인하는 중…",
  "Starting the download…": "다운로드를 시작하는 중…",
  "Downloading v{version} — {pct}%": "v{version} 다운로드하는 중 — {pct}%",
  "Downloading v{version}…": "v{version} 다운로드하는 중…",
  "Installing — the app will restart itself…": "설치하는 중 — 앱이 스스로 다시 시작돼요…",
  "{name} couldn’t install the update to {version}": "{name}이 {version} 업데이트를 설치하지 못했어요",
  "It tried twice on its own. Check your connection and try again — your notes stay right where they are, on your disk.":
    "스스로 두 번 시도했어요. 연결을 확인하고 다시 시도하세요. 메모는 디스크에 그대로 있어요.",
  "Your server needs a newer version of {name} before this one can sync. Your notes and edits stay right where they are, on your disk, and sync as soon as the update is in.":
    "이 버전이 동기화하려면 서버에 더 새로운 {name} 버전이 필요해요. 메모와 편집 내용은 디스크에 그대로 있고, 업데이트가 끝나는 대로 동기화돼요.",
  "Download manually": "직접 다운로드",
  "Reload": "다시 불러오기",

  // What's New
  "What's new": "새로운 기능",
  "{name} updated itself to the latest version — here’s what changed.":
    "{name}이 최신 버전으로 스스로 업데이트됐어요 — 바뀐 내용은 다음과 같아요.",

  // Shell
  "Loading…": "불러오는 중…",
  "Panel": "패널",
  "Panel ({count} to review)": "패널 (검토할 항목 {count}개)",
  "Panel, {count} changes to review": "패널, 검토할 변경 {count}개",

  // Backend behind notice
  "Your Infinite Brain backend is behind this app. Update your self-hosted server (your Railway Infinite Brain backend project) to keep sync working.":
    "Infinite Brain 서버가 이 앱보다 뒤처져 있어요. 동기화를 계속 쓰려면 직접 호스팅하는 서버(Railway의 Infinite Brain 백엔드 프로젝트)를 업데이트하세요.",
  "The Infinite Brain server is being updated. Some sync features are paused until it finishes.":
    "Infinite Brain 서버를 업데이트하는 중이에요. 끝날 때까지 일부 동기화 기능이 일시 중지돼요.",
  "Missing: {features}": "누락: {features}",
  "Server version: {version}": "서버 버전: {version}",
  "unknown (older than feature reporting)": "알 수 없음 (기능 보고보다 오래된 버전)",

  // Sync pill, relative times, Home and Pinned sections
  "{n} min ago": "{n}분 전",
  "1 hour ago": "1시간 전",
  "{n} hours ago": "{n}시간 전",
  "1 day ago": "1일 전",
  "{n} days ago": "{n}일 전",
  "1 month ago": "1개월 전",
  "{n} months ago": "{n}개월 전",
  "1 year ago": "1년 전",
  "{n} years ago": "{n}년 전",
  "Updating access · {n} remaining": "접근 권한 업데이트 중 · {n}개 남음",
  "Read-only": "읽기 전용",
  "Too large to sync": "너무 커서 동기화할 수 없어요",
  "Deleted": "삭제됨",
  "Uploading · {n} note left": "업로드 중 · 메모 {n}개 남음",
  "Uploading · {n} notes left": "업로드 중 · 메모 {n}개 남음",
  "Syncing {done}/{total} updates": "변경 {done}/{total}개 동기화 중",
  "Retrying…": "다시 시도하는 중…",
  "Sync incomplete": "동기화가 끝나지 않았어요",
  "Synced · {ago}": "동기화됨 · {ago}",
  "Pinned": "고정됨",
  "Set a home": "홈 설정하기",
  "Open Home: {path}": "홈 열기: {path}",
  "Choose a template for your Home dashboard": "홈 대시보드에 쓸 템플릿을 고르세요",
  "Home options": "홈 옵션",
  "Change Home…": "홈 바꾸기…",
  "Unset Home": "홈 해제",
  "Hide Home section": "홈 섹션 숨기기",
  "Pinned notes and folders": "고정된 메모와 폴더",
  "Pinned for everyone by a vault admin": "볼트 관리자가 모두에게 고정했어요",
  "Everyone": "모든 사람",
  "Unpin for everyone": "모두에게서 고정 해제",
  "Unpin": "고정 해제",
  "Pinned options for {name}": "{name} 고정 옵션",
  "What’s changed": "달라진 점",
  "New": "새로운 기능",
};
