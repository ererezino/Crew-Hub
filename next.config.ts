import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**"
      }
    ]
  }
};

const intlConfig = withNextIntl(nextConfig);

// Only wrap with Sentry when deploying (SENTRY_AUTH_TOKEN is set in CI/Vercel).
// Running the Sentry webpack plugin in dev causes a recompile loop because it
// writes .env.sentry-build-plugin on each compile, which triggers the file
// watcher, which triggers another compile, ad infinitum.
const hasSentryAuth = !!process.env.SENTRY_AUTH_TOKEN;

export default hasSentryAuth
  ? withSentryConfig(intlConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,

      silent: !process.env.CI,
      widenClientFileUpload: true,
      disableLogger: true,
      sourcemaps: {
        deleteSourcemapsAfterUpload: true
      }
    })
  : intlConfig;
