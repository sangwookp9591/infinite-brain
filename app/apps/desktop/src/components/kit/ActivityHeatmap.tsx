// SPDX-License-Identifier: Apache-2.0
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import { SNAPPY, useSpring } from "./motion";
import "./ActivityHeatmap.css";

export interface ActivityDay { date: string; count: number; }
export interface ActivityHeatmapProps {
  days: ActivityDay[]; label: string; period: string; locale?: string;
  weekStartsOn?: 0 | 1; thresholds?: [number, number, number];
  selectedDate?: string | null; onSelectDate?: (date: string) => void;
  actions?: ReactNode; className?: string; formatCount?: (count: number) => string;
  noActivityLabel?: string; lessLabel?: string; moreLabel?: string;
  highlightLabel?: string; levelDescription?: (ranges: string[]) => string;
  daysWithLabel?: (count: string, range: string) => string;
}
export interface ActivityModel {
  start: number; length: number; lead: number; weeks: number; total: number;
  counts: number[]; levels: number[]; thresholds: [number, number, number];
  months: { month: number; col: number; label: string }[]; perLevel: number[];
}
const DAY = 86_400_000;
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (time: number) => new Date(time).toISOString().slice(0, 10);

export function buildModel(days: ActivityDay[], weekStartsOn: 0 | 1, thresholds: [number, number, number] | undefined, locale: string): ActivityModel {
  const dates = days.map(({ date }) => toUtc(date)).filter(Number.isFinite);
  const start = dates.length ? Math.min(...dates) : toUtc("2025-01-01");
  const length = dates.length ? Math.round((Math.max(...dates) - start) / DAY) + 1 : 0;
  const counts = new Array<number>(length).fill(0);
  days.forEach(({ date, count }) => {
    const index = Math.round((toUtc(date) - start) / DAY);
    if (Number.isFinite(index) && index >= 0 && index < length) counts[index] += Number.isFinite(count) ? Math.max(0, count) : 0;
  });
  const max = Math.max(0, ...counts);
  const bounds = thresholds ?? [Math.max(1, Math.ceil(max * .25)), Math.max(2, Math.ceil(max * .5)), Math.max(3, Math.ceil(max * .75))];
  const levels = counts.map(count => count <= 0 ? 0 : count <= bounds[0] ? 1 : count <= bounds[1] ? 2 : count <= bounds[2] ? 3 : 4);
  const lead = dates.length ? (new Date(start).getUTCDay() - weekStartsOn + 7) % 7 : 0;
  const weeks = Math.ceil((lead + length) / 7);
  const monthName = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const months: ActivityModel["months"] = [];
  for (let index = 0; index < length; index++) {
    const date = new Date(start + index * DAY);
    if (index === 0 || date.getUTCDate() === 1) months.push({ month: date.getUTCFullYear() * 12 + date.getUTCMonth(), col: Math.floor((lead + index) / 7), label: monthName.format(date) });
  }
  if (months.length > 1 && months[1].col - months[0].col < 3) months.shift();
  const perLevel = [0, 0, 0, 0, 0]; levels.forEach(level => perLevel[level]++);
  return { start, length, lead, weeks, total: counts.reduce((a, b) => a + b, 0), counts, levels, thresholds: bounds, months, perLevel };
}

