// SPDX-License-Identifier: Apache-2.0
// Korean strings: the "?" help beside settings tab titles (components/FeatureHelp.tsx).
export const help: Record<string, string> = {
  "About this feature": "이 기능 설명",
  "What it does": "하는 일",
  "Where it applies": "적용 범위",
  "With your team": "팀과 함께",
  "Read the guide": "자세한 안내 보기",

  "Finds notes with a similar meaning, not just the same words, in Search notes.":
    "메모 검색에서 같은 단어가 없어도 뜻이 비슷한 메모까지 찾아 줘요.",
  "Only on this computer. It downloads its model once (310 MB) and reads this computer's copy of your notes. Nothing is sent anywhere.":
    "이 컴퓨터에만 적용돼요. 모델을 한 번 내려받고(310MB) 이 컴퓨터에 있는 메모를 읽어요. 어디로도 보내지 않아요.",
  "Nothing is shared. Each teammate turns it on on their own computer, and it only searches notes they can already open.":
    "공유되는 것은 없어요. 팀원이 각자 자기 컴퓨터에서 켜고, 그 사람이 이미 열 수 있는 메모만 찾아요.",

  "Who is in this vault, and what each person can open: edit, view or nothing, for the whole vault or folder by folder.":
    "이 볼트에 누가 있고, 각자 무엇을 열 수 있는지 정해요. 볼트 전체나 폴더별로 편집, 보기, 접근 불가를 고를 수 있어요.",
  "Saved on the server, so it applies to everyone in the vault on every device.":
    "서버에 저장돼서 볼트의 모든 사람에게, 모든 기기에서 적용돼요.",
  "Add people with Invite people in the vault menu, by link or join code. To share one folder or note, use Share… in the sidebar. Guests see only what is shared with them by name.":
    "볼트 메뉴의 사람 초대에서 링크나 참여 코드로 사람을 추가해요. 폴더나 메모 하나만 공유하려면 사이드바의 공유…를 써요. 게스트는 자기에게 직접 공유된 것만 봐요.",

  "Lets Claude or ChatGPT search and read this vault over MCP, and edit it if you allow that.":
    "Claude나 ChatGPT가 MCP로 이 볼트를 검색하고 읽게 해요. 허용하면 편집도 해요.",
  "Each connection belongs to the person who made it, with the access chosen when connecting: read only, read and write, or read, write and delete.":
    "연결은 만든 사람의 것이고, 연결할 때 고른 권한만 가져요. 읽기만, 읽기와 쓰기, 읽기·쓰기·삭제 중에서 골라요.",
  "Each teammate connects their own AI. Every AI edit appears in Activity → AI changes for the whole team, with a diff and Undo.":
    "팀원이 각자 자기 AI를 연결해요. AI가 고친 내용은 모두 활동 → AI 변경에 바뀐 부분과 되돌리기와 함께 팀 전체에게 보여요.",

  "A checkpoint saves every note in the vault, content and folders. One is taken automatically each day the vault changes, and the 5 most recent are kept.":
    "체크포인트는 볼트의 모든 메모를 내용과 폴더 구조까지 저장해요. 볼트가 바뀐 날마다 자동으로 하나씩 만들고, 최근 5개를 남겨요.",
  "Kept on the server for the whole vault, not per person.":
    "사람별이 아니라 볼트 전체 단위로 서버에 보관돼요.",
  "Reverting rolls back every member's vault at once, live. To bring back one note, use Version history on that note instead. Owners and admins can create checkpoints.":
    "되돌리면 모든 멤버의 볼트가 한꺼번에, 바로 되돌아가요. 메모 하나만 되살리려면 그 메모의 버전 기록을 써요. 체크포인트는 소유자와 관리자가 만들 수 있어요.",
};
