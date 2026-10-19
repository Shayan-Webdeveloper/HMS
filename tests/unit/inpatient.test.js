import { describe, it, expect } from "vitest";
import {
  BED_STATUSES, BED_MANUAL_TRANSITIONS, canChangeBedStatus, bedStatusRequiresReason, bedStatusSchema, bedActionLabel,
  occupancyStats, nextBedLabels, parseBedLabels, addBedsSchema, lengthOfStay, formatLos, vitalsSchema, marSchema, dischargeSchema, wardSchema,
} from "@/lib/validation/inpatient";
import {
  ER_STATUSES, ER_TRANSITIONS, canErTransition, dispositionsFrom, canTriage, isErActive, dispositionSchema, erRegisterSchema, formatWait,
  canDispatchTransition, dispatchReleasesAmbulance, canChangeAmbulanceStatus, dispatchStatusSchema,
} from "@/lib/validation/emergency";
import {
  intervalsOverlap, findScheduleConflicts, canProcedureTransition, procedureStartBlocker, isChecklistComplete, CHECKLIST_KEYS,
  checklistSchema, procedureSchema, procedureStatusSchema, timelineBlock,
} from "@/lib/validation/procedures";

const TZ = "Asia/Karachi"; // UTC+5, no DST

describe("bed status transitions", () => {
  it("never allows manual changes on an occupied bed", () => {
    for (const to of BED_STATUSES) expect(canChangeBedStatus("OCCUPIED", to)).toBe(false);
    expect(BED_MANUAL_TRANSITIONS.OCCUPIED).toEqual([]);
  });
  it("never allows a manual move into OCCUPIED (only admission/transfer may occupy)", () => {
    for (const from of BED_STATUSES) expect(canChangeBedStatus(from, "OCCUPIED")).toBe(false);
  });
  it("supports mark clean, reserve/release, out of service and return to service", () => {
    expect(canChangeBedStatus("CLEANING", "AVAILABLE")).toBe(true);
    expect(canChangeBedStatus("AVAILABLE", "RESERVED")).toBe(true);
    expect(canChangeBedStatus("RESERVED", "AVAILABLE")).toBe(true);
    expect(canChangeBedStatus("AVAILABLE", "OUT_OF_SERVICE")).toBe(true);
    expect(canChangeBedStatus("CLEANING", "OUT_OF_SERVICE")).toBe(true);
    expect(canChangeBedStatus("OUT_OF_SERVICE", "AVAILABLE")).toBe(true);
  });
  it("rejects nonsensical moves and no-ops", () => {
    expect(canChangeBedStatus("OUT_OF_SERVICE", "RESERVED")).toBe(false);
    expect(canChangeBedStatus("CLEANING", "RESERVED")).toBe(false);
    expect(canChangeBedStatus("AVAILABLE", "AVAILABLE")).toBe(false);
    expect(canChangeBedStatus("UNKNOWN", "AVAILABLE")).toBe(false);
  });
  it("requires a reason to take a bed out of service", () => {
    expect(bedStatusRequiresReason("OUT_OF_SERVICE")).toBe(true);
    expect(bedStatusSchema.safeParse({ status: "OUT_OF_SERVICE" }).success).toBe(false);
    expect(bedStatusSchema.safeParse({ status: "OUT_OF_SERVICE", reason: "Broken rail" }).success).toBe(true);
    expect(bedStatusSchema.safeParse({ status: "OCCUPIED" }).success).toBe(false);
    expect(bedStatusSchema.safeParse({ status: "AVAILABLE" }).success).toBe(true);
  });
  it("labels the actions", () => {
    expect(bedActionLabel("CLEANING", "AVAILABLE")).toBe("Mark clean");
    expect(bedActionLabel("OUT_OF_SERVICE", "AVAILABLE")).toBe("Return to service");
  });
});

describe("beds & wards helpers", () => {
  it("computes occupancy over in-service beds only", () => {
    const s = occupancyStats([{ status: "OCCUPIED" }, { status: "OCCUPIED" }, { status: "AVAILABLE" }, { status: "CLEANING" }, { status: "OUT_OF_SERVICE" }]);
    expect(s).toMatchObject({ total: 5, inService: 4, OCCUPIED: 2, AVAILABLE: 1, CLEANING: 1, OUT_OF_SERVICE: 1, occupancyPct: 50 });
    expect(occupancyStats([]).occupancyPct).toBe(0);
    expect(occupancyStats([{ status: "OUT_OF_SERVICE" }]).occupancyPct).toBe(0);
  });
  it("generates the next sequential bed labels", () => {
    expect(nextBedLabels("GMW", ["GMW-01", "GMW-09", "GMW-10", "X-99"], 2)).toEqual(["GMW-11", "GMW-12"]);
    expect(nextBedLabels("ICU", [], 1)).toEqual(["ICU-01"]);
  });
  it("parses and validates bed labels", () => {
    expect(parseBedLabels("A-1, A-2\nA-3,, ")).toEqual(["A-1", "A-2", "A-3"]);
    expect(addBedsSchema.safeParse({ labels: ["A-1", "a-1"] }).success).toBe(false);
    expect(addBedsSchema.safeParse({ labels: [] }).success).toBe(false);
  });
  it("validates ward code and money", () => {
    const r = wardSchema.safeParse({ name: "ICU 2", code: "icu-2", type: "ICU", dailyRate: "15000.50" });
    expect(r.success).toBe(true);
    expect(r.data.code).toBe("ICU-2");
    expect(wardSchema.safeParse({ name: "X", code: "X", type: "ICU", dailyRate: "1.234" }).success).toBe(false);
  });
});

