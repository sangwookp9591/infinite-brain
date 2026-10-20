// SPDX-License-Identifier: Apache-2.0
// The Korean dictionary. The key is the exact English text used in the UI; an
// entry that is missing simply shows in English. One file per area keeps
// translations of different screens from colliding. A key may appear in only
// one file (i18n.test.ts checks), so a word shared by screens lives in common.ts.
//
// Style (the personal-writing contract, applied to UI copy):
//  - 해요체 throughout, the same register as the existing Korean copy. Never mix
//    in 합니다체.
//  - Keep meaning exactly: numbers, units, conditions, negation, and the strength
//    of "must / should / can / may" ("can't" stays "~할 수 없어요", not "~하지
//    않아요"). Do not add reasons or connectors the English does not have.
//  - Same word, same term, everywhere (glossary below). Buttons are short verbs
//    ("저장", "삭제"), not full sentences; error texts say what happened and what
//    to do, in that order, as the English does.
//  - Placeholders like {name} must survive untouched. Do not translate product
//    and file names (Infinite Brain, Markdown, MCP, Claude, ChatGPT, GitHub),
//    URLs, keyboard keys or wire values.
//
// Glossary: vault 볼트 · note 메모 · folder 폴더 · file 파일 · member 멤버 ·
// guest 게스트 · owner 소유자 · admin 관리자 · invite 초대 · join code 참여 코드 ·
// share 공유 · access 접근 권한 · Can edit 편집 가능 · Can view 보기 가능 ·
// No access 접근 불가 · sync 동기화 · synced 동기화됨 · offline 오프라인 ·
// workspace/account 계정 · sign in 로그인 · sign out 로그아웃 · settings 설정 ·
// delete 삭제 · trash 휴지통 · undo 되돌리기 · version history 버전 기록 ·
// activity 활동 · AI changes AI 변경 · connection 연결 · server 서버.
import { common } from "./common";
import { welcome } from "./welcome";
import { sidebar } from "./sidebar";
import { sharing } from "./sharing";
import { app } from "./app";
import { search } from "./search";
import { help } from "./help";
import { shortcuts } from "./shortcuts";

export const ko: Record<string, string> = { ...common, ...welcome, ...sidebar, ...sharing, ...app, ...search, ...help, ...shortcuts };
export const KO_PARTS = { common, welcome, sidebar, sharing, app, search, help, shortcuts };
