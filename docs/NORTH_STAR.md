# North Star

## Overview

Accrue Hub is a multi-tenant workforce and operations platform for organizations that manage employees, managers, and HR workflows in one place. It is designed for internal teams that need reliable people operations, clear role boundaries, auditable actions, and predictable APIs that scale across organizations.

Primary users:
- Employees: view and manage their own profile/workflow interactions.
- Managers: supervise team members and approvals.
- HR Admins: manage HR processes and compliance-sensitive records.
- Super Admins: govern organization-level settings and platform controls.

## Roles & Permissions

| Role | Core permissions |
| --- | --- |
| Employee | View/update own profile data, submit requests, view own records and statuses |
| Manager | All Employee capabilities for self + view team members, approve/deny manager-scoped requests, manage team operations |
| HR Admin | Broad HR data access within org, manage employee lifecycle data, manage HR workflows and policies, view compliance/audit views |
| Super Admin | Full org administration, role assignment, org-wide settings/configuration, privileged access to all admin modules |

## Tech Stack

- Framework: Next.js (App Router) + TypeScript
- UI: Tailwind CSS + shadcn/ui
- Data/Auth: Supabase (Postgres, Auth, RLS, Storage)
- Email: Resend
- Hosting/Deployment: Vercel
- Client state/data fetching: Zustand or React Query (module-dependent)
- Forms/validation: React Hook Form + Zod

## API Conventions

### Base Path

- All versioned endpoints must live under `/api/v1`.

### Response Format

- Every response must use:
  - `data`: payload on success (or `null` on failure)
  - `error`: structured error object on failure (or `null` on success)
  - `meta`: request metadata (pagination, request id, timing, etc.)

Example envelope:

```json
{
  "data": {},
  "error": null,
  "meta": {}
}
```

### Status Codes Rules

- `200` for successful reads/updates that return content.
- `201` for successful create operations.
- `204` for successful operations with no response body.
- `400` for malformed requests.
- `401` for unauthenticated access.
- `403` for authenticated but unauthorized access.
- `404` for missing resources.
- `409` for conflicts (state/version/uniqueness).
- `422` for validation failure when request shape is syntactically valid but semantically invalid.
- `429` for rate limiting.
- `500` for unexpected server failures.

### Cursor Pagination Rules

- Cursor pagination is the default for list endpoints.
- Request shape:
  - `limit`: integer with enforced max.
  - `cursor`: opaque token representing the last seen sort key(s).
- Response metadata:
  - `meta.next_cursor`: present when additional results exist.
  - `meta.has_more`: boolean indicator.
- Sorting must be deterministic and stable (e.g., `(created_at DESC, id DESC)`).
- Cursors must be opaque to clients and validated on every request.

### Validation

- Every endpoint must validate input with Zod before business logic runs.
- Validation applies to params, query, headers (where relevant), and body.
- Validation failures return standardized `422` responses in the `{ data, error, meta }` envelope.

## Database Principles

- Multi-tenancy readiness: include `org_id` on all domain tables.
- Soft delete: use `deleted_at` timestamps instead of hard delete by default.
- Auditing: maintain an `audit_log` table for all mutations with at least:
  - `actor_id`
  - `action`
  - `table_name`
  - `old_values` (JSON/JSONB)
  - `new_values` (JSON/JSONB)
  - `created_at` (timestamp)
  - `ip_address`
- Security: Row Level Security (RLS) is required on every table.
- Money: store in smallest currency unit as integer + ISO currency code column.
- Data integrity/performance:
  - use enums for statuses
  - add indexes for common filters/sorts/joins
- JSONB usage: only for explicitly flexible or schemaless extension fields.

## Design System Tokens

- Primary: `#1a1a2e`
- Accent (placeholder): `#22C55E`
- Typography: Geist + Geist Mono
- UI rules:
  - subtle borders
  - no heavy shadows
  - skeleton loaders for async content
  - fast transitions in the 150–200ms range
  - light mode default with dark mode support
