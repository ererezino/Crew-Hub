import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Expense clarification and payment language hardening", () => {
  it("adds manager request-info action and conversation panel in approvals", () => {
    const approvalsClient = read("app/(shell)/expenses/approvals/approvals-client.tsx");

    expect(approvalsClient).toContain("Request info");
    expect(approvalsClient).toContain("Request more info");
    expect(approvalsClient).toContain("/api/v1/expenses/${expenseId}/comments");
    expect(approvalsClient).not.toContain("Pending Disbursement");
  });

  it("adds expense comments API route with request/response actions", () => {
    const commentsRoute = read("app/api/v1/expenses/[id]/comments/route.ts");

    expect(commentsRoute).toContain('action: expenseCommentTypeSchema');
    expect(commentsRoute).toContain('payload.action === "request_info"');
    expect(commentsRoute).toContain('payload.action === "response"');
    expect(commentsRoute).toContain("sendExpenseInfoRequestedEmail");
    expect(commentsRoute).toContain("sendExpenseInfoResponseEmail");
  });

  it("adds expense comments persistence with RLS policies", () => {
    const migration = read("supabase/migrations/20260312130000_expense_comments_thread.sql");

    expect(migration).toContain("create table if not exists public.expense_comments");
    expect(migration).toContain("create policy expense_comments_select_scope");
    expect(migration).toContain("create policy expense_comments_insert_scope");
  });

  it("shows info-request conversation and reply UI on employee expense details", () => {
    const expensesClient = read("app/(shell)/expenses/expenses-client.tsx");

    expect(expensesClient).toContain("Info Requests");
    expect(expensesClient).toContain("Send response");
    expect(expensesClient).toContain("Action needed: manager requested more info.");
    expect(expensesClient).not.toContain("awaiting disbursement");
  });

  it("enables expense info-request email toggles", () => {
    const emailConfig = read("lib/notifications/email-config.ts");

    expect(emailConfig).toContain("expenseInfoRequested: true");
    expect(emailConfig).toContain("expenseInfoResponse: true");
  });
});
