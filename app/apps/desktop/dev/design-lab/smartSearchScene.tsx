// SPDX-License-Identifier: Apache-2.0
// B0-b mock: first-run "스마트 검색" prompt and its follow-up states (PRD §0.1, §5.8 F8.3a).
// Design lab only; the app itself is untouched. Copy avoids technical terms on purpose.
import { useEffect, useRef, useState } from "react";
import { SpringCheck } from "../../src/components/kit/SpringCheck";
import type { Demo } from "./types";

// B0-a 최종 권고: 기본 Q8_0 310MB, 저사양 Q4_K_XL 180MB(앱이 기기에 맞춰 고름)
const SIZE_MB = 310;
const USED_MB = 320;

function Panel({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <section className="ss-panel" aria-label={`${n}. ${title}`}>
    <span className="scene-eyebrow">{n} · {title}</span>
    <div className="ss-body">{children}</div>
  </section>;
}
function Bar({ percent, label }: { percent: number; label: string }) {
  return <div className="ss-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>;
}
function SearchField({ hint }: { hint?: React.ReactNode }) {
  return <div className="ss-searchrow">
    <input className="scene-search" type="search" aria-label="노트 검색" placeholder="노트 검색…" />
    {hint}
  </div>;
}

function SmartSearchScene() {
  const [enabled, setEnabled] = useState(true);
  const [cleared, setCleared] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [limitReason, setLimitReason] = useState<"storage" | "memory">("storage");
  const used = cleared ? 0 : USED_MB;
  // Keyboard focus follows the swap between 지우기… and its confirm buttons instead of falling to <body>.
  const openRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirmClear) cancelRef.current?.focus();
    else if (wasConfirming.current) openRef.current?.focus();
    wasConfirming.current = confirmClear;
  }, [confirmClear]);
  return <div className="ss-grid">
    <Panel n={1} title="첫 실행 질문">
      <h4>스마트 검색을 켤까요?</h4>
      <p>뜻이 비슷한 노트까지 찾아 줘요. 약 {SIZE_MB}MB를 내려받고, 노트는 이 기기 밖으로 나가지 않아요.</p>
      <div className="ss-actions"><button type="button" className="ss-btn" data-primary>켜기</button><button type="button" className="ss-btn">나중에</button></div>
    </Panel>

    <Panel n={2} title="내려받는 중">
      <h4>스마트 검색을 준비하고 있어요</h4>
      <Bar percent={42} label="스마트 검색 내려받기" />
      <p className="ss-meta"><span>약 130MB / 약 {SIZE_MB}MB</span><span>42%</span></p>
      <p>이 창을 닫아도 계속 받아요. 그동안에도 노트는 평소처럼 쓸 수 있어요.</p>
      <div className="ss-actions"><button type="button" className="ss-btn">취소</button></div>
    </Panel>

    <Panel n={3} title="사양 부족 안내">
      <h4>사양을 확인해 주세요</h4>
      <div className="ss-variants" role="group" aria-label="부족한 사양">
        <button type="button" className="ss-btn" aria-pressed={limitReason === "storage"} onClick={() => setLimitReason("storage")}>저장 공간</button>
        <button type="button" className="ss-btn" aria-pressed={limitReason === "memory"} onClick={() => setLimitReason("memory")}>메모리</button>
      </div>
      <p>{limitReason === "storage"
        ? `저장 공간이 부족해 켤 수 없어요. ${SIZE_MB}MB 이상 비우면 다시 켤 수 있어요.`
        : "이 기기의 메모리가 부족해 켤 수 없어요."}</p>
      <div className="ss-actions"><button type="button" className="ss-btn" data-primary>단어 검색 계속 쓰기</button></div>
    </Panel>

    <Panel n={4} title="설정 → 스마트 검색">
      <h4>스마트 검색</h4>
      <div className="ss-row"><div><strong>스마트 검색 사용</strong><p>뜻이 비슷한 노트까지 찾아 줘요.</p></div>
        <SpringCheck label="스마트 검색 사용" checked={enabled} onChange={setEnabled} /></div>
      <div className="ss-row"><div><strong>사용 중인 공간</strong><p role="status">{cleared ? "지웠어요. 다시 켜면 새로 받아요." : `${used}MB`}</p></div>
        {confirmClear ? <div className="ss-actions"><button type="button" className="ss-btn" data-danger onClick={() => { setCleared(true); setEnabled(false); setConfirmClear(false); }}>지우기</button><button type="button" className="ss-btn" ref={cancelRef} onClick={() => setConfirmClear(false)}>그만두기</button></div>
          : <button type="button" className="ss-btn" ref={openRef} disabled={cleared} onClick={() => setConfirmClear(true)}>지우기…</button>}
      </div>
      <p className="ss-note">스마트 검색 파일과 검색 정보가 사라져요. 노트는 그대로 남아요.</p>
    </Panel>

    <Panel n={5} title="[나중에] 이후 검색창 옆 안내">
      <SearchField hint={<button type="button" className="ss-chip">스마트 검색 켜기</button>} />
      <p className="ss-note">지금은 단어 검색으로 찾아요. 언제든 켤 수 있어요.</p>
    </Panel>
  </div>;
}

export const smartSearchScene: Demo = {
  id: "smart-search-first-run", title: "첫 실행 · 스마트 검색",
  usage: "B0-b · PRD §0.1, §5.8 F8.3a · 질문, 내려받기, 사양 부족, 설정 패널, 나중에 이후 안내.",
  wide: true, render: () => <SmartSearchScene />,
};
