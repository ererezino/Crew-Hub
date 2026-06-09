import { describe, expect, it } from "vitest";

import { findBestProfileMatch, parseEsopAgreementText } from "../lib/equity-import";

const SAMPLE_AGREEMENT = `ROCKETSAPP INC.
NOTICE OF STOCK OPTION GRANT
Richard Daramola
5, Chief Omowale Kuye Avenue, Ikolaba Estate, Ibadan, Oyo State, Nigeria

You have been granted an option to purchase Common Stock of RocketsApp Inc., a Delaware corporation (the “Company”), as follows:
Date of Grant:
January 15, 2026
Exercise Price Per Share:
$0.10
Total Number of Shares:
40,788
Total Exercise Price:
USD$ 4078.80
Type of Option:
Nonstatutory Stock Option
Expiration Date:
January 15, 2036
Vesting Commencement Date:
March 7, 2022

Vesting/Exercise Schedule: As of the Grant Date, 39,088 shares (95.8%) are deemed vested based on Optionee’s continuous service from the Vesting Commencement Date. The remaining 1,700 shares shall continue to vest in equal monthly installments over the next 2 months, subject to Optionee’s continued employment with the Company.
Termination Period: You may exercise this Option for 3 month(s) after the Termination Date except as set out in Section 5 of the Stock Option Agreement (but in no event later than the Expiration Date).`;

describe("parseEsopAgreementText", () => {
  it("extracts the key grant fields from a text-converted agreement", () => {
    const parsed = parseEsopAgreementText(
      SAMPLE_AGREEMENT,
      "Richard_Daramola_Option_Agreement.docx"
    );

    expect(parsed.optioneeName).toBe("Richard Daramola");
    expect(parsed.grantDate).toBe("2026-01-15");
    expect(parsed.vestingStartDate).toBe("2022-03-07");
    expect(parsed.expirationDate).toBe("2036-01-15");
    expect(parsed.grantType).toBe("NSO");
    expect(parsed.numberOfShares).toBe(40_788);
    expect(parsed.exercisePriceCents).toBe(10);
    expect(parsed.boardApprovalDate).toBe("2026-01-15");
    expect(parsed.status).toBe("vested");
    expect(parsed.terminationPeriodMonths).toBe(3);
  });
});

describe("findBestProfileMatch", () => {
  const profiles = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      orgId: "10000000-0000-4000-8000-000000000001",
      fullName: "Richard Adaramola",
      email: "richard@useaccrue.com"
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      orgId: "10000000-0000-4000-8000-000000000001",
      fullName: "Gabriel Owusu",
      email: "gabby@useaccrue.com"
    }
  ];

  it("matches shortened or slightly different internal names back to the same employee", () => {
    const richardMatch = findBestProfileMatch("Richard Daramola", profiles);
    const gabrielMatch = findBestProfileMatch("Gabriel Kofi Owusu", profiles);

    expect(richardMatch?.profile.fullName).toBe("Richard Adaramola");
    expect(gabrielMatch?.profile.fullName).toBe("Gabriel Owusu");
  });
});
