import { redirect } from "next/navigation";

export default function LearningCertificatesPage() {
  redirect("/learning?tab=certificates");
}
