"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { usePeople } from "../../../hooks/use-people";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { USER_ROLES } from "../../../lib/navigation";
import type { AppRole } from "../../../types/auth";
import {
  EMPLOYMENT_TYPES,
  PROFILE_STATUSES,
  type EmploymentType,
  type PeopleCreateResponse,
  type ProfileStatus
} from "../../../types/people";

type PeopleScope = "all" | "reports" | "me";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type PeopleClientProps = {
  currentUserId: string;
  initialScope: PeopleScope;
  canManagePeople: boolean;
};

type ToastMessage = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type CreatePersonFormValues = {
  email: string;
  fullName: string;
  password: string;
  roles: AppRole[];
  department: string;
  title: string;
  countryCode: string;
  timezone: string;
  phone: string;
  startDate: string;
  managerId: string;
  employmentType: EmploymentType;
  primaryCurrency: string;
  status: ProfileStatus;
};

type CreatePersonFormErrors = Partial<Record<keyof CreatePersonFormValues, string>> & {
  form?: string;
};

const createPersonSchema = z.object({
  email: z.string().trim().email("Email must be valid."),
  fullName: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  password: z.string().trim().min(8, "Password must be at least 8 characters.").max(72, "Password is too long."),
  roles: z.array(z.enum(USER_ROLES)).min(1, "Select at least one role."),
  department: z.string().trim().max(100, "Department is too long."),
  title: z.string().trim().max(200, "Title is too long."),
  countryCode: z
    .string()
    .trim()
    .max(2, "Country code must be 2 letters.")
    .refine((value) => value.length === 0 || /^[a-zA-Z]{2}$/.test(value), "Country code must be 2 letters."),
  timezone: z.string().trim().max(50, "Timezone is too long."),
  phone: z.string().trim().max(30, "Phone number is too long."),
  startDate: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value), "Start date must be YYYY-MM-DD."),
  managerId: z.string().uuid("Manager must be valid.").nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  primaryCurrency: z
    .string()
    .trim()
    .length(3, "Currency must be a 3-letter code."),
  status: z.enum(PROFILE_STATUSES)
});

const roleLabels: Record<AppRole, string> = {
  EMPLOYEE: "Employee",
  TEAM_LEAD: "Team Lead",
  MANAGER: "Manager",
  HR_ADMIN: "HR Admin",
  FINANCE_ADMIN: "Finance Admin",
  SUPER_ADMIN: "Super Admin"
};

const initialCreatePersonFormValues: CreatePersonFormValues = {
  email: "",
  fullName: "",
  password: "",
  roles: ["EMPLOYEE"],
  department: "",
  title: "",
  countryCode: "",
  timezone: "",
  phone: "",
  startDate: "",
  managerId: "",
  employmentType: "contractor",
  primaryCurrency: "USD",
  status: "active"
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toDateTimeValue(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  return value;
}

function toneForProfileStatus(status: ProfileStatus) {
  switch (status) {
    case "active":
      return "success" as const;
    case "onboarding":
      return "processing" as const;
    case "offboarding":
      return "warning" as const;
    case "inactive":
    default:
      return "draft" as const;
  }
}

function mapSchemaErrors(values: CreatePersonFormValues): CreatePersonFormErrors {
  const parsed = createPersonSchema.safeParse({
    email: values.email,
    fullName: values.fullName,
    password: values.password,
    roles: values.roles,
    department: values.department,
    title: values.title,
    countryCode: values.countryCode,
    timezone: values.timezone,
    phone: values.phone,
    startDate: values.startDate,
    managerId: values.managerId.trim().length > 0 ? values.managerId.trim() : null,
    employmentType: values.employmentType,
    primaryCurrency: values.primaryCurrency,
    status: values.status
  });

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;

  return {
    email: fieldErrors.email?.[0],
    fullName: fieldErrors.fullName?.[0],
    password: fieldErrors.password?.[0],
    roles: fieldErrors.roles?.[0],
    department: fieldErrors.department?.[0],
    title: fieldErrors.title?.[0],
    countryCode: fieldErrors.countryCode?.[0],
    timezone: fieldErrors.timezone?.[0],
    phone: fieldErrors.phone?.[0],
    startDate: fieldErrors.startDate?.[0],
    managerId: fieldErrors.managerId?.[0],
    employmentType: fieldErrors.employmentType?.[0],
    primaryCurrency: fieldErrors.primaryCurrency?.[0],
    status: fieldErrors.status?.[0]
  };
}

function hasValidationErrors(errors: CreatePersonFormErrors): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

function PeopleTableSkeleton() {
  return (
    <div className="people-table-skeleton" aria-hidden="true">
      <div className="people-table-skeleton-header" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={`people-table-skeleton-${index}`} className="people-table-skeleton-row" />
      ))}
    </div>
  );
}

