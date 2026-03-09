"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { z } from "zod";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { usePeople } from "../../../hooks/use-people";
import { usePresence, type PresenceState } from "../../../hooks/use-presence";
import { countryFlagFromCode, countryNameFromCode, getCountryDefaults } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { DEPARTMENTS } from "../../../lib/departments";
import { formatEmploymentType, formatProfileStatus } from "../../../lib/format-labels";
import { USER_ROLES } from "../../../lib/navigation";
import type { AppRole } from "../../../types/auth";
import { Users } from "lucide-react";
import {
  EMPLOYMENT_TYPES,
  PROFILE_STATUSES,
  type EmploymentType,
  type PeopleCreateResponse,
  type PeopleInviteResponse,
  type PeopleUpdateResponse,
  type PersonRecord,
  type ProfileStatus
} from "../../../types/people";
import { humanizeError } from "@/lib/errors";

type PeopleScope = "all" | "reports" | "me";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type PeopleClientProps = {
  currentUserId: string;
  initialScope: PeopleScope;
  canManagePeople: boolean;
  isAdmin?: boolean;
};

type ToastMessage = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type CreatePersonFormValues = {
  email: string;
  fullName: string;
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
  isNewHire: boolean;
};

type CreatePersonFormErrors = Partial<Record<keyof CreatePersonFormValues, string>> & {
  form?: string;
};

type EditPersonFormValues = {
  roles: AppRole[];
  department: string;
  managerId: string;
  title: string;
  crewTag: string;
};

type EditPersonFormErrors = {
  roles?: string;
  department?: string;
  managerId?: string;
  title?: string;
  crewTag?: string;
  form?: string;
};

const createPersonSchema = z.object({
  email: z.string().trim().email("Email must be valid."),
  fullName: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
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
  status: z.enum(PROFILE_STATUSES),
  isNewHire: z.boolean()
});

const roleLabels: Record<AppRole, string> = {
  EMPLOYEE: "Employee",
  TEAM_LEAD: "Team Lead",
  MANAGER: "Manager",
  HR_ADMIN: "HR Admin",
  FINANCE_ADMIN: "Finance Admin",
  SUPER_ADMIN: "Super Admin"
};

/** Priority order for roles — higher index = higher priority. */
const ROLE_PRIORITY: AppRole[] = [
  "EMPLOYEE",
  "TEAM_LEAD",
  "MANAGER",
  "HR_ADMIN",
  "FINANCE_ADMIN",
  "SUPER_ADMIN"
];

function getPrimaryRole(roles: AppRole[]): AppRole {
  let best: AppRole = "EMPLOYEE";
  let bestIndex = -1;
  for (const role of roles) {
    const idx = ROLE_PRIORITY.indexOf(role);
    if (idx > bestIndex) {
      bestIndex = idx;
      best = role;
    }
  }
  return best;
}

const initialCreatePersonFormValues: CreatePersonFormValues = {
  email: "",
  fullName: "",
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
  status: "active",
  isNewHire: true
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
    status: values.status,
    isNewHire: values.isNewHire
  });

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;

  return {
    email: fieldErrors.email?.[0],
    fullName: fieldErrors.fullName?.[0],
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

type BulkStep = "template" | "preview" | "importing" | "done";

type BulkParsedRow = {
  data: Record<string, string>;
  errors: string[];
  valid: boolean;
};

type BulkResult = {
  email: string;
  status: string;
  error?: string;
};

const CSV_TEMPLATE_HEADERS = [
  "full_name",
  "email",
  "country_code",
  "department",
  "job_title",
  "employment_type",
  "start_date",
  "manager_email",
  "roles"
] as const;

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCSVLine(lines[0]).map((header) => header.toLowerCase().trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }

    rows.push(row);
  }

  return { headers, rows };
}

