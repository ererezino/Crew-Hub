import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { countryFlagFromCode, countryNameFromCode } from "../../../../../lib/countries";

const WITHHOLDING_COUNTRIES = ["NG", "GH", "KE", "ZA", "CA"] as const;

export default function PayrollDeductionsSettingsPage() {
  return (
    <>
      <PageHeader
        title="Payroll Settings"
        description="Tax withholding rollout for Crew Hub payroll by country."
      />

      <section className="settings-layout" aria-label="Payroll withholding settings">
        <article className="settings-card payroll-withholding-note">
          <h2 className="section-title">Tax Withholding by Country</h2>
          <p className="settings-card-description">
            All team members are currently classified as contractors. Taxes are not
            withheld. When employee withholding is enabled for a country, statutory
            deductions will be calculated automatically.
          </p>
        </article>

        <section className="settings-card payroll-country-list" aria-label="Country rollout list">
          {WITHHOLDING_COUNTRIES.map((countryCode) => {
            const countryName = countryNameFromCode(countryCode);
            const lockLabel = `${countryName} withholding is coming soon`;

            return (
              <article key={countryCode} className="payroll-country-item">
                <div className="payroll-country-copy">
                  <p className="country-chip">
                    <span>{countryFlagFromCode(countryCode)}</span>
                    <span>{countryName}</span>
                  </p>
                  <p className="settings-card-description">
                    Statutory withholding configuration is not enabled yet.
                  </p>
                </div>

                <div className="payroll-country-actions">
                  <div className="payroll-coming-soon">
                    <StatusBadge tone="draft">Coming soon</StatusBadge>
                    <svg
                      className="payroll-lock-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="payroll-lock-label">{lockLabel}</span>
                  </div>

                  <button
                    type="button"
                    className="payroll-country-toggle"
                    disabled
                    aria-label={`${countryName} withholding toggle is disabled`}
                  >
                    <span className="payroll-country-toggle-thumb" />
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      </section>
    </>
  );
}
