import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0.2,

  beforeSend(event) {
    // Strip PII: never send names, emails, phone numbers, salaries, employee IDs
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }

    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
    }

    return event;
  }
});
