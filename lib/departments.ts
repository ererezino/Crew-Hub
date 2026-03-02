export const DEPARTMENTS = [
  "Sales",
  "Operations",
  "Marketing",
  "Engineering",
  "Growth",
  "Customer Success",
  "Design",
  "Product"
] as const;

export type Department = (typeof DEPARTMENTS)[number];

function normalizeDepartmentValue(value: string): string {
  return value.trim().toLowerCase();
}

export function parseDepartment(value: string | null | undefined): Department | null {
  if (!value) {
    return null;
  }

  const normalizedValue = normalizeDepartmentValue(value);
  const matchedDepartment = DEPARTMENTS.find(
    (department) => normalizeDepartmentValue(department) === normalizedValue
  );

  return matchedDepartment ?? null;
}

export function isDepartment(value: string | null | undefined): value is Department {
  return parseDepartment(value) !== null;
}

export function getDepartmentsValidationMessage(): string {
  return `Department must be one of: ${DEPARTMENTS.join(", ")}.`;
}
