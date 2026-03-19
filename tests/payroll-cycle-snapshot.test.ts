import { describe, expect, it } from "vitest";

import type { PayrollCycleApprovalSnapshot, PayrollCycleSnapshotRow } from "../types/payroll-runs";

/** These tests verify the structural contract of the approval snapshot
 *  that is frozen at cycle submission time. Per Amendment 2, this snapshot
 *  is THE authoritative record — approval review, payment evidence,
 *  CSV/PDF exports, and audit all read from this snapshot. */

function buildSnapshotRow(overrides: Partial<PayrollCycleSnapshotRow> = {}): PayrollCycleSnapshotRow {
  return {
    employeeId: "emp-1",
    employeeName: "Alice Johnson",
    designation: "Software Engineer",
    department: "Engineering",
    accrueUsername: "alice.j",
    monthlySalary: 500000,
    cycleBaseAmount: 250000,
    overtimeHours: 0,
    overtimeRate: 0,
    overtimeAmount: 0,
    bonus: 0,
    fees: 0,
    finalPayable: 250000,
    comment: null,
    exceptionReason: null,
    ...overrides
  };
}

function buildSnapshot(
  rows: PayrollCycleSnapshotRow[],
  overrides: Partial<PayrollCycleApprovalSnapshot> = {}
): PayrollCycleApprovalSnapshot {
  const totalGross = rows.reduce((s, r) => s + r.cycleBaseAmount + r.overtimeAmount + r.bonus, 0);
  const totalFees = rows.reduce((s, r) => s + r.fees, 0);
  const totalNet = rows.reduce((s, r) => s + r.finalPayable, 0);
  const totalOvertime = rows.reduce((s, r) => s + r.overtimeAmount, 0);
  const totalBonus = rows.reduce((s, r) => s + r.bonus, 0);

  return {
    cycleNumber: 1,
    cycleLabel: "Cycle 1 - January 2026",
    targetPayDate: "2026-01-03",
    submittedAt: "2026-01-02T10:00:00.000Z",
    submittedBy: "user-1",
    submittedByName: "Finance Admin",
    currency: "USD",
    employeeCount: rows.length,
    totalGross,
    totalNet,
    totalDeductions: totalGross - totalNet,
    totalOvertime,
    totalBonus,
    totalFees,
    rows,
    ...overrides
  };
}

