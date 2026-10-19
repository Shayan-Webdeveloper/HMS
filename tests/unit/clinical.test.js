import { describe, it, expect } from "vitest";
import {
  overlaps, findOverlappingAppointments, windowsForDate, slotStartsForWindows, isWithinAvailability, generateSlots, checkBooking, isBlocking,
} from "@/lib/services/scheduling";
import { APPOINTMENT_TRANSITIONS, canTransition, actionsFor, isActionAllowed, APPOINTMENT_STATUSES } from "@/lib/validation/appointments";
import { matchAllergies, ALLERGY_CHECK_LABEL } from "@/lib/validation/prescriptions";
import { assignLanes, weekStart, monthGrid } from "@/components/appointments/calendar-utils";

const KHI = "Asia/Karachi"; // UTC+5, no DST
// 2026-10-12 is a Monday (weekday 1)
const MON = "2026-10-12";
const AVAIL = [
  { weekday: 1, startTime: "09:00", endTime: "10:00" },
  { weekday: 1, startTime: "14:00", endTime: "15:00" },
  { weekday: 2, startTime: "09:00", endTime: "17:00" },
];
const EARLY = new Date("2026-10-01T00:00:00Z");
const appt = (id, startIso, endIso, status = "SCHEDULED", extra = {}) => ({ id, startsAt: new Date(startIso), endsAt: new Date(endIso), status, ...extra });

describe("overlap detection", () => {
  it("treats intervals as half-open", () => {
    expect(overlaps("2026-10-12T04:00:00Z", "2026-10-12T04:15:00Z", "2026-10-12T04:15:00Z", "2026-10-12T04:30:00Z")).toBe(false);
    expect(overlaps("2026-10-12T04:00:00Z", "2026-10-12T04:15:00Z", "2026-10-12T04:14:00Z", "2026-10-12T04:30:00Z")).toBe(true);
  });
  it("detects containment both ways", () => {
    expect(overlaps("2026-10-12T04:00:00Z", "2026-10-12T05:00:00Z", "2026-10-12T04:10:00Z", "2026-10-12T04:20:00Z")).toBe(true);
    expect(overlaps("2026-10-12T04:10:00Z", "2026-10-12T04:20:00Z", "2026-10-12T04:00:00Z", "2026-10-12T05:00:00Z")).toBe(true);
  });
  it("ignores cancelled/no-show appointments and the excluded id", () => {
    const list = [
      appt("a", "2026-10-12T04:00:00Z", "2026-10-12T04:15:00Z", "CANCELLED"),
      appt("b", "2026-10-12T04:00:00Z", "2026-10-12T04:15:00Z", "NO_SHOW"),
      appt("c", "2026-10-12T04:00:00Z", "2026-10-12T04:15:00Z", "CONFIRMED"),
    ];
    expect(findOverlappingAppointments(list, new Date("2026-10-12T04:05:00Z"), new Date("2026-10-12T04:20:00Z")).map((x) => x.id)).toEqual(["c"]);
    expect(findOverlappingAppointments(list, new Date("2026-10-12T04:05:00Z"), new Date("2026-10-12T04:20:00Z"), "c")).toEqual([]);
    expect(isBlocking("COMPLETED")).toBe(true);
    expect(isBlocking("CANCELLED")).toBe(false);
  });
});

