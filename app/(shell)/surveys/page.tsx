import { redirect } from "next/navigation";

export default function SurveysPage() {
  redirect("/learning?tab=surveys");
}
