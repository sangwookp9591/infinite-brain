// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Folder (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { useId, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SOFT, useSpring } from "./motion";
import "./FolderCard.css";

export interface FolderPage { title: string; description?: string; }
export function folderPagePose(index: number, count: number, open: boolean) {
  return { x: open ? (index - (count - 1) / 2) * 42 : 0, y: open ? -62 - (index % 2) * 10 : -index * 5, rotate: open ? (index - (count - 1) / 2) * 9 : (index - (count - 1) / 2) * 2 };
}
export interface FolderCardProps { label: string; items: FolderPage[]; color?: string; onItemClick?: (item: FolderPage, index: number) => void; }
export function FolderCard({ label, items, color = "var(--accent)", onItemClick }: FolderCardProps) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const transition = useSpring(SOFT);
  const reduced = useReducedMotion();
  const id = useId();
  const pages = items.slice(0, 4);
  return <div className="kit-folder" data-open={open || undefined} style={{ "--folder-color": color } as CSSProperties}
    onMouseEnter={() => setPeek(true)} onMouseLeave={() => setPeek(false)} onKeyDown={e => { if (e.key === "Escape") { setOpen(false); setPeek(false); e.currentTarget.querySelector("button")?.focus(); } }}>
    <button type="button" className="kit-folder-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)} aria-label={`${open ? "Close" : "Open"} ${label}`} />
    <div className="kit-folder-back" aria-hidden="true"><span>{label}</span></div>
    <div id={id} className="kit-folder-pages" inert={!open}>
      {pages.map((item, i) => { const pose = folderPagePose(i, pages.length, open); return <motion.button key={`${i}-${item.title}`} type="button" className="kit-folder-page" tabIndex={open ? 0 : -1}
        initial={false} animate={reduced ? { x: pose.x, y: pose.y, rotate: 0 } : { ...pose, y: pose.y - (!open && peek ? 15 : 0) }} transition={reduced ? { duration: 0 } : transition}
        onClick={() => onItemClick?.(item, i)} aria-label={`Open ${item.title}`}><span>{item.title}</span><small>{item.description || "Markdown note"}</small><i /><i /><i /></motion.button>; })}
    </div>
    <motion.div className="kit-folder-front" aria-hidden="true" initial={false} animate={{ rotateX: reduced ? 0 : open ? -52 : peek ? -12 : 0, y: open ? 18 : 0 }} transition={reduced ? { duration: 0 } : transition}><span>{label}</span><small>{items.length} notes</small></motion.div>
  </div>;
}