describe("slot generation", () => {
  it("steps each availability window for the weekday by slotMinutes", () => {
    const w = windowsForDate(AVAIL, MON);
    expect(w).toEqual([{ start: 540, end: 600 }, { start: 840, end: 900 }]);
    expect(slotStartsForWindows(w, 15)).toEqual([540, 555, 570, 585, 840, 855, 870, 885]);
    // 20-minute slots: last slot must end inside the window
    expect(slotStartsForWindows([{ start: 540, end: 600 }], 25)).toEqual([540, 565]);
  });

  it("returns local HH:MM labels with UTC instants for the hospital time zone", () => {
    const slots = generateSlots({ date: MON, tz: KHI, availability: AVAIL, slotMinutes: 15, now: EARLY });
    expect(slots).toHaveLength(8);
    expect(slots[0]).toMatchObject({ start: "09:00", startsAt: "2026-10-12T04:00:00.000Z", endsAt: "2026-10-12T04:15:00.000Z", available: true });
    expect(slots[4].start).toBe("14:00");
    expect(slots[4].startsAt).toBe("2026-10-12T09:00:00.000Z");
  });

  it("returns nothing on a weekday without availability", () => {
    expect(generateSlots({ date: "2026-10-11", tz: KHI, availability: AVAIL, slotMinutes: 15, now: EARLY })).toEqual([]);
  });

  it("marks slots overlapping a schedule exception as unavailable", () => {
    const exceptions = [{ startsAt: new Date("2026-10-12T04:10:00Z"), endsAt: new Date("2026-10-12T04:40:00Z") }]; // 09:10–09:40 local
    const slots = generateSlots({ date: MON, tz: KHI, availability: AVAIL, slotMinutes: 15, exceptions, now: EARLY });
    const byStart = Object.fromEntries(slots.map((s) => [s.start, s]));
    expect(byStart["09:00"]).toMatchObject({ available: false, reason: "unavailable" });
    expect(byStart["09:15"].available).toBe(false);
    expect(byStart["09:30"].available).toBe(false);
    expect(byStart["09:45"].available).toBe(true);
  });

  it("marks booked slots (but not cancelled ones) as unavailable", () => {
    const appointments = [
      appt("x", "2026-10-12T04:15:00Z", "2026-10-12T04:30:00Z", "CONFIRMED"),
      appt("y", "2026-10-12T04:30:00Z", "2026-10-12T04:45:00Z", "CANCELLED"),
      appt("z", "2026-10-12T09:05:00Z", "2026-10-12T09:20:00Z", "CHECKED_IN"), // walk-in straddling 14:00/14:15
    ];
    const slots = generateSlots({ date: MON, tz: KHI, availability: AVAIL, slotMinutes: 15, appointments, now: EARLY });
    const byStart = Object.fromEntries(slots.map((s) => [s.start, s]));
    expect(byStart["09:15"]).toMatchObject({ available: false, reason: "booked" });
    expect(byStart["09:30"].available).toBe(true);
    expect(byStart["14:00"].available).toBe(false);
    expect(byStart["14:15"].available).toBe(false);
    expect(byStart["14:30"].available).toBe(true);
  });

  it("omits past slots for today", () => {
    const now = new Date("2026-10-12T04:20:00Z"); // 09:20 local
    const slots = generateSlots({ date: MON, tz: KHI, availability: AVAIL, slotMinutes: 15, now });
    expect(slots.map((s) => s.start)).toEqual(["09:30", "09:45", "14:00", "14:15", "14:30", "14:45"]);
    // A slot starting exactly now is also gone
    expect(generateSlots({ date: MON, tz: KHI, availability: AVAIL, slotMinutes: 15, now: new Date("2026-10-12T04:30:00Z") })[0].start).toBe("09:45");
  });

  it("handles time zones with daylight saving", () => {
    // New York: 2026-03-08 is the DST start day (UTC-5 → UTC-4); 2026-03-09 is a Monday in EDT.
    const avail = [{ weekday: 1, startTime: "09:00", endTime: "09:30" }, { weekday: 0, startTime: "09:00", endTime: "09:30" }];
    const mon = generateSlots({ date: "2026-03-09", tz: "America/New_York", availability: avail, slotMinutes: 15, now: new Date("2026-01-01T00:00:00Z") });
    expect(mon.map((s) => s.startsAt)).toEqual(["2026-03-09T13:00:00.000Z", "2026-03-09T13:15:00.000Z"]);
    const winterMon = generateSlots({ date: "2026-01-05", tz: "America/New_York", availability: avail, slotMinutes: 15, now: new Date("2026-01-01T00:00:00Z") });
    expect(winterMon[0].startsAt).toBe("2026-01-05T14:00:00.000Z");
    // Local-date boundary: Karachi 00:30 belongs to the local day even though it is the previous UTC day
    const night = generateSlots({ date: MON, tz: KHI, availability: [{ weekday: 1, startTime: "00:00", endTime: "01:00" }], slotMinutes: 30, now: EARLY });
    expect(night.map((s) => s.startsAt)).toEqual(["2026-10-11T19:00:00.000Z", "2026-10-11T19:30:00.000Z"]);
  });
});

