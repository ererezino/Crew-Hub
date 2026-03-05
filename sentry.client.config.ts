import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0.2,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.5,

  beforeSend(event) {
    if (event.request) {
      delete event.request.cookies;
      delete event.request.headers;
    }

    // Strip PII from breadcrumbs
    if (event.breadcrumbs) {
      for (const breadcrumb of event.breadcrumbs) {
        if (breadcrumb.data) {
          delete breadcrumb.data.email;
          delete breadcrumb.data.full_name;
          delete breadcrumb.data.phone;
        }
      }
    }

    return event;
  }
});