function validateBulkRow(row: Record<string, string>): { errors: string[]; valid: boolean } {
  const errors: string[] = [];

  const email = row.email?.trim() ?? "";
  const fullName = row.full_name?.trim() ?? "";

  if (!fullName) {
    errors.push("Full name is required.");
  }

  if (!email) {
    errors.push("Email is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email is not valid.");
  }

  const countryCode = row.country_code?.trim() ?? "";
  if (countryCode && !/^[a-zA-Z]{2}$/.test(countryCode)) {
    errors.push("Country code must be 2 letters.");
  }

  const startDate = row.start_date?.trim() ?? "";
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    errors.push("Start date must be YYYY-MM-DD.");
  }

  const employmentType = row.employment_type?.trim().toLowerCase() ?? "";
  if (employmentType && !["contractor", "full_time", "part_time"].includes(employmentType)) {
    errors.push("Employment type must be contractor, full_time, or part_time.");
  }

  const managerEmail = row.manager_email?.trim() ?? "";
  if (managerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)) {
    errors.push("Manager email is not valid.");
  }

  return { errors, valid: errors.length === 0 };
}

function downloadCSVTemplate() {
  const csvContent = CSV_TEMPLATE_HEADERS.join(",") + "\nJane Doe,jane@example.com,US,Engineering,Software Engineer,full_time,2024-01-15,manager@example.com,EMPLOYEE";
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "crew-hub-people-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function mapCSVRowToEmployee(row: Record<string, string>) {
  const rolesRaw = row.roles?.trim() ?? "";
  const roles = rolesRaw
    .split(/[,;|]/)
    .map((r) => r.trim().toUpperCase())
    .filter((r) => USER_ROLES.includes(r as AppRole));

  return {
    email: row.email?.trim() ?? "",
    fullName: row.full_name?.trim() ?? "",
    countryCode: row.country_code?.trim() || undefined,
    department: row.department?.trim() || undefined,
    title: row.job_title?.trim() || undefined,
    startDate: row.start_date?.trim() || undefined,
    managerEmail: row.manager_email?.trim() || undefined,
    roles: roles.length > 0 ? roles : undefined,
    employmentType: row.employment_type?.trim().toLowerCase() || undefined
  };
}

const PRESENCE_LABELS: Record<PresenceState, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline"
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function PresenceDot({ state }: { state: PresenceState }) {
  return (
    <span
      className={`presence-dot presence-dot-${state}`}
      title={PRESENCE_LABELS[state]}
      aria-label={PRESENCE_LABELS[state]}
    />
  );
}

function PeopleTableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={`table-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

export function PeopleClient({
  currentUserId,
  initialScope,
  canManagePeople,
  isAdmin = false
}: PeopleClientProps) {
  const { people, isLoading, errorMessage, refresh, setPeople } = usePeople({
    scope: initialScope
  });

  const { presenceMap } = usePresence(isAdmin === true);

  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createValues, setCreateValues] = useState<CreatePersonFormValues>(
    initialCreatePersonFormValues
  );
  const [createErrors, setCreateErrors] = useState<CreatePersonFormErrors>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Edit person state
  const [editPerson, setEditPerson] = useState<PersonRecord | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editValues, setEditValues] = useState<EditPersonFormValues>({
    roles: ["EMPLOYEE"],
    department: "",
    managerId: "",
    title: "",
    crewTag: ""
  });
  const [editErrors, setEditErrors] = useState<EditPersonFormErrors>({});
  const [isEditSaving, setIsEditSaving] = useState(false);

  // Invite state
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [confirmInvitePerson, setConfirmInvitePerson] = useState<PersonRecord | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Reset authenticator state
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [confirmResetPerson, setConfirmResetPerson] = useState<PersonRecord | null>(null);

  // Bulk upload state
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [bulkStep, setBulkStep] = useState<BulkStep>("template");
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkRows, setBulkRows] = useState<BulkParsedRow[]>([]);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

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

  const closeBulkUploadPanel = useCallback(() => {
    if (bulkStep === "importing") {
      return;
    }

    setIsBulkUploadOpen(false);
    setBulkStep("template");
    setBulkFile(null);
    setBulkRows([]);
    setBulkResults([]);
    setBulkError(null);

    if (bulkFileInputRef.current) {
      bulkFileInputRef.current.value = "";
    }
  }, [bulkStep]);

  const handleBulkFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      setBulkError(null);
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      if (!file.name.endsWith(".csv")) {
        setBulkError("Please upload a .csv file.");
        return;
      }

      setBulkFile(file);

      try {
        const text = await file.text();
        const { headers, rows } = parseCSV(text);

        if (rows.length === 0) {
          setBulkError("The CSV file is empty or has no data rows.");
          return;
        }

        if (!headers.includes("email") || !headers.includes("full_name")) {
          setBulkError("The CSV must include 'email' and 'full_name' columns.");
          return;
        }

        // Check for duplicate emails within the file
        const emailCounts = new Map<string, number>();
        for (const row of rows) {
          const email = (row.email ?? "").trim().toLowerCase();
          if (email) {
            emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
          }
        }

        const parsedRows: BulkParsedRow[] = rows.map((row) => {
          const validation = validateBulkRow(row);
          const email = (row.email ?? "").trim().toLowerCase();
          const duplicateCount = emailCounts.get(email) ?? 0;

          if (duplicateCount > 1) {
            validation.errors.push("Duplicate email within this file.");
            validation.valid = false;
          }

          return {
            data: row,
            errors: validation.errors,
            valid: validation.valid
          };
        });

        setBulkRows(parsedRows);
        setBulkStep("preview");
      } catch {
        setBulkError("Failed to read the CSV file.");
      }
    },
    []
  );

  const handleBulkImport = useCallback(async () => {
    const validRows = bulkRows.filter((row) => row.valid);

    if (validRows.length === 0) {
      setBulkError("No valid rows to import.");
      return;
    }

    setBulkStep("importing");
    setBulkError(null);

    try {
      const employees = validRows.map((row) => mapCSVRowToEmployee(row.data));

      const response = await fetch("/api/v1/people/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employees, confirm: true })
      });

      const payload = await response.json();

      if (!response.ok && !payload.data?.results) {
        setBulkError(humanizeError(payload.error?.message ?? "Bulk import failed."));
        setBulkStep("preview");
        return;
      }

      setBulkResults(payload.data.results ?? []);
      setBulkStep("done");

      const created = payload.data.created ?? 0;
      const failed = payload.data.failed ?? 0;

      if (created > 0) {
        addToast("success", `${created} ${created === 1 ? "person" : "people"} imported successfully.`);
        refresh();
      }

      if (failed > 0) {
        addToast("error", `${failed} ${failed === 1 ? "person" : "people"} failed to import.`);
      }
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Bulk import failed.");
      setBulkStep("preview");
    }
  }, [bulkRows, refresh]);

  /* ── Edit person handlers ── */

  const openEditPanel = useCallback((person: PersonRecord) => {
    setEditPerson(person);
    setEditValues({
      roles: person.roles.length > 0 ? [...person.roles] : ["EMPLOYEE"],
      department: person.department ?? "",
      managerId: person.managerId ?? "",
      title: person.title ?? "",
      crewTag: person.crewTag ?? ""
    });
    setEditErrors({});
    setIsEditOpen(true);
  }, []);

  const closeEditPanel = useCallback(() => {
    if (isEditSaving) return;
    setIsEditOpen(false);
    setEditPerson(null);
    setEditErrors({});
  }, [isEditSaving]);

  const handleEditRoleToggle = useCallback((role: AppRole) => {
    setEditValues((prev) => {
      const has = prev.roles.includes(role);
      const next = has
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role];
      return { ...prev, roles: next.length > 0 ? next : ["EMPLOYEE"] };
    });
  }, []);

  const handleEditSave = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editPerson) return;

    const errors: EditPersonFormErrors = {};
    if (editValues.roles.length === 0) errors.roles = "Select at least one role.";
    if (Object.values(errors).some(Boolean)) {
      setEditErrors(errors);
      return;
    }

    setIsEditSaving(true);
    setEditErrors({});

    try {
      const response = await fetch(`/api/v1/people/${editPerson.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roles: editValues.roles,
          department: editValues.department.trim() || null,
          managerId: editValues.managerId.trim() || null,
          title: editValues.title.trim() || null,
          crewTag: editValues.crewTag.trim() || null
        })
      });

      const payload = (await response.json()) as PeopleUpdateResponse;

      if (!response.ok || !payload.data?.person) {
        setEditErrors({ form: humanizeError(payload.error?.message ?? "Unable to save changes.") });
        return;
      }

      const updated = payload.data.person;

      setPeople((current) =>
        current.map((p) => (p.id === updated.id ? updated : p))
      );

      closeEditPanel();
      addToast("success", `${updated.fullName} updated.`);
    } catch (error) {
      setEditErrors({ form: error instanceof Error ? error.message : "Unable to save changes." });
    } finally {
      setIsEditSaving(false);
    }
  }, [editPerson, editValues, closeEditPanel, setPeople]);

  /* ── Invite handlers ── */

  const closeInviteDialog = useCallback(() => {
    if (invitingId !== null) return;
    setConfirmInvitePerson(null);
    setInviteLink(null);
  }, [invitingId]);

  const handleCopyInviteLink = useCallback(async () => {
    if (!inviteLink) return;
    if (!navigator?.clipboard?.writeText) {
      addToast("error", "Clipboard access is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteLink);
      addToast("success", "Invite link copied to clipboard.");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Unable to copy invite link.");
    }
  }, [inviteLink]);

  const handleSendInvite = useCallback(async (person: PersonRecord) => {
    setInvitingId(person.id);

    try {
      const response = await fetch(`/api/v1/people/${person.id}/invite`, {
        method: "POST"
      });

      const payload = (await response.json()) as PeopleInviteResponse;

      if (!response.ok || !payload.data?.inviteSent) {
        addToast("error", humanizeError(payload.error?.message ?? "Unable to send invite."));
        return;
      }

      setInviteLink(payload.data.inviteLink);
      addToast(
        "success",
        payload.data.isResend
          ? `Fresh invite generated for ${person.fullName}.`
          : `Invite sent to ${person.fullName}.`
      );
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Unable to send invite.");
    } finally {
      setInvitingId(null);
    }
  }, []);

  /* ── Reset authenticator handler ── */

  const handleResetAuthenticator = useCallback(async (person: PersonRecord) => {
    setResettingId(person.id);

    try {
      const response = await fetch(`/api/v1/people/${person.id}/reset-password`, {
        method: "POST"
      });

      const payload = await response.json();

      if (!response.ok || !payload.data?.resetInitiated) {
        setConfirmResetPerson(null);
        addToast("error", humanizeError(payload.error?.message ?? "Unable to reset authenticator."));
        return;
      }

      setConfirmResetPerson(null);
      addToast("success", `Authenticator reset. Setup link sent for ${person.fullName}.`);
    } catch (error) {
      setConfirmResetPerson(null);
      addToast("error", error instanceof Error ? error.message : "Unable to reset authenticator.");
    } finally {
      setResettingId(null);
    }
  }, []);

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
          status: createValues.status,
          isNewEmployee: createValues.isNewHire
        })
      });

      const payload = (await response.json()) as PeopleCreateResponse;

      if (!response.ok || !payload.data?.person) {
        setCreateErrors((currentErrors) => ({
          ...currentErrors,
          form: humanizeError(payload.error?.message ?? "Unable to create person.")
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
        title="Crew Members"
        description="Find teammates, review roles, and open full profiles."
        actions={
          canManagePeople ? (
            <>
              <button
                type="button"
                className="button"
                onClick={() => setIsBulkUploadOpen(true)}
              >
                Bulk Upload
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => setIsCreateOpen(true)}
              >
                Add person
              </button>
            </>
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
        <>
          <EmptyState
            icon={<Users size={32} />}
            title="No crew members found"
            description="Add your first team member to start using people workflows."
            {...(canManagePeople
              ? { ctaLabel: "Add person", onCtaClick: () => setIsCreateOpen(true) }
              : {})}
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
        </>
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
                {isAdmin ? <th>Role</th> : null}
                <th>Department</th>
                <th>Country</th>
                {isAdmin ? <th>Status</th> : null}
                {canManagePeople ? <th>Access</th> : null}
                <th>Joined</th>
                <th className="table-action-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPeople.map((person) => (
                <tr key={person.id} className="data-table-row">
                  <td>
                    <Link href={`/people/${person.id}`} className="people-name-cell people-name-link">
                      <div className="people-avatar-wrap">
                        {person.avatarUrl ? (
                          <Image
                            src={person.avatarUrl}
                            alt=""
                            width={36}
                            height={36}
                            className="people-avatar-image"
                          />
                        ) : (
                          <div className="people-avatar-fallback" aria-hidden="true">
                            {getInitials(person.fullName)}
                          </div>
                        )}
                        {isAdmin && presenceMap.has(person.id) ? (
                          <div className="people-avatar-presence">
                            <PresenceDot state={presenceMap.get(person.id)!} />
                          </div>
                        ) : null}
                      </div>
                      <div className="people-cell-copy">
                        <p className="people-cell-title">{person.fullName}</p>
                        <p className="people-cell-description">{person.email}</p>
                      </div>
                    </Link>
                  </td>
                  {isAdmin ? (
                    <td>
                      <div className="people-role-tags">
                        {person.roles.length > 0 ? (
                          <>
                            <span
                              className="role-tag"
                              title={person.roles.map((r) => roleLabels[r]).join(", ")}
                            >
                              {roleLabels[getPrimaryRole(person.roles)]}
                            </span>
                            {person.roles.length > 1 ? (
                              <span
                                className="role-tag role-tag-count"
                                title={person.roles.map((r) => roleLabels[r]).join(", ")}
                              >
                                +{person.roles.length - 1}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="role-tag role-tag-muted">No role</span>
                        )}
                      </div>
                    </td>
                  ) : null}
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
                  {isAdmin ? (
                    <td>
                      <StatusBadge tone={toneForProfileStatus(person.status)}>
                        {formatProfileStatus(person.status)}
                      </StatusBadge>
                    </td>
                  ) : null}
                  {canManagePeople ? (
                    <td>
                      {person.inviteStatus === "active" ? (
                        <span className="role-tag role-tag-active" title="Account confirmed and set up">
                          Active
                        </span>
                      ) : (
                        <span className="role-tag role-tag-muted" title="Has not set up their account yet">
                          Not set up
                        </span>
                      )}
                    </td>
                  ) : null}
                  <td>
                    <time
                      dateTime={toDateTimeValue(person.startDate || person.createdAt)}
                      title={formatDateTimeTooltip(toDateTimeValue(person.startDate || person.createdAt))}
                    >
                      {formatRelativeTime(toDateTimeValue(person.startDate || person.createdAt))}
                    </time>
                  </td>
                  {canManagePeople ? (
                    <td className="table-row-action-cell">
                      <div className="people-row-actions">
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => openEditPanel(person)}
                        >
                          Edit
                        </button>
                        {person.inviteStatus === "active" ? (
                          <button
                            type="button"
                            className="table-row-action"
                            disabled={resettingId === person.id}
                            onClick={() => setConfirmResetPerson(person)}
                          >
                            {resettingId === person.id ? "Sending..." : "Reset Authenticator"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="table-row-action"
                            disabled={invitingId === person.id}
                            onClick={() => setConfirmInvitePerson(person)}
                          >
                            {invitingId === person.id ? "Sending..." : "Invite"}
                          </button>
                        )}
                      </div>
                    </td>
                  ) : (
                    <td className="table-row-action-cell">
                      <div className="people-row-actions">
                        <Link className="table-row-action" href={`/people/${person.id}`}>
                          View
                        </Link>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <SlidePanel
        isOpen={isCreateOpen}
        title="Add Person"
        description="Create a profile and send secure account setup instructions."
        onClose={closeCreatePanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleCreatePerson} noValidate>
          <div className="form-field">
            <span className="form-label">Employee type</span>
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}>
              <button
                type="button"
                className={createValues.isNewHire ? "button button-accent" : "button"}
                style={{ flex: 1, height: 36 }}
                onClick={() => updateCreateValues({ ...createValues, isNewHire: true })}
              >
                New hire
              </button>
              <button
                type="button"
                className={!createValues.isNewHire ? "button button-accent" : "button"}
                style={{ flex: 1, height: 36 }}
                onClick={() => updateCreateValues({ ...createValues, isNewHire: false })}
              >
                Existing employee
              </button>
            </div>
            <p className="form-field-hint">
              {createValues.isNewHire
                ? "New hires get an onboarding checklist and welcome email."
                : "Existing team members get a profile only."}
            </p>
          </div>

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
            <select
              id="person-department"
              className={createErrors.department ? "form-input form-input-error" : "form-input"}
              value={createValues.department}
              onChange={(event) =>
                updateCreateValues({
                  ...createValues,
                  department: event.currentTarget.value
                })
              }
            >
              <option value="">No department</option>
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
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
              onChange={(event) => {
                const code = event.currentTarget.value.toUpperCase();
                const defaults = code.length === 2 ? getCountryDefaults(code) : null;
                updateCreateValues({
                  ...createValues,
                  countryCode: code,
                  ...(defaults ? { primaryCurrency: defaults.currency, timezone: defaults.timezone } : {})
                });
              }}
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
                  {formatEmploymentType(employmentType)}
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
                  {formatProfileStatus(status)}
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

      <SlidePanel
        isOpen={isBulkUploadOpen}
        title="Bulk Upload"
        description="Import multiple crew members from a CSV file."
        onClose={closeBulkUploadPanel}
      >
        <div className="slide-panel-form-wrapper">
          {bulkStep === "template" ? (
            <div className="bulk-upload-step">
              <div className="bulk-upload-instructions">
                <h3 className="form-label">Step 1: Download the CSV template</h3>
                <p className="form-hint">
                  Download the template, fill in your employee data, then upload the completed CSV.
                  Required columns: <strong>full_name</strong> and <strong>email</strong>.
                  Optional columns: country_code, department, job_title, employment_type, start_date, manager_email, roles.
                </p>
              </div>
              <button
                type="button"
                className="button button-accent"
                onClick={downloadCSVTemplate}
              >
                Download CSV Template
              </button>
              <div className="bulk-upload-divider" />
              <div className="bulk-upload-instructions">
                <h3 className="form-label">Step 2: Upload your completed CSV</h3>
                <p className="form-hint">
                  Select the CSV file with your employee data. The file will be validated before import.
                </p>
              </div>
              <label className="form-field" htmlFor="bulk-csv-file">
                <span className="form-label">CSV file</span>
                <input
                  ref={bulkFileInputRef}
                  id="bulk-csv-file"
                  type="file"
                  accept=".csv"
                  className="form-input"
                  onChange={handleBulkFileChange}
                />
              </label>
              {bulkError ? <p className="form-submit-error">{bulkError}</p> : null}
            </div>
          ) : null}

          {bulkStep === "preview" ? (
            <div className="bulk-upload-step">
              <div className="bulk-upload-instructions">
                <h3 className="form-label">Preview</h3>
                <p className="form-hint">
                  {bulkFile?.name ?? "CSV"} - {bulkRows.length} row{bulkRows.length === 1 ? "" : "s"} found.{" "}
                  <strong>{bulkRows.filter((r) => r.valid).length}</strong> valid,{" "}
                  <strong>{bulkRows.filter((r) => !r.valid).length}</strong> with errors.
                </p>
              </div>
              <div className="data-table-container">
                <table className="data-table" aria-label="Bulk upload preview">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Department</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((row, index) => (
                      <tr
                        key={`bulk-row-${index}`}
                        className={`data-table-row ${row.valid ? "bulk-row-valid" : "bulk-row-error"}`}
                      >
                        <td>{index + 1}</td>
                        <td>{row.data.full_name || "--"}</td>
                        <td>{row.data.email || "--"}</td>
                        <td>{row.data.department || "--"}</td>
                        <td>
                          {row.valid ? (
                            <StatusBadge tone="success">Valid</StatusBadge>
                          ) : (
                            <span>
                              <StatusBadge tone="warning">Error</StatusBadge>
                              <span className="bulk-row-error-text">
                                {row.errors.join("; ")}
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {bulkError ? <p className="form-submit-error">{bulkError}</p> : null}
              <div className="slide-panel-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setBulkStep("template");
                    setBulkRows([]);
                    setBulkFile(null);
                    setBulkError(null);
                    if (bulkFileInputRef.current) {
                      bulkFileInputRef.current.value = "";
                    }
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="button button-accent"
                  disabled={bulkRows.filter((r) => r.valid).length === 0}
                  onClick={handleBulkImport}
                >
                  Import {bulkRows.filter((r) => r.valid).length} employee{bulkRows.filter((r) => r.valid).length === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          ) : null}

          {bulkStep === "importing" ? (
            <div className="bulk-upload-step">
              <div className="bulk-upload-instructions">
                <h3 className="form-label">Importing...</h3>
                <p className="form-hint">
                  Creating {bulkRows.filter((r) => r.valid).length} crew accounts. This may take a moment.
                </p>
              </div>
            </div>
          ) : null}

          {bulkStep === "done" ? (
            <div className="bulk-upload-step">
              <div className="bulk-upload-instructions">
                <h3 className="form-label">Import Complete</h3>
                <p className="form-hint">
                  {bulkResults.filter((r) => r.status === "created").length} employee{bulkResults.filter((r) => r.status === "created").length === 1 ? "" : "s"} created successfully.
                  {bulkResults.filter((r) => r.status === "error").length > 0
                    ? ` ${bulkResults.filter((r) => r.status === "error").length} failed.`
                    : ""}
                </p>
              </div>
              {bulkResults.length > 0 ? (
                <div className="data-table-container">
                  <table className="data-table" aria-label="Bulk import results">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResults.map((result, index) => (
                        <tr
                          key={`bulk-result-${index}`}
                          className={`data-table-row ${result.status === "created" ? "bulk-row-valid" : "bulk-row-error"}`}
                        >
                          <td>{result.email}</td>
                          <td>
                            <StatusBadge tone={result.status === "created" ? "success" : "warning"}>
                              {result.status === "created" ? "Created" : "Failed"}
                            </StatusBadge>
                          </td>
                          <td>{result.error ?? "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="slide-panel-actions">
                <button
                  type="button"
                  className="button button-accent"
                  onClick={closeBulkUploadPanel}
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </SlidePanel>

      {/* ── Edit Person SlidePanel ── */}
      <SlidePanel
        isOpen={isEditOpen}
        title={editPerson ? `Edit ${editPerson.fullName}` : "Edit Person"}
        description="Update role, department, and manager for this crew member."
        onClose={closeEditPanel}
      >
        {editPerson ? (
          <form className="slide-panel-form-wrapper" onSubmit={handleEditSave} noValidate>
            {editErrors.form ? <p className="form-submit-error">{editErrors.form}</p> : null}

            <div className="edit-person-identity">
              {editPerson.avatarUrl ? (
                <Image
                  src={editPerson.avatarUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="people-avatar-image"
                />
              ) : (
                <div className="people-avatar-fallback" aria-hidden="true">
                  {getInitials(editPerson.fullName)}
                </div>
              )}
              <div className="edit-person-copy">
                <p className="edit-person-name">{editPerson.fullName}</p>
                <p className="edit-person-email">{editPerson.email}</p>
              </div>
            </div>

            <label className="form-field" htmlFor="edit-person-title">
              <span className="form-label">Job title</span>
              <input
                id="edit-person-title"
                className="form-input"
                maxLength={200}
                placeholder="e.g. Software Engineer"
                value={editValues.title}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setEditValues((prev) => ({ ...prev, title: val }));
                }}
              />
            </label>

            <fieldset className="form-field people-role-fieldset">
              <legend className="form-label">Roles</legend>
              <div className="people-role-selection">
                {USER_ROLES.map((role) => (
                  <label key={`edit-role-${role}`} className="settings-checkbox">
                    <input
                      type="checkbox"
                      checked={editValues.roles.includes(role)}
                      onChange={() => handleEditRoleToggle(role)}
                    />
                    <span>{roleLabels[role]}</span>
                  </label>
                ))}
              </div>
              {editErrors.roles ? <p className="form-field-error">{editErrors.roles}</p> : null}
            </fieldset>

            <label className="form-field" htmlFor="edit-person-department">
              <span className="form-label">Department</span>
              <select
                id="edit-person-department"
                className={editErrors.department ? "form-input form-input-error" : "form-input"}
                value={editValues.department}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setEditValues((prev) => ({ ...prev, department: val }));
                }}
              >
                <option value="">No department</option>
                {DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
              {editErrors.department ? (
                <p className="form-field-error">{editErrors.department}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="edit-person-crew-tag">
              <span className="form-label">Crew Tag</span>
              <input
                id="edit-person-crew-tag"
                className={editErrors.crewTag ? "form-input form-input-error" : "form-input"}
                placeholder="e.g. john.doe"
                maxLength={50}
                value={editValues.crewTag}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setEditValues((prev) => ({ ...prev, crewTag: val }));
                }}
              />
              {editErrors.crewTag ? (
                <p className="form-field-error">{editErrors.crewTag}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="edit-person-manager">
              <span className="form-label">Manager</span>
              <select
                id="edit-person-manager"
                className={editErrors.managerId ? "form-input form-input-error" : "form-input"}
                value={editValues.managerId}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setEditValues((prev) => ({ ...prev, managerId: val }));
                }}
              >
                <option value="">No manager</option>
                {people
                  .filter((p) => p.id !== editPerson.id && p.status === "active")
                  .sort((a, b) => a.fullName.localeCompare(b.fullName))
                  .map((p) => (
                    <option key={`edit-mgr-${p.id}`} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
              </select>
              {editErrors.managerId ? (
                <p className="form-field-error">{editErrors.managerId}</p>
              ) : null}
            </label>

            <div className="slide-panel-actions">
              <button type="button" className="button" onClick={closeEditPanel} disabled={isEditSaving}>
                Cancel
              </button>
              <button type="submit" className="button button-accent" disabled={isEditSaving}>
                {isEditSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        ) : null}
      </SlidePanel>

      {/* ── Send Invite Dialog ── */}
      {confirmInvitePerson !== null ? (
        <div
          className="modal-overlay"
          onClick={closeInviteDialog}
        >
          <section
            className="confirm-dialog modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Send Crew Hub invite"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Send Crew Hub invite</h2>
            <p className="settings-card-description">
              Send an invite to {confirmInvitePerson.fullName} ({confirmInvitePerson.email}).
              They can use the generated setup link below to enroll their authenticator and start using Crew Hub.
            </p>

            {inviteLink ? (
              <div className="invite-success-banner" role="status">
                Invite link is ready. Share it directly if email delivery is delayed.
              </div>
            ) : null}

            <div className="invite-link-area">
              <p className="invite-link-label">Setup link</p>
              <div className="invite-link-input-row">
                <input
                  className="form-input"
                  value={inviteLink ?? ""}
                  readOnly
                  placeholder="Click “Send Invite” to generate a setup link."
                  onClick={(e) => {
                    if (inviteLink) {
                      (e.target as HTMLInputElement).select();
                    }
                  }}
                />
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    void handleCopyInviteLink();
                  }}
                  disabled={!inviteLink || invitingId !== null}
                >
                  Copy Link
                </button>
              </div>
              <p className="invite-link-note">
                Setup links are one-time and time-limited. If the user sees an expired link message, click
                “Send Invite” again to generate a fresh link.
              </p>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="button button-subtle"
                onClick={closeInviteDialog}
                disabled={invitingId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => {
                  void handleSendInvite(confirmInvitePerson);
                }}
                disabled={invitingId !== null}
              >
                {invitingId === confirmInvitePerson.id
                  ? "Sending..."
                  : inviteLink
                    ? "Resend Invite"
                    : "Send Invite"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* ── Reset Authenticator Dialog ── */}
      {confirmResetPerson !== null ? (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!resettingId) {
              setConfirmResetPerson(null);
            }
          }}
        >
          <section
            className="confirm-dialog modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Reset authenticator"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Reset authenticator</h2>
            <p className="settings-card-description">
              Reset the authenticator for {confirmResetPerson.fullName} ({confirmResetPerson.email})?
              They will receive an email with a link to set up a new authenticator.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-subtle"
                onClick={() => setConfirmResetPerson(null)}
                disabled={resettingId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => {
                  if (confirmResetPerson) void handleResetAuthenticator(confirmResetPerson);
                }}
                disabled={resettingId !== null}
              >
                {resettingId ? "Sending..." : "Reset Authenticator"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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
