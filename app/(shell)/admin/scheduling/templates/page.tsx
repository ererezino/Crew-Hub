import { redirect } from "next/navigation";

export default function SchedulingTemplatesAdminPage() {
  redirect("/scheduling?tab=templates");
}
