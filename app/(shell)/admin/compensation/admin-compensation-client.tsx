"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { CompensationSkeleton } from "../../../../components/shared/compensation-skeleton";
import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { VestingBar } from "../../../../components/shared/vesting-bar";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { useAdminCompensation } from "../../../../hooks/use-compensation";
import { useConfirmAction } from "../../../../hooks/use-confirm-action";
import {
  formatDateTimeTooltip,
  formatRelativeTime,
  todayIsoDate as todayIsoDateValue
} from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import {
  calculateVestingProgress,
  formatAllowanceTypeLabel,
  formatEmploymentTypeLabel,
  formatPayFrequencyLabel,
  toneForEquityStatus
} from "../../../../lib/compensation";
import {
  ALLOWANCE_TYPES,
  COMPENSATION_EMPLOYMENT_TYPES,
  COMPENSATION_PAY_FREQUENCIES,
  EQUITY_GRANT_STATUSES,
  EQUITY_GRANT_TYPES,
  type AllowanceRecord,
  type CompensationMutationResponse,
  type EquityGrantRecord
} from "../../../../types/compensation";

type ToastVariant = "success" | "error" | "info";
type SortDirection = "asc" | "desc";
type SalaryApprovalAction = "approve" | "revoke";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type AdminCompensationClientProps = {
  initialEmployeeId: string | null;
  canApprove: boolean;
};

type SalaryFormValues = {
  baseSalaryAmount: string;
  currency: string;
  payFrequency: (typeof COMPENSATION_PAY_FREQUENCIES)[number];
  employmentType: (typeof COMPENSATION_EMPLOYMENT_TYPES)[number];
  effectiveFrom: string;
  effectiveTo: string;
  approve: boolean;
};

type AllowanceFormValues = {
  type: (typeof ALLOWANCE_TYPES)[number];
  label: string;
  amount: string;
  currency: string;
  isTaxable: boolean;
  effectiveFrom: string;
  effectiveTo: string;
};

type EquityFormValues = {
  grantType: (typeof EQUITY_GRANT_TYPES)[number];
  numberOfShares: string;
  exercisePriceCents: string;
  grantDate: string;
  vestingStartDate: string;
  cliffMonths: string;
  vestingDurationMonths: string;
  status: (typeof EQUITY_GRANT_STATUSES)[number];
  boardApprovalDate: string;
  notes: string;
  approve: boolean;
};

type SalaryFormErrors = Partial<Record<keyof SalaryFormValues, string>>;
type AllowanceFormErrors = Partial<Record<keyof AllowanceFormValues, string>>;
type EquityFormErrors = Partial<Record<keyof EquityFormValues, string>>;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const salaryFormSchema = z
  .object({
    baseSalaryAmount: z.string().trim().regex(/^\d+$/, "Amount must be a non-negative integer."),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code."),
    payFrequency: z.enum(COMPENSATION_PAY_FREQUENCIES),
    employmentType: z.enum(COMPENSATION_EMPLOYMENT_TYPES),
    effectiveFrom: z
      .string()
      .trim()
      .regex(isoDatePattern, "Effective from date must be in YYYY-MM-DD format."),
    effectiveTo: z.string().trim(),
    approve: z.boolean()
  })
  .superRefine((values, context) => {
    if (values.effectiveTo.length > 0 && !isoDatePattern.test(values.effectiveTo)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "Effective to date must be in YYYY-MM-DD format."
      });
      return;
    }

    if (values.effectiveTo.length > 0 && values.effectiveTo < values.effectiveFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "Effective to date must be on or after effective from date."
      });
    }
  });

const allowanceFormSchema = z
  .object({
    type: z.enum(ALLOWANCE_TYPES),
    label: z.string().trim().min(1, "Label is required.").max(200, "Label is too long."),
    amount: z.string().trim().regex(/^\d+$/, "Amount must be a non-negative integer."),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code."),
    isTaxable: z.boolean(),
    effectiveFrom: z
      .string()
      .trim()
      .regex(isoDatePattern, "Effective from date must be in YYYY-MM-DD format."),
    effectiveTo: z.string().trim()
  })
  .superRefine((values, context) => {
    if (values.effectiveTo.length > 0 && !isoDatePattern.test(values.effectiveTo)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "Effective to date must be in YYYY-MM-DD format."
      });
      return;
    }

    if (values.effectiveTo.length > 0 && values.effectiveTo < values.effectiveFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "Effective to date must be on or after effective from date."
      });
    }
  });

const equityFormSchema = z
  .object({
    grantType: z.enum(EQUITY_GRANT_TYPES),
    numberOfShares: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,4})?$/, "Shares must be a positive number with up to 4 decimals."),
    exercisePriceCents: z
      .string()
      .trim()
      .refine((value) => value.length === 0 || /^\d+$/.test(value), {
        message: "Exercise price must be a non-negative integer in cents."
      }),
    grantDate: z.string().trim().regex(isoDatePattern, "Grant date must be in YYYY-MM-DD format."),
    vestingStartDate: z
      .string()
      .trim()
      .regex(isoDatePattern, "Vesting start date must be in YYYY-MM-DD format."),
    cliffMonths: z.string().trim().regex(/^\d+$/, "Cliff months must be a non-negative integer."),
    vestingDurationMonths: z
      .string()
      .trim()
      .regex(/^\d+$/, "Vesting duration must be a positive integer."),
    status: z.enum(EQUITY_GRANT_STATUSES),
    boardApprovalDate: z
      .string()
      .trim()
      .refine((value) => value.length === 0 || isoDatePattern.test(value), {
        message: "Board approval date must be in YYYY-MM-DD format."
      }),
    notes: z.string().max(5000, "Notes are too long."),
    approve: z.boolean()
  })
  .superRefine((values, context) => {
    const cliffMonths = Number.parseInt(values.cliffMonths, 10);
    const vestingDurationMonths = Number.parseInt(values.vestingDurationMonths, 10);

    if (!Number.isFinite(cliffMonths) || cliffMonths < 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cliffMonths"],
        message: "Cliff months must be zero or greater."
      });
    }

    if (!Number.isFinite(vestingDurationMonths) || vestingDurationMonths <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vestingDurationMonths"],
        message: "Vesting duration must be greater than zero."
      });
    }

    if (values.boardApprovalDate.length > 0 && values.boardApprovalDate < values.grantDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["boardApprovalDate"],
        message: "Board approval date must be on or after grant date."
      });
    }
  });

