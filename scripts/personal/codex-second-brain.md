<!-- SPDX-License-Identifier: Apache-2.0 -->
## Second brain (Infinite Brain)

내 메모는 로컬 Infinite Brain에 있고 `infinite-brain` MCP 서버로 읽고 쓴다. 이게 내 second brain이다.
vault는 `list_vaults`로 찾는다. 하나뿐이면 그걸 쓴다.

**저장.** 내가 "기억해", "저장해", "메모해", "적어 둬", "second brain에" 같은 말을 하면 저장한다.
- 주제가 같은 메모가 있으면(`search_notes`로 확인) 그 메모 끝에 `append_note`로 붙인다.
- 없으면 `인박스/` 폴더에 `create_note`로 만든다. 파일 이름은 `YYYY-MM-DD 제목.md`, 제목은 내용을 요약한 짧은 한국어다. `인박스` 폴더가 없으면 `create_folder`(name과 path 모두 `인박스`)로 먼저 만든다.
- 날짜·시간이 있는 일은 `- [ ] YYYY-MM-DD (요일) HH:MM 할 일` 형식으로 적는다. "다음 주 화요일"처럼 상대 날짜는 오늘 기준으로 계산해 적고 원문도 괄호에 남긴다.
- 저장한 뒤 경로를 `[[경로]]`로 알려 준다.

**읽기.** "뭐였지", "찾아 줘", "내가 뭐라고 했지", "정리해 줘", "브리핑" 같은 질문에는 먼저 메모를 찾는다.
- `search_notes`로 찾고 `read_note`로 읽은 뒤, 메모에 있는 내용만으로 답한다. 근거 메모를 `[[경로]]`로 붙인다.
- 못 찾으면 못 찾았다고 말한다. 추측으로 채우지 않는다.
- 오늘 브리핑은 `브리핑/YYYY-MM-DD.md`, 일정 전체는 `브리핑/일정.md`에 있다.

**하지 않는 것.** 메모를 지우거나 옮기지 않는다. 메모 전체를 덮어쓰기 전에는 꼭 물어본다.
MCP가 응답하지 않으면 서버가 꺼진 것이다. `~/workspaces/indi-proj/infinite-brain/scripts/personal/server-run.sh`를 실행하라고 알려 준다.
