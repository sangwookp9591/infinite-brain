// SPDX-License-Identifier: Apache-2.0
// Korean strings: health screens and the Housekeeper panel.
// Text from lib/health/checks.ts (check labels, advice, action wording) is keyed by its English
// text and translated where it is shown, so those entries live in the last section.
export const health: Record<string, string> = {
  // Health page and diagnostics
  "(based on the last known Remote Vault view)": "(마지막으로 확인된 원격 볼트 보기 기준)",
  "A Remote Vault comparison is not available": "원격 볼트와 비교할 수 없어요",
  "Accessible to you": "내가 접근할 수 있는 항목",
  "Advanced diagnostics": "고급 진단",
  "Already syncing": "이미 동기화하는 중이에요",
  "Checks & repair tools": "검사 및 복구 도구",
  "Checks could not finish: {error}": "검사를 끝내지 못했어요: {error}",
  "Checks read this vault without changing your notes. Sync retry uses the normal safe Remote Vault reconciliation flow.":
    "검사는 메모를 바꾸지 않고 이 볼트를 읽기만 해요. 동기화 재시도는 평소와 같은 안전한 원격 볼트 대조 과정을 사용해요.",
  "Checks unavailable": "검사를 사용할 수 없어요",
  "Copy report": "보고서 복사",
  "Counts are provisional until sync finishes.": "동기화가 끝날 때까지 개수는 잠정값이에요.",
  "Delete all": "모두 삭제",
  "Delete this note?": "이 메모를 삭제할까요?",
  "Delete {count} local copies?": "로컬 사본 {count}개를 삭제할까요?",
  "Delete {count} local copy?": "로컬 사본 {count}개를 삭제할까요?",
  "Deleted {count} local copies": "로컬 사본 {count}개를 삭제했어요",
  "Deleted {count} local copy": "로컬 사본 {count}개를 삭제했어요",
  "Demo data": "데모 데이터",
  "Diagnostic report copied.": "진단 보고서를 복사했어요.",
  "Diagnostic tools": "진단 도구",
  "Editing activity": "편집 활동",
  "Embedded attachments and standalone files; excludes note text, the local index and edit history":
    "임베드된 첨부 파일과 단독 파일이에요. 메모 텍스트, 로컬 색인, 편집 기록은 포함하지 않아요",
  "Empty the recovery copies?": "복구용 사본을 비울까요?",
  "Empty trash": "휴지통 비우기",
  "Files & attachments": "파일 및 첨부 파일",
  "Find files and history using the most space.": "공간을 가장 많이 차지하는 파일과 기록을 찾아보세요.",
  "Folders": "폴더",
  "History reset · {size} freed": "기록 초기화 · {size} 확보",
  "Index rebuilt": "색인을 다시 만들었어요",
  "Inspect a note": "메모 살펴보기",
  "Inspect one note, verify local files, and review sync history":
    "메모 하나를 살펴보고, 로컬 파일을 검증하고, 동기화 기록을 확인해요",
  "Integrity checks": "무결성 검사",
  "Largest items": "가장 큰 항목",
  "Last known": "마지막으로 확인된",
  "Local activity": "로컬 활동",
  "Local storage": "로컬 저장 공간",
  "Needs attention": "확인이 필요해요",
  "No Remote Vault inventory has been received yet.": "아직 원격 볼트의 목록을 받지 못했어요.",
  "Notes and folders match": "메모와 폴더가 일치해요",
  "Nothing to empty": "비울 항목이 없어요",
  "Only the {shown} shown are touched — {more} more were found but not listed. Run the checks again afterwards to reach them.":
    "표시된 {shown}개만 처리해요. {more}개가 더 발견됐지만 목록에는 없어요. 나머지는 이후에 검사를 다시 실행해서 처리하세요.",
  "PDFs, images, data, and other supported files": "PDF, 이미지, 데이터 등 지원되는 파일",
  "Put this file back on the Remote Vault?": "이 파일을 원격 볼트에 다시 올릴까요?",
  "Re-register": "다시 등록",
  "Re-registered {count} file — content is uploading now": "파일 {count}개를 다시 등록했어요. 내용을 업로드하는 중이에요",
  "Re-registered {count} files — content is uploading now": "파일 {count}개를 다시 등록했어요. 내용을 업로드하는 중이에요",
  "Reads every note again and builds search, tags and backlinks from scratch. Search may be briefly incomplete while it runs. Your notes are not touched.":
    "모든 메모를 다시 읽어서 검색, 태그, 백링크를 처음부터 다시 만들어요. 진행하는 동안 검색 결과가 잠시 부족할 수 있어요. 메모는 바뀌지 않아요.",
  "Rebuild": "다시 만들기",
  "Rebuild the search index?": "검색 색인을 다시 만들까요?",
  "Recent sync activity": "최근 동기화 활동",
  "Refresh": "새로 고침",
  "Registered — its content is uploading now": "등록했어요. 내용을 업로드하는 중이에요",
  "Registers {code} with the Remote Vault as a note again and uploads its content. Everyone with access to this vault will see it.":
    "{code}을(를) 원격 볼트에 메모로 다시 등록하고 내용을 업로드해요. 이 볼트에 접근할 수 있는 모든 사람이 볼 수 있어요.",
  "Remote Vault": "원격 볼트",
  "Remote counts include only notes you can access.": "원격 개수에는 내가 접근할 수 있는 메모만 포함돼요.",
  "Removed {count} copies · {size} freed": "사본 {count}개 제거 · {size} 확보",
  "Removed {count} copy · {size} freed": "사본 {count}개 제거 · {size} 확보",
  "Reset history": "기록 초기화",
  "Reset this note's history?": "이 메모의 기록을 초기화할까요?",
  "Retry sync": "동기화 다시 시도",
  "Review connection, upload, and retry events since Infinite Brain launched. Select a note path to inspect it.":
    "Infinite Brain을 실행한 뒤의 연결, 업로드, 재시도 이벤트를 확인하세요. 메모 경로를 선택하면 자세히 살펴볼 수 있어요.",
  "Review what Infinite Brain verified on this computer and fix individual findings.":
    "이 컴퓨터에서 Infinite Brain이 확인한 내용을 살펴보고 항목별로 고치세요.",
  "Run a fresh check or share a report": "새로 검사하거나 보고서를 공유해요",
  "Run all checks": "모든 검사 실행",
  "Running checks…": "검사를 실행하는 중…",
  "Search by name or path to see its local and Remote Vault state.":
    "이름이나 경로로 검색하면 로컬과 원격 볼트의 상태를 볼 수 있어요.",
  "See when notes in this vault changed.": "이 볼트의 메모가 언제 바뀌었는지 확인하세요.",
  "Server totals include notes not everyone can open.": "서버 합계에는 모든 사람이 열 수는 없는 메모도 포함돼요.",
  "Sign in before retrying sync.": "동기화를 다시 시도하기 전에 로그인하세요.",
  "Single note": "메모 하나",
  "Still counting notes on this computer": "이 컴퓨터의 메모를 아직 세는 중이에요",
  "Stored locally": "로컬에 저장됨",
  "Stored on server": "서버에 저장됨",
  "Sync check started. Results will update as notes are confirmed.":
    "동기화 확인을 시작했어요. 메모가 확인되는 대로 결과가 업데이트돼요.",
  "Sync findings": "동기화 검사 결과",
  "Sync is off for this vault.": "이 볼트는 동기화가 꺼져 있어요.",
  "Sync is still updating your local copy": "동기화가 아직 로컬 사본을 업데이트하는 중이에요",
  "Sync now": "지금 동기화",
  "Sync retry is not available yet.": "아직 동기화를 다시 시도할 수 없어요.",
  "Sync retry is unavailable because this vault is local only.": "이 볼트는 로컬 전용이라 동기화를 다시 시도할 수 없어요.",
  "Sync retry is unavailable until access is restored.": "접근 권한이 복구될 때까지 동기화를 다시 시도할 수 없어요.",
  "Syncing these file types requires Team. The Remote Vault view is last known and may be out of date.":
    "이런 종류의 파일을 동기화하려면 Team이 필요해요. 원격 볼트 보기는 마지막으로 확인된 상태라 최신이 아닐 수 있어요.",
  "Syncing these file types requires Team. They remain available to preview locally.":
    "이런 종류의 파일을 동기화하려면 Team이 필요해요. 로컬에서는 계속 미리 볼 수 있어요.",
  "That action could not be completed.": "그 작업을 완료하지 못했어요.",
  "The Remote Vault is unavailable, so this last-known comparison may be out of date.":
    "원격 볼트를 사용할 수 없어서 마지막으로 확인된 이 비교는 최신이 아닐 수 있어요.",
  "The comparison will appear when the supported vault file list is ready.":
    "지원되는 볼트 파일 목록이 준비되면 비교 결과가 나타나요.",
  "The current Remote Vault contents cannot be confirmed": "현재 원격 볼트의 내용을 확인할 수 없어요",
  "The latest note and folder counts do not match yet": "최신 메모와 폴더 개수가 아직 일치하지 않아요",
  "These files can include unsent local edits and deleted-note copies kept by earlier versions. Emptying permanently removes them. Notes still in the vault are untouched.":
    "이 파일에는 보내지 못한 로컬 편집과 이전 버전이 남겨 둔 삭제된 메모의 사본이 들어 있을 수 있어요. 비우면 영구히 제거돼요. 볼트에 있는 메모는 그대로예요.",
  "These {count} files are no longer on the Remote Vault, and this device never confirmed their content there. They may be the only copies. Deleting removes them from this computer.":
    "이 파일 {count}개는 더 이상 원격 볼트에 없고, 이 기기는 그 내용이 원격 볼트에 있다고 확인한 적이 없어요. 유일한 사본일 수 있어요. 삭제하면 이 컴퓨터에서 지워져요.",
  "This app session": "이번 앱 세션",
  "This computer": "이 컴퓨터",
  "This computer and the Remote Vault": "이 컴퓨터와 원격 볼트",
  "This document starts over from the file on disk. The text you have now is kept, but the edit history behind it is discarded on every device, and undo cannot reach past this point.":
    "이 문서는 디스크에 있는 파일에서 다시 시작해요. 지금 있는 텍스트는 그대로 유지되지만, 그 뒤의 편집 기록은 모든 기기에서 삭제되고 되돌리기도 이 시점 이전으로는 갈 수 없어요.",
  "This file is no longer on the Remote Vault, and this device never confirmed its content there. It may be the only copy. Deleting removes it from this computer.":
    "이 파일은 더 이상 원격 볼트에 없고, 이 기기는 그 내용이 원격 볼트에 있다고 확인한 적이 없어요. 유일한 사본일 수 있어요. 삭제하면 이 컴퓨터에서 지워져요.",
  "This folder does not sync": "이 폴더는 동기화되지 않아요",
  "This server requires Team to download files, including previously uploaded files. Review differences for available actions.":
    "이 서버는 이미 업로드한 파일을 포함해 파일을 다운로드하려면 Team이 필요해요. 가능한 작업은 차이점에서 확인하세요.",
  "Unavailable": "사용할 수 없는",
  "Updating": "업데이트하는 중인",
  "Vault files": "볼트 파일",
  "Your copies": "내 사본",
  "Your local files remain available on this computer.": "로컬 파일은 이 컴퓨터에서 그대로 사용할 수 있어요.",
  "{code} is removed from this vault, and from every device that syncs it. A vault checkpoint can bring it back.":
    "{code}이(가) 이 볼트와 이 볼트를 동기화하는 모든 기기에서 제거돼요. 볼트 체크포인트로 되살릴 수 있어요.",
  "{code} starts over from the file on disk. The text you have now is kept, but the edit history behind it is discarded on every device, and undo cannot reach past this point.":
    "{code}은(는) 디스크에 있는 파일에서 다시 시작해요. 지금 있는 텍스트는 그대로 유지되지만, 그 뒤의 편집 기록은 모든 기기에서 삭제되고 되돌리기도 이 시점 이전으로는 갈 수 없어요.",
  "{confirmed} of {total} text notes have confirmed content on the Remote Vault.":
    "텍스트 메모 {total}개 중 {confirmed}개의 내용이 원격 볼트에서 확인됐어요.",
  "{count} checks passed": "검사 {count}개 통과",
  "{count} file is missing from the Remote Vault": "파일 {count}개가 원격 볼트에 없어요",
  "{count} file is missing from this computer": "파일 {count}개가 이 컴퓨터에 없어요",
  "{count} file stays on this computer": "파일 {count}개는 이 컴퓨터에만 있어요",
  "{count} files are missing from the Remote Vault": "파일 {count}개가 원격 볼트에 없어요",
  "{count} files are missing from this computer": "파일 {count}개가 이 컴퓨터에 없어요",
  "{count} files stay on this computer": "파일 {count}개는 이 컴퓨터에만 있어요",
  "{count} finding": "검사 결과 {count}개",
  "{count} findings": "검사 결과 {count}개",
  "{count} folder is missing from the Remote Vault": "폴더 {count}개가 원격 볼트에 없어요",
  "{count} folder is missing from this computer": "폴더 {count}개가 이 컴퓨터에 없어요",
  "{count} folders are missing from the Remote Vault": "폴더 {count}개가 원격 볼트에 없어요",
  "{count} folders are missing from this computer": "폴더 {count}개가 이 컴퓨터에 없어요",
  "{count} item is left alone.": "항목 {count}개는 건드리지 않아요.",
  "{count} items are left alone.": "항목 {count}개는 건드리지 않아요.",
  "{count} notes have restricted access": "접근이 제한된 메모 {count}개",
  "{count} notes with restricted access remain on the server.": "접근이 제한된 메모 {count}개는 서버에 남아 있어요.",
  "{count} text note is missing from the Remote Vault": "텍스트 메모 {count}개가 원격 볼트에 없어요",
  "{count} text note is missing from this computer": "텍스트 메모 {count}개가 이 컴퓨터에 없어요",
  "{count} text notes are missing from the Remote Vault": "텍스트 메모 {count}개가 원격 볼트에 없어요",
  "{count} text notes are missing from this computer": "텍스트 메모 {count}개가 이 컴퓨터에 없어요",
  "{state} Remote Vault view": "{state} 원격 볼트 보기",

  // Inventory groups
  "Delete selected ({count})": "선택 항목 삭제 ({count})",
  "Delete {what} from this computer?": "이 컴퓨터에서 {what}을(를) 삭제할까요?",
  "Download": "다운로드",
  "Download all": "모두 다운로드",
  "Download complete.": "다운로드를 완료했어요.",
  "Download selected ({count})": "선택 항목 다운로드 ({count})",
  "Folders are deleted with everything inside them.": "폴더는 안에 있는 모든 항목과 함께 삭제돼요.",
  "Only on the Remote Vault · {count}": "원격 볼트에만 있음 · {count}",
  "Only on the Remote Vault · {count} (last known view)": "원격 볼트에만 있음 · {count} (마지막으로 확인된 보기)",
  "Only on this computer · {count}": "이 컴퓨터에만 있음 · {count}",
  "Only on this computer · {count} (last known view)": "이 컴퓨터에만 있음 · {count} (마지막으로 확인된 보기)",
  "Remove from server": "서버에서 제거",
  "Remove from server ({count})": "서버에서 제거 ({count})",
  "Remove this file from the server?": "이 파일을 서버에서 제거할까요?",
  "Remove {count} files from the server?": "파일 {count}개를 서버에서 제거할까요?",
  "Select {path}": "{path} 선택",
  "Show": "위치 보기",
  "Show more ({count} remaining)": "더 보기 ({count}개 남음)",
  "These exist only on this computer — the Remote Vault has no copy — so deleting them removes them for good. Save a copy first if you need them.":
    "이 항목들은 이 컴퓨터에만 있고 원격 볼트에는 사본이 없어서, 삭제하면 영구히 사라져요. 필요하다면 먼저 사본을 저장하세요.",
  "These {count} files will be permanently removed from the Remote Vault. Other members lose access and synced devices may remove their copies. This cannot be undone. Save a copy first if you need them.":
    "이 파일 {count}개는 원격 볼트에서 영구히 제거돼요. 다른 멤버는 접근할 수 없게 되고 동기화된 기기에서도 사본이 지워질 수 있어요. 되돌릴 수 없어요. 필요하다면 먼저 사본을 저장하세요.",
  "{code} will be permanently removed from the Remote Vault. Other members lose access and synced devices may remove their copies. This cannot be undone. Save a copy first if you need it.":
    "{code}은(는) 원격 볼트에서 영구히 제거돼요. 다른 멤버는 접근할 수 없게 되고 동기화된 기기에서도 사본이 지워질 수 있어요. 되돌릴 수 없어요. 필요하다면 먼저 사본을 저장하세요.",
  "{count} folder": "폴더 {count}개",
  "{count} folders": "폴더 {count}개",
  "{count} item": "항목 {count}개",
  "{count} items": "항목 {count}개",

  // Needs attention
  "Actions for selected issues": "선택한 문제에 대한 작업",
  "And {count} more.": "그 외 {count}개가 더 있어요.",
  "Contact the owner": "소유자에게 문의",
  "Copy details": "자세히 복사",
  "Delete all local copies": "로컬 사본 모두 삭제",
  "Deleted {ok} of {done}; {failed} failed": "{done}개 중 {ok}개를 삭제했고 {failed}개는 실패했어요",
  "Deleting more than one at a time is not offered here — delete them one by one so each confirm names the note":
    "여러 개를 한 번에 삭제하는 기능은 여기서 제공하지 않아요. 확인 창에 메모 이름이 표시되도록 하나씩 삭제하세요",
  "Error": "오류",
  "Hide this row for this vault on this device — it waits in the Ignored list":
    "이 기기에서 이 볼트의 이 항목을 숨겨요. 무시한 항목 목록에서 다시 볼 수 있어요",
  "Ignore": "무시",
  "Ignore selected": "선택 항목 무시",
  "Ignored · {count}": "무시한 항목 · {count}",
  "Left on disk": "디스크에 남은 항목",
  "No sync errors reported.": "보고된 동기화 오류가 없어요.",
  "Nothing needs attention": "확인이 필요한 항목이 없어요",
  "Re-register all": "모두 다시 등록",
  "Re-registered {ok} of {done}; {failed} failed": "{done}개 중 {ok}개를 다시 등록했고 {failed}개는 실패했어요",
  "Request copied to clipboard. This vault's owner is not known on this device yet.":
    "요청을 클립보드에 복사했어요. 이 기기에서는 아직 이 볼트의 소유자를 알 수 없어요.",
  "Request copied — send it to {name} ({email})": "요청을 복사했어요. {name}({email})님에게 보내세요",
  "Retried {count} note": "메모 {count}개를 다시 시도했어요",
  "Retried {count} notes": "메모 {count}개를 다시 시도했어요",
  "Retried {done} of {total}…": "{total}개 중 {done}개 다시 시도 중…",
  "Retried {ok} of {done}; {failed} failed": "{done}개 중 {ok}개를 다시 시도했고 {failed}개는 실패했어요",
  "Retry": "다시 시도",
  "Retry selected": "선택 항목 다시 시도",
  "Reveal": "위치 보기",
  "Save a copy": "사본 저장",
  "Select all visible": "보이는 항목 모두 선택",
  "Select {title}": "{title} 선택",
  "Select {title} — {path}": "{title} — {path} 선택",
  "Show again": "다시 표시",
  "Sync is off, so there is nothing to report here.": "동기화가 꺼져 있어서 여기에 보고할 내용이 없어요.",
  "Warning": "경고",
  "{count} row is dismissed below.": "항목 {count}개를 아래에서 무시했어요.",
  "{count} rows are dismissed below.": "항목 {count}개를 아래에서 무시했어요.",

  // Integrity checks
  "Checks are not available for this vault.": "이 볼트는 검사를 사용할 수 없어요.",
  "Not run": "실행 안 함",
  "Passed": "통과",
  "Stop showing this check for this vault on this device — it waits in the Ignored list":
    "이 기기에서 이 볼트의 이 검사를 더 이상 표시하지 않아요. 무시한 항목 목록에서 다시 볼 수 있어요",
  "What to do": "해결 방법",
  "and {count} more": "그 외 {count}개",
  "{action} {done} of {total}…": "{action} {done}/{total}…",
  "{action}…": "{action}…",
  "{count} left alone": "{count}개는 건드리지 않음",
  "{count} more are not listed and stay as they are": "{count}개는 목록에 없고 그대로 둬요",
  "{count} or more recovery sets": "복구 세트 {count}개 이상",
  "{count} recovery set": "복구 세트 {count}개",
  "{count} recovery sets": "복구 세트 {count}개",
  "{files} in {sets}.": "{sets}에 {files}가 있어요.",
  "{label}: {count} listed": "{label}: 목록에 {count}개",

  // Inspect a note
  "Check one note": "메모 하나 확인",
  "Copy facts": "정보 복사",
  "Copy {label}": "{label} 복사",
  "Doc id": "문서 ID",
  "Empty here and on the Remote Vault": "여기와 원격 볼트 모두 비어 있어요",
  "Has unsent edits": "보내지 않은 편집 있음",
  "History size": "기록 크기",
  "Looking…": "찾는 중…",
  "Modified": "수정됨",
  "No": "아니요",
  "Not measured": "측정하지 않음",
  "Not on the Remote Vault": "원격 볼트에 없음",
  "Not registered": "등록되지 않음",
  "Nothing reported yet": "아직 보고된 것이 없어요",
  "On Remote Vault": "원격 볼트에 있음",
  "Queued": "대기 중",
  "See its entry above": "위의 항목 보기",
  "Size": "크기",
  "State": "상태",
  "Stopped trying": "시도를 멈췄어요",
  "Syncing": "동기화하는 중",
  "There is no file at this path.": "이 경로에는 파일이 없어요.",
  "Type a note's path or name…": "메모의 경로나 이름을 입력하세요…",
  "Waiting to push": "전송 대기 중",
  "Yes": "예",

  // Largest items and activity
  "Fri": "금",
  "History": "기록",
  "Largest by kind": "종류별 가장 큰 항목",
  "Less": "적음",
  "Mon": "월",
  "More": "많음",
  "No attachments or other files.": "첨부 파일이나 다른 파일이 없어요.",
  "No local edit history yet.": "아직 로컬 편집 기록이 없어요.",
  "No notes yet.": "아직 메모가 없어요.",
  "No per-day activity is available for this vault.": "이 볼트는 일별 활동을 볼 수 없어요.",
  "Note": "메모",
  "Notes edited per day, {range}: {active} active day. {caption}":
    "일별 편집한 메모, {range}: 활동한 날 {active}일. {caption}",
  "Notes edited per day, {range}: {active} active days. {caption}":
    "일별 편집한 메모, {range}: 활동한 날 {active}일. {caption}",
  "Updates": "업데이트",
  "Wed": "수",
  "near the limit": "한도에 가까움",
  "orphan · {id}": "고아 · {id}",
  "over the limit": "한도 초과",
  "{week} note edited in the last 7 days · {month} in 30 days":
    "최근 7일 동안 편집한 메모 {week}개 · 30일 동안 {month}개",
  "{week} notes edited in the last 7 days · {month} in 30 days":
    "최근 7일 동안 편집한 메모 {week}개 · 30일 동안 {month}개",

  // Sync timeline
  "All": "전체",
  "Check {path}": "{path} 확인",
  "Errors": "오류",
  "Filter the timeline": "타임라인 필터",
  "Happened {count} times within a minute": "1분 안에 {count}번 일어났어요",
  "Info": "정보",
  "Nothing at this level.": "이 수준의 항목이 없어요.",
  "Nothing yet this session.": "이번 세션에는 아직 아무것도 없어요.",
  "Show all {count}": "{count}개 모두 보기",
  "Show less": "간단히 보기",
  "Show older": "이전 항목 보기",
  "Warnings": "경고",

  // Housekeeper
  "AI sections": "AI 섹션",
  "Add an AI provider key to scan this vault. Keys stay in this device's keychain.":
    "이 볼트를 검사하려면 AI 제공업체 키를 추가하세요. 키는 이 기기의 키체인에만 저장돼요.",
  "Apply fix": "수정 적용",
  "Applying fix…": "수정을 적용하는 중…",
  "Assistant is currently unavailable.": "어시스턴트를 지금은 사용할 수 없어요.",
  "Check access again": "접근 권한 다시 확인",
  "Check next links": "다음 링크 확인",
  "Checking Team access…": "Team 접근 권한을 확인하는 중…",
  "Close details": "자세히 닫기",
  "Collecting vault evidence…": "볼트 정보를 모으는 중…",
  "Connect a provider": "제공업체 연결",
  "Connect this vault to sync and sign in to use Housekeeper.":
    "Housekeeper를 쓰려면 이 볼트를 동기화에 연결하고 로그인하세요.",
  "Diagnostics": "진단",
  "Find a fix": "수정 방법 찾기",
  "Find recoverable version": "복구할 수 있는 버전 찾기",
  "Find suggested fixes": "수정 제안 찾기",
  "Findings changed. Run the review again for current priorities.":
    "검사 결과가 바뀌었어요. 현재 우선순위를 보려면 검토를 다시 실행하세요.",
  "Fix applied. Local checks could not refresh; scan again to verify.":
    "수정을 적용했어요. 로컬 검사를 새로 고치지 못했으니 다시 검사해서 확인하세요.",
  "Fix applied. Undo is available for 15 minutes if the note stays unchanged.":
    "수정을 적용했어요. 메모가 바뀌지 않으면 15분 동안 되돌릴 수 있어요.",
  "Housekeeper change undone.": "Housekeeper 변경을 되돌렸어요.",
  "Housekeeper could not connect.": "Housekeeper에 연결하지 못했어요.",
  "Housekeeper is not configured on this server. Ask the server administrator to configure OpenRouter.":
    "이 서버에는 Housekeeper가 설정되어 있지 않아요. 서버 관리자에게 OpenRouter 설정을 요청하세요.",
  "Housekeeper is unavailable.": "Housekeeper를 사용할 수 없어요.",
  "Housekeeper requires a Team subscription for this vault.":
    "이 볼트에서 Housekeeper를 쓰려면 Team 구독이 필요해요.",
  "Infinite Brain Assistant": "Infinite Brain 어시스턴트",
  "Inspect finding": "항목 살펴보기",
  "Investigate & prepare fix": "조사하고 수정 준비",
  "Investigating…": "조사하는 중…",
  "Keep your vault tidy. Review every change.": "볼트를 깔끔하게 유지하세요. 모든 변경을 직접 검토하세요.",
  "Last synced version · Up to 4 links per scan.": "마지막으로 동기화된 버전 · 검사 한 번에 링크 최대 4개",
  "No confident repair available. The note may have changed, or no suitable saved version or unambiguous repair exists.":
    "확실한 복구 방법이 없어요. 메모가 바뀌었거나, 알맞은 저장 버전이나 명확한 복구 방법이 없을 수 있어요.",
  "No confident replacement found. The target may not exist yet; inspect the finding or choose another note.":
    "확실한 대체 대상을 찾지 못했어요. 대상이 아직 없을 수 있어요. 항목을 살펴보거나 다른 메모를 선택하세요.",
  "No problems found in the completed checks.": "완료된 검사에서 문제를 찾지 못했어요.",
  "No supported unresolved links found in this synced version. Inspect the finding for local-only changes, embeds or heading links.":
    "동기화된 이 버전에서 지원되는 해결되지 않은 링크를 찾지 못했어요. 로컬 전용 변경, 임베드, 제목 링크는 항목을 살펴보며 확인하세요.",
  "Open details": "자세히 열기",
  "Prepare fix": "수정 준비",
  "Prepare fixes": "수정 준비",
  "Preparing fix…": "수정을 준비하는 중…",
  "Preparing…": "준비하는 중…",
  "Rebuild index": "색인 다시 만들기",
  "Retry affected files": "영향받은 파일 다시 시도",
  "Review access": "접근 권한 검토",
  "Review empty files": "빈 파일 검토",
  "Review link fixes": "링크 수정 검토",
  "Review paths": "경로 검토",
  "Review properties": "속성 검토",
  "Review recovery": "복구 검토",
  "Review storage": "저장 공간 검토",
  "Review the proposed edit to the last synced version.": "마지막으로 동기화된 버전에 대한 편집 제안을 검토하세요.",
  "Scan vault": "볼트 검사",
  "Scanning vault…": "볼트를 검사하는 중…",
  "Set up sync": "동기화 설정",
  "Settings": "설정",
  "Smart diagnostics": "스마트 진단",
  "Suggested changes": "제안된 변경",
  "Suggested target: {path}": "제안된 대상: {path}",
  "The operation failed. Please retry.": "작업에 실패했어요. 다시 시도해 주세요.",
  "TypeSafe Jev is now available in Infinite Brain.":
    "이제 Infinite Brain에서 TypeSafe Jev를 사용할 수 있어요.",
  "Undo fix": "수정 되돌리기",
  "Undoing fix…": "수정을 되돌리는 중…",
  "Undoing…": "되돌리는 중…",
  "Upgrade vault": "볼트 업그레이드",
  "Verifying…": "확인하는 중…",
  "Working…": "작업하는 중…",
  "{count} additional links were outside this scan.": "이번 검사 범위 밖에 링크 {count}개가 더 있어요.",
  "{count} finding · {checked} checks": "검사 결과 {count}개 · 검사 {checked}개",
  "{count} findings · {checked} checks": "검사 결과 {count}개 · 검사 {checked}개",
  "{count} suggested fixes. Apply one, then scan again for the updated note.":
    "수정 제안 {count}개예요. 하나를 적용한 뒤 업데이트된 메모를 다시 검사하세요.",

  // Issue titles and explanations
  "All {notes} are on the Remote Vault": "{notes}가 모두 원격 볼트에 있어요",
  "Connecting…": "연결하는 중…",
  "Couldn't be registered": "등록하지 못했어요",
  "Couldn't upload": "업로드하지 못했어요",
  "Couldn't write this to disk": "디스크에 쓰지 못했어요",
  "Folder couldn't be registered": "폴더를 등록하지 못했어요",
  "Has edits the Remote Vault may not have yet; the next sync pass will send them.":
    "원격 볼트에 아직 없을 수 있는 편집이 있어요. 다음 동기화 때 보내요.",
  "Infinite Brain kept this item on disk because a sync safety check did not pass. {reason}":
    "동기화 안전 검사를 통과하지 못해서 Infinite Brain이 이 항목을 디스크에 그대로 두었어요. {reason}",
  "Infinite Brain stopped trying to sync this note: {reason}":
    "Infinite Brain이 이 메모의 동기화를 더 이상 시도하지 않아요: {reason}",
  "Last confirmed {when}": "마지막 확인 {when}",
  "Left on disk — not on the Remote Vault": "디스크에 남아 있어요 — 원격 볼트에는 없어요",
  "Linked path not synced": "연결된 경로가 동기화되지 않았어요",
  "Local change held for safety": "안전을 위해 보류된 로컬 변경",
  "Many notes were emptied at once from this account, so the Remote Vault paused your sync. Your edits are safe on this device.":
    "이 계정에서 많은 메모가 한꺼번에 비워져서 원격 볼트가 동기화를 일시 중지했어요. 편집 내용은 이 기기에 안전하게 있어요.",
  "New notes and folder changes aren't syncing": "새 메모와 폴더 변경이 동기화되지 않아요",
  "No access to this vault": "이 볼트에 접근할 수 없어요",
  "Not confirmed yet — nothing has reported this note's content as stored on the Remote Vault.":
    "아직 확인되지 않았어요. 이 메모의 내용이 원격 볼트에 저장됐다고 보고한 곳이 없어요.",
  "Not on the Remote Vault yet": "아직 원격 볼트에 없어요",
  "Nothing confirmed yet this session": "이번 세션에서는 아직 확인된 것이 없어요",
  "Offline — {synced} of {notes} are on the Remote Vault": "오프라인 — {notes} 중 {synced}개가 원격 볼트에 있어요",
  "On the Remote Vault; nothing about it has changed since this app launched.":
    "원격 볼트에 있어요. 앱을 실행한 뒤로 바뀐 것은 없어요.",
  "Plan limit reached": "플랜 한도에 도달했어요",
  "Read-only sync needs review": "읽기 전용 동기화를 검토해야 해요",
  "Removed on disk, being restored": "디스크에서 삭제돼서 복원하는 중이에요",
  "Removing local copies you can no longer access.": "더 이상 접근할 수 없는 로컬 사본을 제거하는 중이에요.",
  "Showing the first {shown} of {total} unregistered notes.":
    "등록되지 않은 메모 {total}개 중 처음 {shown}개를 표시하고 있어요.",
  "Signed out — nothing is syncing": "로그아웃됨 — 동기화되는 항목이 없어요",
  "Sync is off for this folder": "이 폴더는 동기화가 꺼져 있어요",
  "Sync paused": "동기화 일시 중지",
  "Synced — the Remote Vault confirmed this note's content.": "동기화됨 — 원격 볼트가 이 메모의 내용을 확인했어요.",
  "Syncing resumes on its own when the connection comes back.": "연결이 돌아오면 동기화가 저절로 이어져요.",
  "Syncing — {of} updates": "동기화하는 중 — 업데이트 {of}개",
  "Teammates see these notes as empty until their content arrives. Keep {brand} open until this reaches zero":
    "내용이 도착하기 전까지 팀원에게는 이 메모들이 비어 있는 것으로 보여요. 남은 수가 0이 될 때까지 {brand}을(를) 열어 두세요",
  "The Remote Vault does not know this note yet.": "원격 볼트가 아직 이 메모를 몰라요.",
  "The Remote Vault has no record for this folder, so nothing under it can sync. {reason}":
    "원격 볼트에 이 폴더의 기록이 없어서 안에 있는 항목을 동기화할 수 없어요. {reason}",
  "The Remote Vault has no record for this note, so nothing under it can sync. {reason}":
    "원격 볼트에 이 메모의 기록이 없어서 동기화할 수 없어요. {reason}",
  "The Remote Vault has this note, but it could not be written into your vault folder. {reason}":
    "원격 볼트에는 이 메모가 있지만, 내 볼트 폴더에 쓰지 못했어요. {reason}",
  "The Remote Vault refused a sync token for this vault, so nothing is uploading or downloading. Ask the vault's owner to share it with you again.":
    "원격 볼트가 이 볼트의 동기화 토큰을 거부해서 업로드도 다운로드도 되지 않아요. 볼트 소유자에게 다시 공유해 달라고 요청하세요.",
  "The Remote Vault refused a sync token, so nothing is moving in either direction. Ask the vault's owner to share it with you again.":
    "원격 볼트가 동기화 토큰을 거부해서 어느 방향으로도 전송되지 않아요. 볼트 소유자에게 다시 공유해 달라고 요청하세요.",
  "The Remote Vault refused this note as read-only. Check again to verify whether its current local and remote text already match.":
    "원격 볼트가 이 메모를 읽기 전용으로 거부했어요. 다시 확인해서 현재 로컬 텍스트와 원격 텍스트가 이미 같은지 살펴보세요.",
  "The Remote Vault refused this note as read-only. Infinite Brain kept a recovery copy before restoring the Remote Vault's version.":
    "원격 볼트가 이 메모를 읽기 전용으로 거부했어요. Infinite Brain이 원격 볼트의 버전으로 복원하기 전에 복구용 사본을 남겨 두었어요.",
  "The Remote Vault refused this note as too large: {reason}":
    "원격 볼트가 이 메모를 너무 크다는 이유로 거부했어요: {reason}",
  "The Remote Vault stopped this sync run at a plan limit. Upgrade to continue.":
    "원격 볼트가 플랜 한도에서 이번 동기화를 멈췄어요. 계속하려면 업그레이드하세요.",
  "The app can't load the vault's file list (last error: {reason}). Edits to existing notes still sync.":
    "앱이 볼트의 파일 목록을 불러오지 못해요(마지막 오류: {reason}). 기존 메모의 편집은 계속 동기화돼요.",
  "These paths are symbolic links. Infinite Brain does not sync through links.":
    "이 경로들은 심볼릭 링크예요. Infinite Brain은 링크를 통해서는 동기화하지 않아요.",
  "This account has as many vaults as the free plan allows, so the Remote Vault refused to create more. Upgrade to keep syncing.":
    "이 계정은 무료 플랜에서 허용하는 만큼 볼트를 이미 가지고 있어서 원격 볼트가 더 만들기를 거부했어요. 계속 동기화하려면 업그레이드하세요.",
  "This folder does not sync, so this note lives on this device only.":
    "이 폴더는 동기화되지 않아서 이 메모는 이 기기에만 있어요.",
  "This note exists only on this device: the Remote Vault has no record for it, and nothing has reported a failure. A sync run should pick it up.":
    "이 메모는 이 기기에만 있어요. 원격 볼트에 기록이 없지만 실패가 보고된 것도 없어요. 동기화를 실행하면 처리될 거예요.",
  "This note is {size}; the Remote Vault accepts up to {cap} MB. It has to get smaller before it can sync.":
    "이 메모는 {size}예요. 원격 볼트는 {cap} MB까지만 받아요. 동기화하려면 크기를 줄여야 해요.",
  "This note was removed from the vault folder together with many others at once.":
    "이 메모는 다른 많은 메모와 함께 볼트 폴더에서 한꺼번에 삭제됐어요.",
  "This note's content did not reach the Remote Vault. {reason} Its only copy is on this device.":
    "이 메모의 내용이 원격 볼트에 전달되지 않았어요. {reason} 유일한 사본이 이 기기에 있어요.",
  "This note's edit history is {size}; the Remote Vault accepts up to {cap} MB per note. The note's own text is not the problem.":
    "이 메모의 편집 기록은 {size}예요. 원격 볼트는 메모 하나에 {cap} MB까지만 받아요. 메모 텍스트 자체가 문제는 아니에요.",
  "This vault has as many members as the free plan allows, so the Remote Vault refused. Upgrade to add more.":
    "이 볼트는 무료 플랜에서 허용하는 만큼 멤버가 이미 있어서 원격 볼트가 거부했어요. 더 추가하려면 업그레이드하세요.",
  "This vault is empty": "이 볼트는 비어 있어요",
  "This vault reached its sync limit for notes. Upgrade to Team to sync more. Existing notes keep syncing; additional notes stay on this device.":
    "이 볼트가 메모 동기화 한도에 도달했어요. 더 동기화하려면 Team으로 업그레이드하세요. 기존 메모는 계속 동기화되고, 추가 메모는 이 기기에만 남아요.",
  "This vault syncs with {server}. Sign in to resume. Your edits are safe on disk in the meantime.":
    "이 볼트는 {server}와(과) 동기화해요. 다시 시작하려면 로그인하세요. 그동안 편집 내용은 디스크에 안전하게 있어요.",
  "This vault's top level is locked, so these stay on this computer until they are in a folder.":
    "이 볼트의 최상위는 잠겨 있어서, 폴더 안으로 옮기기 전까지는 이 컴퓨터에만 남아요.",
  "Two notes share one file on disk": "메모 두 개가 디스크에서 파일 하나를 함께 써요",
  "Updating access — {count} remaining": "접근 권한을 업데이트하는 중 — {count}개 남음",
  "Uploading — {notes} not uploaded yet": "업로드하는 중 — {notes}가 아직 업로드되지 않았어요",
  "Waiting to be pushed — it is in the queue for the next sync pass.":
    "전송을 기다리는 중이에요. 다음 동기화 때 보낼 대기열에 있어요.",
  "You don't have permission to add notes {where}, so these stay on this computer. Edits to notes that already exist still sync.":
    "{where} 메모를 추가할 권한이 없어서 이 항목들은 이 컴퓨터에만 남아요. 이미 있는 메모의 편집은 계속 동기화돼요.",
  "You no longer have access to this vault": "더 이상 이 볼트에 접근할 수 없어요",
  "at the top of this vault": "이 볼트의 최상위에",
  "in {folder}": "{folder}에",
  "its Remote Vault": "원격 볼트",
  "{count} linked path is ignored by sync": "동기화에서 제외된 연결 경로 {count}개",
  "{count} linked paths are ignored by sync": "동기화에서 제외된 연결 경로 {count}개",
  "{count} new item": "새 항목 {count}개",
  "{count} new items": "새 항목 {count}개",
  "{count} new note": "새 메모 {count}개",
  "{count} new notes": "새 메모 {count}개",
  "{count} note is not on the Remote Vault": "메모 {count}개가 원격 볼트에 없어요",
  "{count} notes are not on the Remote Vault": "메모 {count}개가 원격 볼트에 없어요",
  "{count} notes were emptied at once from this account, so the Remote Vault paused your sync. Your edits are safe on this device.":
    "이 계정에서 메모 {count}개가 한꺼번에 비워져서 원격 볼트가 동기화를 일시 중지했어요. 편집 내용은 이 기기에 안전하게 있어요.",
  "{count} thing needs you": "확인이 필요한 항목 {count}개",
  "{count} things need you": "확인이 필요한 항목 {count}개",
  "{notes} live here on this device only. Turn on sync to reach your other devices and your team.":
    "{notes}가 이 기기에만 있어요. 다른 기기와 팀에 전달하려면 동기화를 켜세요.",
  "{notes} not on the Remote Vault — {errors} need you":
    "{notes}가 원격 볼트에 없어요 — {errors}개는 확인이 필요해요",
  "{paths} are the same file on disk, usually through a symbolic link.":
    "{paths}은(는) 디스크에서 같은 파일이에요. 보통 심볼릭 링크 때문이에요.",
  "{reason} It was kept here rather than removed, because this device may hold the only copy. Open it to check, then delete it if you don't need it.":
    "{reason} 이 기기에 유일한 사본이 있을 수 있어서 삭제하지 않고 여기에 남겨 두었어요. 열어서 확인한 뒤 필요 없으면 삭제하세요.",
  "{synced} of {notes} are confirmed so far": "지금까지 {notes} 중 {synced}개를 확인했어요",
  "{title} — see Needs attention above for what to do.": "{title} — 해야 할 일은 위의 ‘확인이 필요해요’를 보세요.",
  "{what} not syncing: no permission to add notes {where}":
    "{what}이(가) 동기화되지 않아요: {where} 메모를 추가할 권한이 없어요",
  "{what} not syncing: notes can't be added at the top of this vault":
    "{what}이(가) 동기화되지 않아요: 이 볼트의 최상위에는 메모를 추가할 수 없어요",

  // Check actions
  "Cancelled — nothing changed": "취소했어요. 바뀐 것은 없어요",
  "Nothing to reclaim": "정리할 항목이 없어요",
  "`{name}` is taken — rename it yourself": "`{name}`은(는) 이미 있어요. 직접 이름을 바꾸세요",
  "in {dir}": "{dir}에",
  "no doc id": "문서 ID 없음",
  "no edit history is recorded for this file, so there is nothing to reset":
    "이 파일에는 기록된 편집 기록이 없어서 초기화할 것이 없어요",
  "nothing legal to rename it to": "바꿀 수 있는 올바른 이름이 없어요",
  "the offending name is a folder, or nothing legal is left of it — rename it yourself":
    "문제가 되는 이름이 폴더이거나 올바른 부분이 남지 않아요. 직접 이름을 바꾸세요",
  "this is a folder — rename it in the sidebar": "폴더예요. 사이드바에서 이름을 바꾸세요",
  "{count} failed": "{count}개 실패",
  "{label} failed": "{label} 실패",
  "{size} freed": "{size} 확보",
  "{verb} {count}": "{verb} {count}개",
  "{verb} {done} of {total}": "{verb} {done}/{total}",

  // Row sentences and group titles
  "History kept for notes this vault no longer has": "이 볼트에 더 이상 없는 메모의 기록이 남아 있어요",
  "Leftover edit history": "남은 편집 기록",
  "Linked paths ignored by sync": "동기화에서 제외된 연결 경로",
  "Many notes were emptied at once, so sync is paused for a while": "많은 메모가 한꺼번에 비워져서 동기화를 잠시 멈췄어요",
  "You don't have access to this vault": "이 볼트에 접근할 수 없어요",
  "Your plan's limit stopped new notes from syncing": "플랜 한도 때문에 새 메모가 동기화되지 않아요",
  "{count} edit blocked by read-only access": "읽기 전용 접근으로 막힌 편집 {count}개",
  "{count} edits blocked by read-only access": "읽기 전용 접근으로 막힌 편집 {count}개",
  "{count} file shared by more than one note": "여러 메모가 함께 쓰는 파일 {count}개",
  "{count} files shared by more than one note": "여러 메모가 함께 쓰는 파일 {count}개",
  "{count} item couldn't be added to the Remote Vault": "원격 볼트에 추가하지 못한 항목 {count}개",
  "{count} items couldn't be added to the Remote Vault": "원격 볼트에 추가하지 못한 항목 {count}개",
  "{count} local change held for safety": "안전을 위해 보류된 로컬 변경 {count}개",
  "{count} local changes held for safety": "안전을 위해 보류된 로컬 변경 {count}개",
  "{count} note couldn't be written to this computer": "이 컴퓨터에 쓰지 못한 메모 {count}개",
  "{count} note couldn't upload": "업로드하지 못한 메모 {count}개",
  "{count} note isn't registered": "등록되지 않은 메모 {count}개",
  "{count} note left on disk": "디스크에 남은 메모 {count}개",
  "{count} note too large to sync": "너무 커서 동기화할 수 없는 메모 {count}개",
  "{count} notes aren't registered": "등록되지 않은 메모 {count}개",
  "{count} notes couldn't be written to this computer": "이 컴퓨터에 쓰지 못한 메모 {count}개",
  "{count} notes couldn't upload": "업로드하지 못한 메모 {count}개",
  "{count} notes left on disk": "디스크에 남은 메모 {count}개",
  "{count} notes too large to sync": "너무 커서 동기화할 수 없는 메모 {count}개",

  // Labels and dates
  "Connecting": "연결하는 중",
  "Couldn't write": "쓰지 못했어요",
  "Healthy": "정상",
  "Leftover history": "남은 기록",
  "Linked path": "연결된 경로",
  "Not uploaded yet": "아직 업로드 안 됨",
  "Plan limit": "플랜 한도",
  "Read-only edit": "읽기 전용 편집",
  "Safety check": "안전 검사",
  "Shared file": "공유된 파일",
  "Signed out": "로그아웃됨",
  "Today": "오늘",
  "Too large": "너무 큼",
  "Upload failed": "업로드 실패",
  "Yesterday": "어제",
  "{day} {month}": "{month} {day}일",
  "{time}, {day} {month} {year}": "{year}년 {month} {day}일 {time}",
  "{weekday} {day} {month}": "{month} {day}일 ({weekday})",

  // Activity range
  "{from} – {to}": "{from} – {to}",
  "{month} {year}": "{year}년 {month}",

  // Health actions
  "No vault is open.": "열려 있는 볼트가 없어요.",
  "Saved a copy to {dest}": "{dest}에 사본을 저장했어요",
  "This note couldn't be registered: the vault isn't reconciled with the Remote Vault yet. Try again once the connection is back.":
    "이 메모를 등록하지 못했어요. 볼트가 아직 원격 볼트와 대조되지 않았어요. 연결이 돌아오면 다시 시도하세요.",

  // Check definitions (checks.ts) and shared words
  "![[embeds]] and ![](images) whose file is not in the vault.": "볼트에 파일이 없는 ![[임베드]]와 ![](이미지)예요.",
  "A [[wikilink]] to that title is ambiguous, so it may open a different note than you meant.":
    "그 제목으로 연결한 [[위키링크]]는 어느 메모인지 모호해서, 의도와 다른 메모가 열릴 수 있어요.",
  "A file the index never saw is invisible to search and is not synced — usually one that was copied in while Infinite Brain was not running.":
    "색인이 한 번도 보지 못한 파일은 검색에 나타나지 않고 동기화되지도 않아요. 보통 Infinite Brain이 꺼져 있을 때 복사해 넣은 파일이에요.",
  "A note that starts with --- but the properties block never closes, or holds lines that are not key: value.":
    "---로 시작하는데 속성 블록이 닫히지 않았거나, 키: 값 형식이 아닌 줄이 들어 있는 메모예요.",
  "A note this size cannot be uploaded, so its only copy is on this device. Large notes are almost always pasted images or data tables.":
    "이 크기의 메모는 업로드할 수 없어서 유일한 사본이 이 기기에 있어요. 큰 메모는 거의 항상 붙여 넣은 이미지나 데이터 표 때문이에요.",
  "A teammate on Windows cannot create these files, so their vault silently misses them.":
    "Windows를 쓰는 팀원은 이 파일을 만들 수 없어서, 팀원의 볼트에는 아무 알림 없이 빠져요.",
  "A wikilink that used the old name needs updating afterwards.": "이전 이름을 쓰던 위키링크는 나중에 직접 고쳐야 해요.",
  "An empty note syncs fine, but a note that used to have text and is now empty usually means a save that never landed or a file another app truncated.":
    "빈 메모도 동기화는 잘 되지만, 예전에는 내용이 있었는데 지금은 비어 있다면 저장이 반영되지 않았거나 다른 앱이 파일을 잘라낸 경우가 많아요.",
  "Apr": "4월",
  "Aug": "8월",
  "Broken properties block": "깨진 속성 블록",
  "Clicking one creates a new empty note instead of opening what you meant.":
    "링크를 누르면 의도한 메모가 열리지 않고 빈 새 메모가 만들어져요.",
  "Dec": "12월",
  "Delete notes you never filled in — Delete all clears every one listed here at once.":
    "채운 적 없는 메모는 삭제하세요. 모두 삭제를 누르면 여기에 나열된 메모를 한 번에 지워요.",
  "Delete {n} {check}?": "{check} {n}개를 삭제할까요?",
  "Deleting": "삭제하는 중",
  "Drop the file back into the note, or remove the embed.": "파일을 메모에 다시 넣거나 임베드를 지우세요.",
  "Each note starts over from the file on disk. The text you have now is kept, but the edit history behind it is discarded on every device, and undo cannot reach past this point.":
    "각 메모는 디스크에 있는 파일에서 다시 시작해요. 지금 있는 텍스트는 그대로 유지되지만, 그 뒤의 편집 기록은 모든 기기에서 삭제되고 되돌리기도 이 시점 이전으로는 갈 수 없어요.",
  "Each offending character becomes `-`, a trailing dot or space is dropped, and a name Windows reserves gets a leading `_`. The file keeps its identity, its history and its place, so this is a rename and not a new note — but a [[wikilink]] that used the old name will need updating. Folders are left alone.":
    "문제가 되는 문자는 `-`로 바뀌고, 끝에 붙은 점이나 공백은 지워지며, Windows 예약어는 앞에 `_`가 붙어요. 파일의 정체성과 기록, 위치는 그대로라서 새 메모가 아니라 이름 변경이에요. 다만 이전 이름을 쓰던 [[위키링크]]는 직접 고쳐야 해요. 폴더는 건드리지 않아요.",
  "Edit history for notes this vault no longer has.": "이 볼트에 더 이상 없는 메모의 편집 기록이에요.",
  "Empty notes": "빈 메모",
  "Emptying": "비우는 중",
  "Feb": "2월",
  "File": "파일",
  "Folders are left to you — renaming one moves everything inside it.":
    "폴더는 직접 처리해야 해요. 폴더 이름을 바꾸면 안에 있는 모든 항목이 함께 이동해요.",
  "Give one of them a more specific title, or link by path.":
    "그중 하나에 더 구체적인 제목을 지어 주거나, 경로로 연결하세요.",
  "Heal does that for every note listed here in one pass.":
    "자동 복구를 누르면 여기에 나열된 모든 메모에 대해 한 번에 처리해요.",
  "Heal rebuilds the index so these files become notes.": "자동 복구는 색인을 다시 만들어서 이 파일들이 메모가 되게 해요.",
  "Heal rebuilds the index — it reads every note again and takes a few seconds.":
    "자동 복구는 색인을 다시 만들어요. 모든 메모를 다시 읽어서 몇 초 걸려요.",
  "Heal reclaims it. Nothing you can see changes.": "자동 복구가 정리해요. 눈에 보이는 것은 바뀌지 않아요.",
  "Heal renames every FILE listed here to the same name without the offending character (it becomes `-`, a trailing dot or space is dropped, and a reserved Windows name gets a leading `_`). The note keeps its identity and its history.":
    "자동 복구는 여기에 나열된 모든 파일의 이름에서 문제가 되는 문자를 없앤 이름으로 바꿔요. 문제 문자는 `-`로 바뀌고, 끝의 점이나 공백은 지워지며, Windows 예약어는 앞에 `_`가 붙어요. 메모의 정체성과 기록은 그대로예요.",
  "History this large slows opening and syncing the note and can push it over the Remote Vault's limit even when the text is small.":
    "기록이 이만큼 크면 메모를 열고 동기화하는 속도가 느려지고, 텍스트가 작아도 원격 볼트의 한도를 넘을 수 있어요.",
  "If it is not really a note (an image or export with a .md name), move it out of the vault or rename it.":
    "실제로는 메모가 아니라면(이름만 .md인 이미지나 내보낸 파일 등) 볼트 밖으로 옮기거나 이름을 바꾸세요.",
  "If the link is intentional, create the note yourself with the name and location you want.":
    "의도한 링크라면 원하는 이름과 위치로 직접 메모를 만드세요.",
  "Infinite Brain cannot heal this one: the bytes are not in the vault, so there is nothing to point the embed at.":
    "Infinite Brain이 이 항목은 자동으로 고칠 수 없어요. 파일 데이터가 볼트에 없어서 임베드가 가리킬 대상이 없어요.",
  "Infinite Brain cannot open, index or sync a note it cannot read as text. These files are skipped silently everywhere else, so this is the only place you will see them.":
    "Infinite Brain은 텍스트로 읽을 수 없는 메모를 열거나 색인하거나 동기화할 수 없어요. 다른 곳에서는 이런 파일을 알림 없이 건너뛰기 때문에, 여기에서만 확인할 수 있어요.",
  "Infinite Brain will not pick for you: only you know which of the two names is the right one, and renaming the wrong one moves the note your links point at.":
    "Infinite Brain은 대신 고르지 않아요. 두 이름 중 어느 쪽이 맞는지는 직접 판단해야 하고, 잘못된 쪽의 이름을 바꾸면 링크가 가리키던 메모가 옮겨져요.",
  "Infinite Brain will not repair this for you: properties it cannot read are never rewritten, because a guess at what you meant would silently change your data.":
    "Infinite Brain은 이 문제를 대신 고치지 않아요. 읽을 수 없는 속성은 절대 다시 쓰지 않아요. 의도를 추측해서 고치면 데이터가 조용히 바뀔 수 있기 때문이에요.",
  "Infinite Brain will not shorten it for you — a name truncated by a machine stops saying what the note is.":
    "Infinite Brain은 이름을 대신 줄이지 않아요. 기계가 잘라낸 이름은 더 이상 어떤 메모인지 알려 주지 못해요.",
  "It only takes up space. Nothing you can see depends on it.":
    "공간만 차지해요. 눈에 보이는 것 중에 이것에 의존하는 것은 없어요.",
  "Jan": "1월",
  "Jul": "7월",
  "Jun": "6월",
  "Keep one property per line as key: value.": "속성은 한 줄에 하나씩 키: 값 형식으로 쓰세요.",
  "Links": "링크",
  "Links to missing notes": "없는 메모로 가는 링크",
  "Mar": "3월",
  "Markdown files on disk that have no entry in the index.": "디스크에는 있지만 색인에 항목이 없는 Markdown 파일이에요.",
  "Markdown not picked up": "인식되지 않은 Markdown",
  "May": "5월",
  "Missing images and attachments": "없는 이미지와 첨부 파일",
  "Move big images and files into attachments and link to them.":
    "큰 이미지와 파일은 첨부 파일로 옮기고 링크로 연결하세요.",
  "Names & paths": "이름과 경로",
  "Names Windows cannot use": "Windows에서 쓸 수 없는 이름",
  "Names containing < > : \" | ? *, ending in a dot or a space, or reserved words such as CON or NUL.":
    "< > : \" | ? * 가 들어 있거나, 점이나 공백으로 끝나거나, CON·NUL 같은 예약어인 이름이에요.",
  "Names that differ only by case": "대소문자만 다른 이름",
  "Note files that are not valid text (not UTF-8, or binary).":
    "올바른 텍스트가 아닌 메모 파일이에요(UTF-8이 아니거나 바이너리).",
  "Notes at or above 10 MB, the most the Remote Vault accepts for one note.":
    "10 MB 이상인 메모예요. 원격 볼트는 메모 하나에 10 MB까지만 받아요.",
  "Notes over the size limit": "크기 제한을 넘은 메모",
  "Notes that changed on disk after they were last indexed, or whose file is gone.":
    "마지막 색인 이후 디스크에서 바뀌었거나 파일이 사라진 메모예요.",
  "Notes whose file is 0 bytes.": "파일 크기가 0바이트인 메모예요.",
  "Notes whose local edit history is many times the size of the note itself.":
    "로컬 편집 기록이 메모 자체보다 몇 배나 큰 메모예요.",
  "Notes with heavy edit history": "편집 기록이 큰 메모",
  "Notes with the same title": "제목이 같은 메모",
  "Nothing here is broken, so Infinite Brain changes no titles on its own: which of the two should be renamed is yours to say.":
    "문제가 있는 것은 아니라서 Infinite Brain은 제목을 마음대로 바꾸지 않아요. 둘 중 어느 쪽 이름을 바꿀지는 직접 정하세요.",
  "Nov": "11월",
  "Oct": "10월",
  "On a Mac or Windows these are ONE file; on the Remote Vault and on Linux they are two. That mismatch is the single most common cause of a note that keeps re-syncing forever.":
    "Mac이나 Windows에서는 이 둘이 하나의 파일이지만, 원격 볼트와 Linux에서는 별개의 파일 두 개예요. 이 불일치가 메모가 끝없이 다시 동기화되는 가장 흔한 원인이에요.",
  "Open the file in a text editor and save it as UTF-8.": "텍스트 편집기에서 파일을 열고 UTF-8로 저장하세요.",
  "Open the note and close the block with a line containing only ---.":
    "메모를 열고 ---만 있는 줄로 블록을 닫으세요.",
  "Open the note — if it should have content, restore it from Versioning.":
    "메모를 열어 보세요. 내용이 있어야 한다면 버전 기록에서 복원하세요.",
  "Open the source note and fix the link if it is a typo.": "원본 메모를 열고 오타라면 링크를 고치세요.",
  "Opened": "열림",
  "Opening": "여는 중",
  "PDFs, images and other files need Team to sync. Notes and folders sync on every plan.":
    "PDF, 이미지 같은 파일을 동기화하려면 Team이 필요해요. 메모와 폴더는 모든 플랜에서 동기화돼요.",
  "Paths longer than 200 characters from the vault root.": "볼트 루트부터 200자를 넘는 경로예요.",
  "Properties Infinite Brain cannot read are shown as plain text and never touched, so nothing is lost — but tags and dates in that block will not be found by search or filters.":
    "Infinite Brain이 읽을 수 없는 속성은 일반 텍스트로 표시되고 수정되지 않아서 잃는 것은 없어요. 다만 그 블록의 태그와 날짜는 검색이나 필터로 찾을 수 없어요.",
  "Rebuilding": "다시 만드는 중",
  "Rebuilt": "다시 만들어짐",
  "Reclaim": "정리",
  "Reclaimed": "정리됨",
  "Reclaiming": "정리하는 중",
  "Recovery copies": "복구용 사본",
  "Removed": "제거됨",
  "Rename one of the pair so the names differ by more than case.":
    "둘 중 하나의 이름을 바꿔서 대소문자 말고도 다르게 만드세요.",
  "Rename them": "이름 바꾸기",
  "Rename to legal names": "사용 가능한 이름으로 바꾸기",
  "Rename {n} files?": "파일 {n}개의 이름을 바꿀까요?",
  "Renamed": "이름 변경됨",
  "Renaming": "이름을 바꾸는 중",
  "Reset the history of {n} notes?": "메모 {n}개의 기록을 초기화할까요?",
  "Reset the note's history — it keeps the text and starts a fresh history on every device.":
    "메모의 기록을 초기화하세요. 텍스트는 유지되고 모든 기기에서 기록이 새로 시작돼요.",
  "Resetting": "초기화하는 중",
  "Revealed": "위치 표시됨",
  "Revealing": "위치를 여는 중",
  "Review the copies, then empty them when you are sure you no longer need them.":
    "사본을 살펴보고, 더 이상 필요 없다고 확신하면 비우세요.",
  "Sat": "토",
  "Save copies": "사본 저장",
  "Save copies puts all of them in one folder outside the vault before you delete them.":
    "사본 저장은 삭제하기 전에 모든 파일을 볼트 밖의 폴더 하나에 모아 저장해요.",
  "Saved": "저장됨",
  "Saving": "저장하는 중",
  "Search index out of date": "검색 색인이 오래됐어요",
  "Search, tags, backlinks and the graph read the index, so a stale row means results that miss recent edits or point at a file that no longer exists.":
    "검색, 태그, 백링크, 그래프는 색인을 읽어요. 오래된 항목이 있으면 최근 편집이 빠지거나 이미 없는 파일을 가리키는 결과가 나올 수 있어요.",
  "Sep": "9월",
  "Shorten the folder or file name.": "폴더나 파일 이름을 줄이세요.",
  "Split the note, or save a copy outside the vault and shorten it — Save copies puts all of them in one folder in a single step.":
    "메모를 나누거나, 볼트 밖에 사본을 저장한 뒤 내용을 줄이세요. 사본 저장은 모든 파일을 한 번에 폴더 하나에 모아 저장해요.",
  "Storage": "저장 공간",
  "Sun": "일",
  "Sync now then registers them with the Remote Vault.": "그다음 지금 동기화를 누르면 원격 볼트에 등록돼요.",
  "The note shows a broken image. Usually the file was never copied in, or was deleted from attachments while a note still used it.":
    "메모에 깨진 이미지가 표시돼요. 보통 파일을 복사해 넣지 않았거나, 메모가 아직 쓰고 있는데 첨부 파일에서 삭제된 경우예요.",
  "These files can include local edits that could not be synced and deleted-note copies kept by earlier versions. Emptying permanently deletes them. Notes still in the vault are untouched.":
    "이 파일에는 동기화하지 못한 로컬 편집과 이전 버전이 남겨 둔 삭제된 메모의 사본이 들어 있을 수 있어요. 비우면 영구히 삭제돼요. 볼트에 있는 메모는 그대로예요.",
  "They are removed from this vault and from every device that syncs it — the same delete the sidebar makes. A vault checkpoint can bring them back.":
    "이 볼트와 이 볼트를 동기화하는 모든 기기에서 제거돼요. 사이드바의 삭제와 같아요. 볼트 체크포인트로 되살릴 수 있어요.",
  "They may contain changes that could not be synced, and they take up space until emptied.":
    "동기화하지 못한 변경이 들어 있을 수 있고, 비우기 전까지 공간을 차지해요.",
  "Thu": "목",
  "Tue": "화",
  "Two or more notes sharing one title.": "하나의 제목을 함께 쓰는 메모가 둘 이상 있어요.",
  "Two paths that are the same once you ignore upper and lower case.": "대소문자를 무시하면 같아지는 경로 두 개예요.",
  "Unreadable notes": "읽을 수 없는 메모",
  "Unsent local edits Infinite Brain preserved, plus deleted-note copies kept by earlier versions.":
    "Infinite Brain이 보존한 보내지 못한 로컬 편집과, 이전 버전이 남겨 둔 삭제된 메모의 사본이에요.",
  "Very long paths": "매우 긴 경로",
  "Windows and some backup tools refuse paths past 260 characters in total.":
    "Windows와 일부 백업 도구는 전체 길이가 260자를 넘는 경로를 받지 않아요.",
  "[[wikilinks]] that point at no note in the vault.": "볼트의 어떤 메모도 가리키지 않는 [[위키링크]]예요.",
  "error": "오류",
  "info": "정보",
  "warning": "경고",
};
