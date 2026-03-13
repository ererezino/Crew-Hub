import { describe, it, expect } from "vitest";

import {
  crewDisplayDepartment,
  isCrewMgsDepartment,
  CREW_MGS_DISPLAY_LABEL,
} from "../lib/crew-department-display";

describe("crewDisplayDepartment", () => {
  it.each([
    ["Marketing", "Marketing & Growth"],
    ["Growth", "Marketing & Growth"],
    ["Sales", "Marketing & Growth"],
    ["Marketing & Growth", "Marketing & Growth"],
  ])('maps "%s" → "%s"', (input, expected) => {
    expect(crewDisplayDepartment(input)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(crewDisplayDepartment("marketing")).toBe("Marketing & Growth");
    expect(crewDisplayDepartment("GROWTH")).toBe("Marketing & Growth");
    expect(crewDisplayDepartment("sales")).toBe("Marketing & Growth");
    expect(crewDisplayDepartment("MARKETING & GROWTH")).toBe("Marketing & Growth");
  });

  it("passes through other departments unchanged", () => {
    expect(crewDisplayDepartment("Engineering")).toBe("Engineering");
    expect(crewDisplayDepartment("Customer Success")).toBe("Customer Success");
    expect(crewDisplayDepartment("Finance")).toBe("Finance");
  });

  it('returns "Other" for null/undefined/empty', () => {
    expect(crewDisplayDepartment(null)).toBe("Other");
    expect(crewDisplayDepartment(undefined)).toBe("Other");
    expect(crewDisplayDepartment("")).toBe("Other");
  });
});

describe("isCrewMgsDepartment", () => {
  it("returns true for all MGS variants", () => {
    expect(isCrewMgsDepartment("Marketing")).toBe(true);
    expect(isCrewMgsDepartment("Growth")).toBe(true);
    expect(isCrewMgsDepartment("Sales")).toBe(true);
    expect(isCrewMgsDepartment("Marketing & Growth")).toBe(true);
  });

  it("returns false for non-MGS departments", () => {
    expect(isCrewMgsDepartment("Engineering")).toBe(false);
    expect(isCrewMgsDepartment(null)).toBe(false);
    expect(isCrewMgsDepartment(undefined)).toBe(false);
  });
});

describe("CREW_MGS_DISPLAY_LABEL", () => {
  it('equals "Marketing & Growth"', () => {
    expect(CREW_MGS_DISPLAY_LABEL).toBe("Marketing & Growth");
  });
});
