"use client";

import { useCallback, useMemo, useState } from "react";

import type { ScheduleTrack } from "../../types/scheduling";

export type RosterEmployee = {
  id: string;
  fullName: string;
  department: string | null;
  countryCode: string | null;
  scheduleType: string;
  weekendShiftHours: "full" | "part";
};

export type RosterSelection = {
  employeeId: string;
  weekendHours: "full" | "part";
};

type RosterSelectorProps = {
  employees: RosterEmployee[];
  track: ScheduleTrack;
  selected: Map<string, RosterSelection>;
  onChange: (selected: Map<string, RosterSelection>) => void;
};

function getCountryFlag(code: string | null): string {
  if (!code || code.length !== 2) return "";
  const chars = [...code.toUpperCase()];
  return chars.map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

export function RosterSelector({ employees, track, selected, onChange }: RosterSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Show all employees regardless of track — any team member might need
  // to chip in for customer success weeks or help with support workload
  const eligible = employees;

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return eligible;
    const query = searchQuery.toLowerCase();
    return eligible.filter((emp) =>
      emp.fullName.toLowerCase().includes(query) ||
      (emp.department?.toLowerCase().includes(query) ?? false)
    );
  }, [eligible, searchQuery]);

  const allSelected = eligible.length > 0 && eligible.every((emp) => selected.has(emp.id));

  const handleToggle = useCallback((emp: RosterEmployee) => {
    const next = new Map(selected);
    if (next.has(emp.id)) {
      next.delete(emp.id);
    } else {
      next.set(emp.id, {
        employeeId: emp.id,
        weekendHours: emp.weekendShiftHours
      });
    }
    onChange(next);
  }, [selected, onChange]);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      onChange(new Map());
    } else {
      const next = new Map<string, RosterSelection>();
      for (const emp of eligible) {
        const existing = selected.get(emp.id);
        next.set(emp.id, existing ?? {
          employeeId: emp.id,
          weekendHours: emp.weekendShiftHours
        });
      }
      onChange(next);
    }
  }, [allSelected, eligible, selected, onChange]);

  const handleToggleWeekendHours = useCallback((empId: string) => {
    const entry = selected.get(empId);
    if (!entry) return;
    const next = new Map(selected);
    next.set(empId, {
      ...entry,
      weekendHours: entry.weekendHours === "full" ? "part" : "full"
    });
    onChange(next);
  }, [selected, onChange]);

  return (
    <div className="schedule-roster-selector">
      <div className="schedule-roster-header">
        <div className="schedule-roster-count">
          {selected.size} of {eligible.length} selected
        </div>
        <button type="button" className="button button-ghost" onClick={handleSelectAll}>
          {allSelected ? "Deselect All" : "Select All"}
        </button>
      </div>

      {eligible.length > 6 ? (
        <input
          type="text"
          className="form-input schedule-roster-search"
          placeholder="Search team members..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      ) : null}

      <div className="schedule-roster-list">
        {filtered.map((emp) => {
          const isChecked = selected.has(emp.id);
          const entry = selected.get(emp.id);
          const flag = getCountryFlag(emp.countryCode);

          return (
            <label key={emp.id} className="schedule-roster-row">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => handleToggle(emp)}
              />
              <span className="schedule-roster-name">
                {flag ? <span className="schedule-roster-flag">{flag}</span> : null}
                {emp.fullName}
              </span>
              {emp.department ? (
                <span className="schedule-roster-dept">{emp.department}</span>
              ) : null}
              {track === "weekend" && isChecked ? (
                <button
                  type="button"
                  className={`schedule-roster-hours-badge ${entry?.weekendHours === "part" ? "schedule-roster-hours-part" : "schedule-roster-hours-full"}`}
                  onClick={(e) => {
                    e.preventDefault();
                    handleToggleWeekendHours(emp.id);
                  }}
                  title="Click to toggle between full-time (8hr) and part-time (4hr)"
                >
                  {entry?.weekendHours === "part" ? "4hr" : "8hr"}
                </button>
              ) : null}
            </label>
          );
        })}

        {filtered.length === 0 ? (
          <div className="schedule-roster-empty">
            {searchQuery.trim()
              ? "No team members match your search."
              : "No active team members found."}
          </div>
        ) : null}
      </div>
    </div>
  );
}
