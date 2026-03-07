"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { DEPARTMENTS } from "../../lib/departments";
import { USER_ROLES } from "../../lib/navigation";
import {
  buildAccessOverridesFromSelected,
  resolveDefaultAccessForRoles
} from "../../lib/auth/default-role-access";
import type { AppRole } from "../../types/auth";
import {
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type PeopleCreatePayload,
  type PeopleCreateResponse,
  type PersonRecord
} from "../../types/people";
import { AccessChecklist, type AccessChecklistItem } from "./access-checklist";

type InviteFormValues = {
  email: string;
  fullName: string;
  phone: string;
  isNewEmployee: boolean;
  department: string;
  title: string;
  roles: AppRole[];
  managerId: string;
  employmentType: EmploymentType;
  startDate: string;
};

type InviteFormErrors = Partial<Record<keyof InviteFormValues, string>> & {
  form?: string;
};

type InviteSuccessState = {
  userId: string;
  fullName: string;
  email: string;
};

type InviteFormProps = {
  people: PersonRecord[];
  accessItems: AccessChecklistItem[];
  onCreated: (person: PersonRecord) => void;
};

type Step = 1 | 2 | 3 | 4;

const roleLabels: Record<AppRole, string> = {
  EMPLOYEE: "Employee",
  TEAM_LEAD: "Team Lead",
  MANAGER: "Manager",
  HR_ADMIN: "HR Admin",
  FINANCE_ADMIN: "Finance Admin",
  SUPER_ADMIN: "Super Admin"
};

const initialValues: InviteFormValues = {
  email: "",
  fullName: "",
  phone: "",
  isNewEmployee: true,
  department: "",
  title: "",
  roles: ["EMPLOYEE"],
  managerId: "",
  employmentType: "contractor",
  startDate: ""
};

function normalizeRoles(roles: readonly AppRole[]): AppRole[] {
  return [...new Set(["EMPLOYEE", ...roles] as AppRole[])];
}

function copyToClipboard(value: string) {
  void navigator.clipboard?.writeText(value);
}

function stepLabel(step: Step): string {
  if (step === 1) return "Basic Info";
  if (step === 2) return "Role & Department";
  if (step === 3) return "Access Control";
  return "Review & Confirm";
}

