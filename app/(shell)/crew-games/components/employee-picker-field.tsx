"use client";

import { useEffect, useMemo, useState } from "react";

type EmployeeOption = {
  id: string;
  fullName: string;
};

type EmployeePickerFieldProps = {
  orgId: string;
  value: string;
  onChange: (employeeId: string) => void;
  placeholder?: string;
};

export function EmployeePickerField({
  orgId,
  value,
  onChange,
  placeholder = "Select crew member…"
}: EmployeePickerFieldProps) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (isLoaded) return;

    async function loadEmployees() {
      try {
        const res = await fetch("/api/v1/crew-games/employees");
        if (!res.ok) return;
        const json = await res.json();
        setEmployees(json.data?.employees ?? []);
      } catch {
        // Silently fail — the picker just stays empty
      } finally {
        setIsLoaded(true);
      }
    }

    void loadEmployees();
  }, [isLoaded]);

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [employees]
  );

  return (
    <select
      className="form-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {sortedEmployees.map((emp) => (
        <option key={emp.id} value={emp.id}>
          {emp.fullName}
        </option>
      ))}
    </select>
  );
}