describe("length of stay", () => {
  it("counts a same-day stay as one day", () => {
    const a = new Date("2026-10-09T04:00:00Z"); // 09:00 PKT
    const b = new Date("2026-10-09T13:00:00Z"); // 18:00 PKT
    expect(lengthOfStay(a, b, TZ)).toEqual({ days: 1, hours: 9, midnights: 0 });
  });
  it("counts midnights crossed in the hospital time zone, not UTC", () => {
    // 23:30 PKT on the 8th → 00:30 PKT on the 9th: one local midnight, though the same UTC date.
    const a = new Date("2026-10-08T18:30:00Z");
    const b = new Date("2026-10-08T19:30:00Z");
    expect(lengthOfStay(a, b, TZ).midnights).toBe(1);
    expect(lengthOfStay(a, b, "UTC").midnights).toBe(0);
  });
  it("handles multi-day stays", () => {
    const a = new Date("2026-10-01T05:00:00Z");
    const b = new Date("2026-10-05T05:00:00Z");
    expect(lengthOfStay(a, b, TZ)).toMatchObject({ days: 4, hours: 96 });
    expect(formatLos(a, b, TZ)).toBe("4 days");
  });
  it("uses now for open admissions and is safe for bad input", () => {
    const a = new Date(Date.now() - 3 * 86400000);
    expect(lengthOfStay(a, null, TZ).days).toBeGreaterThanOrEqual(3);
    expect(lengthOfStay("not-a-date", null, TZ).days).toBe(1);
    expect(lengthOfStay(new Date("2026-10-05T00:00:00Z"), new Date("2026-10-01T00:00:00Z"), TZ).days).toBe(1);
  });
});

describe("inpatient clinical schemas", () => {
  it("requires at least one vital and a coherent blood pressure", () => {
    expect(vitalsSchema.safeParse({}).success).toBe(false);
    expect(vitalsSchema.safeParse({ pulse: "88" }).success).toBe(true);
    expect(vitalsSchema.safeParse({ systolic: "120" }).success).toBe(false);
    expect(vitalsSchema.safeParse({ systolic: "80", diastolic: "90" }).success).toBe(false);
    expect(vitalsSchema.safeParse({ temperatureC: "52" }).success).toBe(false);
  });
  it("requires a reason when a dose is held or refused", () => {
    expect(marSchema.safeParse({ medicationName: "Paracetamol 1 g", dose: "1 g", status: "GIVEN" }).success).toBe(true);
    expect(marSchema.safeParse({ medicationName: "Paracetamol 1 g", dose: "1 g", status: "HELD" }).success).toBe(false);
    expect(marSchema.safeParse({ dose: "1 g", status: "GIVEN" }).success).toBe(false);
  });
  it("requires a discharge summary and condition", () => {
    expect(dischargeSchema.safeParse({ dischargeSummary: "short", dischargeCondition: "Improved" }).success).toBe(false);
    expect(dischargeSchema.safeParse({ dischargeSummary: "Recovered well after treatment.", dischargeCondition: "Improved" }).success).toBe(true);
    expect(dischargeSchema.safeParse({ dischargeSummary: "Recovered well after treatment.", dischargeCondition: "Improved", dischargeDate: "2026-10-09" }).success).toBe(false);
  });
});

