export function normalizeDepartment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function areDepartmentsEqual(
  lhs: string | null | undefined,
  rhs: string | null | undefined
): boolean {
  const normalizedLeft = normalizeDepartment(lhs);
  const normalizedRight = normalizeDepartment(rhs);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft === normalizedRight;
}
