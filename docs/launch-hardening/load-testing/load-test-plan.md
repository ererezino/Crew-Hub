# Load Test Plan

## Objectives

1. Identify performance bottlenecks before they affect real users
2. Establish baseline response times under load for critical endpoints
3. Determine the maximum concurrent user capacity of the current deployment
4. Validate that the system meets acceptance criteria under expected peak load

---

## Critical Endpoints to Test

These endpoints represent the most frequently used and business-critical flows:

| Priority | Flow | Method | Endpoint | Notes |
|----------|------|--------|----------|-------|
| **P0** | Login | POST | `/api/auth/callback` | Supabase Auth, session creation |
| **P0** | Dashboard load | GET | `/api/dashboard` (or page route) | Initial authenticated page, multiple data fetches |
| **P0** | People list | GET | `/api/people` | Paginated list, used by managers/HR daily |
| **P1** | Time-off request | POST | `/api/time-off/requests` | Write operation with validation and notification |
| **P1** | Time-off list | GET | `/api/time-off/requests` | Read with filters, used daily |
| **P1** | Approvals list | GET | `/api/approvals` | Cross-module aggregation for managers |
| **P1** | Approval action | POST | `/api/approvals/[id]` | Write with state transition and notification |
| **P2** | Document upload | POST | `/api/documents` | Multipart upload to Supabase Storage |
| **P2** | Document list | GET | `/api/documents` | Paginated with filters |
| **P2** | Expense submission | POST | `/api/expenses` | Write with receipt upload |
| **P2** | Expense list | GET | `/api/expenses` | Paginated with role-based filtering |
| **P3** | Announcements | GET | `/api/announcements` | Read-heavy, loaded on dashboard |
| **P3** | Notifications | GET | `/api/notifications` | Polled frequently |

---

## Expected Load Profiles

### Assumptions
- Initial launch: ~50-200 active employees across organizations
- Peak usage: 9:00-11:00 AM local time (weekdays)
- Typical session: user logs in, checks dashboard, performs 2-5 actions, logs out
- API calls per active session: ~20-40 over a 30-minute window

### Load Tiers

| Tier | Concurrent Users | Requests/Second | Purpose |
|------|------------------|-----------------|---------|
| **Baseline** | 10 | ~5 rps | Establish normal performance |
| **Expected peak** | 50 | ~25 rps | Typical Monday morning load |
| **Stress** | 150 | ~75 rps | 3x peak, test degradation behavior |
| **Spike** | 300 (burst) | ~150 rps for 60s | Simulate sudden traffic surge |

---

## Tool: k6

