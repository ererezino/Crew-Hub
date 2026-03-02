import { redirect } from "next/navigation";

export default function SchedulingManagePage() {
  redirect("/scheduling?tab=manage");
}
