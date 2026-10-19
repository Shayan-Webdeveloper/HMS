// Pure helpers for the appointment calendar (no React, no server-only).
import { addDays, weekdayOf } from "@/lib/utils/time";

/** Block colours per appointment status — mirrors the StatusBadge tones (components/ui/Badge.jsx). */
export const STATUS_BLOCK = {
  REQUESTED: "bg-info-soft text-info border-info",
  SCHEDULED: "bg-primary-soft text-primary-ink border-primary",
  CONFIRMED: "bg-secondary-soft text-[#0f766e] border-secondary",
  CHECKED_IN: "bg-warning-soft text-warning border-warning",
  IN_PROGRESS: "bg-info-soft text-info border-info",
  COMPLETED: "bg-success-soft text-success border-success",
  CANCELLED: "bg-neutral-soft text-muted border-border-strong line-through",
  NO_SHOW: "bg-danger-soft text-danger border-danger",
};

export const STATUS_DOT = {
  REQUESTED: "bg-info", SCHEDULED: "bg-primary", CONFIRMED: "bg-secondary", CHECKED_IN: "bg-warning",
  IN_PROGRESS: "bg-info", COMPLETED: "bg-success", CANCELLED: "bg-border-strong", NO_SHOW: "bg-danger",
};

/** Monday of the week containing dateStr (YYYY-MM-DD). */
export function weekStart(dateStr) {
  const wd = weekdayOf(dateStr); // 0 = Sunday
  return addDays(dateStr, wd === 0 ? -6 : 1 - wd);
}

export function monthStart(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

export function addMonths(dateStr, n) {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** Dates (YYYY-MM-DD) for a Monday-first month grid covering the month of dateStr (5–6 weeks). */
export function monthGrid(dateStr) {
  const first = monthStart(dateStr);
  const start = weekStart(first);
  const nextMonth = addMonths(first, 1);
  const days = [];
  let d = start;
  while (d < nextMonth || days.length % 7 !== 0) {
    days.push(d);
    d = addDays(d, 1);
  }
  return days;
}

/** Visible range [firstDate, lastDate] (inclusive, local dates) for a calendar view. */
export function viewRange(view, anchor) {
  if (view === "day") return [anchor, anchor];
  if (view === "week") { const s = weekStart(anchor); return [s, addDays(s, 6)]; }
  const g = monthGrid(anchor);
  return [g[0], g[g.length - 1]];
}

export function shiftAnchor(view, anchor, dir) {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  return addMonths(monthStart(anchor), dir);
}

/**
 * Side-by-side layout for overlapping events in one column.
 * events: [{ startMin, endMin, ... }] → same objects with { lane, lanes } added.
 */
export function assignLanes(events) {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const laneEnds = [];
    for (const e of cluster) {
      let lane = laneEnds.findIndex((end) => end <= e.startMin);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.endMin); } else laneEnds[lane] = e.endMin;
      e.lane = lane;
    }
    for (const e of cluster) { e.lanes = laneEnds.length; out.push(e); }
    cluster = [];
  };
  for (const ev of sorted) {
    const e = { ...ev };
    if (cluster.length && e.startMin >= clusterEnd) { flush(); clusterEnd = -Infinity; }
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  if (cluster.length) flush();
  return out;
}
