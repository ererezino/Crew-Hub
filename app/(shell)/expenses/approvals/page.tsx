import { redirect } from "next/navigation";

export default function ExpenseApprovalsPage() {
  redirect("/approvals?tab=expenses");
}
