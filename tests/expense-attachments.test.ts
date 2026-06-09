import { describe, expect, it } from "vitest";

import {
  expenseRowSchema,
  toExpenseAttachment,
  toExpenseRecord
} from "../app/api/v1/expenses/_helpers";
import type { ExpenseAttachment } from "../types/expenses";

const ORG = "00000000-0000-4000-a000-000000000001";
const EMP = "00000000-0000-4000-a000-000000000002";
const EXP = "00000000-0000-4000-a000-000000000003";

function buildRow(overrides: Record<string, unknown> = {}) {
  return expenseRowSchema.parse({
    id: EXP,
    org_id: ORG,
    employee_id: EMP,
    category: "marketing",
    description: "Campaign invoice",
    amount: 150000,
    currency: "XOF",
    receipt_file_path: `${ORG}/${EMP}/${EXP}/primary.pdf`,
    expense_date: "2026-06-01",
    status: "pending",
    manager_approved_by: null,
    manager_approved_at: null,
    finance_approved_by: null,
    finance_approved_at: null,
    finance_rejected_by: null,
    finance_rejected_at: null,
    finance_rejection_reason: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reimbursed_by: null,
    reimbursed_at: null,
    reimbursement_reference: null,
    reimbursement_notes: null,
    reimbursement_receipt_path: null,
    created_at: "2026-06-01T09:00:00.000Z",
    updated_at: "2026-06-01T09:00:00.000Z",
    ...overrides
  });
}

const noProfiles = new Map();

describe("expense attachments mapping", () => {
  it("synthesizes a single primary attachment from receipt_file_path when no map is supplied", () => {
    const record = toExpenseRecord(buildRow(), noProfiles);

    expect(record.attachments).toHaveLength(1);
    expect(record.attachments[0].filePath).toBe(`${ORG}/${EMP}/${EXP}/primary.pdf`);
    expect(record.attachments[0].fileName).toBe("primary.pdf");
    expect(record.receiptFilePath).toBe(`${ORG}/${EMP}/${EXP}/primary.pdf`);
    expect(record.receiptFileName).toBe("primary.pdf");
  });

  it("uses the supplied attachments and derives the primary from the first one", () => {
    const attachments: ExpenseAttachment[] = [
      {
        id: "att-1",
        fileName: "invoice.pdf",
        filePath: `${ORG}/${EMP}/${EXP}/invoice.pdf`,
        mimeType: "application/pdf",
        fileSizeBytes: 2048,
        createdAt: "2026-06-01T09:00:00.000Z"
      },
      {
        id: "att-2",
        fileName: "receipt.png",
        filePath: `${ORG}/${EMP}/${EXP}/receipt.png`,
        mimeType: "image/png",
        fileSizeBytes: 1024,
        createdAt: "2026-06-01T09:05:00.000Z"
      }
    ];

    const record = toExpenseRecord(buildRow(), noProfiles, new Map([[EXP, attachments]]));

    expect(record.attachments).toHaveLength(2);
    expect(record.receiptFilePath).toBe(`${ORG}/${EMP}/${EXP}/invoice.pdf`);
    expect(record.receiptFileName).toBe("invoice.pdf");
    expect(record.attachments[1].fileName).toBe("receipt.png");
  });

  it("maps null size/mime safely", () => {
    const attachment = toExpenseAttachment({
      id: "att-1",
      expense_id: EXP,
      file_name: "legacy.pdf",
      file_path: `${ORG}/${EMP}/${EXP}/legacy.pdf`,
      file_size_bytes: null,
      mime_type: null,
      sort_order: 0,
      created_at: "2026-06-01T09:00:00.000Z"
    });

    expect(attachment.fileSizeBytes).toBeNull();
    expect(attachment.mimeType).toBeNull();
    expect(attachment.fileName).toBe("legacy.pdf");
  });
});
