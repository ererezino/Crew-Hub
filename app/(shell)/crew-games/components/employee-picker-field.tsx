"use client";

import { useEffect, useMemo, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";

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
  orgId: _orgId,
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
    <Select
      value={value || "__none__"}
      onValueChange={(val) => onChange(val === "__none__" ? "" : val)}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{placeholder}</SelectItem>
        {sortedEmployees.map((emp) => (
          <SelectItem key={emp.id} value={emp.id}>
            {emp.fullName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
