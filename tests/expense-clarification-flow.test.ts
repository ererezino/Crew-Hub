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

    expect(approvalsClient).toContain("requestInfoTarget");
    expect(approvalsClient).toContain("t('actions.requestInfo')");
    expect(approvalsClient).toContain("t('requestInfoPanel.conversationTitle')");
    expect(approvalsClient).toContain("/api/v1/expenses/${expenseId}/comments");
    expect(approvalsClient).not.toContain("Pending Disbursement");
  });

  it("adds expense comments API route with request/response actions", () => {
    const commentsRoute = read("app/api/v1/expenses/[id]/comments/route.ts");

    expect(commentsRoute).toContain('action: expenseCommentTypeSchema');
    expect(commentsRoute).toContain('payload.action === "request_info"');
    expect(commentsRoute).toContain('payload.action === "response"');
    expect(commentsRoute).toContain('formData.getAll("attachments")');
    expect(commentsRoute).toContain('expense_comment_attachments');
    expect(commentsRoute).toContain('FINANCE_THREAD_STATUSES');
    expect(commentsRoute).toContain("sendExpenseInfoRequestedEmail");
    expect(commentsRoute).toContain("sendExpenseInfoResponseEmail");
  });

  it("adds expense comments persistence with RLS policies", () => {
    const migration = read("supabase/migrations/20260312130000_expense_comments_thread.sql");

    expect(migration).toContain("create table if not exists public.expense_comments");
    expect(migration).toContain("create policy expense_comments_select_scope");
    expect(migration).toContain("create policy expense_comments_insert_scope");
  });

  it("adds expense comment attachment persistence with scoped access", () => {
    const migration = read("supabase/migrations/20260312200000_expense_comment_attachments.sql");

    expect(migration).toContain("create table if not exists public.expense_comment_attachments");
    expect(migration).toContain("create policy expense_comment_attachments_select_scope");
    expect(migration).toContain("create policy expense_comment_attachments_insert_scope");
    expect(migration).toContain("drop constraint if exists expense_comments_message_check");
  });

  it("shows info-request conversation and reply UI on employee expense details", () => {
    const expensesClient = read("app/(shell)/expenses/expenses-client.tsx");

    expect(expensesClient).toContain("t('infoRequests.title')");
    expect(expensesClient).toContain("t('infoRequests.sendResponse')");
    expect(expensesClient).toContain("t('infoRequests.actionNeeded')");
    expect(expensesClient).toContain("FileAttachmentPicker");
    expect(expensesClient).toContain("openCommentAttachment");
    expect(expensesClient).toContain("comment.attachments.length > 0");
    expect(expensesClient).not.toContain("awaiting disbursement");
  });

  it("shows attachments and finance request-info action in approvals", () => {
    const approvalsClient = read("app/(shell)/expenses/approvals/approvals-client.tsx");

    expect(approvalsClient).toContain("FileAttachmentPicker");
    expect(approvalsClient).toContain("openCommentAttachment");
    expect(approvalsClient).toContain("comment.attachments.length > 0");
    expect(approvalsClient).toContain("stage === \"finance\"");
    expect(approvalsClient).toContain("t('requestInfoPanel.descriptionFinance'");
  });

  it("adds a signed-url route for expense comment attachments", () => {
    const attachmentRoute = read("app/api/v1/expenses/[id]/comments/attachments/[attachmentId]/route.ts");

    expect(attachmentRoute).toContain("expense_comment_attachments");
    expect(attachmentRoute).toContain("createSignedUrl");
    expect(attachmentRoute).toContain("You are not allowed to view this attachment");
  });

  it("enables expense info-request email toggles", () => {
    const emailConfig = read("lib/notifications/email-config.ts");

    expect(emailConfig).toContain("expenseInfoRequested: true");
    expect(emailConfig).toContain("expenseInfoResponse: true");
  });
});
