import { redirect } from "next/navigation";

export default function MyPayslipsPage() {
  redirect("/me/pay?tab=payslips");
}
