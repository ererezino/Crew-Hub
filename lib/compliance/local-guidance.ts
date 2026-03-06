export type LocalComplianceGuidance = {
  countryCode: "NG" | "GH" | "KE" | "ZA" | "CA";
  authority: string;
  authority_url: string;
  local_guidance: string;
};

const GUIDANCE_BY_COUNTRY: Record<string, LocalComplianceGuidance[]> = {
  NG: [
    {
      countryCode: "NG",
      authority: "FIRS",
      authority_url: "https://www.firs.gov.ng",
      local_guidance:
        "PAYE remittance is due monthly. Confirm filing cutoffs and accepted channels before payroll lock."
    },
    {
      countryCode: "NG",
      authority: "PENCOM",
      authority_url: "https://www.pencom.gov.ng",
      local_guidance:
        "Pension schedules should be reconciled against payroll totals before submission to avoid employer penalties."
    },
    {
      countryCode: "NG",
      authority: "Federal Mortgage Bank of Nigeria",
      authority_url: "https://www.fmbn.gov.ng",
      local_guidance:
        "NHF contributions should align with employee basic salary values and current statutory rates."
    },
    {
      countryCode: "NG",
      authority: "NSITF",
      authority_url: "https://www.nsitf.gov.ng",
      local_guidance:
        "NSITF filings should include current employee registers and updated payroll support documents."
    }
  ],
  GH: [
    {
      countryCode: "GH",
      authority: "GRA",
      authority_url: "https://gra.gov.gh",
      local_guidance:
        "PAYE returns should be filed monthly with payroll schedules retained for audit and reconciliation."
    },
    {
      countryCode: "GH",
      authority: "SSNIT",
      authority_url: "https://www.ssnit.org.gh",
      local_guidance:
        "SSNIT submissions should be reconciled against employee identifiers and contribution classes before remittance."
    }
  ],
  KE: [
    {
      countryCode: "KE",
      authority: "KRA",
      authority_url: "https://www.kra.go.ke",
      local_guidance:
        "Kenya PAYE and housing levy submissions should match approved payroll and employee PIN records."
    },
    {
      countryCode: "KE",
      authority: "NSSF",
      authority_url: "https://www.nssf.or.ke",
      local_guidance:
        "NSSF remittances should be checked for employee tier mappings and monthly contribution caps."
    },
    {
      countryCode: "KE",
      authority: "Social Health Authority",
      authority_url: "https://www.sha.go.ke",
      local_guidance:
        "Health contribution uploads should include active employee rosters and accurate payroll period metadata."
    }
  ],
  ZA: [
    {
      countryCode: "ZA",
      authority: "SARS",
      authority_url: "https://www.sars.gov.za",
      local_guidance:
        "EMP201 filings should be prepared with source data exports and payment references for reconciliation."
    },
    {
      countryCode: "ZA",
      authority: "UIF",
      authority_url: "https://www.labour.gov.za",
      local_guidance:
        "UIF declarations should align with payroll and employment status updates before monthly filing."
    },
    {
      countryCode: "ZA",
      authority: "B-BBEE Commission",
      authority_url: "https://www.bbbeecommission.co.za",
      local_guidance:
        "Annual submissions require validated supporting evidence and internal ownership before deadline week."
    }
  ],
  CA: [
    {
      countryCode: "CA",
      authority: "CRA",
      authority_url: "https://www.canada.ca/en/revenue-agency.html",
      local_guidance:
        "Source deduction remittances should be filed with payroll support schedules and payroll account validation."
    },
    {
      countryCode: "CA",
      authority: "FINTRAC",
      authority_url: "https://fintrac-canafe.canada.ca",
      local_guidance:
        "Ongoing AML obligations should include periodic review tasks and document retention checkpoints."
    }
  ]
};

export function getLocalComplianceGuidance(countryCode: string): LocalComplianceGuidance[] {
  return GUIDANCE_BY_COUNTRY[countryCode] ?? [];
}
