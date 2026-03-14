"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  type PeoplePasswordResetResponse,
  type PeopleUpdateResponse,
  type PersonRecord,
  type ProfileStatus
} from "../../../types/people";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";

type PeopleScope = "all" | "reports" | "me";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type PeopleClientProps = {
  currentUserId: string;
  initialScope: PeopleScope;
  canCreatePeople: boolean;
  canInvitePeople: boolean;
  canEditPeople: boolean;
  canResetAuthenticator: boolean;
  isAdmin?: boolean;
  /** When true, the page header is rendered by the parent tabs wrapper. */
  embedded?: boolean;
  /** Called once on mount so the parent tabs wrapper can trigger create / bulk-upload. */
  onRegisterActions?: (actions: { openCreate: () => void; openBulkUpload: () => void }) => void;
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
  isNewHire: boolean | null;
};

type CreatePersonFormErrors = Partial<Record<keyof CreatePersonFormValues, string>> & {
  form?: string;
};

type EditPersonFormValues = {
  roles: AppRole[];
  department: string;
  managerId: string;
  teamLeadId: string;
  title: string;
  crewTag: string;
  directoryVisible: boolean;
  status: ProfileStatus;
};

type EditPersonFormErrors = {
  roles?: string;
  department?: string;
  managerId?: string;
  title?: string;
  crewTag?: string;
  form?: string;
};

