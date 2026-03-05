"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useLearningCourses } from "../../../../hooks/use-learning";
import { usePeople } from "../../../../hooks/use-people";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import type {
  LearningAssignmentsBulkMutationResponse,
  LearningCourseRecord
} from "../../../../types/learning";

type SortDirection = "asc" | "desc";

type AssignmentFormState = {
  courseId: string;
  dueDate: string;
  employeeIds: string[];
};

const defaultAssignmentForm: AssignmentFormState = {
  courseId: "",
  dueDate: "",
  employeeIds: []
};

function learningAdminSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={`learning-admin-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`learning-admin-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function LearningAdminClient() {
  const coursesQuery = useLearningCourses({ includeDraft: true });
  const peopleQuery = usePeople({ scope: "all" });

  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(defaultAssignmentForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sortedCourses = useMemo(() => {
    const rows = coursesQuery.data?.courses ?? [];

    return [...rows].sort((leftRow, rightRow) => {
      const comparison = leftRow.title.localeCompare(rightRow.title);
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [coursesQuery.data?.courses, sortDirection]);

  const publishedCount = sortedCourses.filter((row) => row.isPublished).length;
  const mandatoryCount = sortedCourses.filter((row) => row.isMandatory).length;

  const isLoading = coursesQuery.isLoading || peopleQuery.isLoading;
  const errorMessage = coursesQuery.errorMessage ?? peopleQuery.errorMessage;

  function toggleEmployee(employeeId: string) {
    setAssignmentForm((currentValue) => {
      const hasSelected = currentValue.employeeIds.includes(employeeId);

      return {
        ...currentValue,
        employeeIds: hasSelected
          ? currentValue.employeeIds.filter((value) => value !== employeeId)
          : [...currentValue.employeeIds, employeeId]
      };
    });
  }

  function prefillCourse(course: LearningCourseRecord) {
    setAssignmentForm((currentValue) => ({
      ...currentValue,
      courseId: course.id
    }));
    setFormError(null);
    setSubmitMessage(null);
  }

  async function handleAssignCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitMessage(null);

    if (!assignmentForm.courseId) {
      setFormError("Select a course.");
      return;
    }

    if (assignmentForm.employeeIds.length === 0) {
      setFormError("Select at least one employee.");
      return;
    }

    if (assignmentForm.dueDate.trim().length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(assignmentForm.dueDate)) {
      setFormError("Due date must be YYYY-MM-DD.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/v1/learning/courses/${assignmentForm.courseId}/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          employeeIds: assignmentForm.employeeIds,
          dueDate: assignmentForm.dueDate || undefined
        })
      });

      const payload = (await response.json()) as LearningAssignmentsBulkMutationResponse;

      if (!response.ok || !payload.data?.assignments) {
        setFormError(payload.error?.message ?? "Unable to assign course.");
        return;
      }

      setSubmitMessage(`Assigned to ${payload.data.assignments.length} employee(s).`);
      setAssignmentForm((currentValue) => ({
        ...currentValue,
        employeeIds: []
      }));
      coursesQuery.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to assign course.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Learning Admin"
        description="Create training content, publish courses, and assign learning plans."
      />

      {isLoading ? learningAdminSkeleton() : null}

      {!isLoading && errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Learning admin data is unavailable"
            description={errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => {
              coursesQuery.refresh();
              peopleQuery.refresh();
            }}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!isLoading && !errorMessage ? (
        <section className="compensation-layout" aria-label="Learning admin overview">
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Courses</p>
              <p className="metric-value numeric">{sortedCourses.length}</p>
              <p className="metric-description">Total learning courses configured.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Published</p>
              <p className="metric-value numeric">{publishedCount}</p>
              <p className="metric-description">Visible to employees in the learning catalog.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Mandatory</p>
              <p className="metric-value numeric">{mandatoryCount}</p>
              <p className="metric-description">Courses marked mandatory for completion.</p>
            </article>
          </article>

          <article className="metric-card">
            <div>
              <h2 className="section-title">Admin actions</h2>
              <p className="settings-card-description">
                Create new courses or review completion reporting.
              </p>
            </div>
            <div className="documents-row-actions">
              <Link href="/admin/learning/courses/new" className="button button-accent">
                New course
              </Link>
              <Link href="/admin/learning/reports" className="button">
                Reports
              </Link>
            </div>
          </article>

          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Assign course</h2>
                <p className="settings-card-description">
                  Assign selected course to one or more employees.
                </p>
              </div>
            </header>

            <form className="settings-form-grid" onSubmit={handleAssignCourse}>
              <label className="settings-field">
                <span className="settings-field-label">Course</span>
                <select
                  className="settings-input"
                  value={assignmentForm.courseId}
                  onChange={(event) =>
                    setAssignmentForm((currentValue) => ({
                      ...currentValue,
                      courseId: event.target.value
                    }))
                  }
                >
                  <option value="">Select a course</option>
                  {sortedCourses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-field">
                <span className="settings-field-label">Due date</span>
                <input
                  type="date"
                  className="settings-input"
                  value={assignmentForm.dueDate}
                  onChange={(event) =>
                    setAssignmentForm((currentValue) => ({
                      ...currentValue,
                      dueDate: event.target.value
                    }))
                  }
                />
              </label>

              <fieldset className="settings-field">
                <legend className="settings-field-label">Employees</legend>
                <div className="documents-upload-list" style={{ maxHeight: "220px", overflow: "auto" }}>
                  {peopleQuery.people.map((person) => (
                    <label key={person.id} className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={assignmentForm.employeeIds.includes(person.id)}
                        onChange={() => toggleEmployee(person.id)}
                      />
                      <span>{person.fullName}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {formError ? <p className="form-field-error">{formError}</p> : null}

              <div className="settings-actions">
                <button type="submit" className="button button-accent" disabled={isSubmitting}>
                  {isSubmitting ? "Assigning..." : "Assign course"}
                </button>
              </div>
            </form>

            {submitMessage ? <p className="settings-card-description">{submitMessage}</p> : null}
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">Course list</h2>
                <p className="settings-card-description">
                  Published and draft courses, with assignment counts.
                </p>
              </div>
            </header>

            {sortedCourses.length === 0 ? (
              <EmptyState
                title="No courses yet"
                description="Create a course to begin assigning learning content."
                ctaLabel="Create course"
                ctaHref="/admin/learning/courses/new"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Learning courses admin table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="table-sort-trigger"
                          onClick={() =>
                            setSortDirection((currentValue) =>
                              currentValue === "asc" ? "desc" : "asc"
                            )
                          }
                        >
                          Title
                          <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>Type</th>
                      <th>Assignments</th>
                      <th>Completions</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCourses.map((course) => (
                      <tr key={course.id} className="data-table-row">
                        <td>{course.title}</td>
                        <td>
                          <StatusBadge tone="info">{toSentenceCase(course.contentType)}</StatusBadge>
                        </td>
                        <td className="numeric">{course.assignmentCount}</td>
                        <td className="numeric">{course.completionCount}</td>
                        <td>
                          <StatusBadge tone={course.isPublished ? "success" : "draft"}>
                            {course.isPublished ? "Published" : "Draft"}
                          </StatusBadge>
                        </td>
                        <td>
                          <span title={formatDateTimeTooltip(course.updatedAt)}>
                            {formatRelativeTime(course.updatedAt)}
                          </span>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="timeatt-row-actions">
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => prefillCourse(course)}
                            >
                              Assign
                            </button>
                            <Link href={`/learning/courses/${course.id}`} className="table-row-action">
                              View
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      ) : null}
    </>
  );
}