function todayIsoDate() {
  return todayIsoDateValue();
}

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasErrors(errors: Record<string, string | undefined>) {
  return Object.values(errors).some((value) => Boolean(value));
}

function validateSalary(values: SalaryFormValues): SalaryFormErrors {
  const parsed = salaryFormSchema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;

  return {
    baseSalaryAmount: fieldErrors.baseSalaryAmount?.[0],
    currency: fieldErrors.currency?.[0],
    payFrequency: fieldErrors.payFrequency?.[0],
    employmentType: fieldErrors.employmentType?.[0],
    effectiveFrom: fieldErrors.effectiveFrom?.[0],
    effectiveTo: fieldErrors.effectiveTo?.[0],
    approve: fieldErrors.approve?.[0]
  };
}

function validateAllowance(values: AllowanceFormValues): AllowanceFormErrors {
  const parsed = allowanceFormSchema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;

  return {
    type: fieldErrors.type?.[0],
    label: fieldErrors.label?.[0],
    amount: fieldErrors.amount?.[0],
    currency: fieldErrors.currency?.[0],
    isTaxable: fieldErrors.isTaxable?.[0],
    effectiveFrom: fieldErrors.effectiveFrom?.[0],
    effectiveTo: fieldErrors.effectiveTo?.[0]
  };
}

function validateEquity(values: EquityFormValues): EquityFormErrors {
  const parsed = equityFormSchema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;

  return {
    grantType: fieldErrors.grantType?.[0],
    numberOfShares: fieldErrors.numberOfShares?.[0],
    exercisePriceCents: fieldErrors.exercisePriceCents?.[0],
    grantDate: fieldErrors.grantDate?.[0],
    vestingStartDate: fieldErrors.vestingStartDate?.[0],
    cliffMonths: fieldErrors.cliffMonths?.[0],
    vestingDurationMonths: fieldErrors.vestingDurationMonths?.[0],
    status: fieldErrors.status?.[0],
    boardApprovalDate: fieldErrors.boardApprovalDate?.[0],
    notes: fieldErrors.notes?.[0],
    approve: fieldErrors.approve?.[0]
  };
}

function initialSalaryForm(canApprove: boolean): SalaryFormValues {
  return {
    baseSalaryAmount: "",
    currency: "USD",
    payFrequency: "monthly",
    employmentType: "contractor",
    effectiveFrom: todayIsoDate(),
    effectiveTo: "",
    approve: canApprove
  };
}

function initialAllowanceForm(): AllowanceFormValues {
  return {
    type: "internet",
    label: "",
    amount: "",
    currency: "USD",
    isTaxable: false,
    effectiveFrom: todayIsoDate(),
    effectiveTo: ""
  };
}

function initialEquityForm(canApprove: boolean): EquityFormValues {
  return {
    grantType: "RSU",
    numberOfShares: "",
    exercisePriceCents: "",
    grantDate: todayIsoDate(),
    vestingStartDate: todayIsoDate(),
    cliffMonths: "12",
    vestingDurationMonths: "48",
    status: "draft",
    boardApprovalDate: "",
    notes: "",
    approve: canApprove
  };
}

function salaryApprovalTone(approvedBy: string | null) {
  return approvedBy ? "success" : "pending";
}

function allowanceTaxTone(isTaxable: boolean) {
  return isTaxable ? "warning" : "success";
}

function allowanceTaxLabel(isTaxable: boolean) {
  return isTaxable ? "Taxable" : "Non-taxable";
}

function salarySortValue(effectiveFrom: string): number {
  return Date.parse(`${effectiveFrom}T00:00:00.000Z`);
}

function mapAllowanceToForm(allowance: AllowanceRecord): AllowanceFormValues {
  return {
    type: allowance.type,
    label: allowance.label,
    amount: String(allowance.amount),
    currency: allowance.currency,
    isTaxable: allowance.isTaxable,
    effectiveFrom: allowance.effectiveFrom,
    effectiveTo: allowance.effectiveTo ?? ""
  };
}

function mapEquityToForm(grant: EquityGrantRecord, canApprove: boolean): EquityFormValues {
  return {
    grantType: grant.grantType,
    numberOfShares: String(grant.numberOfShares),
    exercisePriceCents: grant.exercisePriceCents === null ? "" : String(grant.exercisePriceCents),
    grantDate: grant.grantDate,
    vestingStartDate: grant.vestingStartDate,
    cliffMonths: String(grant.cliffMonths),
    vestingDurationMonths: String(grant.vestingDurationMonths),
    status: grant.status,
    boardApprovalDate: grant.boardApprovalDate ?? "",
    notes: grant.notes ?? "",
    approve: canApprove && Boolean(grant.approvedBy)
  };
}