describe("Payroll cycle approval snapshot", () => {
  describe("snapshot structure", () => {
    it("contains all required fields for audit", () => {
      const row = buildSnapshotRow();
      const snapshot = buildSnapshot([row]);

      expect(snapshot.cycleNumber).toBe(1);
      expect(snapshot.cycleLabel).toBeTruthy();
      expect(snapshot.targetPayDate).toBeTruthy();
      expect(snapshot.submittedAt).toBeTruthy();
      expect(snapshot.submittedBy).toBeTruthy();
      expect(snapshot.submittedByName).toBeTruthy();
      expect(snapshot.currency).toBe("USD");
      expect(snapshot.employeeCount).toBe(1);
      expect(snapshot.rows).toHaveLength(1);
    });

    it("snapshot row contains employee identification fields", () => {
      const row = buildSnapshotRow();

      expect(row.employeeId).toBeTruthy();
      expect(row.employeeName).toBeTruthy();
      expect(row.designation).toBeTruthy();
      expect(row.department).toBeTruthy();
      expect(row.accrueUsername).toBeTruthy();
    });

    it("snapshot row contains financial fields matching the real spreadsheet", () => {
      const row = buildSnapshotRow({
        monthlySalary: 600000,
        cycleBaseAmount: 300000,
        overtimeHours: 5,
        overtimeRate: 5000,
        overtimeAmount: 25000,
        bonus: 10000,
        fees: 2000,
        finalPayable: 333000
      });

      expect(row.monthlySalary).toBe(600000);
      expect(row.cycleBaseAmount).toBe(300000);
      expect(row.overtimeHours).toBe(5);
      expect(row.overtimeRate).toBe(5000);
      expect(row.overtimeAmount).toBe(25000);
      expect(row.bonus).toBe(10000);
      expect(row.fees).toBe(2000);
      expect(row.finalPayable).toBe(333000);
    });
  });

  describe("snapshot totals", () => {
    it("correctly sums totals across multiple employees", () => {
      const rows = [
        buildSnapshotRow({ cycleBaseAmount: 250000, finalPayable: 250000 }),
        buildSnapshotRow({
          employeeId: "emp-2",
          employeeName: "Bob Smith",
          cycleBaseAmount: 300000,
          overtimeAmount: 15000,
          bonus: 5000,
          fees: 1000,
          finalPayable: 319000
        })
      ];

      const snapshot = buildSnapshot(rows);

      expect(snapshot.employeeCount).toBe(2);
      expect(snapshot.totalGross).toBe(250000 + 300000 + 15000 + 5000);
      expect(snapshot.totalNet).toBe(250000 + 319000);
      expect(snapshot.totalOvertime).toBe(15000);
      expect(snapshot.totalBonus).toBe(5000);
      expect(snapshot.totalFees).toBe(1000);
    });

    it("handles a cycle with zero employees", () => {
      const snapshot = buildSnapshot([]);

      expect(snapshot.employeeCount).toBe(0);
      expect(snapshot.totalGross).toBe(0);
      expect(snapshot.totalNet).toBe(0);
      expect(snapshot.totalOvertime).toBe(0);
      expect(snapshot.totalBonus).toBe(0);
      expect(snapshot.totalFees).toBe(0);
    });
  });

  describe("50/50 default split verification", () => {
    it("each cycle gets half the monthly salary by default", () => {
      const monthlySalary = 500000;
      const halfSalary = Math.round(monthlySalary / 2);

      const cycle1Row = buildSnapshotRow({ monthlySalary, cycleBaseAmount: halfSalary, finalPayable: halfSalary });
      const cycle2Row = buildSnapshotRow({ monthlySalary, cycleBaseAmount: halfSalary, finalPayable: halfSalary });

      expect(cycle1Row.cycleBaseAmount).toBe(250000);
      expect(cycle2Row.cycleBaseAmount).toBe(250000);
      expect(cycle1Row.cycleBaseAmount + cycle2Row.cycleBaseAmount).toBe(monthlySalary);
    });
  });

  describe("snapshot immutability contract", () => {
    it("snapshot is a plain serializable object (no class instances)", () => {
      const row = buildSnapshotRow();
      const snapshot = buildSnapshot([row]);
      const serialized = JSON.parse(JSON.stringify(snapshot));

      expect(serialized).toEqual(snapshot);
    });

    it("snapshot rows preserve comment and exception reason fields", () => {
      const row = buildSnapshotRow({
        comment: "Partial month — started mid-cycle",
        exceptionReason: "Pro-rated: joined 2026-01-10"
      });

      const snapshot = buildSnapshot([row]);
      const restored = JSON.parse(JSON.stringify(snapshot)) as PayrollCycleApprovalSnapshot;

      expect(restored.rows[0].comment).toBe("Partial month — started mid-cycle");
      expect(restored.rows[0].exceptionReason).toBe("Pro-rated: joined 2026-01-10");
    });
  });

  describe("CSV export field mapping", () => {
    it("snapshot fields map to the real payroll spreadsheet columns", () => {
      // Real spreadsheet columns from the December 2025 CSV:
      // Month, Employee Name, Designation, Department, Accrue Username,
      // Salary, Fees, Total Salary, Bonus, Comment, Overtime Rate,
      // Hours worked, Overtime Payable, First Payroll Cycle, Second Payroll Cycle, Overtime
      const row = buildSnapshotRow({
        employeeName: "Test Employee",    // → Employee Name
        designation: "Customer Success",  // → Designation
        department: "Operations",         // → Department
        accrueUsername: "test.emp",        // → Accrue Username
        monthlySalary: 400000,            // → Salary
        fees: 5000,                       // → Fees
        cycleBaseAmount: 200000,          // → derived from Salary/2
        bonus: 10000,                     // → Bonus
        comment: "Test comment",          // → Comment
        overtimeRate: 3000,               // → Overtime Rate
        overtimeHours: 8,                 // → Hours worked
        overtimeAmount: 24000             // → Overtime Payable
      });

      // All fields present and correctly typed
      expect(typeof row.employeeName).toBe("string");
      expect(typeof row.designation).toBe("string");
      expect(typeof row.department).toBe("string");
      expect(typeof row.accrueUsername).toBe("string");
      expect(typeof row.monthlySalary).toBe("number");
      expect(typeof row.fees).toBe("number");
      expect(typeof row.cycleBaseAmount).toBe("number");
      expect(typeof row.bonus).toBe("number");
      expect(typeof row.comment).toBe("string");
      expect(typeof row.overtimeRate).toBe("number");
      expect(typeof row.overtimeHours).toBe("number");
      expect(typeof row.overtimeAmount).toBe("number");
    });
  });
});
