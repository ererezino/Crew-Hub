import { redirect } from "next/navigation";

export default function TimeOffApprovalsPage() {
  redirect("/approvals?tab=time-off");
}