export function AdminCompensationClient({
  initialEmployeeId,
  canApprove
}: AdminCompensationClientProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(initialEmployeeId);
  const [salarySortDirection, setSalarySortDirection] = useState<SortDirection>("desc");
  const [allowanceSortDirection, setAllowanceSortDirection] = useState<SortDirection>("desc");
  const [equitySortDirection, setEquitySortDirection] = useState<SortDirection>("desc");

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [isSalaryPanelOpen, setIsSalaryPanelOpen] = useState(false);
  const [salaryFormValues, setSalaryFormValues] = useState<SalaryFormValues>(
    initialSalaryForm(canApprove)
  );
  const [salaryFormErrors, setSalaryFormErrors] = useState<SalaryFormErrors>({});
  const [isSubmittingSalary, setIsSubmittingSalary] = useState(false);
  const [isUpdatingSalaryApprovalId, setIsUpdatingSalaryApprovalId] = useState<string | null>(
    null
  );

  const [isAllowancePanelOpen, setIsAllowancePanelOpen] = useState(false);
  const [editingAllowanceId, setEditingAllowanceId] = useState<string | null>(null);
  const [allowanceFormValues, setAllowanceFormValues] = useState<AllowanceFormValues>(
    initialAllowanceForm()
  );
  const [allowanceFormErrors, setAllowanceFormErrors] = useState<AllowanceFormErrors>({});
  const [isSubmittingAllowance, setIsSubmittingAllowance] = useState(false);
  const [isDeletingAllowanceId, setIsDeletingAllowanceId] = useState<string | null>(null);

  const [isEquityPanelOpen, setIsEquityPanelOpen] = useState(false);
  const [editingEquityGrantId, setEditingEquityGrantId] = useState<string | null>(null);
  const [equityFormValues, setEquityFormValues] = useState<EquityFormValues>(
    initialEquityForm(canApprove)
  );
  const [equityFormErrors, setEquityFormErrors] = useState<EquityFormErrors>({});
  const [isSubmittingEquity, setIsSubmittingEquity] = useState(false);
  const [isUpdatingEquityApprovalId, setIsUpdatingEquityApprovalId] = useState<string | null>(
    null
  );
  const { confirm, confirmDialog } = useConfirmAction();

  const compensationQuery = useAdminCompensation({ employeeId: selectedEmployeeId });

  const selectedEmployee = compensationQuery.data?.selectedEmployee ?? null;

  useEffect(() => {
    if (selectedEmployeeId) {
      return;
    }

    if (compensationQuery.data?.selectedEmployee?.id) {
      setSelectedEmployeeId(compensationQuery.data.selectedEmployee.id);
      return;
    }

    const firstEmployeeId = compensationQuery.data?.employees[0]?.id;

    if (firstEmployeeId) {
      setSelectedEmployeeId(firstEmployeeId);
    }
  }, [compensationQuery.data, selectedEmployeeId]);

  useEffect(() => {
    if (!selectedEmployee) {
      return;
    }

    setSalaryFormValues((currentValues) => ({
      ...currentValues,
      currency: selectedEmployee.primaryCurrency,
      employmentType: selectedEmployee.employmentType
    }));

    setAllowanceFormValues((currentValues) => ({
      ...currentValues,
      currency: selectedEmployee.primaryCurrency
    }));
  }, [selectedEmployee]);

  const salaryRecords = useMemo(
    () =>
      [...(compensationQuery.data?.salaryRecords ?? [])].sort((leftRecord, rightRecord) => {
        const leftValue = salarySortValue(leftRecord.effectiveFrom);
        const rightValue = salarySortValue(rightRecord.effectiveFrom);

        if (salarySortDirection === "asc") {
          return leftValue - rightValue;
        }

        return rightValue - leftValue;
      }),
    [compensationQuery.data?.salaryRecords, salarySortDirection]
  );

  const allowances = useMemo(
    () =>
      [...(compensationQuery.data?.allowances ?? [])].sort((leftRecord, rightRecord) => {
        if (allowanceSortDirection === "asc") {
          return leftRecord.amount - rightRecord.amount;
        }

        return rightRecord.amount - leftRecord.amount;
      }),
    [allowanceSortDirection, compensationQuery.data?.allowances]
  );

  const equityGrants = useMemo(
    () =>
      [...(compensationQuery.data?.equityGrants ?? [])].sort((leftRecord, rightRecord) => {
        const leftValue = Date.parse(`${leftRecord.grantDate}T00:00:00.000Z`);
        const rightValue = Date.parse(`${rightRecord.grantDate}T00:00:00.000Z`);

        if (equitySortDirection === "asc") {
          return leftValue - rightValue;
        }

        return rightValue - leftValue;
      }),
    [compensationQuery.data?.equityGrants, equitySortDirection]
  );

  const currentSalary = salaryRecords[0] ?? null;

  const dismissToast = (toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, message: string) => {
    const toastId = createToastId();

    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  const resetSalaryPanel = () => {
    setSalaryFormValues(initialSalaryForm(canApprove));
    setSalaryFormErrors({});
    setIsSalaryPanelOpen(false);
  };

  const resetAllowancePanel = () => {
    setEditingAllowanceId(null);
    setAllowanceFormValues(initialAllowanceForm());
    setAllowanceFormErrors({});
    setIsAllowancePanelOpen(false);
  };

  const resetEquityPanel = () => {
    setEditingEquityGrantId(null);
    setEquityFormValues(initialEquityForm(canApprove));
    setEquityFormErrors({});
    setIsEquityPanelOpen(false);
  };

  const handleSalarySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEmployee) {
      showToast("error", "Select an employee before adding salary records.");
      return;
    }

    const errors = validateSalary(salaryFormValues);
    setSalaryFormErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setIsSubmittingSalary(true);

    try {
      const response = await fetch("/api/v1/compensation/admin/salary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          employeeId: selectedEmployee.id,
          baseSalaryAmount: Number.parseInt(salaryFormValues.baseSalaryAmount, 10),
          currency: salaryFormValues.currency.trim().toUpperCase(),
          payFrequency: salaryFormValues.payFrequency,
          employmentType: salaryFormValues.employmentType,
          effectiveFrom: salaryFormValues.effectiveFrom,
          effectiveTo: salaryFormValues.effectiveTo || null,
          approve: canApprove ? salaryFormValues.approve : false
        })
      });

      const payload = (await response.json()) as CompensationMutationResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to create salary record.");
        return;
      }

      showToast("success", "Salary record created.");
      resetSalaryPanel();
      compensationQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to create salary record."
      );
    } finally {
      setIsSubmittingSalary(false);
    }
  };

  const handleSalaryApproval = async (
    recordId: string,
    action: SalaryApprovalAction
  ) => {
    setIsUpdatingSalaryApprovalId(recordId);

    try {
      const response = await fetch(`/api/v1/compensation/admin/salary/${recordId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action })
      });

      const payload = (await response.json()) as CompensationMutationResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to update salary approval.");
        return;
      }

      showToast("success", action === "approve" ? "Salary approved." : "Salary approval removed.");
      compensationQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to update salary approval."
      );
    } finally {
      setIsUpdatingSalaryApprovalId(null);
    }
  };

  const handleAllowanceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEmployee) {
      showToast("error", "Select an employee before managing allowances.");
      return;
    }

    const errors = validateAllowance(allowanceFormValues);
    setAllowanceFormErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setIsSubmittingAllowance(true);

    try {
      const endpoint = editingAllowanceId
        ? `/api/v1/compensation/admin/allowances/${editingAllowanceId}`
        : "/api/v1/compensation/admin/allowances";

      const method = editingAllowanceId ? "PATCH" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          employeeId: selectedEmployee.id,
          type: allowanceFormValues.type,
          label: allowanceFormValues.label,
          amount: Number.parseInt(allowanceFormValues.amount, 10),
          currency: allowanceFormValues.currency.trim().toUpperCase(),
          isTaxable: allowanceFormValues.isTaxable,
          effectiveFrom: allowanceFormValues.effectiveFrom,
          effectiveTo: allowanceFormValues.effectiveTo || null
        })
      });

      const payload = (await response.json()) as CompensationMutationResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to save allowance.");
        return;
      }

      showToast("success", editingAllowanceId ? "Allowance updated." : "Allowance created.");
      resetAllowancePanel();
      compensationQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to save allowance.");
    } finally {
      setIsSubmittingAllowance(false);
    }
  };

  const handleAllowanceDelete = async (allowanceId: string) => {
    const confirmed = await confirm({
      title: "Delete allowance?",
      description: "This removes the allowance record and logs the action in the audit trail.",
      confirmLabel: "Delete allowance",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    setIsDeletingAllowanceId(allowanceId);

    try {
      const response = await fetch(`/api/v1/compensation/admin/allowances/${allowanceId}`, {
        method: "DELETE"
      });

      const payload = (await response.json()) as CompensationMutationResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to delete allowance.");
        return;
      }

      showToast("success", "Allowance deleted.");
      compensationQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to delete allowance.");
    } finally {
      setIsDeletingAllowanceId(null);
    }
  };

  const handleEquitySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEmployee) {
      showToast("error", "Select an employee before managing equity grants.");
      return;
    }

    const errors = validateEquity(equityFormValues);
    setEquityFormErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setIsSubmittingEquity(true);

    try {
      const endpoint = editingEquityGrantId
        ? `/api/v1/compensation/admin/equity/${editingEquityGrantId}`
        : "/api/v1/compensation/admin/equity";

      const method = editingEquityGrantId ? "PATCH" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          employeeId: selectedEmployee.id,
          grantType: equityFormValues.grantType,
          numberOfShares: Number.parseFloat(equityFormValues.numberOfShares),
          exercisePriceCents:
            equityFormValues.exercisePriceCents.length > 0
              ? Number.parseInt(equityFormValues.exercisePriceCents, 10)
              : null,
          grantDate: equityFormValues.grantDate,
          vestingStartDate: equityFormValues.vestingStartDate,
          cliffMonths: Number.parseInt(equityFormValues.cliffMonths, 10),
          vestingDurationMonths: Number.parseInt(equityFormValues.vestingDurationMonths, 10),
          status: equityFormValues.status,
          boardApprovalDate: equityFormValues.boardApprovalDate || null,
          notes: equityFormValues.notes || null,
          approve: canApprove ? equityFormValues.approve : undefined
        })
      });

      const payload = (await response.json()) as CompensationMutationResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to save equity grant.");
        return;
      }

      showToast("success", editingEquityGrantId ? "Equity grant updated." : "Equity grant created.");
      resetEquityPanel();
      compensationQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to save equity grant."
      );
    } finally {
      setIsSubmittingEquity(false);
    }
  };

  const handleEquityApproval = async (grant: EquityGrantRecord, approve: boolean) => {
    setIsUpdatingEquityApprovalId(grant.id);

    try {
      const response = await fetch(`/api/v1/compensation/admin/equity/${grant.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          grantType: grant.grantType,
          numberOfShares: grant.numberOfShares,
          exercisePriceCents: grant.exercisePriceCents,
          grantDate: grant.grantDate,
          vestingStartDate: grant.vestingStartDate,
          cliffMonths: grant.cliffMonths,
          vestingDurationMonths: grant.vestingDurationMonths,
          status: grant.status,
          boardApprovalDate: grant.boardApprovalDate,
          notes: grant.notes,
          approve
        })
      });

      const payload = (await response.json()) as CompensationMutationResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to update equity approval.");
        return;
      }

      showToast("success", approve ? "Equity grant approved." : "Equity approval removed.");
      compensationQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to update equity approval."
      );
    } finally {
      setIsUpdatingEquityApprovalId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Compensation Admin"
        description="Manage salary, allowances, and equity grants for crew members."
      />

      <section className="compensation-admin-employee-card" aria-label="Employee selector">
        <label className="form-field" htmlFor="compensation-employee-selector">
          <span className="form-label">Employee</span>
          <select
            id="compensation-employee-selector"
            className="form-input"
            value={selectedEmployeeId ?? ""}
            onChange={(event) => setSelectedEmployeeId(event.currentTarget.value || null)}
          >
            <option value="">Select an employee</option>
            {(compensationQuery.data?.employees ?? []).map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName}
              </option>
            ))}
          </select>
        </label>
        {selectedEmployeeId ? (
          <Link
            className="button"
            href={`/people/${selectedEmployeeId}?tab=compensation`}
          >
            Open profile tab
          </Link>
        ) : null}
      </section>

      {compensationQuery.isLoading ? <CompensationSkeleton /> : null}

      {!compensationQuery.isLoading && compensationQuery.errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Compensation admin data is unavailable"
            description={compensationQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => compensationQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!compensationQuery.isLoading &&
      !compensationQuery.errorMessage &&
      compensationQuery.data &&
      compensationQuery.data.employees.length === 0 ? (
        <EmptyState
          title="No employees found"
          description="Seed or create profile data before managing compensation records."
          ctaLabel="Go to dashboard"
          ctaHref="/dashboard"
        />
      ) : null}

      {!compensationQuery.isLoading &&
      !compensationQuery.errorMessage &&
      selectedEmployee ? (
        <section className="compensation-layout" aria-label="Compensation admin sections">
          <article className="metric-card" aria-label="Selected employee summary">
            <div>
              <h2 className="section-title">{selectedEmployee.fullName}</h2>
              <p className="settings-card-description">
                {selectedEmployee.title ?? "No title"} • {selectedEmployee.department ?? "No department"}
              </p>
            </div>
            <div className="compensation-summary-meta">
              <StatusBadge tone="info">
                {formatEmploymentTypeLabel(selectedEmployee.employmentType)}
              </StatusBadge>
            </div>
          </article>

          <section className="compensation-section" aria-label="Salary management">
            <div className="timeoff-section-header">
              <h2 className="section-title">Salary records</h2>
              <button
                type="button"
                className="button button-accent"
                onClick={() => {
                  setSalaryFormValues({
                    ...initialSalaryForm(canApprove),
                    currency: selectedEmployee.primaryCurrency,
                    employmentType: selectedEmployee.employmentType
                  });
                  setSalaryFormErrors({});
                  setIsSalaryPanelOpen(true);
                }}
              >
                Add salary record
              </button>
            </div>

            {currentSalary ? (
              <article className="compensation-salary-card">
                <header className="compensation-salary-header">
                  <div>
                    <p className="metric-label">Current base salary</p>
                    <p className="compensation-salary-value">
                      <CurrencyDisplay
                        amount={currentSalary.baseSalaryAmount}
                        currency={currentSalary.currency}
                      />
                    </p>
                  </div>
                  <StatusBadge tone={salaryApprovalTone(currentSalary.approvedBy)}>
                    {currentSalary.approvedBy ? "Approved" : "Pending approval"}
                  </StatusBadge>
                </header>

                <dl className="compensation-salary-meta">
                  <div>
                    <dt>Frequency</dt>
                    <dd>{formatPayFrequencyLabel(currentSalary.payFrequency)}</dd>
                  </div>
                  <div>
                    <dt>Employment</dt>
                    <dd>{formatEmploymentTypeLabel(currentSalary.employmentType)}</dd>
                  </div>
                  <div>
                    <dt>Effective</dt>
                    <dd>
                      <time
                        dateTime={currentSalary.effectiveFrom}
                        title={formatDateTimeTooltip(currentSalary.effectiveFrom)}
                      >
                        {formatRelativeTime(currentSalary.effectiveFrom)}
                      </time>
                    </dd>
                  </div>
                </dl>
              </article>
            ) : (
              <EmptyState
                title="No salary records"
                description="Create the first salary record for this employee."
                ctaLabel="Back to dashboard"
                ctaHref="/dashboard"
              />
            )}

            {salaryRecords.length > 0 ? (
              <div className="data-table-container">
                <table className="data-table" aria-label="Salary records table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="table-sort-trigger"
                          onClick={() =>
                            setSalarySortDirection((currentDirection) =>
                              currentDirection === "desc" ? "asc" : "desc"
                            )
                          }
                        >
                          Effective
                          <span className="numeric">
                            {salarySortDirection === "desc" ? "↓" : "↑"}
                          </span>
                        </button>
                      </th>
                      <th>Amount</th>
                      <th>Frequency</th>
                      <th>Status</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salaryRecords.map((record) => (
                      <tr key={record.id} className="data-table-row">
                        <td>
                          <time
                            dateTime={record.effectiveFrom}
                            title={formatDateTimeTooltip(record.effectiveFrom)}
                          >
                            {formatRelativeTime(record.effectiveFrom)}
                          </time>
                        </td>
                        <td>
                          <CurrencyDisplay amount={record.baseSalaryAmount} currency={record.currency} />
                        </td>
                        <td>{formatPayFrequencyLabel(record.payFrequency)}</td>
                        <td>
                          <StatusBadge tone={salaryApprovalTone(record.approvedBy)}>
                            {record.approvedBy ? "Approved" : "Pending"}
                          </StatusBadge>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="compensation-row-actions">
                            {canApprove ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() =>
                                  handleSalaryApproval(
                                    record.id,
                                    record.approvedBy ? "revoke" : "approve"
                                  )
                                }
                                disabled={isUpdatingSalaryApprovalId === record.id}
                              >
                                {isUpdatingSalaryApprovalId === record.id
                                  ? "Saving..."
                                  : record.approvedBy
                                    ? "Revoke"
                                    : "Approve"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => {
                                if (!navigator.clipboard) {
                                  return;
                                }

                                void navigator.clipboard.writeText(record.id);
                                showToast("info", "Salary record ID copied.");
                              }}
                            >
                              Copy ID
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="compensation-section" aria-label="Allowance management">
            <div className="timeoff-section-header">
              <h2 className="section-title">Allowances</h2>
              <button
                type="button"
                className="button button-accent"
                onClick={() => {
                  setEditingAllowanceId(null);
                  setAllowanceFormValues({
                    ...initialAllowanceForm(),
                    currency: selectedEmployee.primaryCurrency
                  });
                  setAllowanceFormErrors({});
                  setIsAllowancePanelOpen(true);
                }}
              >
                Add allowance
              </button>
            </div>

            {allowances.length === 0 ? (
              <EmptyState
                title="No allowances"
                description="Create allowances for this employee to track recurring compensation."
                ctaLabel="Back to dashboard"
                ctaHref="/dashboard"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Allowances table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Type</th>
                      <th>
                        <button
                          type="button"
                          className="table-sort-trigger"
                          onClick={() =>
                            setAllowanceSortDirection((currentDirection) =>
                              currentDirection === "desc" ? "asc" : "desc"
                            )
                          }
                        >
                          Amount
                          <span className="numeric">
                            {allowanceSortDirection === "desc" ? "↓" : "↑"}
                          </span>
                        </button>
                      </th>
                      <th>Tax</th>
                      <th>Effective</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allowances.map((allowance) => (
                      <tr key={allowance.id} className="data-table-row">
                        <td>{allowance.label}</td>
                        <td>{formatAllowanceTypeLabel(allowance.type)}</td>
                        <td>
                          <CurrencyDisplay amount={allowance.amount} currency={allowance.currency} />
                        </td>
                        <td>
                          <StatusBadge tone={allowanceTaxTone(allowance.isTaxable)}>
                            {allowanceTaxLabel(allowance.isTaxable)}
                          </StatusBadge>
                        </td>
                        <td>
                          <time
                            dateTime={allowance.effectiveFrom}
                            title={formatDateTimeTooltip(allowance.effectiveFrom)}
                          >
                            {formatRelativeTime(allowance.effectiveFrom)}
                          </time>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="compensation-row-actions">
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => {
                                setEditingAllowanceId(allowance.id);
                                setAllowanceFormValues(mapAllowanceToForm(allowance));
                                setAllowanceFormErrors({});
                                setIsAllowancePanelOpen(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => handleAllowanceDelete(allowance.id)}
                              disabled={isDeletingAllowanceId === allowance.id}
                            >
                              {isDeletingAllowanceId === allowance.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="compensation-section" aria-label="Equity management">
            <div className="timeoff-section-header">
              <h2 className="section-title">Equity grants</h2>
              <button
                type="button"
                className="button button-accent"
                onClick={() => {
                  setEditingEquityGrantId(null);
                  setEquityFormValues(initialEquityForm(canApprove));
                  setEquityFormErrors({});
                  setIsEquityPanelOpen(true);
                }}
              >
                Add equity grant
              </button>
            </div>

            {equityGrants.length === 0 ? (
              <EmptyState
                title="No equity grants"
                description="Create equity grants to track vesting schedules for this employee."
                ctaLabel="Back to dashboard"
                ctaHref="/dashboard"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Equity grants table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="table-sort-trigger"
                          onClick={() =>
                            setEquitySortDirection((currentDirection) =>
                              currentDirection === "desc" ? "asc" : "desc"
                            )
                          }
                        >
                          Grant date
                          <span className="numeric">
                            {equitySortDirection === "desc" ? "↓" : "↑"}
                          </span>
                        </button>
                      </th>
                      <th>Grant</th>
                      <th>Shares</th>
                      <th>Status</th>
                      <th>Vesting</th>
                      <th>Approval</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equityGrants.map((grant) => {
                      const vesting = calculateVestingProgress(grant);

                      return (
                        <tr key={grant.id} className="data-table-row">
                          <td>
                            <time
                              dateTime={grant.grantDate}
                              title={formatDateTimeTooltip(grant.grantDate)}
                            >
                              {formatRelativeTime(grant.grantDate)}
                            </time>
                          </td>
                          <td>{grant.grantType}</td>
                          <td className="numeric">{grant.numberOfShares.toLocaleString()}</td>
                          <td>
                            <StatusBadge tone={toneForEquityStatus(grant.status)}>
                              {toSentenceCase(grant.status)}
                            </StatusBadge>
                          </td>
                          <td>
                            <div className="compensation-vesting-inline">
                              <VestingBar
                                vestedPercent={vesting.vestedPercent}
                                cliffPercent={vesting.cliffPercent}
                                todayOffsetPercent={vesting.todayOffsetPercent}
                              />
                              <span className="numeric">{Math.round(vesting.vestedPercent)}%</span>
                            </div>
                          </td>
                          <td>
                            <StatusBadge tone={salaryApprovalTone(grant.approvedBy)}>
                              {grant.approvedBy ? "Approved" : "Pending"}
                            </StatusBadge>
                          </td>
                          <td className="table-row-action-cell">
                            <div className="compensation-row-actions">
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => {
                                  setEditingEquityGrantId(grant.id);
                                  setEquityFormValues(mapEquityToForm(grant, canApprove));
                                  setEquityFormErrors({});
                                  setIsEquityPanelOpen(true);
                                }}
                              >
                                Edit
                              </button>
                              {canApprove ? (
                                <button
                                  type="button"
                                  className="table-row-action"
                                  onClick={() => handleEquityApproval(grant, !grant.approvedBy)}
                                  disabled={isUpdatingEquityApprovalId === grant.id}
                                >
                                  {isUpdatingEquityApprovalId === grant.id
                                    ? "Saving..."
                                    : grant.approvedBy
                                      ? "Revoke"
                                      : "Approve"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      ) : null}

      <SlidePanel
        isOpen={isSalaryPanelOpen}
        onClose={resetSalaryPanel}
        title="Add salary record"
        description="Salary updates create new rows to preserve full compensation history."
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSalarySubmit} noValidate>
          <label className="form-field" htmlFor="salary-base-amount">
            <span className="form-label">Base salary (smallest unit)</span>
            <input
              id="salary-base-amount"
              className={
                salaryFormErrors.baseSalaryAmount ? "form-input form-input-error" : "form-input"
              }
              value={salaryFormValues.baseSalaryAmount}
              onChange={(event) => {
                const nextValues = {
                  ...salaryFormValues,
                  baseSalaryAmount: event.currentTarget.value
                };

                setSalaryFormValues(nextValues);
                setSalaryFormErrors(validateSalary(nextValues));
              }}
            />
            {salaryFormErrors.baseSalaryAmount ? (
              <p className="form-field-error">{salaryFormErrors.baseSalaryAmount}</p>
            ) : null}
          </label>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="salary-currency">
              <span className="form-label">Currency</span>
              <input
                id="salary-currency"
                className={salaryFormErrors.currency ? "form-input form-input-error" : "form-input"}
                value={salaryFormValues.currency}
                onChange={(event) => {
                  const nextValues = {
                    ...salaryFormValues,
                    currency: event.currentTarget.value
                  };

                  setSalaryFormValues(nextValues);
                  setSalaryFormErrors(validateSalary(nextValues));
                }}
              />
              {salaryFormErrors.currency ? (
                <p className="form-field-error">{salaryFormErrors.currency}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="salary-pay-frequency">
              <span className="form-label">Pay frequency</span>
              <select
                id="salary-pay-frequency"
                className={
                  salaryFormErrors.payFrequency ? "form-input form-input-error" : "form-input"
                }
                value={salaryFormValues.payFrequency}
                onChange={(event) => {
                  const nextValues = {
                    ...salaryFormValues,
                    payFrequency: event.currentTarget.value as SalaryFormValues["payFrequency"]
                  };

                  setSalaryFormValues(nextValues);
                  setSalaryFormErrors(validateSalary(nextValues));
                }}
              >
                {COMPENSATION_PAY_FREQUENCIES.map((value) => (
                  <option key={value} value={value}>
                    {formatPayFrequencyLabel(value)}
                  </option>
                ))}
              </select>
              {salaryFormErrors.payFrequency ? (
                <p className="form-field-error">{salaryFormErrors.payFrequency}</p>
              ) : null}
            </label>
          </div>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="salary-employment-type">
              <span className="form-label">Employment type</span>
              <select
                id="salary-employment-type"
                className={
                  salaryFormErrors.employmentType ? "form-input form-input-error" : "form-input"
                }
                value={salaryFormValues.employmentType}
                onChange={(event) => {
                  const nextValues = {
                    ...salaryFormValues,
                    employmentType: event.currentTarget.value as SalaryFormValues["employmentType"]
                  };

                  setSalaryFormValues(nextValues);
                  setSalaryFormErrors(validateSalary(nextValues));
                }}
              >
                {COMPENSATION_EMPLOYMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {formatEmploymentTypeLabel(value)}
                  </option>
                ))}
              </select>
              {salaryFormErrors.employmentType ? (
                <p className="form-field-error">{salaryFormErrors.employmentType}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="salary-effective-from">
              <span className="form-label">Effective from</span>
              <input
                id="salary-effective-from"
                type="date"
                className={
                  salaryFormErrors.effectiveFrom ? "form-input form-input-error" : "form-input"
                }
                value={salaryFormValues.effectiveFrom}
                onChange={(event) => {
                  const nextValues = {
                    ...salaryFormValues,
                    effectiveFrom: event.currentTarget.value
                  };

                  setSalaryFormValues(nextValues);
                  setSalaryFormErrors(validateSalary(nextValues));
                }}
              />
              {salaryFormErrors.effectiveFrom ? (
                <p className="form-field-error">{salaryFormErrors.effectiveFrom}</p>
              ) : null}
            </label>
          </div>

          <label className="form-field" htmlFor="salary-effective-to">
            <span className="form-label">Effective to (optional)</span>
            <input
              id="salary-effective-to"
              type="date"
              className={
                salaryFormErrors.effectiveTo ? "form-input form-input-error" : "form-input"
              }
              value={salaryFormValues.effectiveTo}
              onChange={(event) => {
                const nextValues = {
                  ...salaryFormValues,
                  effectiveTo: event.currentTarget.value
                };

                setSalaryFormValues(nextValues);
                setSalaryFormErrors(validateSalary(nextValues));
              }}
            />
            {salaryFormErrors.effectiveTo ? (
              <p className="form-field-error">{salaryFormErrors.effectiveTo}</p>
            ) : null}
          </label>

          {canApprove ? (
            <label className="settings-checkbox" htmlFor="salary-approve">
              <input
                id="salary-approve"
                type="checkbox"
                checked={salaryFormValues.approve}
                onChange={(event) => {
                  const nextValues = {
                    ...salaryFormValues,
                    approve: event.currentTarget.checked
                  };

                  setSalaryFormValues(nextValues);
                  setSalaryFormErrors(validateSalary(nextValues));
                }}
              />
              <span>Approve this salary record now (Super Admin only)</span>
            </label>
          ) : null}

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={resetSalaryPanel}>
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmittingSalary}>
              {isSubmittingSalary ? "Saving..." : "Save salary"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isAllowancePanelOpen}
        onClose={resetAllowancePanel}
        title={editingAllowanceId ? "Edit allowance" : "Add allowance"}
        description="Allowances are stored in the smallest currency unit and tracked over time."
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleAllowanceSubmit} noValidate>
          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="allowance-type">
              <span className="form-label">Type</span>
              <select
                id="allowance-type"
                className={allowanceFormErrors.type ? "form-input form-input-error" : "form-input"}
                value={allowanceFormValues.type}
                onChange={(event) => {
                  const nextValues = {
                    ...allowanceFormValues,
                    type: event.currentTarget.value as AllowanceFormValues["type"]
                  };

                  setAllowanceFormValues(nextValues);
                  setAllowanceFormErrors(validateAllowance(nextValues));
                }}
              >
                {ALLOWANCE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {formatAllowanceTypeLabel(value)}
                  </option>
                ))}
              </select>
              {allowanceFormErrors.type ? (
                <p className="form-field-error">{allowanceFormErrors.type}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="allowance-amount">
              <span className="form-label">Amount (smallest unit)</span>
              <input
                id="allowance-amount"
                className={allowanceFormErrors.amount ? "form-input form-input-error" : "form-input"}
                value={allowanceFormValues.amount}
                onChange={(event) => {
                  const nextValues = {
                    ...allowanceFormValues,
                    amount: event.currentTarget.value
                  };

                  setAllowanceFormValues(nextValues);
                  setAllowanceFormErrors(validateAllowance(nextValues));
                }}
              />
              {allowanceFormErrors.amount ? (
                <p className="form-field-error">{allowanceFormErrors.amount}</p>
              ) : null}
            </label>
          </div>

          <label className="form-field" htmlFor="allowance-label">
            <span className="form-label">Label</span>
            <input
              id="allowance-label"
              className={allowanceFormErrors.label ? "form-input form-input-error" : "form-input"}
              value={allowanceFormValues.label}
              onChange={(event) => {
                const nextValues = {
                  ...allowanceFormValues,
                  label: event.currentTarget.value
                };

                setAllowanceFormValues(nextValues);
                setAllowanceFormErrors(validateAllowance(nextValues));
              }}
            />
            {allowanceFormErrors.label ? (
              <p className="form-field-error">{allowanceFormErrors.label}</p>
            ) : null}
          </label>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="allowance-currency">
              <span className="form-label">Currency</span>
              <input
                id="allowance-currency"
                className={
                  allowanceFormErrors.currency ? "form-input form-input-error" : "form-input"
                }
                value={allowanceFormValues.currency}
                onChange={(event) => {
                  const nextValues = {
                    ...allowanceFormValues,
                    currency: event.currentTarget.value
                  };

                  setAllowanceFormValues(nextValues);
                  setAllowanceFormErrors(validateAllowance(nextValues));
                }}
              />
              {allowanceFormErrors.currency ? (
                <p className="form-field-error">{allowanceFormErrors.currency}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="allowance-effective-from">
              <span className="form-label">Effective from</span>
              <input
                id="allowance-effective-from"
                type="date"
                className={
                  allowanceFormErrors.effectiveFrom ? "form-input form-input-error" : "form-input"
                }
                value={allowanceFormValues.effectiveFrom}
                onChange={(event) => {
                  const nextValues = {
                    ...allowanceFormValues,
                    effectiveFrom: event.currentTarget.value
                  };

                  setAllowanceFormValues(nextValues);
                  setAllowanceFormErrors(validateAllowance(nextValues));
                }}
              />
              {allowanceFormErrors.effectiveFrom ? (
                <p className="form-field-error">{allowanceFormErrors.effectiveFrom}</p>
              ) : null}
            </label>
          </div>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="allowance-effective-to">
              <span className="form-label">Effective to (optional)</span>
              <input
                id="allowance-effective-to"
                type="date"
                className={
                  allowanceFormErrors.effectiveTo ? "form-input form-input-error" : "form-input"
                }
                value={allowanceFormValues.effectiveTo}
                onChange={(event) => {
                  const nextValues = {
                    ...allowanceFormValues,
                    effectiveTo: event.currentTarget.value
                  };

                  setAllowanceFormValues(nextValues);
                  setAllowanceFormErrors(validateAllowance(nextValues));
                }}
              />
              {allowanceFormErrors.effectiveTo ? (
                <p className="form-field-error">{allowanceFormErrors.effectiveTo}</p>
              ) : null}
            </label>

            <label className="settings-checkbox" htmlFor="allowance-taxable">
              <input
                id="allowance-taxable"
                type="checkbox"
                checked={allowanceFormValues.isTaxable}
                onChange={(event) => {
                  const nextValues = {
                    ...allowanceFormValues,
                    isTaxable: event.currentTarget.checked
                  };

                  setAllowanceFormValues(nextValues);
                  setAllowanceFormErrors(validateAllowance(nextValues));
                }}
              />
              <span>This allowance is taxable</span>
            </label>
          </div>

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={resetAllowancePanel}>
              Cancel
            </button>
            <button
              type="submit"
              className="button button-accent"
              disabled={isSubmittingAllowance}
            >
              {isSubmittingAllowance ? "Saving..." : editingAllowanceId ? "Save allowance" : "Add allowance"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isEquityPanelOpen}
        onClose={resetEquityPanel}
        title={editingEquityGrantId ? "Edit equity grant" : "Add equity grant"}
        description="Track grant details, vesting schedule, and approval status."
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleEquitySubmit} noValidate>
          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="equity-grant-type">
              <span className="form-label">Grant type</span>
              <select
                id="equity-grant-type"
                className={equityFormErrors.grantType ? "form-input form-input-error" : "form-input"}
                value={equityFormValues.grantType}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    grantType: event.currentTarget.value as EquityFormValues["grantType"]
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              >
                {EQUITY_GRANT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {equityFormErrors.grantType ? (
                <p className="form-field-error">{equityFormErrors.grantType}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="equity-number-of-shares">
              <span className="form-label">Number of shares</span>
              <input
                id="equity-number-of-shares"
                className={
                  equityFormErrors.numberOfShares ? "form-input form-input-error" : "form-input"
                }
                value={equityFormValues.numberOfShares}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    numberOfShares: event.currentTarget.value
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              />
              {equityFormErrors.numberOfShares ? (
                <p className="form-field-error">{equityFormErrors.numberOfShares}</p>
              ) : null}
            </label>
          </div>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="equity-exercise-price">
              <span className="form-label">Exercise price (cents, optional)</span>
              <input
                id="equity-exercise-price"
                className={
                  equityFormErrors.exercisePriceCents ? "form-input form-input-error" : "form-input"
                }
                value={equityFormValues.exercisePriceCents}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    exercisePriceCents: event.currentTarget.value
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              />
              {equityFormErrors.exercisePriceCents ? (
                <p className="form-field-error">{equityFormErrors.exercisePriceCents}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="equity-status">
              <span className="form-label">Status</span>
              <select
                id="equity-status"
                className={equityFormErrors.status ? "form-input form-input-error" : "form-input"}
                value={equityFormValues.status}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    status: event.currentTarget.value as EquityFormValues["status"]
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              >
                {EQUITY_GRANT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {equityFormErrors.status ? (
                <p className="form-field-error">{equityFormErrors.status}</p>
              ) : null}
            </label>
          </div>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="equity-grant-date">
              <span className="form-label">Grant date</span>
              <input
                id="equity-grant-date"
                type="date"
                className={equityFormErrors.grantDate ? "form-input form-input-error" : "form-input"}
                value={equityFormValues.grantDate}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    grantDate: event.currentTarget.value
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              />
              {equityFormErrors.grantDate ? (
                <p className="form-field-error">{equityFormErrors.grantDate}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="equity-vesting-start-date">
              <span className="form-label">Vesting start date</span>
              <input
                id="equity-vesting-start-date"
                type="date"
                className={
                  equityFormErrors.vestingStartDate ? "form-input form-input-error" : "form-input"
                }
                value={equityFormValues.vestingStartDate}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    vestingStartDate: event.currentTarget.value
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              />
              {equityFormErrors.vestingStartDate ? (
                <p className="form-field-error">{equityFormErrors.vestingStartDate}</p>
              ) : null}
            </label>
          </div>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="equity-cliff-months">
              <span className="form-label">Cliff months</span>
              <input
                id="equity-cliff-months"
                className={
                  equityFormErrors.cliffMonths ? "form-input form-input-error" : "form-input"
                }
                value={equityFormValues.cliffMonths}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    cliffMonths: event.currentTarget.value
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              />
              {equityFormErrors.cliffMonths ? (
                <p className="form-field-error">{equityFormErrors.cliffMonths}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="equity-vesting-duration-months">
              <span className="form-label">Vesting duration months</span>
              <input
                id="equity-vesting-duration-months"
                className={
                  equityFormErrors.vestingDurationMonths ? "form-input form-input-error" : "form-input"
                }
                value={equityFormValues.vestingDurationMonths}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    vestingDurationMonths: event.currentTarget.value
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              />
              {equityFormErrors.vestingDurationMonths ? (
                <p className="form-field-error">{equityFormErrors.vestingDurationMonths}</p>
              ) : null}
            </label>
          </div>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="equity-board-approval-date">
              <span className="form-label">Board approval date (optional)</span>
              <input
                id="equity-board-approval-date"
                type="date"
                className={
                  equityFormErrors.boardApprovalDate ? "form-input form-input-error" : "form-input"
                }
                value={equityFormValues.boardApprovalDate}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    boardApprovalDate: event.currentTarget.value
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              />
              {equityFormErrors.boardApprovalDate ? (
                <p className="form-field-error">{equityFormErrors.boardApprovalDate}</p>
              ) : null}
            </label>
          </div>

          <label className="form-field" htmlFor="equity-notes">
            <span className="form-label">Notes (optional)</span>
            <textarea
              id="equity-notes"
              className={equityFormErrors.notes ? "form-input form-input-error" : "form-input"}
              value={equityFormValues.notes}
              rows={4}
              onChange={(event) => {
                const nextValues = {
                  ...equityFormValues,
                  notes: event.currentTarget.value
                };

                setEquityFormValues(nextValues);
                setEquityFormErrors(validateEquity(nextValues));
              }}
            />
            {equityFormErrors.notes ? (
              <p className="form-field-error">{equityFormErrors.notes}</p>
            ) : null}
          </label>

          {canApprove ? (
            <label className="settings-checkbox" htmlFor="equity-approve">
              <input
                id="equity-approve"
                type="checkbox"
                checked={equityFormValues.approve}
                onChange={(event) => {
                  const nextValues = {
                    ...equityFormValues,
                    approve: event.currentTarget.checked
                  };

                  setEquityFormValues(nextValues);
                  setEquityFormErrors(validateEquity(nextValues));
                }}
              />
              <span>Approve this equity grant now (Super Admin only)</span>
            </label>
          ) : null}

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={resetEquityPanel}>
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmittingEquity}>
              {isSubmittingEquity ? "Saving..." : editingEquityGrantId ? "Save equity" : "Add equity"}
            </button>
          </div>
        </form>
      </SlidePanel>

      {confirmDialog}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label="Compensation toasts">
          {toasts.map((toast) => (
            <article
              key={toast.id}
              className={`toast-message toast-message-${toast.variant}`}
            >
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss toast"
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
