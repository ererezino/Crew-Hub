Do not make any code changes. This is a review-only task.

Start the dev server if it is not already running: `npm run dev`

Wait for it to be ready, then take a screenshot of every page in the app. Use both light mode and dark mode for each page. Capture every tab state on pages that have tabs.

For each page:
1. Navigate to the URL
2. Wait for data to load (or for empty/error state to appear)
3. Take a full-page screenshot
4. If the page has tabs, click each tab and screenshot each one
5. Toggle to dark mode, screenshot the same page
6. Toggle back to light mode before moving to the next page

Pages to capture (navigate to each URL):

```
/                           (Dashboard)
/announcements
/time-off                   (My Requests tab)
/time-off?tab=calendar      (Calendar tab)
/approvals                  (All Pending tab)
/approvals?tab=time-off
/approvals?tab=expenses
/approvals?tab=timesheets
/people
/scheduling                 (My Shifts tab)
/scheduling?tab=open-shifts
/scheduling?tab=swap-requests
/scheduling?tab=manage
/scheduling?tab=templates
/onboarding                 (Active tab)
/onboarding?tab=completed
/onboarding?tab=at-risk
/onboarding?tab=templates
/expenses
/expenses/reports
/documents
/learning                   (My Courses tab)
/learning?tab=certificates
/learning?tab=surveys
/performance
/performance/admin
/signatures
/notifications
/payroll
/payroll/runs/new
/payroll/settings
/analytics
/compliance
/settings                   (Profile tab)
/settings?tab=preferences
/settings?tab=security
/settings?tab=organization
/settings?tab=time-policies
/settings?tab=audit-log
/me/pay                     (Payslips tab)
/me/pay?tab=payment-details
/me/pay?tab=compensation
/me/onboarding
/me/documents
/admin/compensation
/admin/compensation-bands
/admin/surveys
/admin/surveys/new
/admin/learning
/admin/learning/reports
/admin/access-control
/admin/users
/login                      (log out first or open in incognito)
```

Save all screenshots to a folder called `docs/audit/screenshots-post/` with filenames matching the route, like `dashboard-light.png`, `dashboard-dark.png`, `expenses-light.png`, `approvals-time-off-dark.png`, etc.

After capturing everything, list all the screenshots you took so I can review them.
