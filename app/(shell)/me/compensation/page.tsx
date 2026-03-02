import { redirect } from "next/navigation";

export default function MyCompensationPage() {
  redirect("/me/pay?tab=compensation");
}
