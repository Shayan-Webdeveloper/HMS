// Time-zone helpers. Everything is stored in UTC; the hospital time zone decides
// what "today", "09:00" and day boundaries mean.

export const DEFAULT_TZ = "Asia/Karachi";

function partsInTz(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

/** Offset (minutes) of tz from UTC at the given instant. */
export function tzOffsetMinutes(date, tz = DEFAULT_TZ) {
  const p = partsInTz(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Convert a wall-clock time in tz ("2026-10-09", "09:30") to a UTC Date. */
export function zonedToUtc(dateStr, timeStr = "00:00", tz = DEFAULT_TZ) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off1 = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(first, tz);
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000);
}

/** "YYYY-MM-DD" of an instant as seen in tz. */
export function toZonedDateString(date, tz = DEFAULT_TZ) {
  const p = partsInTz(new Date(date), tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:MM" of an instant as seen in tz. */
export function toZonedTimeString(date, tz = DEFAULT_TZ) {
  const p = partsInTz(new Date(date), tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Weekday (0=Sun) of a "YYYY-MM-DD" date string. */
export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** [start, end) UTC instants covering the given local day. */
export function dayRangeUtc(dateStr, tz = DEFAULT_TZ) {
  return [zonedToUtc(dateStr, "00:00", tz), zonedToUtc(addDays(dateStr, 1), "00:00", tz)];
}

export function todayInTz(tz = DEFAULT_TZ) {
  return toZonedDateString(new Date(), tz);
}

export function minutesFromHHMM(s) {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function hhmmFromMinutes(n) {
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/** Inclusive age in whole years from a date of birth. */
export function ageFromDob(dob, now = new Date()) {
  if (!dob) return null;
  const b = new Date(dob);
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const md = now.getUTCMonth() - b.getUTCMonth();
  if (md < 0 || (md === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export function formatDateTime(date, tz = DEFAULT_TZ, opts = {}) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, ...opts,
  }).format(new Date(date));
}

export function formatDate(date, tz = DEFAULT_TZ) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "numeric" }).format(new Date(date));
}

/** For @db.Date columns (stored as UTC midnight) — format without tz shifting. */
export function formatDateOnly(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(new Date(date));
}

export function formatTime(date, tz = DEFAULT_TZ) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(date));
}
