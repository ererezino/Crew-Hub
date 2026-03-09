# Load Test Execution Report

**Date**: March 9, 2026  
**Tool**: k6  
**Environment**: `http://localhost:3100` + Supabase cloud

## Runs Executed

1. `auth-pressure-test.js` with `--summary-export auth-pressure-summary.json`
2. `load-test.js` with `--summary-export load-test-summary.json`

## Auth Pressure Results

Source: `docs/launch-hardening/load-testing/auth-pressure-summary.json`

- Duration: 30s
- VUs: 2
- Requests: 38
- Checks: **40 passed / 0 failed**
- `lockout_detected_count`: **36** (target `> 0`)  
  - Confirms lockout enforcement triggers under repeated failed attempts

## Main Load Results

Source: `docs/launch-hardening/load-testing/load-test-summary.json`

- Duration: 3m15s
- VUs: ramp 5 → 10 → 0
- Iterations: 339
- Requests: 1796
- Checks: **1759 passed / 0 failed**

Threshold-relevant metrics:

- `http_req_duration p95`: **247.65ms** (target `< 2000ms`)
- `read_duration p95`: **252ms** (target `< 2000ms`)
- `write_duration p95`: **226.1ms** (target `< 3000ms`)
- `error_rate value`: **0.00** (target `< 0.35`)

## Conclusion

Load and auth-pressure runs passed with substantial margin versus thresholds. Lockout behavior was observed under pressure, and no material reliability regressions were detected in these executions.