export function ActivityHeatmap({ days, label, period, locale = "ko-KR", weekStartsOn = 1, thresholds, selectedDate = null, onSelectDate, actions, className, formatCount, noActivityLabel = "활동 없음", lessLabel = "적음", moreLabel = "많음", highlightLabel = "단계별 날짜 강조", levelDescription = ranges => `색이 진할수록 편집 횟수가 많아요. 단계: ${ranges.join(", ")}.`, daysWithLabel = (count, range) => `${count}일 · ${range}` }: ActivityHeatmapProps) {
  const id = useId();
  const model = useMemo(() => buildModel(days, weekStartsOn, thresholds, locale), [days, weekStartsOn, thresholds, locale]);
  const spring = useSpring(SNAPPY);
  const [reveal, setReveal] = useState("revealing");
  const [direction, setDirection] = useState<"forward" | "back" | undefined>();
  const previousStart = useRef(model.start);
  useEffect(() => { const timer = window.setTimeout(() => setReveal("done"), 1120); return () => window.clearTimeout(timer); }, []);
  // The sweep keeps `animation-fill-mode: both`, which would pin opacity and mask the legend highlight; clear it once finished so the next sweep also replays.
  useEffect(() => {
    if (previousStart.current === model.start) return;
    setDirection(model.start < previousStart.current ? "back" : "forward");
    previousStart.current = model.start;
    const timer = window.setTimeout(() => setDirection(undefined), 1100);
    return () => window.clearTimeout(timer);
  }, [model.start]);
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const fmtCount = useMemo(() => formatCount ?? ((count: number) => `편집 ${number.format(count)}회`), [formatCount, number]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }), [locale]);
  const shortDate = useMemo(() => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }), [locale]);
  const selectedIndex = selectedDate ? Math.round((toUtc(selectedDate) - model.start) / DAY) : -1;
  const hasSelection = selectedIndex >= 0 && selectedIndex < model.length;
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [tip, setTip] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const tipX = useMotionValue(0), tipY = useMotionValue(0);
  // Always-mounted tooltip: a freshly mounted motion element ignores MotionValue writes made right after mount.
  const lastTip = useRef(0);
  if (tip !== null) lastTip.current = tip;
  const shownTip = Math.min(lastTip.current, Math.max(0, model.length - 1));
  const tipOpen = useRef(false);
  useLayoutEffect(() => {
    if (tip === null || !rootRef.current) { tipOpen.current = false; return; }
    const root = rootRef.current;
    const glide = tipOpen.current;
    tipOpen.current = true;
    const scroller = root.querySelector<HTMLElement>(".kit-heatmap-scroller");
    let stopPosition = () => {};
    const position = (glideTo = true) => {
      stopPosition();
      const cell = root.querySelector<HTMLElement>(`[data-index="${tip}"]`);
      if (!cell) return;
      const box = root.getBoundingClientRect(), rect = cell.getBoundingClientRect();
      const x = Math.max(32, Math.min(rect.left - box.left + rect.width / 2, root.clientWidth - 32));
      const y = rect.top - box.top;
      if (!glideTo) { tipX.jump(x); tipY.jump(y); return; }
      const xAnimation = animate(tipX, x, spring), yAnimation = animate(tipY, y, spring);
      stopPosition = () => { xAnimation.stop(); yAnimation.stop(); };
    };
    position(glide);
    const onScroll = () => position();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    return () => { stopPosition(); scroller?.removeEventListener("scroll", onScroll); };
  }, [tip, model, spring, tipX, tipY]);
  const [preview, setPreview] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [legendFocus, setLegendFocus] = useState(0);
  const highlight = preview ?? pinned;
  const bounds = model.thresholds;
  const ranges = useMemo(() => [noActivityLabel, `1–${number.format(bounds[0])}회`, `${number.format(bounds[0] + 1)}–${number.format(bounds[1])}회`, `${number.format(bounds[1] + 1)}–${number.format(bounds[2])}회`, `${number.format(bounds[2] + 1)}회 이상`], [noActivityLabel, number, bounds]);
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, row) => {
      const weekday = (row + weekStartsOn) % 7;
      return weekday % 2 ? format.format(new Date((3 + weekday) * DAY)) : "";
    });
  }, [locale, weekStartsOn]);
  const moveFocus = (index: number) => document.querySelector<HTMLElement>(`#${CSS.escape(id)} [data-index="${index}"]`)?.focus();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
    if (!cell) return;
    const i = Number(cell.dataset.index);
    const move: Record<string, number> = { ArrowUp: i - 1, ArrowDown: i + 1, ArrowLeft: i - 7, ArrowRight: i + 7, Home: 0, End: model.length - 1 };
    if (event.key in move) { event.preventDefault(); moveFocus(Math.max(0, Math.min(model.length - 1, move[event.key]))); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectDate?.(toIso(model.start + i * DAY)); }
    else if (event.key === "Escape") setTip(null);
  };
  const maxDiagonal = Math.max(1, model.weeks + 5);
  const tabIndexDay = focusIndex !== null && focusIndex < model.length ? focusIndex : hasSelection ? selectedIndex : model.length - 1;
  // Memoized so hover/legend state changes do not rebuild ~370 buttons; handlers only call stable setters.
  const cells = useMemo(() => Array.from({ length: 7 }, (_, row) => <div role="row" className="kit-heatmap-row" key={row}>{Array.from({ length: model.weeks }, (_, col) => {
    const i = col * 7 + row - model.lead;
    if (i < 0 || i >= model.length) return <span className="kit-heatmap-cell" data-empty="" key={col} aria-hidden="true" />;
    const count = model.counts[i], date = new Date(model.start + i * DAY), level = model.levels[i];
    return <button key={col} type="button" role="gridcell" className="kit-heatmap-cell" style={{ "--wave": Math.round((col + row) / maxDiagonal * 420), "--wave-back": Math.round((maxDiagonal - col - row) / maxDiagonal * 420) } as CSSProperties} data-index={i} data-level={level} data-col={col} data-row={row} tabIndex={i === tabIndexDay ? 0 : -1} aria-selected={onSelectDate ? i === selectedIndex : undefined} aria-label={`${count ? fmtCount(count) : noActivityLabel}, ${dateFormat.format(date)}`} onFocus={() => { setFocusIndex(i); setTip(i); }} onBlur={() => setTip(null)} onPointerEnter={() => setTip(i)} onPointerLeave={() => { const active = document.activeElement as HTMLElement | null; setTip(active?.matches(".kit-heatmap-cell[data-index]:focus-visible") ? Number(active.dataset.index) : null); }} onClick={() => onSelectDate?.(toIso(date.getTime()))} />;
  })}</div>), [model, maxDiagonal, tabIndexDay, selectedIndex, onSelectDate, fmtCount, noActivityLabel, dateFormat]);
  return <section ref={rootRef} className={`kit-heatmap ${className ?? ""}`} aria-label={label}>
    <header className="kit-heatmap-header"><p className="kit-heatmap-summary"><strong>{fmtCount(model.total)}</strong><span>{period}</span><span className="kit-heatmap-sr" role="status">{fmtCount(model.total)} · {period}</span></p>{actions && <div className="kit-heatmap-actions">{actions}</div>}</header>
    <div className="kit-heatmap-scroller"><div className="kit-heatmap-canvas" style={{ "--weeks": model.weeks } as CSSProperties}>
      <div className="kit-heatmap-months" aria-hidden="true">{model.months.map((m, i) => <span key={`${m.month}-${i}`} style={{ "--col": m.col } as CSSProperties}>{m.label}</span>)}</div>
      <div className="kit-heatmap-weekdays" aria-hidden="true">{weekdays.map((day, i) => <span key={i}>{day}</span>)}</div>
      <div className="kit-heatmap-plot"><div id={id} role="grid" aria-label={label} aria-readonly="true" aria-describedby={`${id}-legend`} className="kit-heatmap-grid" data-reveal={reveal} data-direction={direction} data-highlight={highlight ?? undefined} onKeyDown={onKeyDown}>
        {cells}
      </div>{hasSelection && <span className="kit-heatmap-ring" style={{ "--col": Math.floor((selectedIndex + model.lead) / 7), "--row": (selectedIndex + model.lead) % 7 } as CSSProperties} aria-hidden="true" />}</div>
    </div></div>
    <footer className="kit-heatmap-legend"><span id={`${id}-legend`} className="kit-heatmap-sr">{levelDescription(ranges)}</span><span className="kit-heatmap-caption" aria-live="polite">{highlight === null ? "" : daysWithLabel(number.format(model.perLevel[highlight]), ranges[highlight])}</span><span className="kit-heatmap-scale"><span>{lessLabel}</span><div className="kit-heatmap-swatches" role="group" aria-label={highlightLabel} onKeyDown={event => { const f = (event.target as HTMLElement).closest<HTMLElement>("[data-level]"); if (!f) return; const n = Number(f.dataset.level); if (event.key === "Escape") setPreview(null); else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? 4 : Math.max(0, Math.min(4, n + (event.key === "ArrowLeft" ? -1 : 1))); document.querySelector<HTMLElement>(`#${CSS.escape(id)}-legend-buttons [data-level="${next}"]`)?.focus(); } }} id={`${id}-legend-buttons`}>
      {Array.from({ length: 5 }, (_, level) => <button key={level} type="button" className="kit-heatmap-swatch" data-level={level} tabIndex={level === legendFocus ? 0 : -1} aria-pressed={pinned === level} aria-label={`날짜 강조: ${ranges[level]}`} onPointerEnter={() => setPreview(level)} onPointerLeave={() => setPreview(null)} onFocus={() => { setLegendFocus(level); setPreview(level); }} onBlur={() => setPreview(null)} onClick={() => setPinned(pinned === level ? null : level)} />)}
    </div><span>{moreLabel}</span></span></footer>
    <motion.div className="kit-heatmap-tip" style={{ x: tipX, y: tipY }} initial={false} animate={tip === null ? { opacity: 0, scale: .96, filter: "blur(2px)" } : { opacity: 1, scale: 1, filter: "blur(0px)" }} transition={spring} aria-hidden="true"><span className="kit-heatmap-bubble">{model.counts[shownTip] ? fmtCount(model.counts[shownTip]) : noActivityLabel}<small>{shortDate.format(new Date(model.start + shownTip * DAY))}</small></span></motion.div>
  </section>;
}
export default ActivityHeatmap;