describe("booking validation", () => {
  const base = { date: MON, tz: KHI, availability: AVAIL, slotMinutes: 15, now: EARLY };
  it("accepts a free slot on the grid", () => {
    const r = checkBooking({ ...base, time: "09:15" });
    expect(r.ok).toBe(true);
    expect(r.startsAt.toISOString()).toBe("2026-10-12T04:15:00.000Z");
    expect(r.endsAt.toISOString()).toBe("2026-10-12T04:30:00.000Z");
  });
  it("rejects times outside availability or off the slot grid (422)", () => {
    expect(checkBooking({ ...base, time: "11:00" })).toMatchObject({ ok: false, status: 422, code: "OUTSIDE_AVAILABILITY" });
    expect(checkBooking({ ...base, time: "09:07" })).toMatchObject({ ok: false, code: "OUTSIDE_AVAILABILITY" });
    expect(checkBooking({ ...base, time: "09:50" })).toMatchObject({ ok: false, code: "OUTSIDE_AVAILABILITY" }); // would end after 10:00
  });
  it("rejects the past", () => {
    expect(checkBooking({ ...base, time: "09:00", now: new Date("2026-10-12T05:00:00Z") })).toMatchObject({ ok: false, code: "PAST" });
  });
  it("rejects exceptions and taken slots with 409", () => {
    const exceptions = [{ startsAt: new Date("2026-10-12T04:00:00Z"), endsAt: new Date("2026-10-12T05:00:00Z") }];
    expect(checkBooking({ ...base, time: "09:30", exceptions })).toMatchObject({ ok: false, status: 409, code: "SCHEDULE_EXCEPTION" });
    const doctorAppointments = [appt("d1", "2026-10-12T04:30:00Z", "2026-10-12T04:45:00Z")];
    expect(checkBooking({ ...base, time: "09:30", doctorAppointments })).toMatchObject({ ok: false, status: 409, code: "SLOT_TAKEN" });
    // rescheduling the same appointment onto its own slot is not a clash
    expect(checkBooking({ ...base, time: "09:30", doctorAppointments, excludeId: "d1" }).ok).toBe(true);
  });
  it("prevents the same patient double-booking overlapping times", () => {
    const patientAppointments = [appt("p1", "2026-10-12T04:20:00Z", "2026-10-12T04:40:00Z", "SCHEDULED", { appointmentNo: "APT-2026-000999" })];
    const r = checkBooking({ ...base, time: "09:30", patientAppointments });
    expect(r).toMatchObject({ ok: false, status: 409, code: "PATIENT_CONFLICT" });
    expect(r.message).toContain("APT-2026-000999");
  });
  it("walk-ins bypass windows and doctor overlaps but not exceptions or patient clashes", () => {
    const startsAt = new Date("2026-10-12T07:00:00Z"); // 12:00 local, outside windows
    const doctorAppointments = [appt("d1", "2026-10-12T07:00:00Z", "2026-10-12T07:15:00Z")];
    expect(checkBooking({ ...base, time: "12:00", startsAt, doctorAppointments, bypassAvailability: true }).ok).toBe(true);
    const exceptions = [{ startsAt: new Date("2026-10-12T06:00:00Z"), endsAt: new Date("2026-10-12T08:00:00Z") }];
    expect(checkBooking({ ...base, time: "12:00", startsAt, exceptions, bypassAvailability: true }).code).toBe("SCHEDULE_EXCEPTION");
    const patientAppointments = [appt("p", "2026-10-12T07:10:00Z", "2026-10-12T07:25:00Z")];
    expect(checkBooking({ ...base, time: "12:00", startsAt, patientAppointments, bypassAvailability: true }).code).toBe("PATIENT_CONFLICT");
  });
  it("isWithinAvailability respects window boundaries", () => {
    const w = windowsForDate(AVAIL, MON);
    expect(isWithinAvailability(w, 585, 15)).toBe(true);
    expect(isWithinAvailability(w, 600, 15)).toBe(false);
    expect(isWithinAvailability(w, 839, 15)).toBe(false);
  });
});

