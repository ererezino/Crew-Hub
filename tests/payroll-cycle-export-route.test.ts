import { beforeEach, describe, expect, it, vi } from "vitest";

type QResult = { data: unknown; error: unknown };

const {
  getAuthenticatedSessionMock,
  renderPayrollCycleAuditPdfMock,
  fromFn,
  tableQueues
} = vi.hoisted(() => {
  const tableQueues: Record<string, QResult[]> = {};

  function dequeue(table: string): QResult {
    const queue = tableQueues[table];
    if (!queue || queue.length === 0) {
      return { data: null, error: null };
    }
    return queue.shift()!;
  }

  function chain(table: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "maybeSingle"]) {
      if (method === "maybeSingle") {
        obj[method] = () => Promise.resolve(dequeue(table));
      } else {
        obj[method] = (..._args: unknown[]) => obj;
      }
    }
    return obj;
  }

  return {
    getAuthenticatedSessionMock: vi.fn(),
    renderPayrollCycleAuditPdfMock: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    fromFn: (table: string) => chain(table),
    tableQueues
  };
});

function enqueue(table: string, ...results: QResult[]) {
  if (!tableQueues[table]) tableQueues[table] = [];
  tableQueues[table].push(...results);
}

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({ from: fromFn })
}));

vi.mock("../lib/payroll/cycle-audit-pdf", () => ({
  renderPayrollCycleAuditPdf: renderPayrollCycleAuditPdfMock
}));

const ORG = "00000000-0000-4000-a000-000000000001";
const RUN = "00000000-0000-4000-a000-000000000002";
const CYC = "00000000-0000-4000-a000-000000000003";
const USR = "00000000-0000-4000-a000-000000000004";

const session = { profile: { id: USR, org_id: ORG, roles: ["FINANCE_APPROVER"] } };

const snapshot = {
  cycleNumber: 1,
  cycleLabel: "Cycle 1 - March 2026",
  targetPayDate: "2026-03-06",
  submittedAt: "2026-03-01T10:00:00Z",
  submittedBy: USR,
  submittedByName: "Finance User",
  currency: "NGN",
  employeeCount: 1,
  totalGross: 250000,
  totalNet: 250000,
  totalDeductions: 0,
  totalOvertime: 0,
  totalBonus: 0,
  totalFees: 0,
  totalGrossByCurrency: { NGN: 250000 },
  totalNetByCurrency: { NGN: 250000 },
  totalDeductionsByCurrency: { NGN: 0 },
  totalOvertimeByCurrency: {},
  totalBonusByCurrency: {},
  totalFeesByCurrency: {},
  rows: [
    {
      employeeId: "00000000-0000-4000-a000-000000000005",
      employeeName: "Ada Lovelace",
      designation: "Engineer",
      department: "Engineering",
      accrueUsername: "ada",
      currency: "NGN",
      monthlySalary: 500000,
      cycleBaseAmount: 250000,
      overtimeHours: 0,
      overtimeRate: 0,
      overtimeAmount: 0,
      bonus: 0,
      fees: 0,
      finalPayable: 250000,
      comment: null,
      exceptionReason: null
    }
  ]
};

function cycleRow() {
  return {
    id: CYC,
    payroll_run_id: RUN,
    org_id: ORG,
    label: "Cycle 1 - March 2026",
    cycle_number: 1,
    currency: "NGN",
    status: "paid",
    target_pay_date: "2026-03-06",
    prepared_at: "2026-03-01T09:00:00Z",
    prepared_by: USR,
    submitted_at: "2026-03-01T10:00:00Z",
    submitted_by: USR,
    approved_at: "2026-03-02T10:00:00Z",
    approved_by: USR,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    paid_at: "2026-03-06T18:00:00Z",
    paid_by: USR,
    payment_reference: "BATCH-001",
    payment_note: "External payroll batch completed",
    payment_snapshot: {},
    approval_snapshot: snapshot,
    reconciled_at: null,
    reconciled_by: null,
    reconciliation_notes: null,
    locked_at: "2026-03-06T18:00:00Z",
    total_gross: 250000,
    total_net: 250000,
    total_deductions: 0,
    total_overtime: 0,
    total_bonus: 0,
    total_fees: 0,
    employee_count: 1,
    created_at: "2026-03-01T09:00:00Z",
    updated_at: "2026-03-06T18:00:00Z"
  };
}

describe("GET /cycles/[cycleId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableQueues)) delete tableQueues[key];
  });

  async function importRoute() {
    return await import("../app/api/v1/payroll/runs/[id]/cycles/[cycleId]/export/route");
  }

  it("returns a PDF audit pack from the frozen approval snapshot", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(session);
    renderPayrollCycleAuditPdfMock.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    enqueue("payroll_cycles", { data: cycleRow(), error: null });
    enqueue("orgs", { data: { name: "Acme Labs" }, error: null });

    const { GET } = await importRoute();
    const res = await GET(
      new Request("http://localhost/api/v1/payroll/runs/run/cycles/cycle/export?format=pdf"),
      { params: Promise.resolve({ id: RUN, cycleId: CYC }) }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("_audit.pdf");
    expect(renderPayrollCycleAuditPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: "Acme Labs",
        cycleLabel: snapshot.cycleLabel,
        paymentReference: "BATCH-001",
        snapshot
      })
    );
  });

  it("returns CSV rows with each employee's currency preserved", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(session);
    enqueue("payroll_cycles", { data: cycleRow(), error: null });

    const { GET } = await importRoute();
    const res = await GET(
      new Request("http://localhost/api/v1/payroll/runs/run/cycles/cycle/export?format=csv"),
      { params: Promise.resolve({ id: RUN, cycleId: CYC }) }
    );

    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Currency");
    expect(csv).toContain("NGN");
    expect(csv).toContain("₦2,500.00");
  });
});
