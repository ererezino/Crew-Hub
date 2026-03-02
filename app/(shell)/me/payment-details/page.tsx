import { redirect } from "next/navigation";

export default function MyPaymentDetailsPage() {
  redirect("/me/pay?tab=payment-details");
}