describe("appointment state machine", () => {
  it("defines the allowed transitions explicitly", () => {
    expect(APPOINTMENT_TRANSITIONS.REQUESTED.sort()).toEqual(["CANCELLED", "CONFIRMED"]);
    expect(APPOINTMENT_TRANSITIONS.SCHEDULED.sort()).toEqual(["CANCELLED", "CHECKED_IN", "CONFIRMED", "NO_SHOW"]);
    expect(APPOINTMENT_TRANSITIONS.CONFIRMED.sort()).toEqual(["CANCELLED", "CHECKED_IN", "NO_SHOW"]);
    expect(APPOINTMENT_TRANSITIONS.CHECKED_IN.sort()).toEqual(["CANCELLED", "IN_PROGRESS"]);
    expect(APPOINTMENT_TRANSITIONS.IN_PROGRESS).toEqual(["COMPLETED"]);
  });
  it("makes COMPLETED, CANCELLED and NO_SHOW terminal", () => {
    for (const s of ["COMPLETED", "CANCELLED", "NO_SHOW"]) {
      expect(APPOINTMENT_TRANSITIONS[s]).toEqual([]);
      expect(actionsFor(s)).toEqual([]);
    }
  });
  it("rejects skipping states", () => {
    expect(canTransition("SCHEDULED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("REQUESTED", "CHECKED_IN")).toBe(false);
    expect(canTransition("CHECKED_IN", "COMPLETED")).toBe(false);
    expect(canTransition("IN_PROGRESS", "CANCELLED")).toBe(false);
    expect(canTransition("CHECKED_IN", "IN_PROGRESS")).toBe(true);
  });
  it("only allows rescheduling before check-in", () => {
    expect(isActionAllowed("reschedule", "SCHEDULED")).toBe(true);
    expect(isActionAllowed("reschedule", "CONFIRMED")).toBe(true);
    expect(isActionAllowed("reschedule", "CHECKED_IN")).toBe(false);
    expect(isActionAllowed("bogus", "SCHEDULED")).toBe(false);
  });
  it("covers every status", () => {
    expect(Object.keys(APPOINTMENT_TRANSITIONS).sort()).toEqual([...APPOINTMENT_STATUSES].sort());
  });
});

describe("allergy name match", () => {
  const meds = [
    { id: "amx", genericName: "Amoxicillin", brandName: "Amoxil", category: "Antibiotic" },
    { id: "asp", genericName: "Aspirin", brandName: "Disprin", category: "NSAID" },
    { id: "pcm", genericName: "Paracetamol", brandName: "Panadol", category: "Analgesic" },
  ];
  it("matches case-insensitively on generic name, brand name or category", () => {
    const r = matchAllergies([{ id: "a1", substance: "ASPIRIN" }, { id: "a2", substance: "amoxil" }, { id: "a3", substance: "antibiotics" }], meds);
    expect(r.map((m) => [m.allergyId, m.medicationId, m.matchedOn])).toEqual([["a1", "asp", "genericName"], ["a2", "amx", "brandName"], ["a3", "amx", "category"]]);
  });
  it("matches when one name contains the other", () => {
    expect(matchAllergies([{ id: "a", substance: "Paracetamol 500mg" }], meds)).toHaveLength(1);
  });
  it("does not flag unrelated substances, short strings or inactive allergies", () => {
    expect(matchAllergies([{ id: "a", substance: "Penicillin" }, { id: "b", substance: "Peanuts" }], meds)).toEqual([]);
    expect(matchAllergies([{ id: "c", substance: "as" }], meds)).toEqual([]);
    expect(matchAllergies([{ id: "d", substance: "Aspirin", isActive: false }], meds)).toEqual([]);
    expect(matchAllergies([], meds)).toEqual([]);
  });
  it("reports at most one match per allergy/medicine pair and tolerates missing fields", () => {
    const r = matchAllergies([{ id: "a", substance: "Panadol" }], [{ id: "x", genericName: "Panadol", brandName: "Panadol", category: null }]);
    expect(r).toHaveLength(1);
    expect(r[0].medicationName).toBe("Panadol (Panadol)");
  });
  it("is labelled as a basic name match, not decision support", () => {
    expect(ALLERGY_CHECK_LABEL).toBe("Basic name match against recorded allergies — not a drug-interaction or clinical decision-support check");
  });
});

describe("calendar helpers", () => {
  it("lays out overlapping events side by side", () => {
    const out = assignLanes([{ id: 1, startMin: 540, endMin: 555 }, { id: 2, startMin: 545, endMin: 560 }, { id: 3, startMin: 600, endMin: 615 }]);
    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect([byId[1].lane, byId[2].lane, byId[1].lanes]).toEqual([0, 1, 2]);
    expect([byId[3].lane, byId[3].lanes]).toEqual([0, 1]);
  });
  it("builds Monday-first weeks and month grids", () => {
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday → previous Monday
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    const g = monthGrid("2026-10-15");
    expect(g[0]).toBe("2026-09-28");
    expect(g.length % 7).toBe(0);
    expect(g).toContain("2026-10-31");
  });
});