export function InviteForm({ people, accessItems, onCreated }: InviteFormProps) {
  const [step, setStep] = useState<Step>(1);
  const [values, setValues] = useState<InviteFormValues>(initialValues);
  const [managerSearch, setManagerSearch] = useState("");
  const [errors, setErrors] = useState<InviteFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedAccessKeys, setSelectedAccessKeys] = useState<string[]>([]);
  const [successState, setSuccessState] = useState<InviteSuccessState | null>(null);

  const defaultRoleAccess = useMemo(
    () => resolveDefaultAccessForRoles(values.roles),
    [values.roles]
  );

  useEffect(() => {
    setSelectedAccessKeys(defaultRoleAccess);
  }, [defaultRoleAccess]);

  const managerOptions = useMemo(() => {
    const query = managerSearch.trim().toLowerCase();
    const filtered = people.filter((person) => {
      if (person.id === values.managerId) {
        return true;
      }

      if (values.department && person.department !== values.department) {
        return false;
      }

      const searchable = `${person.fullName} ${person.email}`.toLowerCase();
      return query.length === 0 || searchable.includes(query);
    });

    return filtered.sort((left, right) => left.fullName.localeCompare(right.fullName));
  }, [managerSearch, people, values.department, values.managerId]);

  const selectedAccessSet = useMemo(() => new Set(selectedAccessKeys), [selectedAccessKeys]);

  const validationErrors = useMemo(() => {
    const nextErrors: InviteFormErrors = {};

    if (!values.email.trim()) {
      nextErrors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
      nextErrors.email = "Email must be valid.";
    }

    if (!values.fullName.trim()) {
      nextErrors.fullName = "Full name is required.";
    }

    if (!values.department.trim()) {
      nextErrors.department = "Department is required.";
    }

    if (values.roles.length === 0) {
      nextErrors.roles = "At least one role is required.";
    }

    return nextErrors;
  }, [values.department, values.email, values.fullName, values.roles]);

  const roleSelection = useMemo(() => normalizeRoles(values.roles), [values.roles]);

  const roleSummary = roleSelection.map((role) => roleLabels[role]).join(", ");
  const managerName =
    values.managerId.trim().length > 0
      ? people.find((person) => person.id === values.managerId)?.fullName ?? "Unknown manager"
      : "No manager";

  const goNext = () => {
    if (step === 1) {
      if (validationErrors.email || validationErrors.fullName) {
        setErrors(validationErrors);
        return;
      }

      setErrors({});
      setStep(2);
      return;
    }

    if (step === 2) {
      if (validationErrors.department || validationErrors.roles) {
        setErrors(validationErrors);
        return;
      }

      setErrors({});
      setStep(3);
      return;
    }

    if (step === 3) {
      setStep(4);
    }
  };

  const goBack = () => {
    if (step === 1) {
      return;
    }

    setStep((currentStep) => (currentStep - 1) as Step);
  };

  const resetForm = () => {
    setStep(1);
    setValues(initialValues);
    setErrors({});
    setSuccessState(null);
    setManagerSearch("");
  };

  const toggleRole = (role: AppRole, checked: boolean) => {
    if (role === "EMPLOYEE") {
      return;
    }

    const nextRoles = checked
      ? normalizeRoles([...values.roles, role])
      : normalizeRoles(values.roles.filter((value) => value !== role));

    setValues((currentValues) => ({
      ...currentValues,
      roles: nextRoles
    }));
  };

  const toggleAccess = (navItemKey: string, checked: boolean) => {
    setSelectedAccessKeys((currentKeys) => {
      const currentSet = new Set(currentKeys);

      if (checked) {
        currentSet.add(navItemKey);
      } else {
        currentSet.delete(navItemKey);
      }

      return [...currentSet].sort((left, right) => left.localeCompare(right));
    });
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    const overrides = buildAccessOverridesFromSelected({
      selectedNavItemKeys: selectedAccessKeys,
      defaultNavItemKeys: defaultRoleAccess
    });

    const payload: PeopleCreatePayload = {
      email: values.email.trim(),
      fullName: values.fullName.trim(),
      phone: values.phone.trim() || undefined,
      isNewEmployee: values.isNewEmployee,
      department: values.department.trim(),
      title: values.title.trim() || undefined,
      roles: roleSelection,
      managerId: values.managerId.trim() || undefined,
      employmentType: values.employmentType,
      startDate: values.startDate.trim() || undefined,
      primaryCurrency: "USD",
      accessOverrides: overrides
    };

    try {
      const response = await fetch("/api/v1/people", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const responseBody = (await response.json()) as PeopleCreateResponse;

      if (!response.ok || !responseBody.data?.person) {
        setErrors({
          form: responseBody.error?.message ?? "Unable to create employee."
        });
        return;
      }

      onCreated(responseBody.data.person);
      setSuccessState({
        userId: responseBody.data.person.id,
        fullName: responseBody.data.person.fullName,
        email: responseBody.data.person.email
      });
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : "Unable to create employee."
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successState) {
    return (
      <section className="settings-card">
        <h3 className="section-title">Employee created</h3>
        <p className="settings-card-description">
          {successState.fullName} ({successState.email}) is ready in Crew Hub.
        </p>
        <p className="settings-card-description">
          A welcome email and secure account setup link have been sent to the employee.
        </p>
        <div className="settings-actions">
          <button type="button" className="button button-accent" onClick={resetForm}>
            Create Another
          </button>
          <Link className="button button-ghost" href={`/people/${successState.userId}`}>
            View Employee
          </Link>
        </div>
      </section>
    );
  }

  return (
    <form className="settings-card" onSubmit={handleCreate} noValidate>
      <header className="admin-users-form-header">
        <h3 className="section-title">Invite Employee</h3>
        <p className="settings-card-description">
          Step {step} of 4: {stepLabel(step)}
        </p>
      </header>

      {step === 1 ? (
        <div className="admin-users-form-grid">
          <label className="form-field" htmlFor="invite-email">
            <span className="form-label">Email address</span>
            <input
              id="invite-email"
              type="email"
              className={errors.email ? "form-input form-input-error" : "form-input"}
              value={values.email}
              onChange={(event) =>
                setValues((currentValues) => ({
                  ...currentValues,
                  email: event.currentTarget.value
                }))
              }
            />
            {errors.email ? <p className="form-field-error">{errors.email}</p> : null}
          </label>

          <label className="form-field" htmlFor="invite-full-name">
            <span className="form-label">Full name</span>
            <input
              id="invite-full-name"
              className={errors.fullName ? "form-input form-input-error" : "form-input"}
              value={values.fullName}
              onChange={(event) =>
                setValues((currentValues) => ({
                  ...currentValues,
                  fullName: event.currentTarget.value
                }))
              }
            />
            {errors.fullName ? <p className="form-field-error">{errors.fullName}</p> : null}
          </label>

          <label className="form-field" htmlFor="invite-phone">
            <span className="form-label">Phone number (optional)</span>
            <input
              id="invite-phone"
              className="form-input"
              value={values.phone}
              onChange={(event) =>
                setValues((currentValues) => ({
                  ...currentValues,
                  phone: event.currentTarget.value
                }))
              }
            />
          </label>

          <fieldset className="form-field">
            <legend className="form-label">Employee type</legend>
            <label className="settings-checkbox">
              <input
                type="radio"
                name="invite-is-new-employee"
                checked={values.isNewEmployee}
                onChange={() =>
                  setValues((currentValues) => ({
                    ...currentValues,
                    isNewEmployee: true
                  }))
                }
              />
              <span>New Employee</span>
            </label>
            <label className="settings-checkbox">
              <input
                type="radio"
                name="invite-is-new-employee"
                checked={!values.isNewEmployee}
                onChange={() =>
                  setValues((currentValues) => ({
                    ...currentValues,
                    isNewEmployee: false
                  }))
                }
              />
              <span>Existing Employee</span>
            </label>
            <p className="settings-card-description">
              New employees will automatically receive onboarding tasks.
            </p>
          </fieldset>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="admin-users-form-grid">
          <label className="form-field" htmlFor="invite-department">
            <span className="form-label">Department</span>
            <select
              id="invite-department"
              className={errors.department ? "form-input form-input-error" : "form-input"}
              value={values.department}
              onChange={(event) =>
                setValues((currentValues) => ({
                  ...currentValues,
                  department: event.currentTarget.value,
                  managerId: ""
                }))
              }
            >
              <option value="">Select department</option>
              {DEPARTMENTS.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
            {errors.department ? <p className="form-field-error">{errors.department}</p> : null}
          </label>

          <label className="form-field" htmlFor="invite-title">
            <span className="form-label">Job title</span>
            <input
              id="invite-title"
              className="form-input"
              value={values.title}
              onChange={(event) =>
                setValues((currentValues) => ({
                  ...currentValues,
                  title: event.currentTarget.value
                }))
              }
            />
          </label>

          <fieldset className="form-field">
            <legend className="form-label">Role assignment</legend>
            <div className="admin-users-role-grid">
              {USER_ROLES.map((role) => (
                <label key={role} className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={roleSelection.includes(role)}
                    disabled={role === "EMPLOYEE"}
                    onChange={(event) => toggleRole(role, event.currentTarget.checked)}
                  />
                  <span>{roleLabels[role]}</span>
                </label>
              ))}
            </div>
            {errors.roles ? <p className="form-field-error">{errors.roles}</p> : null}
          </fieldset>

          <label className="form-field" htmlFor="invite-manager-search">
            <span className="form-label">Team Lead / Manager</span>
            <input
              id="invite-manager-search"
              className="form-input"
              placeholder="Search by name or email"
              value={managerSearch}
              onChange={(event) => setManagerSearch(event.currentTarget.value)}
            />
            <select
              className="form-input"
              value={values.managerId}
              onChange={(event) =>
                setValues((currentValues) => ({
                  ...currentValues,
                  managerId: event.currentTarget.value
                }))
              }
            >
              <option value="">No manager</option>
              {managerOptions.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName} ({person.department ?? ""})
                </option>
              ))}
            </select>
          </label>

          <label className="form-field" htmlFor="invite-employment-type">
            <span className="form-label">Employment type</span>
            <select
              id="invite-employment-type"
              className="form-input"
              value={values.employmentType}
              onChange={(event) =>
                setValues((currentValues) => ({
                  ...currentValues,
                  employmentType: event.currentTarget.value as EmploymentType
                }))
              }
            >
              {EMPLOYMENT_TYPES.map((employmentType) => (
                <option key={employmentType} value={employmentType}>
                  {employmentType === "full_time"
                    ? "Full-time"
                    : employmentType === "part_time"
                      ? "Part-time"
                      : "Contractor"}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field" htmlFor="invite-start-date">
            <span className="form-label">Start date</span>
            <input
              id="invite-start-date"
              type="date"
              className="form-input"
              value={values.startDate}
              onChange={(event) =>
                setValues((currentValues) => ({
                  ...currentValues,
                  startDate: event.currentTarget.value
                }))
              }
            />
          </label>
        </div>
      ) : null}

      {step === 3 ? (
        <AccessChecklist
          items={accessItems}
          selectedKeys={selectedAccessKeys}
          onToggle={toggleAccess}
        />
      ) : null}

      {step === 4 ? (
        <section className="settings-card admin-users-review-card">
          <h4 className="section-title">Review</h4>
          <dl className="admin-users-review-grid">
            <div>
              <dt>Email</dt>
              <dd>{values.email}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{values.fullName}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{values.department}</dd>
            </div>
            <div>
              <dt>Title</dt>
              <dd>{values.title || "--"}</dd>
            </div>
            <div>
              <dt>Roles</dt>
              <dd>{roleSummary}</dd>
            </div>
            <div>
              <dt>Manager</dt>
              <dd>{managerName}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{values.isNewEmployee ? "Onboarding" : "Active"}</dd>
            </div>
            <div>
              <dt>Access tabs selected</dt>
              <dd>{selectedAccessSet.size}</dd>
            </div>
          </dl>

          <p className="settings-card-description">
            A welcome email and secure account setup link will be sent to the employee.
          </p>
        </section>
      ) : null}

      {errors.form ? <p className="form-submit-error">{errors.form}</p> : null}

      <div className="settings-actions">
        {step > 1 ? (
          <button type="button" className="button button-ghost" onClick={goBack}>
            Back
          </button>
        ) : null}

        {step < 4 ? (
          <button type="button" className="button button-accent" onClick={goNext}>
            Next
          </button>
        ) : (
          <button type="submit" className="button button-accent" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Employee"}
          </button>
        )}
      </div>
    </form>
  );
}