describe("ER status transitions", () => {
  it("defines a transition list for every status", () => {
    for (const s of ER_STATUSES) expect(Array.isArray(ER_TRANSITIONS[s])).toBe(true);
  });
  it("requires triage before treatment", () => {
    expect(canErTransition("WAITING_TRIAGE", "UNDER_TREATMENT")).toBe(false);
    expect(canErTransition("WAITING_TRIAGE", "TRIAGED")).toBe(true);
    expect(canErTransition("TRIAGED", "UNDER_TREATMENT")).toBe(true);
  });
  it("only allows clinical dispositions after treatment has started", () => {
    expect(canErTransition("TRIAGED", "DISCHARGED")).toBe(false);
    expect(canErTransition("TRIAGED", "ADMITTED")).toBe(false);
    expect(canErTransition("UNDER_TREATMENT", "DISCHARGED")).toBe(true);
    expect(canErTransition("UNDER_TREATMENT", "ADMITTED")).toBe(true);
    expect(canErTransition("UNDER_TREATMENT", "LEFT_WITHOUT_BEING_SEEN")).toBe(false);
    expect(dispositionsFrom("WAITING_TRIAGE")).toEqual(["LEFT_WITHOUT_BEING_SEEN"]);
    expect(dispositionsFrom("UNDER_TREATMENT")).toEqual(["DISCHARGED", "ADMITTED", "TRANSFERRED"]);
  });
  it("treats dispositions as terminal", () => {
    for (const s of ["ADMITTED", "TRANSFERRED", "DISCHARGED", "LEFT_WITHOUT_BEING_SEEN"]) {
      expect(isErActive(s)).toBe(false);
      expect(canTriage(s)).toBe(false);
      for (const to of ER_STATUSES) expect(canErTransition(s, to)).toBe(false);
    }
  });
  it("requires a destination for transfers", () => {
    expect(dispositionSchema.safeParse({ disposition: "TRANSFERRED" }).success).toBe(false);
    expect(dispositionSchema.safeParse({ disposition: "TRANSFERRED", destination: "City Trauma Centre" }).success).toBe(true);
  });
  it("validates registration for existing vs. quick-registered patients", () => {
    expect(erRegisterSchema.safeParse({ patientMode: "EXISTING", patientId: "abc", arrivalMode: "WALK_IN", presentingComplaint: "Chest pain", newPatient: { firstName: "" } }).success).toBe(true);
    expect(erRegisterSchema.safeParse({ patientMode: "EXISTING", arrivalMode: "WALK_IN", presentingComplaint: "Chest pain" }).success).toBe(false);
    expect(erRegisterSchema.safeParse({ patientMode: "NEW", patientId: "", newPatient: { firstName: "Unknown", lastName: "Male" }, arrivalMode: "AMBULANCE", presentingComplaint: "RTA" }).success).toBe(true);
    expect(erRegisterSchema.safeParse({ patientMode: "NEW", newPatient: { firstName: "", lastName: "" }, arrivalMode: "AMBULANCE", presentingComplaint: "RTA" }).success).toBe(false);
  });
  it("formats waiting time", () => {
    expect(formatWait(35)).toBe("35 m");
    expect(formatWait(125)).toBe("2 h 05 m");
    expect(formatWait(60 * 50)).toBe("2 d 2 h");
  });
});

