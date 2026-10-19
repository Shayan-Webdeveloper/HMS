import { describe, it, expect } from "vitest";
import {
  computeFlag, flagForResult, parseNumericValue, formatReferenceRange, describeReference, planSegments,
  LAB_ALLOWED, LAB_STATUSES, canTransitionLab, labOrderSchema, labTestSchema, resultEntrySchema,
} from "@/lib/validation/lab";
import { IMAGING_ALLOWED, IMAGING_STATUSES, canTransitionImaging, imagingCatalogSchema } from "@/lib/validation/radiology";

describe("lab result flagging", () => {
  it("flags numeric values against low/high", () => {
    expect(computeFlag("11.9", "12.000", "17.500")).toBe("LOW");
    expect(computeFlag("14", "12.000", "17.500")).toBe("NORMAL");
    expect(computeFlag("17.6", "12.000", "17.500")).toBe("HIGH");
  });
  it("treats the range boundaries as normal (inclusive)", () => {
    expect(computeFlag("12", "12.000", "17.500")).toBe("NORMAL");
    expect(computeFlag("12.000", "12.000", "17.500")).toBe("NORMAL");
    expect(computeFlag("17.5", "12.000", "17.500")).toBe("NORMAL");
    expect(computeFlag("17.501", "12.000", "17.500")).toBe("HIGH");
    expect(computeFlag("11.999", "12.000", "17.500")).toBe("LOW");
  });
  it("never flags text results", () => {
    expect(computeFlag("Positive", "0", "1")).toBeNull();
    expect(computeFlag("<0.5", "1", "5")).toBeNull();
    expect(computeFlag(">1000", "1", "5")).toBeNull();
    expect(computeFlag("1,200", "100", "400")).toBeNull();
    expect(computeFlag("12 g/dL", "12", "17")).toBeNull();
    expect(computeFlag("", "12", "17")).toBeNull();
    expect(computeFlag(null, "12", "17")).toBeNull();
  });
  it("returns null when no numeric range is configured", () => {
    expect(computeFlag("5", null, null)).toBeNull();
    expect(computeFlag("5", "", "")).toBeNull();
    expect(computeFlag("5", undefined, undefined)).toBeNull();
  });
  it("supports one-sided ranges", () => {
    expect(computeFlag("250", null, "200.000")).toBe("HIGH");
    expect(computeFlag("200", null, "200.000")).toBe("NORMAL");
    expect(computeFlag("150", null, "200.000")).toBe("NORMAL");
    expect(computeFlag("0.3", "0.4", null)).toBe("LOW");
    expect(computeFlag("9", "0.4", null)).toBe("NORMAL");
  });
  it("handles negative ranges and decimal-like objects", () => {
    expect(computeFlag("-3", "-2", "2")).toBe("LOW");
    expect(computeFlag("+1", "-2", "2")).toBe("NORMAL");
    const dec = (s) => ({ toString: () => s });
    expect(computeFlag("4.1", dec("4.000"), dec("11.000"))).toBe("NORMAL");
    expect(computeFlag("3.9", dec("4.000"), dec("11.000"))).toBe("LOW");
  });
  it("parses numbers strictly", () => {
    expect(parseNumericValue(" 7.25 ")).toBe(7.25);
    expect(parseNumericValue(".5")).toBe(0.5);
    expect(parseNumericValue("1e3")).toBeNull();
    expect(parseNumericValue("NaN")).toBeNull();
    expect(parseNumericValue("Infinity")).toBeNull();
  });
  it("does not flag when the reported unit differs from the configured unit", () => {
    const test = { unit: "mg/dL", referenceLow: "70", referenceHigh: "100" };
    expect(flagForResult(test, "150", "mg/dL")).toBe("HIGH");
    expect(flagForResult(test, "150", "")).toBe("HIGH");
    expect(flagForResult(test, "5.5", "mmol/L")).toBeNull();
    expect(flagForResult({ unit: null, referenceLow: "1", referenceHigh: "2" }, "3", "x")).toBe("HIGH");
  });
  it("formats reference ranges", () => {
    expect(formatReferenceRange({ referenceLow: "12.000", referenceHigh: "17.500" })).toBe("12–17.5");
    expect(formatReferenceRange({ referenceLow: null, referenceHigh: "200.000" })).toBe("≤ 200");
    expect(formatReferenceRange({ referenceLow: "0.400", referenceHigh: null })).toBe("≥ 0.4");
    expect(formatReferenceRange({ referenceText: "Negative" })).toBe("Negative");
    expect(formatReferenceRange({})).toBeNull();
    expect(describeReference({ referenceLow: "4", referenceHigh: "11", unit: "×10⁹/L" })).toBe("4–11 ×10⁹/L");
    expect(describeReference({ referenceText: "See report" })).toBe("See report");
  });
});

