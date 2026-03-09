/**
 * Crew Hub - Launch Scope Load Test
 *
 * Focus:
 * - Auth pressure probe (single lightweight burst)
 * - Launch-scope read traffic
 * - Launch-scope lightweight writes
 * - Concurrency pressure on health endpoint
 *
 * Usage:
 *   BASE_URL=http://localhost:3100 k6 run load-test.js
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3100";
const SUPABASE_URL =
  __ENV.SUPABASE_URL || "https://xmeruhyybvyosqxfleiu.supabase.co";
const SUPABASE_KEY =
  __ENV.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtZXJ1aHl5YnZ5b3NxeGZsZWl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxODg2MjAsImV4cCI6MjA4Nzc2NDYyMH0.12zO50DlmBxJUsVwfbTBajqwgodRm2dhenIY6JM5irI";

const TEST_USERS = JSON.parse(open("./test-users.json"));

const readDuration = new Trend("read_duration", true);
const writeDuration = new Trend("write_duration", true);
const errorRate = new Rate("error_rate");
const rateLimitHits = new Counter("rate_limit_hits");

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "60s", target: 5 },
    { duration: "30s", target: 10 },
    { duration: "60s", target: 10 },
    { duration: "15s", target: 0 }
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    read_duration: ["p(95)<2000"],
    write_duration: ["p(95)<3000"],
    error_rate: ["rate<0.35"]
  }
};

function supabaseLogin(email, password) {
  const response = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY
      }
    }
  );

  if (response.status !== 200) {
    return null;
  }

  try {
    const body = JSON.parse(response.body);
    if (!body.access_token) {
      return null;
    }

    return {
      email,
      accessToken: body.access_token
    };
  } catch {
    return null;
  }
}

function authParams(accessToken) {
  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_KEY
    }
  };
}

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

export function setup() {
  const tokens = TEST_USERS.map((user) =>
    supabaseLogin(user.email, user.password)
  ).filter(Boolean);

  if (tokens.length === 0) {
    throw new Error("No test users could authenticate for load test setup.");
  }

  return { tokens };
}

export default function loadTestRun(data) {
  const tokens = data.tokens || [];
  const tokenBundle = tokens[__VU % tokens.length];

  if (!tokenBundle?.accessToken) {
    errorRate.add(true);
    sleep(1);
    return;
  }

  const accessToken = tokenBundle.accessToken;
  const restBase = `${SUPABASE_URL}/rest/v1`;

  group("A: Auth Pressure Probe", function authPressureProbe() {
    if (__VU === 1 && __ITER === 0) {
      const fakeEmail = `loadtest-ratelimit-${Date.now()}@test.com`;
      for (let index = 0; index < 7; index += 1) {
        const response = appSignIn(
          fakeEmail,
          "WrongPassword!123",
          `198.51.100.${30 + index}`
        );
        if (response.status === 429) {
          rateLimitHits.add(1);
          check(response, {
            "auth pressure returns 429": (result) => result.status === 429
          });
          break;
        }
      }
    }
  });

  group("B: Core Reads (Supabase REST)", function coreReads() {
    const params = authParams(accessToken);

    const t1 = Date.now();
    const notificationsResponse = http.get(
      `${restBase}/notifications?select=id,title,type,is_read,created_at&limit=50&order=created_at.desc`,
      params
    );
    readDuration.add(Date.now() - t1);
    check(notificationsResponse, {
      "notifications status 200": (response) => response.status === 200
    });
    errorRate.add(notificationsResponse.status !== 200);
    sleep(0.15);

    const t2 = Date.now();
    const announcementsResponse = http.get(
      `${restBase}/announcements?select=id,title,body,is_pinned,created_at&limit=20&order=created_at.desc`,
      params
    );
    readDuration.add(Date.now() - t2);
    check(announcementsResponse, {
      "announcements status 200": (response) => response.status === 200
    });
    errorRate.add(announcementsResponse.status !== 200);
    sleep(0.15);

    const t3 = Date.now();
    const leaveResponse = http.get(
      `${restBase}/leave_requests?select=id,status,leave_type,start_date,end_date&limit=20`,
      params
    );
    readDuration.add(Date.now() - t3);
    check(leaveResponse, {
      "leave_requests status 200 or 403": (response) =>
        response.status === 200 || response.status === 403
    });
    errorRate.add(leaveResponse.status !== 200 && leaveResponse.status !== 403);
    sleep(0.15);

    const t4 = Date.now();
    const profilesResponse = http.get(
      `${restBase}/profiles?select=id,full_name,email,roles,department,status&limit=50`,
      params
    );
    readDuration.add(Date.now() - t4);
    check(profilesResponse, {
      "profiles status 200": (response) => response.status === 200
    });
    errorRate.add(profilesResponse.status !== 200);
    sleep(0.15);
  });

  group("C: Core Writes", function coreWrites() {
    const t1 = Date.now();
    const healthResponse = http.get(`${BASE_URL}/api/health`);
    writeDuration.add(Date.now() - t1);
    check(healthResponse, {
      "health status 200": (response) => response.status === 200
    });
    errorRate.add(healthResponse.status !== 200);

    if (Math.random() < 0.2) {
      const params = authParams(accessToken);
      const t2 = Date.now();
      const patchResponse = http.patch(
        `${SUPABASE_URL}/rest/v1/notifications?id=eq.00000000-0000-0000-0000-000000000000`,
        JSON.stringify({ is_read: true }),
        {
          headers: {
            ...params.headers,
            Prefer: "return=minimal"
          }
        }
      );
      writeDuration.add(Date.now() - t2);
      check(patchResponse, {
        "notification patch not 5xx": (response) => response.status < 500
      });
      errorRate.add(patchResponse.status >= 500);
    }

    sleep(0.3);
  });

  group("D: Concurrency Pressure", function concurrencyPressure() {
    if (__VU === 2 && __ITER < 3) {
      const responses = [];
      for (let index = 0; index < 10; index += 1) {
        responses.push(http.get(`${BASE_URL}/api/health`));
      }

      const successCount = responses.filter(
        (response) => response.status === 200
      ).length;

      check(null, {
        "health flood all succeed": () => successCount === 10
      });
      errorRate.add(successCount !== 10);
    }
  });

  sleep(Math.random() * 2 + 1);
}
