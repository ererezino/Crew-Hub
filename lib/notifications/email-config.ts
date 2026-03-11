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
  leaveCancelled: false,
  payslipReady: true,
  expenseSubmitted: true,
  expenseApproved: true,
  expenseRejected: true,
  expenseDisbursed: true,
  signatureRequest: true,
  passwordReset: true,
  paymentDetailsUpdated: true,
  complianceReminder: false,
  complianceOverdue: false,
  reviewCycleStarted: false,
  selfReviewReminder: false,
  reviewShared: false,
  reviewAcknowledged: false,
  documentExpiring: false,
  documentExpired: false,
  onboardingStarted: true,
  onboardingOverdue: false,
  onboardingCompleted: false,
  schedulePublished: true,
  swapRequested: true,
  swapAccepted: true,
  payrollApproval: true
} as const;

export type EmailFeatureKey = keyof typeof EMAIL_FEATURES;

export function isEmailEnabled(key: EmailFeatureKey): boolean {
  return EMAIL_FEATURES[key] === true;
}
