/**
 * Crew Hub - Auth Pressure Test
 *
 * Purpose:
 * - Verify app-level sign-in rate limiting returns 429 under pressure
 * - Verify failed login lockout returns ACCOUNT_LOCKED after repeated failures
 * - Verify lockout remains active on subsequent attempts
 * - Verify a legitimate user can still sign in
 *
 * Usage:
 *   k6 run auth-pressure-test.js
 *
 * Optional env vars:
 *   BASE_URL=http://localhost:3000
 *   TEST_USER_EMAIL=coo@accrue.test
 *   TEST_USER_PASSWORD=TestPassword123!
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL || "coo@accrue.test";
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD || "TestPassword123!";

const rateLimit429Count = new Counter("rate_limit_429_count");
const lockoutDetectedCount = new Counter("lockout_detected_count");
const authErrorRate = new Rate("auth_error_rate");
const attemptDuration = new Trend("attempt_duration", true);

export const options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    lockout_detected_count: ["count>0"]
  }
};

function appSignIn(email, password, forwardedIp) {
  return http.post(
    `${BASE_URL}/api/v1/auth/sign-in`,
    JSON.stringify({ email, password }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": forwardedIp
      }
    }
  );
}

export default function authPressureTest() {
  const attackEmail = `loadtest-lockout-vu${__VU}@test.com`;
  let sawLockout = false;

  group("Invalid sign-in burst", function invalidSignInBurst() {
    for (let index = 0; index < 8; index += 1) {
      const attackIp = `198.51.${__VU}.${20 + index}`;
      const startedAt = Date.now();
      const response = appSignIn(attackEmail, "WrongPassword!123", attackIp);
      attemptDuration.add(Date.now() - startedAt);

      const bodyText = response.body || "";
      const lockoutResponse = response.status === 429 && bodyText.includes("ACCOUNT_LOCKED");
      const rateLimitResponse = response.status === 429 && bodyText.includes("RATE_LIMIT_EXCEEDED");

      if (lockoutResponse) {
        lockoutDetectedCount.add(1);
        sawLockout = true;
        check(response, {
          "lockout status is 429": (res) => res.status === 429
        });
        break;
      }

      if (rateLimitResponse) {
        rateLimit429Count.add(1);
        check(response, {
          "rate limit status is 429": (res) => res.status === 429
        });
        break;
      }

      authErrorRate.add(response.status >= 400);
      check(response, {
        "invalid sign-in is 401 or 429": (res) => res.status === 401 || res.status === 429
      });

      sleep(0.05);
    }
  });

  group("Lockout persistence check", function lockoutPersistenceCheck() {
    if (!sawLockout) {
      return;
    }

    sleep(0.5);

    const verifyResponse = appSignIn(
      attackEmail,
      "WrongPassword!123",
      `198.51.${__VU}.250`
    );
    const verifyBody = verifyResponse.body || "";
    const stillLocked =
      verifyResponse.status === 429 &&
      (verifyBody.includes("ACCOUNT_LOCKED") || verifyBody.includes("temporarily locked"));

    if (stillLocked) {
      lockoutDetectedCount.add(1);
    }

    check(verifyResponse, {
      "lockout remains active": () => stillLocked
    });
  });

  group("Legitimate sign-in", function legitimateSignIn() {
    if (__ITER > 0) {
      return;
    }

    const response = appSignIn(
      TEST_USER_EMAIL,
      TEST_USER_PASSWORD,
      `203.0.113.${100 + __VU}`
    );
    const bodyText = response.body || "";
    const parsedOk = bodyText.includes('"signedIn":true');

    check(response, {
      "legitimate sign-in returns 200": (res) => res.status === 200,
      "legitimate sign-in response contains signedIn true": () => parsedOk
    });
  });

  sleep(1);
}
