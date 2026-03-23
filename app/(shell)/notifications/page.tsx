import { redirect } from "next/navigation";

export default async function NotificationsPage() {
  redirect("/announcements");
}
