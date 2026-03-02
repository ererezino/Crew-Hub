import { redirect } from "next/navigation";

export default function TimeOffCalendarPage() {
  redirect("/time-off?tab=calendar");
}