function createValidationSchema(tv: (key: string) => string) {
  return z.object({
    email: z.string().trim().email(tv('validation.emailValid')),
    fullName: z.string().trim().min(1, tv('validation.nameRequired')).max(200, tv('validation.nameTooLong')),
    roles: z.array(z.enum(USER_ROLES)).min(1, tv('validation.selectRole')),
    department: z.string().trim().max(100, tv('validation.departmentTooLong')),
    title: z.string().trim().max(200, tv('validation.titleTooLong')),
    countryCode: z
      .string()
      .trim()
      .max(2, tv('validation.countryCode'))
      .refine((value) => value.length === 0 || /^[a-zA-Z]{2}$/.test(value), tv('validation.countryCode')),
    timezone: z.string().trim().max(50, tv('validation.timezoneTooLong')),
    phone: z.string().trim().max(30, tv('validation.phoneTooLong')),
    startDate: z
      .string()
      .trim()
      .refine((value) => value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value), tv('validation.startDateFormat')),
    managerId: z.string().uuid(tv('validation.managerValid')).nullable(),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    primaryCurrency: z
      .string()
      .trim()
      .length(3, tv('validation.currencyCode')),
    status: z.enum(PROFILE_STATUSES),
    isNewHire: z.boolean({ error: tv('validation.selectEmployeeType') })
  });
}

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
  isNewHire: null
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

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function mapSchemaErrors(values: CreatePersonFormValues, schema: z.ZodObject<z.ZodRawShape>): CreatePersonFormErrors {
  const parsed = schema.safeParse({
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

function validateBulkRow(row: Record<string, string>, tv: (key: string) => string): { errors: string[]; valid: boolean } {
  const errors: string[] = [];

  const email = row.email?.trim() ?? "";
  const fullName = row.full_name?.trim() ?? "";

  if (!fullName) {
    errors.push(tv('validation.fullNameRequired'));
  }

  if (!email) {
    errors.push(tv('validation.emailRequired'));
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push(tv('validation.emailInvalid'));
  }

  const countryCode = row.country_code?.trim() ?? "";
  if (countryCode && !/^[a-zA-Z]{2}$/.test(countryCode)) {
    errors.push(tv('validation.countryCode'));
  }

  const startDate = row.start_date?.trim() ?? "";
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    errors.push(tv('validation.startDateFormat'));
  }

  const employmentType = row.employment_type?.trim().toLowerCase() ?? "";
  if (employmentType && !["contractor", "full_time", "part_time"].includes(employmentType)) {
    errors.push(tv('validation.employmentTypeInvalid'));
  }

  const managerEmail = row.manager_email?.trim() ?? "";
  if (managerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)) {
    errors.push(tv('validation.managerEmailInvalid'));
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function PresenceDot({ state, label }: { state: PresenceState; label: string }) {
  return (
    <span
      className={`presence-dot presence-dot-${state}`}
      title={label}
      aria-label={label}
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
  canCreatePeople,
  canInvitePeople,
  canEditPeople,
  canResetAuthenticator,
  isAdmin = false,
  embedded = false,
  onRegisterActions
}: PeopleClientProps) {
  const t = useTranslations('people');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;
  const tcd = tCommon as (key: string, params?: Record<string, unknown>) => string;

  const roleLabels: Record<AppRole, string> = {
    EMPLOYEE: tcd('role.EMPLOYEE'),
    TEAM_LEAD: tcd('role.TEAM_LEAD'),
    MANAGER: tcd('role.MANAGER'),
    HR_ADMIN: tcd('role.HR_ADMIN'),
    FINANCE_ADMIN: tcd('role.FINANCE_ADMIN'),
    SUPER_ADMIN: tcd('role.SUPER_ADMIN')
  };

  const presenceLabels: Record<PresenceState, string> = {
    online: t('presence.online'),
    away: t('presence.away'),
    offline: t('presence.offline')
  };

  const createPersonSchema = useMemo(() => createValidationSchema(td), [td]);

  const fallbackInviteErrorMessage = useCallback((status: number): string => {
    if (status === 401) {
      return t('toast.sessionExpired');
    }

    if (status === 403) {
      return t('toast.noInvitePermission');
    }

    if (status === 404) {
      return t('toast.personNotFound');
    }

    return t('toast.unableToSendInvite');
  }, [t]);

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
    teamLeadId: "",
    title: "",
    crewTag: "",
    directoryVisible: true,
    status: "active"
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
  const [resetSetupLink, setResetSetupLink] = useState<string | null>(null);

  // Bulk upload state
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [bulkStep, setBulkStep] = useState<BulkStep>("template");
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkRows, setBulkRows] = useState<BulkParsedRow[]>([]);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  // Expose create / bulk-upload actions to the parent tabs wrapper
  useEffect(() => {
    if (embedded && onRegisterActions) {
      onRegisterActions({
        openCreate: () => setIsCreateOpen(true),
        openBulkUpload: () => setIsBulkUploadOpen(true)
      });
    }
  }, [embedded, onRegisterActions]);

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

  const canViewAccessState = canInvitePeople || canResetAuthenticator;
  const canManageAnyPersonAction = canEditPeople || canInvitePeople || canResetAuthenticator;

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
        setBulkError(t('bulkValidation.csvRequired'));
        return;
      }

      setBulkFile(file);

      try {
        const text = await file.text();
        const { headers, rows } = parseCSV(text);

        if (rows.length === 0) {
          setBulkError(t('bulkValidation.csvEmpty'));
          return;
        }

        if (!headers.includes("email") || !headers.includes("full_name")) {
          setBulkError(t('bulkValidation.csvMissingColumns'));
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
          const validation = validateBulkRow(row, td);
          const email = (row.email ?? "").trim().toLowerCase();
          const duplicateCount = emailCounts.get(email) ?? 0;

          if (duplicateCount > 1) {
            validation.errors.push(t('validation.duplicateEmail'));
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
        setBulkError(t('bulkValidation.csvReadFailed'));
      }
    },
    [t, td]
  );

  const handleBulkImport = useCallback(async () => {
    const validRows = bulkRows.filter((row) => row.valid);

    if (validRows.length === 0) {
      setBulkError(t('bulkValidation.noValidRows'));
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
        setBulkError(humanizeError(payload.error?.message ?? t('bulkValidation.bulkImportFailed')));
        setBulkStep("preview");
        return;
      }

      setBulkResults(payload.data.results ?? []);
      setBulkStep("done");

      const created = payload.data.created ?? 0;
      const failed = payload.data.failed ?? 0;

      if (created > 0) {
        addToast("success", td('toast.importedSuccess', { count: created }));
        refresh();
      }

      if (failed > 0) {
        addToast("error", td('toast.importedFailed', { count: failed }));
      }
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : t('bulkValidation.bulkImportFailed'));
      setBulkStep("preview");
    }
  }, [bulkRows, refresh, t, td]);

  /* ── Edit person handlers ── */

  const openEditPanel = useCallback((person: PersonRecord) => {
    setEditPerson(person);
    setEditValues({
      roles: person.roles.length > 0 ? [...person.roles] : ["EMPLOYEE"],
      department: person.department ?? "",
      managerId: person.managerId ?? "",
      teamLeadId: person.teamLeadId ?? "",
      title: person.title ?? "",
      crewTag: person.crewTag ?? "",
      directoryVisible: person.directoryVisible !== false,
      status: person.status as ProfileStatus
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
    if (editValues.roles.length === 0) errors.roles = t('validation.selectRole');
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
          teamLeadId: editValues.teamLeadId.trim() || null,
          title: editValues.title.trim() || null,
          crewTag: editValues.crewTag.trim() || null,
          directoryVisible: editValues.directoryVisible,
          status: editValues.status
        })
      });

      const payload = (await response.json()) as PeopleUpdateResponse;

      if (!response.ok || !payload.data?.person) {
        setEditErrors({ form: humanizeError(payload.error?.message ?? t('toast.unableToSaveChanges')) });
        return;
      }

      const updated = payload.data.person;

      // Diagnostic: verify status save round-trip (remove after production verification)
      if (editValues.status !== updated.status) {
        console.warn("[EditSave] Status mismatch!", {
          requested: editValues.status,
          returned: updated.status,
          httpStatus: response.status
        });
      }

      setPeople((current) =>
        current.map((p) => (p.id === updated.id ? updated : p))
      );

      closeEditPanel();
      addToast("success", td('toast.personUpdated', { name: updated.fullName }));
    } catch (error) {
      setEditErrors({ form: error instanceof Error ? error.message : t('toast.unableToSaveChanges') });
    } finally {
      setIsEditSaving(false);
    }
  }, [editPerson, editValues, closeEditPanel, setPeople, t, td]);

  /* ── Invite handlers ── */

  const closeInviteDialog = useCallback(() => {
    if (invitingId !== null) return;
    setConfirmInvitePerson(null);
    setInviteLink(null);
  }, [invitingId]);

  const openResetDialog = useCallback((person: PersonRecord) => {
    setConfirmResetPerson(person);
    setResetSetupLink(null);
  }, []);

  const closeResetDialog = useCallback(() => {
    if (resettingId !== null) return;
    setConfirmResetPerson(null);
    setResetSetupLink(null);
  }, [resettingId]);

  const handleCopyInviteLink = useCallback(async () => {
    if (!inviteLink) return;
    if (!navigator?.clipboard?.writeText) {
      addToast("error", t('toast.clipboardUnavailable'));
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteLink);
      addToast("success", t('toast.inviteLinkCopied'));
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : t('toast.unableToCopyInvite'));
    }
  }, [inviteLink, t]);

  const handleCopyResetSetupLink = useCallback(async () => {
    if (!resetSetupLink) return;
    if (!navigator?.clipboard?.writeText) {
      addToast("error", t('toast.clipboardUnavailable'));
      return;
    }

    try {
      await navigator.clipboard.writeText(resetSetupLink);
      addToast("success", t('toast.setupLinkCopied'));
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : t('toast.unableToCopySetup'));
    }
  }, [resetSetupLink, t]);

  const handleSendInvite = useCallback(async (person: PersonRecord) => {
    setInvitingId(person.id);

    try {
      const response = await fetch(`/api/v1/people/${person.id}/invite`, {
        method: "POST"
      });

      const payload = await parseJsonResponse<PeopleInviteResponse>(response);

      if (!response.ok || !payload?.data?.inviteSent) {
        addToast(
          "error",
          humanizeError(payload?.error?.message ?? fallbackInviteErrorMessage(response.status))
        );
        return;
      }

      setInviteLink(payload.data.inviteLink ?? null);
      addToast(
        "success",
        payload.data.isResend
          ? td('toast.freshInviteGenerated', { name: person.fullName })
          : td('toast.inviteSent', { name: person.fullName })
      );
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : t('toast.unableToSendInvite'));
    } finally {
      setInvitingId(null);
    }
  }, [fallbackInviteErrorMessage, t, td]);

  /* ── Reset authenticator handler ── */

  const handleResetAuthenticator = useCallback(async (person: PersonRecord) => {
    setResettingId(person.id);

    try {
      const response = await fetch(`/api/v1/people/${person.id}/reset-password`, {
        method: "POST"
      });

      const payload = await parseJsonResponse<PeoplePasswordResetResponse>(response);

      if (!response.ok || !payload?.data?.resetInitiated) {
        addToast(
          "error",
          humanizeError(payload?.error?.message ?? t('toast.unableToResetAuth'))
        );
        return;
      }

      setResetSetupLink(payload.data.setupLink ?? null);
      addToast("success", td('toast.authenticatorReset', { name: person.fullName }));
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : t('toast.unableToResetAuth'));
    } finally {
      setResettingId(null);
    }
  }, [t, td]);

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
      setCreateErrors(mapSchemaErrors(resolvedValues, createPersonSchema));
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

    const validationErrors = mapSchemaErrors(createValues, createPersonSchema);

    if (createValues.isNewHire === null) {
      validationErrors.isNewHire = t('validation.selectEmployeeType');
    }

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
          form: humanizeError(payload.error?.message ?? t('toast.unableToCreatePerson'))
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
      addToast("success", t('toast.personCreated'));
      refresh();
    } catch (error) {
      setCreateErrors((currentErrors) => ({
        ...currentErrors,
        form: error instanceof Error ? error.message : t('toast.unableToCreatePerson')
      }));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      {!embedded ? (
        <PageHeader
          title={t('pageTitle')}
          description={t('pageDescription')}
          actions={
            canCreatePeople ? (
              <>
                <button
                  type="button"
                  className="button"
                  onClick={() => setIsBulkUploadOpen(true)}
                >
                  {t('bulkUpload.title')}
                </button>
                <button
                  type="button"
                  className="button button-accent"
                  onClick={() => setIsCreateOpen(true)}
                >
                  {t('createPanel.addPersonButton')}
                </button>
              </>
            ) : null
          }
        />
      ) : null}

      {isLoading ? <PeopleTableSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title={t('emptyState.unavailable')}
          description={errorMessage}
          ctaLabel={tCommon('retry')}
          ctaHref="/people"
        />
      ) : null}

      {!isLoading && !errorMessage && sortedPeople.length === 0 ? (
        <>
          <EmptyState
            icon={<Users size={32} />}
            title={t('emptyState.noCrew')}
            description={t('emptyState.noCrewDescription')}
            {...(canCreatePeople
              ? { ctaLabel: t('emptyState.addPerson'), onCtaClick: () => setIsCreateOpen(true) }
              : {})}
          />
          {canCreatePeople ? (
            <button
              type="button"
              className="button button-accent"
              onClick={() => setIsCreateOpen(true)}
            >
              {t('emptyState.addPerson')}
            </button>
          ) : null}
        </>
      ) : null}

      {!isLoading && !errorMessage && sortedPeople.length > 0 ? (
        <div className="data-table-container">
          <table className="data-table" aria-label={t('table.ariaLabel')}>
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
                    {t('table.name')} {sortDirection === "asc" ? "\u2191" : "\u2193"}
                  </button>
                </th>
                {isAdmin ? <th>{t('table.role')}</th> : null}
                <th>{t('table.department')}</th>
                <th>{t('table.country')}</th>
                {isAdmin ? <th>{t('table.status')}</th> : null}
                {canViewAccessState ? <th>{t('table.access')}</th> : null}
                <th>{t('table.joined')}</th>
                {canViewAccessState ? <th>{t('table.crewHubJoined')}</th> : null}
                {canViewAccessState ? <th>{t('table.inviteSent')}</th> : null}
                <th className="table-action-column">{t('table.actions')}</th>
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
                            <PresenceDot state={presenceMap.get(person.id)!} label={presenceLabels[presenceMap.get(person.id)!]} />
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
                          <span className="role-tag role-tag-muted">{t('table.noRole')}</span>
                        )}
                      </div>
                    </td>
                  ) : null}
                  <td>{person.department ?? "--"}</td>
                  <td>
                    {person.countryCode ? (
                      <span className="country-chip">
                        <span>{countryFlagFromCode(person.countryCode)}</span>
                        <span>{countryNameFromCode(person.countryCode, locale)}</span>
                      </span>
                    ) : (
                      "--"
                    )}
                  </td>
                  {isAdmin ? (
                    <td>
                      <StatusBadge tone={toneForProfileStatus(person.status)}>
                        {formatProfileStatus(person.status, locale)}
                      </StatusBadge>
                    </td>
                  ) : null}
                  {canViewAccessState ? (
                    <td>
                      {person.accessStatus === "signed_in" ? (
                        <span className="role-tag role-tag-active" title={t('table.accessSignedInTooltip')}>
                          {t('table.accessSignedIn')}
                        </span>
                      ) : person.accessStatus === "invited" ? (
                        <span className="role-tag role-tag-pending" title={t('table.accessInvitedTooltip')}>
                          {t('table.accessInvited')}
                        </span>
                      ) : (
                        <span className="role-tag role-tag-muted" title={t('table.accessNotInvitedTooltip')}>
                          {t('table.accessNotInvited')}
                        </span>
                      )}
                    </td>
                  ) : null}
                  <td>
                    {person.startDate ? (
                      <time
                        dateTime={toDateTimeValue(person.startDate)}
                        title={formatDateTimeTooltip(toDateTimeValue(person.startDate), locale)}
                      >
                        {formatRelativeTime(toDateTimeValue(person.startDate), locale)}
                      </time>
                    ) : (
                      <span className="text-muted">{"\u2014"}</span>
                    )}
                  </td>
                  {canViewAccessState ? (
                    <td>
                      {person.crewHubJoinedAt ? (
                        <time
                          dateTime={toDateTimeValue(person.crewHubJoinedAt)}
                          title={formatDateTimeTooltip(toDateTimeValue(person.crewHubJoinedAt), locale)}
                        >
                          {formatRelativeTime(toDateTimeValue(person.crewHubJoinedAt), locale)}
                        </time>
                      ) : (
                        <span className="text-muted">{"\u2014"}</span>
                      )}
                    </td>
                  ) : null}
                  {canViewAccessState ? (
                    <td>
                      {person.firstInvitedAt ? (
                        <time
                          dateTime={toDateTimeValue(person.firstInvitedAt)}
                          title={formatDateTimeTooltip(toDateTimeValue(person.firstInvitedAt), locale)}
                        >
                          {formatRelativeTime(toDateTimeValue(person.firstInvitedAt), locale)}
                        </time>
                      ) : (
                        <span className="text-muted">{"\u2014"}</span>
                      )}
                    </td>
                  ) : null}
                  {canManageAnyPersonAction ? (
                    <td className="table-row-action-cell">
                      <div className="people-row-actions">
                        {canEditPeople ? (
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => openEditPanel(person)}
                          >
                            {t('table.edit')}
                          </button>
                        ) : null}
                        {person.accessStatus === "signed_in" && canResetAuthenticator ? (
                          <button
                            type="button"
                            className="table-row-action table-row-action-warning"
                            disabled={resettingId === person.id}
                            onClick={() => openResetDialog(person)}
                          >
                            {resettingId === person.id ? t('table.resetting') : t('table.resetAuthenticator')}
                          </button>
                        ) : null}
                        {person.accessStatus === "invited" && canInvitePeople ? (
                          <button
                            type="button"
                            className="table-row-action table-row-action-accent"
                            disabled={invitingId === person.id}
                            onClick={() => setConfirmInvitePerson(person)}
                          >
                            {invitingId === person.id ? t('table.sending') : t('table.reInvite')}
                          </button>
                        ) : null}
                        {person.accessStatus === "not_invited" && canInvitePeople ? (
                          <button
                            type="button"
                            className="table-row-action table-row-action-accent"
                            disabled={invitingId === person.id}
                            onClick={() => setConfirmInvitePerson(person)}
                          >
                            {invitingId === person.id ? t('table.sending') : t('table.invite')}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : (
                    <td className="table-row-action-cell">
                      <div className="people-row-actions">
                        <Link className="table-row-action" href={`/people/${person.id}`}>
                          {t('table.view')}
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
        title={t('createPanel.title')}
        description={t('createPanel.description')}
        onClose={closeCreatePanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleCreatePerson} noValidate>
          <div className="form-field">
            <span className="form-label">{t('createPanel.employeeTypeLabel')}</span>
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}>
              <button
                type="button"
                className={createValues.isNewHire === true ? "button button-accent" : "button"}
                style={{ flex: 1, height: 36 }}
                onClick={() => updateCreateValues({ ...createValues, isNewHire: true })}
              >
                {t('createPanel.newHire')}
              </button>
              <button
                type="button"
                className={createValues.isNewHire === false ? "button button-accent" : "button"}
                style={{ flex: 1, height: 36 }}
                onClick={() => updateCreateValues({ ...createValues, isNewHire: false })}
              >
                {t('createPanel.existingEmployee')}
              </button>
            </div>
            {createErrors.isNewHire ? <p className="form-field-error">{createErrors.isNewHire}</p> : null}
            {createValues.isNewHire !== null ? (
              <p className="form-field-hint">
                {createValues.isNewHire
                  ? t('createPanel.newHireHint')
                  : t('createPanel.existingEmployeeHint')}
              </p>
            ) : null}
          </div>

          <label className="form-field" htmlFor="person-email">
            <span className="form-label">{t('createPanel.emailLabel')}</span>
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
            <span className="form-label">{t('createPanel.fullNameLabel')}</span>
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
            <legend className="form-label">{t('createPanel.rolesLabel')}</legend>
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
            <span className="form-label">{t('createPanel.departmentLabel')}</span>
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
              <option value="">{t('createPanel.noDepartment')}</option>
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
            <span className="form-label">{t('createPanel.titleLabel')}</span>
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
            <span className="form-label">{t('createPanel.countryCodeLabel')}</span>
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
            <span className="form-label">{t('createPanel.timezoneLabel')}</span>
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
            <span className="form-label">{t('createPanel.phoneLabel')}</span>
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
            <span className="form-label">{t('createPanel.startDateLabel')}</span>
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
            <span className="form-label">{t('createPanel.managerLabel')}</span>
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
              <option value="">{t('createPanel.noManager')}</option>
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
            <span className="form-label">{t('createPanel.employmentTypeLabel')}</span>
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
                  {formatEmploymentType(employmentType, locale)}
                </option>
              ))}
            </select>
            {createErrors.employmentType ? (
              <p className="form-field-error">{createErrors.employmentType}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="person-primary-currency">
            <span className="form-label">{t('createPanel.primaryCurrencyLabel')}</span>
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
            <span className="form-label">{t('createPanel.profileStatusLabel')}</span>
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
                  {formatProfileStatus(status, locale)}
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
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isCreating}>
              {isCreating ? t('createPanel.creating') : t('createPanel.createPerson')}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isBulkUploadOpen}
        title={t('bulkUpload.title')}
        description={t('bulkUpload.description')}
        onClose={closeBulkUploadPanel}
      >
        <div className="slide-panel-form-wrapper">
          {bulkStep === "template" ? (
            <div className="bulk-upload-step">
              <div className="bulk-upload-instructions">
                <h3 className="form-label">{t('bulkUpload.step1Title')}</h3>
                <p className="form-hint">
                  {t('bulkUpload.step1Description')}
                </p>
              </div>
              <button
                type="button"
                className="button button-accent"
                onClick={downloadCSVTemplate}
              >
                {t('bulkUpload.downloadTemplate')}
              </button>
              <div className="bulk-upload-divider" />
              <div className="bulk-upload-instructions">
                <h3 className="form-label">{t('bulkUpload.step2Title')}</h3>
                <p className="form-hint">
                  {t('bulkUpload.step2Description')}
                </p>
              </div>
              <label className="form-field" htmlFor="bulk-csv-file">
                <span className="form-label">{t('bulkUpload.csvFileLabel')}</span>
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
                <h3 className="form-label">{t('bulkUpload.previewTitle')}</h3>
                <p className="form-hint">
                  {td('bulkUpload.previewSummary', {
                    fileName: bulkFile?.name ?? "CSV",
                    totalRows: bulkRows.length,
                    validCount: bulkRows.filter((r) => r.valid).length,
                    errorCount: bulkRows.filter((r) => !r.valid).length
                  })}
                </p>
              </div>
              <div className="data-table-container">
                <table className="data-table" aria-label={t('bulkUpload.previewAriaLabel')}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('table.name')}</th>
                      <th>{t('createPanel.emailLabel')}</th>
                      <th>{t('table.department')}</th>
                      <th>{t('table.status')}</th>
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
                            <StatusBadge tone="success">{t('bulkUpload.statusValid')}</StatusBadge>
                          ) : (
                            <span>
                              <StatusBadge tone="warning">{tcd('error.generic')}</StatusBadge>
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
                  {tCommon('back')}
                </button>
                <button
                  type="button"
                  className="button button-accent"
                  disabled={bulkRows.filter((r) => r.valid).length === 0}
                  onClick={handleBulkImport}
                >
                  {td('bulkUpload.importButton', { count: bulkRows.filter((r) => r.valid).length })}
                </button>
              </div>
            </div>
          ) : null}

          {bulkStep === "importing" ? (
            <div className="bulk-upload-step">
              <div className="bulk-upload-instructions">
                <h3 className="form-label">{t('bulkUpload.importingTitle')}</h3>
                <p className="form-hint">
                  {td('bulkUpload.importingDescription', { count: bulkRows.filter((r) => r.valid).length })}
                </p>
              </div>
            </div>
          ) : null}

          {bulkStep === "done" ? (
            <div className="bulk-upload-step">
              <div className="bulk-upload-instructions">
                <h3 className="form-label">{t('bulkUpload.doneTitle')}</h3>
                <p className="form-hint">
                  {td('bulkUpload.doneSummary', {
                    createdCount: bulkResults.filter((r) => r.status === "created").length,
                    failedCount: bulkResults.filter((r) => r.status === "error").length
                  })}
                </p>
              </div>
              {bulkResults.length > 0 ? (
                <div className="data-table-container">
                  <table className="data-table" aria-label={t('bulkUpload.resultsAriaLabel')}>
                    <thead>
                      <tr>
                        <th>{t('createPanel.emailLabel')}</th>
                        <th>{t('table.status')}</th>
                        <th>{t('bulkUpload.detailsColumn')}</th>
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
                              {result.status === "created" ? t('bulkUpload.statusCreated') : t('bulkUpload.statusFailed')}
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
                  {t('bulkUpload.doneButton')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </SlidePanel>

      {/* ── Edit Person SlidePanel ── */}
      <SlidePanel
        isOpen={isEditOpen}
        title={editPerson ? td('editPanel.title', { name: editPerson.fullName }) : t('editPanel.titleFallback')}
        description={t('editPanel.description')}
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
              <span className="form-label">{t('editPanel.jobTitleLabel')}</span>
              <input
                id="edit-person-title"
                className="form-input"
                maxLength={200}
                placeholder={t('editPanel.jobTitlePlaceholder')}
                value={editValues.title}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setEditValues((prev) => ({ ...prev, title: val }));
                }}
              />
            </label>

            <fieldset className="form-field people-role-fieldset">
              <legend className="form-label">{t('createPanel.rolesLabel')}</legend>
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
              <span className="form-label">{t('createPanel.departmentLabel')}</span>
              <select
                id="edit-person-department"
                className={editErrors.department ? "form-input form-input-error" : "form-input"}
                value={editValues.department}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setEditValues((prev) => ({ ...prev, department: val }));
                }}
              >
                <option value="">{t('createPanel.noDepartment')}</option>
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
              <span className="form-label">{t('editPanel.crewTagLabel')}</span>
              <input
                id="edit-person-crew-tag"
                className={editErrors.crewTag ? "form-input form-input-error" : "form-input"}
                placeholder={t('editPanel.crewTagPlaceholder')}
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
              <span className="form-label">{t('createPanel.managerLabel')}</span>
              <select
                id="edit-person-manager"
                className={editErrors.managerId ? "form-input form-input-error" : "form-input"}
                value={editValues.managerId}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setEditValues((prev) => ({ ...prev, managerId: val }));
                }}
              >
                <option value="">{t('createPanel.noManager')}</option>
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

            <label className="form-field" htmlFor="edit-person-team-lead">
              <span className="form-label">{t('editPanel.teamLeadLabel')}</span>
              <select
                id="edit-person-team-lead"
                className="form-input"
                value={editValues.teamLeadId}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setEditValues((prev) => ({ ...prev, teamLeadId: val }));
                }}
              >
                <option value="">{t('editPanel.noTeamLead')}</option>
                {people
                  .filter((p) => p.id !== editPerson.id && p.status === "active")
                  .sort((a, b) => a.fullName.localeCompare(b.fullName))
                  .map((p) => (
                    <option key={`edit-tl-${p.id}`} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
              </select>
            </label>

            <label className="crew-mod-toggle" style={{ padding: "var(--space-3) 0", borderTop: "1px solid var(--border-default)", marginTop: "var(--space-2)" }}>
              <input
                type="checkbox"
                checked={editValues.directoryVisible}
                onChange={(e) => setEditValues((prev) => ({ ...prev, directoryVisible: e.target.checked }))}
              />
              {t('editPanel.directoryVisible')}
            </label>

            <label className="form-field" htmlFor="edit-person-status" style={{ borderTop: "1px solid var(--border-default)", paddingTop: "var(--space-3)" }}>
              <span className="form-label">{t('editPanel.statusLabel')}</span>
              <select
                id="edit-person-status"
                className="form-input"
                value={editValues.status}
                onChange={(e) => {
                  const val = e.currentTarget.value as ProfileStatus;
                  setEditValues((prev) => ({ ...prev, status: val }));
                }}
              >
                {PROFILE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {formatProfileStatus(s, locale as "en" | "fr")}
                  </option>
                ))}
              </select>
              {editPerson && editValues.status !== editPerson.status ? (
                <p className="form-field-hint">
                  {editValues.status === "active" && editPerson.status === "onboarding"
                    ? t('editPanel.statusHintOnboardingToActive')
                    : editValues.status === "inactive"
                      ? t('editPanel.statusHintToInactive')
                      : editValues.status === "onboarding" && editPerson.status === "active"
                        ? t('editPanel.statusHintToOnboarding')
                        : null}
                </p>
              ) : null}
            </label>

            <div className="slide-panel-actions">
              <button type="button" className="button" onClick={closeEditPanel} disabled={isEditSaving}>
                {tCommon('cancel')}
              </button>
              <button type="submit" className="button button-accent" disabled={isEditSaving}>
                {isEditSaving ? tCommon('saving') : t('editPanel.saveChanges')}
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
            aria-label={t('inviteDialog.ariaLabel')}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">{t('inviteDialog.title')}</h2>
            <p className="settings-card-description">
              {td('inviteDialog.description', {
                name: confirmInvitePerson.fullName,
                email: confirmInvitePerson.email
              })}
            </p>

            {inviteLink ? (
              <div className="invite-success-banner" role="status">
                {t('inviteDialog.linkReady')}
              </div>
            ) : null}

            <div className="invite-link-area">
              <p className="invite-link-label">{t('inviteDialog.setupLinkLabel')}</p>
              <div className="invite-link-input-row">
                <input
                  className="form-input"
                  value={inviteLink ?? ""}
                  readOnly
                  placeholder={t('inviteDialog.sendInvitePlaceholder')}
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
                  {t('inviteDialog.copyLink')}
                </button>
              </div>
              <p className="invite-link-note">
                {t('inviteDialog.linkNote')}
              </p>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="button button-subtle"
                onClick={closeInviteDialog}
                disabled={invitingId !== null}
              >
                {tCommon('cancel')}
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
                  ? t('inviteDialog.sending')
                  : inviteLink
                    ? t('inviteDialog.resendInvite')
                    : t('inviteDialog.sendInvite')}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* ── Reset Authenticator Dialog ── */}
      {confirmResetPerson !== null ? (
        <div
          className="modal-overlay"
          onClick={closeResetDialog}
        >
          <section
            className="confirm-dialog modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('resetDialog.ariaLabel')}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">{t('resetDialog.title')}</h2>
            <p className="settings-card-description">
              {td('resetDialog.description', {
                name: confirmResetPerson.fullName,
                email: confirmResetPerson.email
              })}
            </p>

            {resetSetupLink ? (
              <div className="invite-success-banner" role="status">
                {t('resetDialog.linkReady')}
              </div>
            ) : null}

            <div className="invite-link-area">
              <p className="invite-link-label">{t('resetDialog.setupLinkLabel')}</p>
              <div className="invite-link-input-row">
                <input
                  className="form-input"
                  value={resetSetupLink ?? ""}
                  readOnly
                  placeholder={t('resetDialog.resetPlaceholder')}
                  onClick={(event) => {
                    if (resetSetupLink) {
                      (event.target as HTMLInputElement).select();
                    }
                  }}
                />
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    void handleCopyResetSetupLink();
                  }}
                  disabled={!resetSetupLink || resettingId !== null}
                >
                  {t('resetDialog.copyLink')}
                </button>
              </div>
              <p className="invite-link-note">
                {t('resetDialog.linkNote')}
              </p>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="button button-subtle"
                onClick={closeResetDialog}
                disabled={resettingId !== null}
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => {
                  if (confirmResetPerson) void handleResetAuthenticator(confirmResetPerson);
                }}
                disabled={resettingId !== null}
              >
                {resettingId ? t('resetDialog.resetting') : resetSetupLink ? t('resetDialog.generateNewLink') : t('resetDialog.resetAuthenticator')}
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
                aria-label={t('dismissNotification')}
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