describe("lab status transition map", () => {
  it("covers every status", () => {
    expect(Object.keys(LAB_ALLOWED).sort()).toEqual([...LAB_STATUSES].sort());
    for (const targets of Object.values(LAB_ALLOWED)) for (const t of targets) expect(LAB_STATUSES).toContain(t);
  });
  it("allows the happy path", () => {
    const path = ["REQUESTED", "SAMPLE_COLLECTED", "PROCESSING", "AWAITING_VALIDATION", "RELEASED"];
    for (let i = 0; i < path.length - 1; i++) expect(canTransitionLab(path[i], path[i + 1])).toBe(true);
  });
  it("cancels only before processing", () => {
    expect(canTransitionLab("REQUESTED", "CANCELLED")).toBe(true);
    expect(canTransitionLab("SAMPLE_COLLECTED", "CANCELLED")).toBe(true);
    expect(canTransitionLab("PROCESSING", "CANCELLED")).toBe(false);
    expect(canTransitionLab("AWAITING_VALIDATION", "CANCELLED")).toBe(false);
    expect(canTransitionLab("RELEASED", "CANCELLED")).toBe(false);
  });
  it("supports specimen rejection with or without recollection", () => {
    expect(canTransitionLab("SAMPLE_COLLECTED", "REQUESTED")).toBe(true);
    expect(canTransitionLab("SAMPLE_COLLECTED", "REJECTED")).toBe(true);
    expect(canTransitionLab("PROCESSING", "REQUESTED")).toBe(true);
    expect(canTransitionLab("REQUESTED", "REJECTED")).toBe(false);
  });
  it("requires re-validation after a post-release correction", () => {
    expect(canTransitionLab("RELEASED", "AWAITING_VALIDATION")).toBe(true);
    expect(LAB_ALLOWED.RELEASED).toEqual(["AWAITING_VALIDATION"]);
  });
  it("cannot skip validation or leave terminal states", () => {
    expect(canTransitionLab("PROCESSING", "RELEASED")).toBe(false);
    expect(canTransitionLab("SAMPLE_COLLECTED", "AWAITING_VALIDATION")).toBe(false);
    expect(canTransitionLab("REQUESTED", "PROCESSING")).toBe(false);
    for (const to of LAB_STATUSES) {
      expect(canTransitionLab("CANCELLED", to)).toBe(false);
      expect(canTransitionLab("REJECTED", to)).toBe(false);
    }
    expect(canTransitionLab("BOGUS", "RELEASED")).toBe(false);
  });
});

describe("radiology status transition map", () => {
  it("covers every status", () => {
    expect(Object.keys(IMAGING_ALLOWED).sort()).toEqual([...IMAGING_STATUSES].sort());
  });
  it("allows the happy path including rescheduling", () => {
    for (const [a, b] of [["REQUESTED", "SCHEDULED"], ["SCHEDULED", "SCHEDULED"], ["SCHEDULED", "IN_PROGRESS"], ["IN_PROGRESS", "REPORTED"], ["REPORTED", "VERIFIED"]]) {
      expect(canTransitionImaging(a, b)).toBe(true);
    }
    expect(canTransitionImaging("REQUESTED", "IN_PROGRESS")).toBe(true); // walk-in
  });
  it("prevents skipping reporting/verification", () => {
    expect(canTransitionImaging("IN_PROGRESS", "VERIFIED")).toBe(false);
    expect(canTransitionImaging("REQUESTED", "REPORTED")).toBe(false);
    expect(canTransitionImaging("SCHEDULED", "VERIFIED")).toBe(false);
  });
  it("cancels only before a report exists; terminal states are final", () => {
    expect(canTransitionImaging("IN_PROGRESS", "CANCELLED")).toBe(true);
    expect(canTransitionImaging("REPORTED", "CANCELLED")).toBe(false);
    for (const to of IMAGING_STATUSES) {
      expect(canTransitionImaging("VERIFIED", to)).toBe(false);
      expect(canTransitionImaging("CANCELLED", to)).toBe(false);
    }
  });
});

