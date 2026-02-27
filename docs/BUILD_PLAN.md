# Build Plan

## Phases (1-5)

### Phase 1: Foundation

Modules:
- Project setup and environment configuration
- Authentication and authorization baseline
- Core layout/navigation shell
- Design tokens and base component primitives

### Phase 2: Identity & Organization Core

Modules:
- Organization model and tenant boundaries
- User profile and role assignment flows
- Invitation/onboarding flows
- Role-aware dashboard entry points

### Phase 3: Workforce Operations

Modules:
- Employee-facing request/record modules
- Manager approval and team oversight modules
- HR Admin operational modules
- Notification/event triggers for operational actions

### Phase 4: Governance, Compliance, and Auditability

Modules:
- Audit log ingestion and review interfaces
- Policy enforcement and permission hardening
- Reporting exports and compliance-oriented views
- Data lifecycle controls (soft delete, restore, retention policies)

### Phase 5: Reliability, Scale, and Launch Readiness

Modules:
- Performance optimization and query tuning
- Observability and error monitoring
- Security review and RLS verification pass
- Release hardening and production readiness checks

## Stop Conditions

- Only one module may be implemented per task.
- Before a task is considered complete, `npm run build` must pass.
- If build fails, resolve build failures before stopping.
