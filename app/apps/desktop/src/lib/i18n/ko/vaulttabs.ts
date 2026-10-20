// SPDX-License-Identifier: Apache-2.0
// Korean strings: vaulttabs screens.
export const vaultTabs: Record<string, string> = {
  // Security history
  "Security history": "보안 기록",
  "See who changed access to this vault and when.": "누가 언제 이 볼트의 접근 권한을 바꿨는지 볼 수 있어요.",
  "No security changes yet.": "아직 보안 변경이 없어요.",
  "Couldn't load security history. Check your connection and try again.":
    "보안 기록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
  "Unknown": "알 수 없음",
  "Completed": "완료됨",
  "Declined": "거절됨",
  "Couldn't complete": "완료하지 못했어요",
  "Show older changes": "이전 변경 더 보기",
  "Sharing changed": "공유가 바뀌었어요",
  "Vault members changed": "볼트 멤버가 바뀌었어요",
  "Invitation changed": "초대가 바뀌었어요",
  "Public link changed": "공개 링크가 바뀌었어요",
  "AI connection changed": "AI 연결이 바뀌었어요",
  "Join code changed": "참여 코드가 바뀌었어요",
  "Access settings changed": "접근 권한 설정이 바뀌었어요",
  "Access change declined": "접근 권한 변경이 거절되었어요",
  "Vault access changed": "볼트 접근 권한이 바뀌었어요",

  // External sharing
  "External sharing": "외부 공유",
  "Choose how this vault can be shared with people outside your team.":
    "이 볼트를 팀 밖의 사람과 어떻게 공유할 수 있을지 선택하세요.",
  "Sharing": "공유",
  "Allow": "허용",
  "Only allowed email domains": "허용한 이메일 도메인만",
  "Do not allow": "허용 안 함",
  "Allowed email domains": "허용한 이메일 도메인",
  "Public links stop opening. Existing guests keep their shared items until you remove their access.":
    "공개 링크가 더 이상 열리지 않아요. 기존 게스트는 접근 권한을 제거하기 전까지 공유된 항목을 계속 볼 수 있어요.",
  "Guests must use a verified email from an allowed domain. On servers without email, use a verified Google account.":
    "게스트는 허용한 도메인의 인증된 이메일을 사용해야 해요. 이메일을 쓸 수 없는 서버에서는 인증된 Google 계정을 사용하세요.",
  "Save sharing settings": "공유 설정 저장",
  "Sharing settings saved.": "공유 설정을 저장했어요.",
  "Couldn't load sharing settings. Reopen this page to try again.":
    "공유 설정을 불러오지 못했어요. 이 페이지를 다시 열어 다시 시도해 주세요.",
  "Couldn't save. Check the email domains and your connection, then try again.":
    "저장하지 못했어요. 이메일 도메인과 연결을 확인하고 다시 시도해 주세요.",

  // Remove all external access
  "Remove all external access": "외부 접근 권한 모두 제거",
  "Remove every guest, pending guest invitation, public link, and guest AI connection from this vault.":
    "이 볼트의 모든 게스트, 대기 중인 게스트 초대, 공개 링크, 게스트 AI 연결을 제거해요.",
  "Review external access": "외부 접근 권한 검토",
  "Confirm removal": "제거 확인",
  "{guests} guests · {invitations} invitations · {publicLinks} public links · {aiConnections} AI connections":
    "게스트 {guests}명 · 초대 {invitations}개 · 공개 링크 {publicLinks}개 · AI 연결 {aiConnections}개",
  "Already downloaded content cannot be taken back. Download links already issued may stay open for up to 5 minutes.":
    "이미 다운로드된 내용은 되돌릴 수 없어요. 이미 발급된 다운로드 링크는 최대 5분 동안 열려 있을 수 있어요.",
  "Removing external access…": "외부 접근 권한을 제거하는 중…",
  "External access removed.": "외부 접근 권한을 제거했어요.",
  "Some access couldn't be removed. Try again to finish.":
    "일부 접근 권한을 제거하지 못했어요. 다시 시도해 마무리해 주세요.",
  "Couldn't finish removing access. Try again to check and finish this request.":
    "접근 권한 제거를 마치지 못했어요. 다시 시도해 이 요청을 확인하고 마무리해 주세요.",
  "Couldn't load the people and links. Check your connection and try again.":
    "사람과 링크를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.",

  // Assistant: local findings and repair
  "{count} local findings · Manual tools": "로컬 발견 항목 {count}개 · 수동 도구",
  "Close finding": "발견 항목 닫기",
  "Some checks could not finish. Retry the scan.": "일부 검사를 끝내지 못했어요. 검사를 다시 실행해 주세요.",
  "Vault checks took too long. Retry the scan.": "볼트 검사가 너무 오래 걸렸어요. 검사를 다시 실행해 주세요.",
  "Search index rebuilt. Refreshing checks…": "검색 색인을 다시 만들었어요. 검사를 새로 고치는 중…",
  "Sync retry requested. Refreshing checks…": "동기화 재시도를 요청했어요. 검사를 새로 고치는 중…",
  "Retried {done} of {total} files. Scan again to verify.":
    "파일 {total}개 중 {done}개를 다시 시도했어요. 다시 검사해서 확인해 주세요.",
  "This finding changed. Run diagnostics again.": "이 발견 항목이 바뀌었어요. 진단을 다시 실행해 주세요.",
  "Vault or account changed. Prepare a new action.": "볼트나 계정이 바뀌었어요. 작업을 새로 준비해 주세요.",
  "Prepare an access request": "접근 권한 요청 준비",
  "Copy a request for the vault owner. This does not send a message or change permissions.":
    "볼트 소유자에게 보낼 요청을 복사해요. 메시지를 보내거나 권한을 바꾸지는 않아요.",
  "Copy access request": "접근 권한 요청 복사",
  "Wait for a current remote inventory before downloading missing files.":
    "누락된 파일을 다운로드하기 전에 최신 원격 목록이 준비될 때까지 기다려 주세요.",
  "Download missing files": "누락된 파일 다운로드",
  "Restore the listed remote files to this device using the guarded download pipeline.":
    "보호된 다운로드 경로로 나열된 원격 파일을 이 기기에 복원해요.",
  "Download files": "파일 다운로드",
  "No recoverable local files remain.": "복구할 수 있는 로컬 파일이 남아 있지 않아요.",
  "Restore local files to sync": "동기화할 로컬 파일 복원",
  "These copies were preserved after deletion or loss of access. Re-registering requests permission to upload them again. Review whether the original deletion was intentional.":
    "이 사본은 삭제되거나 접근 권한을 잃은 뒤에 보존된 거예요. 다시 등록하면 업로드 권한을 다시 요청해요. 원래 삭제가 의도한 것이었는지 확인해 주세요.",
  "Re-register files": "파일 다시 등록",
  "These paths require a folder move or individual naming choice; no safe file-only rename was found.":
    "이 경로는 폴더를 옮기거나 이름을 개별로 정해야 해요. 파일만 안전하게 바꿀 수 있는 이름 변경은 찾지 못했어요.",
  "Review distinct file names": "서로 다른 파일 이름 검토",
  "Preserve every file and its identity. Links using the old paths may need repair after renaming. Folders are left alone.":
    "모든 파일과 파일의 식별 정보를 그대로 유지해요. 이름을 바꾼 뒤에는 이전 경로를 쓰는 링크를 고쳐야 할 수 있어요. 폴더는 그대로 둬요.",
  "Apply renames": "이름 변경 적용",
  "The finding changed. Scan again.": "발견 항목이 바뀌었어요. 다시 검사해 주세요.",
  "No eligible files remain.": "대상이 되는 파일이 남아 있지 않아요.",
  "Save recovery copies": "복구용 사본 저장",
  "Choose a folder to save the listed files. Originals stay intact. Saving a copy does not reduce their size or resolve a sync limit.":
    "나열된 파일을 저장할 폴더를 선택하세요. 원본은 그대로 남아요. 사본을 저장해도 크기가 줄거나 동기화 한도가 해결되지는 않아요.",
  "Reclaim only orphaned history after validating the complete live note set.":
    "전체 메모 목록을 확인한 뒤 연결이 끊긴 기록만 정리해요.",
  "Could not prepare this action.": "이 작업을 준비하지 못했어요.",
  "Preparing action…": "작업을 준비하는 중…",
  "Applying…": "적용하는 중…",
  "Apply": "적용",
  "Assistant access is unavailable.": "도우미를 사용할 수 없어요.",
  "The finding changed. Prepare a fresh action.": "발견 항목이 바뀌었어요. 작업을 새로 준비해 주세요.",
  "Deletion is not available in this repair flow.": "이 복구 과정에서는 삭제할 수 없어요.",
  "Recovery copies are preserved.": "복구용 사본은 그대로 보존돼요.",
  "Wait for this file to register before renaming.": "이름을 바꾸기 전에 이 파일이 등록될 때까지 기다려 주세요.",
  "File identity changed": "파일 식별 정보가 바뀌었어요",
  "Source or destination changed": "원본 또는 대상이 바뀌었어요",
  "Failed": "실패했어요",
  "Renamed {done} of {total}. {failures}": "{total}개 중 {done}개의 이름을 바꿨어요. {failures}",
  "Copied access request. Send it to {name}.": "접근 권한 요청을 복사했어요. {name}에게 보내 주세요.",
  "the vault owner": "볼트 소유자",
  "Download completed. Scan again to verify.": "다운로드를 마쳤어요. 다시 검사해서 확인해 주세요.",
  "Re-registered {done} of {total}. {errors}": "{total}개 중 {done}개를 다시 등록했어요. {errors}",
  "Action failed.": "작업에 실패했어요.",
  "{count} additional items are outside this preview.": "추가 항목 {count}개는 이 미리보기에 포함되지 않았어요.",

  // Appearance rows
  "Adjusted for readability": "가독성을 위해 조정됨",
  "Accent presets": "강조 색 프리셋",
  "Accent {name}": "강조 색 {name}",
  "Custom accent color": "사용자 지정 강조 색",
  "Custom accent hex": "사용자 지정 강조 색 hex",
  "Use #rrggbb.": "#rrggbb 형식으로 입력하세요.",
  "Automatic file colors": "파일 색 자동 지정",
  "Give every uncoloured file and folder a personal, stable colour.":
    "색이 없는 모든 파일과 폴더에 나만의 고정된 색을 지정해요.",
  "Content width": "본문 너비",
  "How wide the text runs before it wraps. Drag to the end for the full window.":
    "글이 줄바꿈되기 전까지의 너비예요. 끝까지 끌면 창 전체 너비를 써요.",
  "Full width": "전체 너비",
  "{measure} characters": "{measure}자",
  "Text size": "글자 크기",
  "The size of note text in the editor.": "편집기에서 메모 글자의 크기예요.",
  "Line numbers": "줄 번호",
  "Show a line-number gutter in the editor.": "편집기에 줄 번호 영역을 표시해요.",
  "Properties in document": "문서 속 속성",
  "How a note's YAML frontmatter is shown at the top of the note.":
    "메모 맨 위에 YAML 프런트매터를 어떻게 보여줄지 정해요.",
  "Visible": "표시",
  "Hidden": "숨김",
  "Source": "소스",

  // Upgrade nudge
  "Upgrade to Team": "Team으로 업그레이드",
  "Free includes {count} synced vault on your account. Upgrade to Team for unlimited synced vaults.":
    "Free에는 계정당 동기화 볼트 {count}개가 포함돼요. Team으로 업그레이드하면 동기화 볼트를 제한 없이 쓸 수 있어요.",
  "Free includes {count} synced vaults on your account. Upgrade to Team for unlimited synced vaults.":
    "Free에는 계정당 동기화 볼트 {count}개가 포함돼요. Team으로 업그레이드하면 동기화 볼트를 제한 없이 쓸 수 있어요.",
  "This vault has reached its sync limit. Upgrade to Team to lift it.":
    "이 볼트가 동기화 한도에 도달했어요. Team으로 업그레이드하면 한도가 풀려요.",
  "This Free vault has reached {count} synced notes. Upgrade to Team to sync more; additional notes stay on this device.":
    "이 Free 볼트는 동기화된 메모가 {count}개에 도달했어요. Team으로 업그레이드하면 더 동기화할 수 있어요. 추가 메모는 이 기기에만 남아요.",
  "Free plan limit reached — this vault allows {count} member.":
    "Free 플랜 한도에 도달했어요. 이 볼트는 멤버 {count}명까지 가능해요.",
  "Free plan limit reached — this vault allows {count} members.":
    "Free 플랜 한도에 도달했어요. 이 볼트는 멤버 {count}명까지 가능해요.",
  "You're using all {count} free vault. Move one to a Team account ($10/seat/month, minimum 3 seats) — Team vaults don't count toward that limit — and you can create another.":
    "무료 볼트 {count}개를 모두 쓰고 있어요. 하나를 Team 계정(좌석당 월 $10, 최소 3석)으로 옮기면 다른 볼트를 만들 수 있어요. Team 볼트는 이 한도에 포함되지 않아요.",
  "You're using all {count} free vaults. Move one to a Team account ($10/seat/month, minimum 3 seats) — Team vaults don't count toward that limit — and you can create another.":
    "무료 볼트 {count}개를 모두 쓰고 있어요. 하나를 Team 계정(좌석당 월 $10, 최소 3석)으로 옮기면 다른 볼트를 만들 수 있어요. Team 볼트는 이 한도에 포함되지 않아요.",

  // Vault icon
  "Vault icon": "볼트 아이콘",
  "Shown on this device only, until you turn on sync.": "동기화를 켜기 전까지는 이 기기에서만 보여요.",
  "Everyone in this vault sees this icon.": "이 볼트의 모든 사람에게 이 아이콘이 보여요.",
  "Everyone in this vault sees this icon. Only an owner or admin can change it.":
    "이 볼트의 모든 사람에게 이 아이콘이 보여요. 소유자나 관리자만 바꿀 수 있어요.",
  "Upload image": "이미지 업로드",
  "Recent uploads": "최근 업로드",
  "Use this image": "이 이미지 사용",
  "Icon colour": "아이콘 색",
  "Icon": "아이콘",
  "Using your uploaded image. Pick an icon to switch back.":
    "업로드한 이미지를 사용 중이에요. 아이콘을 고르면 다시 바뀌어요.",
  "Using an uploaded image.": "업로드한 이미지를 사용 중이에요.",
  "Couldn't change the vault icon — {reason}": "볼트 아이콘을 바꾸지 못했어요 — {reason}",
  "Couldn't upload that image. Try a smaller PNG or JPG.":
    "이미지를 업로드하지 못했어요. 더 작은 PNG나 JPG로 시도해 주세요.",
};