describe("priority paging plan", () => {
  const order = ["STAT", "URGENT", "ROUTINE"];
  it("fills a page across segments in priority order", () => {
    expect(planSegments({ STAT: 2, URGENT: 3, ROUTINE: 50 }, order, 0, 20)).toEqual([
      { key: "STAT", skip: 0, take: 2 }, { key: "URGENT", skip: 0, take: 3 }, { key: "ROUTINE", skip: 0, take: 15 },
    ]);
  });
  it("offsets later pages into the right segment", () => {
    expect(planSegments({ STAT: 2, URGENT: 3, ROUTINE: 50 }, order, 20, 20)).toEqual([{ key: "ROUTINE", skip: 15, take: 20 }]);
    expect(planSegments({ STAT: 25, URGENT: 3, ROUTINE: 5 }, order, 20, 20)).toEqual([
      { key: "STAT", skip: 20, take: 5 }, { key: "URGENT", skip: 0, take: 3 }, { key: "ROUTINE", skip: 0, take: 5 },
    ]);
  });
  it("returns nothing beyond the end and skips empty segments", () => {
    expect(planSegments({ STAT: 1, URGENT: 0, ROUTINE: 1 }, order, 0, 10)).toEqual([{ key: "STAT", skip: 0, take: 1 }, { key: "ROUTINE", skip: 0, take: 1 }]);
    expect(planSegments({ STAT: 1, URGENT: 1, ROUTINE: 1 }, order, 40, 20)).toEqual([]);
  });
});

describe("schemas", () => {
  it("validates lab order contract", () => {
    expect(labOrderSchema.safeParse({ patientId: "p1", testIds: ["t1"], priority: "STAT" }).success).toBe(true);
    expect(labOrderSchema.safeParse({ patientId: "p1", testIds: [] }).success).toBe(false);
    expect(labOrderSchema.safeParse({ patientId: "p1", testIds: ["t1", "t1"] }).success).toBe(false);
    expect(labOrderSchema.safeParse({ patientId: "p1", testIds: ["t1"], priority: "ASAP" }).success).toBe(false);
    expect(labOrderSchema.parse({ patientId: "p1", testIds: ["t1"], encounterId: "" }).priority).toBe("ROUTINE");
  });
  it("validates catalogue test ranges", () => {
    const base = { code: "hb", name: "Haemoglobin", category: "Haematology", specimenType: "EDTA", price: "450", turnaroundHours: "24" };
    expect(labTestSchema.parse(base).code).toBe("HB");
    expect(labTestSchema.safeParse({ ...base, referenceLow: "10", referenceHigh: "5" }).success).toBe(false);
    expect(labTestSchema.safeParse({ ...base, referenceLow: "1.2345" }).success).toBe(false);
    expect(labTestSchema.safeParse({ ...base, price: "-1" }).success).toBe(false);
  });
  it("rejects absurd numeric results", () => {
    expect(resultEntrySchema.safeParse({ results: [{ orderItemId: "i1", value: "12.4" }] }).success).toBe(true);
    expect(resultEntrySchema.safeParse({ results: [{ orderItemId: "i1", value: "99999999999" }] }).success).toBe(false);
    expect(resultEntrySchema.safeParse({ results: [{ orderItemId: "i1", value: "  " }] }).success).toBe(false);
  });
  it("rejects duplicate imaging catalogue codes", () => {
    const item = { code: "xr-chest", modality: "XRAY", bodyPart: "Chest PA", price: "1500" };
    expect(imagingCatalogSchema.parse({ items: [item] }).items[0].code).toBe("XR-CHEST");
    expect(imagingCatalogSchema.safeParse({ items: [item, { ...item, code: "XR-CHEST" }] }).success).toBe(false);
    expect(imagingCatalogSchema.safeParse({ items: [{ ...item, modality: "PET" }] }).success).toBe(false);
  });
});
