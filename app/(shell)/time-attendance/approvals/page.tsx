import { redirect } from "next/navigation";

export default function TimeAttendanceApprovalsPage() {
  redirect("/approvals?tab=timesheets");
}
