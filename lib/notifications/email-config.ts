/* ---------------------------------------------------------------------------
 * Email Feature Flags
 *
 * Controls which email types are enabled. ACTIVE = true, DORMANT = false.
 * Auth emails (welcome, invite, reset) bypass this check entirely.
 *
 * Flip any value to true to enable sending, no code changes needed.
 * -------------------------------------------------------------------------*/

export const EMAIL_FEATURES = {
  welcome: true,
  invite: true,
  leaveApproved: true,
  leaveDenied: true,
  leaveSubmitted: true,
  leaveCancelled: true,
  payslipReady: true,
  expenseSubmitted: true,
  expenseApproved: true,
  expenseRejected: true,
  expenseDisbursed: true,
  expenseInfoRequested: true,
  expenseInfoResponse: true,
  signatureRequest: true,
  passwordReset: true,
  paymentDetailsUpdated: true,
  complianceReminder: true,
  complianceOverdue: true,
  reviewCycleStarted: true,
  selfReviewReminder: true,
  reviewShared: true,
  reviewAcknowledged: true,
  documentExpiring: true,
  documentExpired: true,
  onboardingStarted: true,
  onboardingOverdue: true,
  onboardingCompleted: true,
  schedulePublished: true,
  swapRequested: true,
  swapAccepted: true,
  payrollApproval: true
} as const;

export type EmailFeatureKey = keyof typeof EMAIL_FEATURES;

export function isEmailEnabled(key: EmailFeatureKey): boolean {
  return EMAIL_FEATURES[key] === true;
}