describe("ambulance dispatch transitions", () => {
  it("follows dispatched → on scene → transporting → completed", () => {
    expect(canDispatchTransition("DISPATCHED", "ON_SCENE")).toBe(true);
    expect(canDispatchTransition("DISPATCHED", "TRANSPORTING")).toBe(false);
    expect(canDispatchTransition("ON_SCENE", "TRANSPORTING")).toBe(true);
    expect(canDispatchTransition("TRANSPORTING", "COMPLETED")).toBe(true);
    expect(canDispatchTransition("TRANSPORTING", "CANCELLED")).toBe(false);
    expect(canDispatchTransition("COMPLETED", "CANCELLED")).toBe(false);
  });
  it("releases the ambulance on completion or cancellation only", () => {
    expect(dispatchReleasesAmbulance("COMPLETED")).toBe(true);
    expect(dispatchReleasesAmbulance("CANCELLED")).toBe(true);
    expect(dispatchReleasesAmbulance("ON_SCENE")).toBe(false);
  });
  it("never changes a dispatched vehicle manually and requires a cancel reason", () => {
    expect(canChangeAmbulanceStatus("DISPATCHED", "AVAILABLE")).toBe(false);
    expect(canChangeAmbulanceStatus("AVAILABLE", "MAINTENANCE")).toBe(true);
    expect(dispatchStatusSchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
  });
});

describe("theatre / surgeon overlap detection", () => {
  const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 12, h, m));
  const existing = [
    { id: "p1", theatreId: "T1", surgeonId: "S1", status: "SCHEDULED", scheduledStart: at(9), scheduledEnd: at(10, 30) },
    { id: "p2", theatreId: "T2", surgeonId: "S2", status: "IN_PROGRESS", scheduledStart: at(11), scheduledEnd: at(12) },
    { id: "p3", theatreId: "T1", surgeonId: "S3", status: "CANCELLED", scheduledStart: at(13), scheduledEnd: at(14) },
    { id: "p4", theatreId: "T3", surgeonId: "S4", status: "COMPLETED", scheduledStart: at(15), scheduledEnd: at(16) },
  ];
  it("uses half-open intervals (back-to-back is not a clash)", () => {
    expect(intervalsOverlap(at(9), at(10), at(10), at(11))).toBe(false);
    expect(intervalsOverlap(at(9), at(10, 1), at(10), at(11))).toBe(true);
    expect(intervalsOverlap(at(8), at(12), at(9), at(10))).toBe(true); // containment
    expect(intervalsOverlap(at(9), at(10), at(8), at(12))).toBe(true);
  });
  it("detects a theatre clash with a different surgeon", () => {
    const c = findScheduleConflicts({ theatreId: "T1", surgeonId: "S9", scheduledStart: at(10), scheduledEnd: at(11) }, existing);
    expect(c.theatre.map((p) => p.id)).toEqual(["p1"]);
    expect(c.surgeon).toEqual([]);
    expect(c.any).toBe(true);
  });
  it("detects a surgeon clash in a different theatre", () => {
    const c = findScheduleConflicts({ theatreId: "T9", surgeonId: "S2", scheduledStart: at(11, 30), scheduledEnd: at(12, 30) }, existing);
    expect(c.surgeon.map((p) => p.id)).toEqual(["p2"]);
    expect(c.theatre).toEqual([]);
  });
  it("reports both when theatre and surgeon clash", () => {
    const c = findScheduleConflicts({ theatreId: "T1", surgeonId: "S1", scheduledStart: at(9, 30), scheduledEnd: at(10) }, existing);
    expect(c.theatre.map((p) => p.id)).toEqual(["p1"]);
    expect(c.surgeon.map((p) => p.id)).toEqual(["p1"]);
  });
  it("ignores cancelled/completed procedures and the procedure being edited", () => {
    expect(findScheduleConflicts({ theatreId: "T1", surgeonId: "S3", scheduledStart: at(13), scheduledEnd: at(14) }, existing).any).toBe(false);
    expect(findScheduleConflicts({ theatreId: "T3", surgeonId: "S4", scheduledStart: at(15), scheduledEnd: at(16) }, existing).any).toBe(false);
    expect(findScheduleConflicts({ id: "p1", theatreId: "T1", surgeonId: "S1", scheduledStart: at(9), scheduledEnd: at(10) }, existing).any).toBe(false);
  });
  it("allows back-to-back bookings in the same theatre", () => {
    expect(findScheduleConflicts({ theatreId: "T1", surgeonId: "S1", scheduledStart: at(10, 30), scheduledEnd: at(11) }, existing).any).toBe(false);
  });
  it("positions timeline blocks within the visible window", () => {
    expect(timelineBlock(9 * 60, 10 * 60, 7 * 60, 19 * 60)).toEqual({ left: (2 / 12) * 100, width: (1 / 12) * 100 });
  });
});

describe("procedure workflow rules", () => {
  it("blocks start until the checklist is complete", () => {
    expect(procedureStartBlocker({ status: "SCHEDULED", checklistComplete: false })).toMatch(/checklist/i);
    expect(procedureStartBlocker({ status: "SCHEDULED", checklistComplete: true })).toBeNull();
    expect(procedureStartBlocker({ status: "COMPLETED", checklistComplete: true })).toMatch(/scheduled/i);
  });
  it("only accepts a checklist with every item ticked", () => {
    const all = Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, true]));
    expect(isChecklistComplete(all)).toBe(true);
    expect(isChecklistComplete({ ...all, consent: false })).toBe(false);
    expect(checklistSchema.safeParse({ items: { ...all, site: false } }).success).toBe(false);
    expect(checklistSchema.safeParse({ items: all }).success).toBe(true);
  });
  it("enforces the status map and required notes", () => {
    expect(canProcedureTransition("SCHEDULED", "COMPLETED")).toBe(false);
    expect(canProcedureTransition("SCHEDULED", "IN_PROGRESS")).toBe(true);
    expect(canProcedureTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canProcedureTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(procedureStatusSchema.safeParse({ status: "COMPLETED" }).success).toBe(false);
    expect(procedureStatusSchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
    expect(procedureStatusSchema.safeParse({ status: "CANCELLED", reason: "Patient unfit" }).success).toBe(true);
  });
  it("rejects an end time before the start time", () => {
    const base = { patientId: "p", surgeonId: "s", theatreId: "t", name: "Hernia repair", date: "2026-10-12", charge: "1000" };
    expect(procedureSchema.safeParse({ ...base, startTime: "10:00", endTime: "09:00" }).success).toBe(false);
    expect(procedureSchema.safeParse({ ...base, startTime: "09:00", endTime: "10:00" }).success).toBe(true);
  });
});
