import { describe, it, expect } from "vitest";
import { csvCell, toCsv } from "@/lib/utils/csv";
import { zonedToUtc, dayRangeUtc, toZonedDateString, ageFromDob } from "@/lib/utils/time";

describe("csv", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+92 300")).toBe("'+92 300");
    expect(csvCell("@SUM")).toBe("'@SUM");
    expect(csvCell("normal")).toBe("normal");
  });
  it("builds header and rows", () => {
    expect(toCsv([{ label: "A", key: "a" }], [{ a: 1 }])).toBe("A\r\n1\r\n");
  });
});

describe("time zones", () => {
  it("converts Karachi wall time to UTC", () => {
    expect(zonedToUtc("2026-10-09", "09:00", "Asia/Karachi").toISOString()).toBe("2026-10-09T04:00:00.000Z");
  });
  it("computes local day ranges", () => {
    const [s, e] = dayRangeUtc("2026-10-09", "Asia/Karachi");
    expect(s.toISOString()).toBe("2026-10-08T19:00:00.000Z");
    expect(e.toISOString()).toBe("2026-10-09T19:00:00.000Z");
    expect(toZonedDateString(new Date("2026-10-08T19:30:00Z"), "Asia/Karachi")).toBe("2026-10-09");
  });
  it("calculates age", () => {
    expect(ageFromDob(new Date("2000-10-10"), new Date("2026-10-09"))).toBe(25);
    expect(ageFromDob(new Date("2000-10-09"), new Date("2026-10-09"))).toBe(26);
  });
});
