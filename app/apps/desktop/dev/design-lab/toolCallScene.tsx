// SPDX-License-Identifier: Apache-2.0
import { ToolCallCard, ToolCallGroup } from "../../src/components/kit/ToolCallCard";
import type { Demo } from "./types";

export const toolCallScene: Demo = {
  id: "tool-call-card", title: "AI tool calls", usage: "search_notes, read_note, update_note · 실행 중, 완료, 실패 및 재시도", wide: true,
  render: () => <div style={{ display: "grid", gap: 18, width: "min(100%, 740px)", margin: "0 auto" }}>
    <div style={{ display: "grid", gap: 8 }}>
      <ToolCallCard name="search_notes" summary="제품 팀 회의 기록 검색" status="running" defaultOpen startedAt={Date.now() - 1800} args={{ query: "제품 팀 회의", limit: 10 }} />
      <ToolCallCard name="read_note" summary="주간 계획 노트 읽기" status="success" defaultOpen duration={2400} args={{ docId: "note-weekly-plan" }} result={{ path: "Planning/Weekly.md", content: "이번 주 우선순위…" }} />
      <ToolCallCard name="update_note" summary="노트 업데이트 충돌" status="error" defaultOpen error="409 conflict: note changed since it was read" args={{ docId: "note-weekly-plan", expectedRevision: "rev-42" }} onRetry={() => window.alert("디자인 랩 예시: 다시 시도")}/>
    </div>
    <ToolCallGroup defaultOpen duration={2400}>
      <ToolCallCard name="search_notes" summary="회의 기록 검색" status="success" duration={800} args={{ query: "회의" }} result={[{ docId: "note-1", title: "주간 회의" }]} />
      <ToolCallCard name="read_note" summary="검색 결과 읽기" status="success" duration={1600} args={{ docId: "note-1" }} result={{ content: "결정 사항" }} />
      <ToolCallCard name="update_note" summary="수정 실패" status="error" duration={0} args={{ docId: "note-1" }} error="권한이 없습니다." />
    </ToolCallGroup>
  </div>,
};