export function PeopleClient({
  currentUserId,
  initialScope,
  canManagePeople
}: PeopleClientProps) {
  const { people, isLoading, errorMessage, refresh, setPeople } = usePeople({
    scope: initialScope
  });

  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createValues, setCreateValues] = useState<CreatePersonFormValues>(
    initialCreatePersonFormValues
  );
  const [createErrors, setCreateErrors] = useState<CreatePersonFormErrors>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const sortedPeople = useMemo(
    () =>
      [...people].sort((leftPerson, rightPerson) => {
        const comparison = leftPerson.fullName.localeCompare(rightPerson.fullName);
        return sortDirection === "asc" ? comparison : comparison * -1;
      }),
    [people, sortDirection]
  );

  const managerOptions = useMemo(
    () =>
      people
        .filter((person) => person.id !== currentUserId && person.status === "active")
        .sort((leftPerson, rightPerson) => leftPerson.fullName.localeCompare(rightPerson.fullName)),
    [currentUserId, people]
  );

  const addToast = (variant: ToastVariant, message: string) => {
    const id = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id, variant, message }]);
    window.setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
    }, 4000);
  };

  const closeCreatePanel = () => {
    if (isCreating) {
      return;
    }

    setCreateValues(initialCreatePersonFormValues);
    setCreateErrors({});
    setIsCreateOpen(false);
  };

  const updateCreateValues = (
    nextValues:
      | CreatePersonFormValues
      | ((currentValues: CreatePersonFormValues) => CreatePersonFormValues)
  ) => {
    setCreateValues((currentValues) => {
      const resolvedValues =
        typeof nextValues === "function" ? nextValues(currentValues) : nextValues;
      setCreateErrors(mapSchemaErrors(resolvedValues));
      return resolvedValues;
    });
  };

  const handleRoleToggle = (role: AppRole) => {
    updateCreateValues((currentValues) => {
      const hasSelectedRole = currentValues.roles.includes(role);
      const roles = hasSelectedRole
        ? currentValues.roles.filter((currentRole) => currentRole !== role)
        : [...currentValues.roles, role];

      return {
        ...currentValues,
        roles
      };
    });
  };

  const handleCreatePerson = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationErrors = mapSchemaErrors(createValues);
    setCreateErrors(validationErrors);

    if (hasValidationErrors(validationErrors)) {
      return;
    }

    setIsCreating(true);
    setCreateErrors((currentErrors) => ({ ...currentErrors, form: undefined }));

    try {
      const response = await fetch("/api/v1/people", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: createValues.email.trim(),
          fullName: createValues.fullName.trim(),
          password: createValues.password,
          roles: createValues.roles,
          department: createValues.department.trim() || undefined,
          title: createValues.title.trim() || undefined,
          countryCode: createValues.countryCode.trim() || undefined,
          timezone: createValues.timezone.trim() || undefined,
          phone: createValues.phone.trim() || undefined,
          startDate: createValues.startDate.trim() || undefined,
          managerId: createValues.managerId.trim() || undefined,
          employmentType: createValues.employmentType,
          primaryCurrency: createValues.primaryCurrency.trim().toUpperCase(),
          status: createValues.status
        })
      });

      const payload = (await response.json()) as PeopleCreateResponse;

      if (!response.ok || !payload.data?.person) {
        setCreateErrors((currentErrors) => ({
          ...currentErrors,
          form: payload.error?.message ?? "Unable to create person."
        }));
        return;
      }

      const createdPerson = payload.data.person;

      setPeople((currentPeople) => {
        const withoutCreatedPerson = currentPeople.filter(
          (person) => person.id !== createdPerson.id
        );
        return [createdPerson, ...withoutCreatedPerson];
      });

      closeCreatePanel();
      addToast("success", "Person created.");
      refresh();
    } catch (error) {
      setCreateErrors((currentErrors) => ({
        ...currentErrors,
        form: error instanceof Error ? error.message : "Unable to create person."
      }));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <PageHeader
        title="People"
        description="Employee directory with role-aware access and profile links."
        actions={
          canManagePeople ? (
            <button
              type="button"
              className="button button-accent"
              onClick={() => setIsCreateOpen(true)}
            >
              Add person
            </button>
          ) : null
        }
      />

      {isLoading ? <PeopleTableSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title="People data is unavailable"
          description={errorMessage}
          ctaLabel="Retry"
          ctaHref="/people"
        />
      ) : null}

      {!isLoading && !errorMessage && sortedPeople.length === 0 ? (
        <section className="people-empty-state">
          <EmptyState
            title="No people records found"
            description="Create a profile to start managing your team in Crew Hub."
            ctaLabel={canManagePeople ? "Add person" : "Go to dashboard"}
            ctaHref={canManagePeople ? "/people" : "/dashboard"}
          />
          {canManagePeople ? (
            <button
              type="button"
              className="button button-accent"
              onClick={() => setIsCreateOpen(true)}
            >
              Add person
            </button>
          ) : null}
        </section>
      ) : null}

      {!isLoading && !errorMessage && sortedPeople.length > 0 ? (
        <div className="data-table-container">
          <table className="data-table" aria-label="People directory table">
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    className="table-sort-trigger"
                    onClick={() =>
                      setSortDirection((currentDirection) =>
                        currentDirection === "asc" ? "desc" : "asc"
                      )
                    }
                  >
                    Name {sortDirection === "asc" ? "↑" : "↓"}
                  </button>
                </th>
                <th>Roles</th>
                <th>Department</th>
                <th>Country</th>
                <th>Status</th>
                <th>Employment</th>
                <th>Created</th>
                <th className="table-action-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPeople.map((person) => (
                <tr key={person.id} className="data-table-row">
                  <td>
                    <div className="people-cell-copy">
                      <p className="people-cell-title">{person.fullName}</p>
                      <p className="people-cell-description">{person.email}</p>
                    </div>
                  </td>
                  <td>
                    <div className="people-role-badges">
                      {person.roles.length > 0 ? (
                        person.roles.map((role) => (
                          <StatusBadge key={`${person.id}-${role}`} tone="info">
                            {roleLabels[role]}
                          </StatusBadge>
                        ))
                      ) : (
                        <StatusBadge tone="draft">No role</StatusBadge>
                      )}
                    </div>
                  </td>
                  <td>{person.department ?? "--"}</td>
                  <td>
                    {person.countryCode ? (
                      <span className="country-chip">
                        <span>{countryFlagFromCode(person.countryCode)}</span>
                        <span>{countryNameFromCode(person.countryCode)}</span>
                      </span>
                    ) : (
                      "--"
                    )}
                  </td>
                  <td>
                    <StatusBadge tone={toneForProfileStatus(person.status)}>
                      {person.status}
                    </StatusBadge>
                  </td>
                  <td>
                    <StatusBadge tone="processing">{person.employmentType.replace("_", " ")}</StatusBadge>
                  </td>
                  <td>
                    <time
                      dateTime={toDateTimeValue(person.createdAt)}
                      title={formatDateTimeTooltip(toDateTimeValue(person.createdAt))}
                    >
                      {formatRelativeTime(toDateTimeValue(person.createdAt))}
                    </time>
                  </td>
                  <td className="table-row-action-cell">
                    <div className="people-row-actions">
                      <Link className="table-row-action" href={`/people/${person.id}`}>
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <SlidePanel
        isOpen={isCreateOpen}
        title="Add Person"
        description="Create login credentials and a profile record."
        onClose={closeCreatePanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleCreatePerson} noValidate>
          <label className="form-field" htmlFor="person-email">
            <span className="form-label">Email</span>
            <input
              id="person-email"
              type="email"
              autoComplete="off"
              className={createErrors.email ? "form-input form-input-error" : "form-input"}
              value={createValues.email}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  email: event.currentTarget.value
                })
              }
            />
            {createErrors.email ? <p className="form-field-error">{createErrors.email}</p> : null}
          </label>

          <label className="form-field" htmlFor="person-full-name">
            <span className="form-label">Full name</span>
            <input
              id="person-full-name"
              className={createErrors.fullName ? "form-input form-input-error" : "form-input"}
              value={createValues.fullName}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  fullName: event.currentTarget.value
                })
              }
            />
            {createErrors.fullName ? (
              <p className="form-field-error">{createErrors.fullName}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="person-password">
            <span className="form-label">Temporary password</span>
            <input
              id="person-password"
              type="password"
              autoComplete="new-password"
              className={createErrors.password ? "form-input form-input-error" : "form-input"}
              value={createValues.password}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  password: event.currentTarget.value
                })
              }
            />
            {createErrors.password ? (
              <p className="form-field-error">{createErrors.password}</p>
            ) : null}
          </label>

          <fieldset className="form-field people-role-fieldset">
            <legend className="form-label">Roles</legend>
            <div className="people-role-selection">
              {USER_ROLES.map((role) => (
                <label key={role} className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={createValues.roles.includes(role)}
                    onChange={() => handleRoleToggle(role)}
                  />
                  <span>{roleLabels[role]}</span>
                </label>
              ))}
            </div>
            {createErrors.roles ? <p className="form-field-error">{createErrors.roles}</p> : null}
          </fieldset>

          <label className="form-field" htmlFor="person-department">
            <span className="form-label">Department</span>
            <input
              id="person-department"
              className={createErrors.department ? "form-input form-input-error" : "form-input"}
              value={createValues.department}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  department: event.currentTarget.value
                })
              }
            />
            {createErrors.department ? (
              <p className="form-field-error">{createErrors.department}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="person-title">
            <span className="form-label">Title</span>
            <input
              id="person-title"
              className={createErrors.title ? "form-input form-input-error" : "form-input"}
              value={createValues.title}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  title: event.currentTarget.value
                })
              }
            />
            {createErrors.title ? <p className="form-field-error">{createErrors.title}</p> : null}
          </label>

          <label className="form-field" htmlFor="person-country">
            <span className="form-label">Country code</span>
            <input
              id="person-country"
              maxLength={2}
              className={createErrors.countryCode ? "form-input form-input-error" : "form-input"}
              value={createValues.countryCode}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  countryCode: event.currentTarget.value.toUpperCase()
                })
              }
            />
            {createErrors.countryCode ? (
              <p className="form-field-error">{createErrors.countryCode}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="person-timezone">
            <span className="form-label">Timezone</span>
            <input
              id="person-timezone"
              className={createErrors.timezone ? "form-input form-input-error" : "form-input"}
              value={createValues.timezone}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  timezone: event.currentTarget.value
                })
              }
            />
            {createErrors.timezone ? (
              <p className="form-field-error">{createErrors.timezone}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="person-phone">
            <span className="form-label">Phone</span>
            <input
              id="person-phone"
              className={createErrors.phone ? "form-input form-input-error" : "form-input"}
              value={createValues.phone}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  phone: event.currentTarget.value
                })
              }
            />
            {createErrors.phone ? <p className="form-field-error">{createErrors.phone}</p> : null}
          </label>

          <label className="form-field" htmlFor="person-start-date">
            <span className="form-label">Start date</span>
            <input
              id="person-start-date"
              type="date"
              className={createErrors.startDate ? "form-input form-input-error" : "form-input"}
              value={createValues.startDate}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  startDate: event.currentTarget.value
                })
              }
            />
            {createErrors.startDate ? (
              <p className="form-field-error">{createErrors.startDate}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="person-manager">
            <span className="form-label">Manager</span>
            <select
              id="person-manager"
              className={createErrors.managerId ? "form-input form-input-error" : "form-input"}
              value={createValues.managerId}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  managerId: event.currentTarget.value
                })
              }
            >
              <option value="">No manager</option>
              {managerOptions.map((person) => (
                <option key={`manager-${person.id}`} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </select>
            {createErrors.managerId ? (
              <p className="form-field-error">{createErrors.managerId}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="person-employment-type">
            <span className="form-label">Employment type</span>
            <select
              id="person-employment-type"
              className={
                createErrors.employmentType ? "form-input form-input-error" : "form-input"
              }
              value={createValues.employmentType}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  employmentType: event.currentTarget.value as EmploymentType
                })
              }
            >
              {EMPLOYMENT_TYPES.map((employmentType) => (
                <option key={employmentType} value={employmentType}>
                  {employmentType.replace("_", " ")}
                </option>
              ))}
            </select>
            {createErrors.employmentType ? (
              <p className="form-field-error">{createErrors.employmentType}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="person-primary-currency">
            <span className="form-label">Primary currency</span>
            <input
              id="person-primary-currency"
              maxLength={3}
              className={
                createErrors.primaryCurrency ? "form-input form-input-error" : "form-input"
              }
              value={createValues.primaryCurrency}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  primaryCurrency: event.currentTarget.value.toUpperCase()
                })
              }
            />
            {createErrors.primaryCurrency ? (
              <p className="form-field-error">{createErrors.primaryCurrency}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="person-status">
            <span className="form-label">Profile status</span>
            <select
              id="person-status"
              className={createErrors.status ? "form-input form-input-error" : "form-input"}
              value={createValues.status}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  status: event.currentTarget.value as ProfileStatus
                })
              }
            >
              {PROFILE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            {createErrors.status ? (
              <p className="form-field-error">{createErrors.status}</p>
            ) : null}
          </label>

          {createErrors.form ? <p className="form-submit-error">{createErrors.form}</p> : null}

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeCreatePanel} disabled={isCreating}>
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isCreating}>
              {isCreating ? "Creating..." : "Create person"}
            </button>
          </div>
        </form>
      </SlidePanel>

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite">
          {toasts.map((toast) => (
            <article
              key={toast.id}
              className={`toast-message ${
                toast.variant === "success"
                  ? "toast-message-success"
                  : toast.variant === "error"
                    ? "toast-message-error"
                    : "toast-message-info"
              }`}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                className="toast-dismiss"
                aria-label="Dismiss notification"
                onClick={() =>
                  setToasts((currentToasts) =>
                    currentToasts.filter((entry) => entry.id !== toast.id)
                  )
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
