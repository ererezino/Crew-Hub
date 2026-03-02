import { redirect } from "next/navigation";

export default function TimePoliciesPage() {
  redirect("/settings?tab=time-policies");
}
