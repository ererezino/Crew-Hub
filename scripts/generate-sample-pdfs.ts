import { writeFileSync } from "node:fs";
import { renderPaymentStatementPdf } from "../lib/payroll/payment-statement-pdf";
import { renderTravelSupportLetterPdf } from "../lib/pdf/travel-support-letter-pdf";

async function main() {
  console.log("Generating sample payslip PDF...");
  const payslipBytes = await renderPaymentStatementPdf({
    companyName: "Accrue",
    periodLabel: "February 2026",
    contractorName: "Zino Asamaige",
    department: "Engineering",
    title: "Co-founder & CTO",
    country: "United States",
    baseSalaryAmount: 850000, // $8,500.00 in cents
    allowances: [
      { label: "Housing allowance", amount: 150000 },
      { label: "Internet stipend", amount: 10000 }
    ],
    adjustments: [],
    grossAmount: 1010000,
    deductions: [
      { label: "Federal income tax", amount: 202000 },
      { label: "Social security", amount: 62620 },
      { label: "Medicare", amount: 14645 }
    ],
    deductionsTotal: 279265,
    paymentAmount: 730735,
    currency: "USD",
    paymentReference: "PAY-2026-02-001",
    withholdingApplied: true
  });

  writeFileSync("/tmp/sample-payslip.pdf", payslipBytes);
  console.log("Payslip saved to /tmp/sample-payslip.pdf");

  console.log("Generating sample travel support letter PDF...");
  const travelBytes = await renderTravelSupportLetterPdf({
    employeeName: "Adesuwa Omoruyi",
    jobTitle: "CMO",
    department: "Marketing",
    startDate: "2024-03-15",
    destinationCountry: "United Kingdom",
    embassyName: "British High Commission",
    embassyAddress: "19 Torrens Close, Maitama, Abuja, Nigeria",
    travelStartDate: "2026-04-10",
    travelEndDate: "2026-04-25",
    purpose: "Attending a design conference and meeting with UK-based partners to discuss product strategy",
    approverName: "Clinton Mbah",
    approverTitle: "CEO",
    issueDate: "March 3, 2026",
    entityAddress: "14 Adeola Hopewell Street, Victoria Island, Lagos, Nigeria"
  });

  writeFileSync("/tmp/sample-travel-letter.pdf", travelBytes);
  console.log("Travel letter saved to /tmp/sample-travel-letter.pdf");

  console.log("Done! Opening PDFs...");
}

main().catch(console.error);