[k6](https://k6.io/) is recommended for its scriptability, good reporting, and ability to model realistic user scenarios.

Install: `brew install k6` (macOS) or `npm install -g k6`

### Sample k6 Script: Auth Flow + Dashboard

```javascript
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration');
const dashboardDuration = new Trend('dashboard_duration');

// Test configuration
export const options = {
  stages: [
    { duration: '1m', target: 10 },   // Ramp up to 10 users
    { duration: '3m', target: 50 },   // Ramp up to 50 users (expected peak)
    { duration: '5m', target: 50 },   // Hold at 50 users
    { duration: '2m', target: 100 },  // Push to stress level
    { duration: '3m', target: 100 },  // Hold at stress level
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    errors: ['rate<0.01'],             // Error rate under 1%
    login_duration: ['p(95)<2000'],    // Login under 2s at p95
    dashboard_duration: ['p(95)<1000'], // Dashboard under 1s at p95
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://your-staging-domain.vercel.app';

// Use test accounts created specifically for load testing
// NEVER use real user credentials
const TEST_USERS = JSON.parse(open('./test-users.json'));
// Format: [{"email": "loadtest-1@example.com", "password": "..."}, ...]

export default function () {
  const user = TEST_USERS[__VU % TEST_USERS.length];

  group('Login Flow', function () {
    // Step 1: Sign in via Supabase Auth
    const loginStart = Date.now();
    const loginRes = http.post(
      `${__ENV.SUPABASE_URL}/auth/v1/token?grant_type=password`,
      JSON.stringify({
        email: user.email,
        password: user.password,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': __ENV.SUPABASE_ANON_KEY,
        },
      }
    );
    loginDuration.add(Date.now() - loginStart);

    const loginSuccess = check(loginRes, {
      'login status is 200': (r) => r.status === 200,
      'login returns access token': (r) => JSON.parse(r.body).access_token !== undefined,
    });
    errorRate.add(!loginSuccess);

    if (!loginSuccess) {
      console.error(`Login failed for ${user.email}: ${loginRes.status} ${loginRes.body}`);
      return;
    }

    const authToken = JSON.parse(loginRes.body).access_token;
    const authHeaders = {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    };

    sleep(1); // Simulate user reading the login redirect

    // Step 2: Load dashboard
    const dashStart = Date.now();
    const dashRes = http.get(`${BASE_URL}/api/dashboard`, {
      headers: authHeaders,
    });
    dashboardDuration.add(Date.now() - dashStart);

    check(dashRes, {
      'dashboard status is 200': (r) => r.status === 200,
    });

    sleep(2); // Simulate user reading dashboard
  });

  group('Browse People', function () {
    // This group would use the auth token from login
    // Simplified for example -- in practice, share auth state
    sleep(1);
  });

  group('Submit Time-Off Request', function () {
    // Only a percentage of virtual users submit requests
    if (Math.random() < 0.1) {
      sleep(1); // Simulate filling the form
      // POST to time-off endpoint with test data
    }
  });

  sleep(Math.random() * 3 + 2); // 2-5 second think time between actions
}
```

### Running the Test

```bash
# Against staging environment (NEVER run against production)
k6 run \
  -e BASE_URL=https://crew-hub-staging.vercel.app \
  -e SUPABASE_URL=https://<project-ref>.supabase.co \
  -e SUPABASE_ANON_KEY=<staging-anon-key> \
  load-test.js

# With HTML report output
k6 run --out json=results.json load-test.js
# Then convert: k6-to-html results.json > report.html
```

---

## Alternative Tool: Artillery

If k6 is not available, [Artillery](https://www.artillery.io/) is a good Node.js-based alternative:

```bash
npm install -g artillery
```

Artillery uses YAML config, which is simpler for basic scenarios but less flexible for complex user flows.

---

## Bottleneck Identification Approach

### Where to Look

1. **Supabase Query Performance**
   - During the test, monitor **Supabase Dashboard > Database > Query Performance**
   - Look for queries with high avg execution time or high call count
   - Common bottleneck: missing indexes on `org_id`, `employee_id`, `status`, `created_at`

2. **Vercel Function Duration**
   - Monitor **Vercel Dashboard > Functions** during the test
   - Look for functions consistently near the 10s timeout (Hobby) or 60s (Pro)
   - High p99 with low p50 indicates cold start impact

3. **Connection Pool Saturation**
   - Monitor **Supabase Dashboard > Database > Connection Pooler**
   - If connections hit the max, requests will queue and eventually timeout
   - Crew Hub uses `createSupabaseServiceRoleClient()` -- each serverless function invocation gets a connection

4. **Memory Usage**
   - Vercel serverless functions have a 1024MB memory limit
   - Large list queries (people, documents with many records) can hit this limit
   - Check Vercel function logs for OOM errors

### Profiling Steps

1. Run the baseline test (10 users) and record response times per endpoint
2. Run the expected peak test (50 users) and compare
3. If any endpoint degrades > 2x from baseline to peak:
   - Check the database query for that endpoint
   - Look for N+1 query patterns
   - Verify pagination is working (not fetching all records)
   - Check if the endpoint is doing sequential operations that could be parallelized

---

## Acceptance Criteria

| Metric | Threshold | Notes |
|--------|-----------|-------|
| **p95 response time** | < 500ms | Across all GET endpoints at expected peak load |
| **p95 login time** | < 2000ms | Includes Supabase Auth round-trip |
| **Error rate** | < 1% | At expected peak load (50 concurrent users) |
| **p99 response time** | < 3000ms | Allow for cold starts |
| **Zero errors** at baseline | 0% | At 10 concurrent users, no errors are acceptable |
| **Graceful degradation** | No 5xx cascade | At stress load (150 users), errors should stay contained |
| **Recovery** | < 30s | After spike subsides, response times return to baseline within 30 seconds |

### Failure Criteria (Test Fails If)
- p95 response time > 2000ms at expected peak
- Error rate > 5% at any load level
- Any endpoint returns 5xx at baseline load
- Database connection pool reaches 100%
- Any serverless function hits the timeout limit at expected peak

---

## Vercel-Specific Considerations

### Serverless Cold Starts
- Each Vercel serverless function has a cold start penalty of ~200-800ms
- Cold starts are more frequent during low traffic and after deployments
- k6 tests may see higher p99 than real-world because the ramp-up triggers many cold starts simultaneously
- To measure warm performance, run a 2-minute warm-up phase before collecting metrics

### Function Timeout Limits
- **Hobby plan:** 10 seconds per function invocation
- **Pro plan:** 60 seconds per function invocation
- Endpoints that aggregate data across tables (dashboard, approvals) are most at risk
- If testing reveals endpoints near the limit, optimize the query or add caching

### Concurrent Execution Limits
- Vercel does not impose a hard concurrent function limit, but Supabase connection pooling becomes the bottleneck
- Each function invocation opens a database connection via the connection pooler
- Monitor `active_connections` in Supabase during the test

### Edge Network
- Vercel serves static assets from the edge, but API routes (serverless functions) execute in a single region
- Ensure the k6 test runner is in the same region as the Vercel deployment to get accurate latency measurements
- For geo-distributed load testing, use k6 Cloud or multiple runners

---

## Test Environment Setup

### Prerequisites
1. **Staging environment** on Vercel (never load-test production)
2. **Separate Supabase project** for staging with representative data
3. **Test user accounts** -- create 20-50 accounts with various roles for realistic testing
4. **Seed data** -- populate the staging database with realistic volume:
   - ~200 employee profiles
   - ~500 time-off requests (mix of pending, approved, rejected)
   - ~300 documents
   - ~200 expense reports
   - ~50 announcements

### Test User Setup Script
```sql
-- Create load test users (run against staging Supabase)
-- Use Supabase Auth admin API to create users, then assign profiles
-- Example for creating profiles after auth users exist:
INSERT INTO profiles (id, email, full_name, role, org_id, status)
VALUES
  ('<auth-user-id-1>', 'loadtest-1@example.com', 'Load Test User 1', 'EMPLOYEE', '<org-id>', 'active'),
  ('<auth-user-id-2>', 'loadtest-2@example.com', 'Load Test User 2', 'TEAM_LEAD', '<org-id>', 'active'),
  ('<auth-user-id-3>', 'loadtest-3@example.com', 'Load Test Manager', 'MANAGER', '<org-id>', 'active');
-- Repeat for desired number of test users across roles
```

---

## Results Template

Record results for each test run:

```markdown
# Load Test Results - [Date]

## Environment
- Vercel plan: [Hobby/Pro]
- Supabase plan: [Free/Pro]
- Region: [us-east-1/etc]
- Seed data: [X profiles, Y requests, etc]

## Test Configuration
- Tool: k6 vX.X
- Duration: [total minutes]
- Peak VUs: [number]

## Results

| Endpoint | p50 | p95 | p99 | Error Rate | Notes |
|----------|-----|-----|-----|------------|-------|
| Login | ms | ms | ms | % | |
| Dashboard | ms | ms | ms | % | |
| People list | ms | ms | ms | % | |
| Time-off request | ms | ms | ms | % | |
| Document upload | ms | ms | ms | % | |
| Expense submission | ms | ms | ms | % | |
| Approvals list | ms | ms | ms | % | |

## Infrastructure During Test
- Max DB connections: X / Y pool
- Max DB latency: Xms
- Vercel function errors: X
- Function timeout events: X

## Pass/Fail
- [ ] p95 < 500ms: PASS/FAIL
- [ ] Error rate < 1%: PASS/FAIL
- [ ] No 5xx at baseline: PASS/FAIL
- [ ] Graceful degradation at stress: PASS/FAIL

## Bottlenecks Identified
1. [Description + affected endpoint + root cause]
2. [Description]

## Action Items
- [ ] [Fix/optimization] - Owner: [name] - Priority: [P0-P3]
```
