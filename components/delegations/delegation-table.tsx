"use client";

import { useTranslations } from "next-intl";

import type { DelegationRecord, EffectiveStatus } from "./delegation-types";

type DelegationTableProps = {
  delegations: DelegationRecord[];
  onEdit: (delegation: DelegationRecord) => void;
  onDeactivate: (delegation: DelegationRecord) => void;
  onReactivate: (delegation: DelegationRecord) => void;
};

function StatusBadge({ status }: { status: EffectiveStatus }) {
  const t = useTranslations("delegations");

  const classMap: Record<EffectiveStatus, string> = {
    in_effect: "delegation-status-badge delegation-status-in-effect",
    standby: "delegation-status-badge delegation-status-standby",
    expired: "delegation-status-badge delegation-status-expired",
    inactive: "delegation-status-badge delegation-status-inactive"
  };

  return (
    <span className={classMap[status]}>
      {t(`status.${status}`)}
    </span>
  );
}

const SCOPE_KEYS = ["leave", "expense", "schedule"] as const;
type ScopeKey = (typeof SCOPE_KEYS)[number];

function isScopeKey(s: string): s is ScopeKey {
  return (SCOPE_KEYS as readonly string[]).includes(s);
}

function ScopePills({ scopes }: { scopes: string[] }) {
  const t = useTranslations("delegations");

  return (
    <span className="delegation-scope-pills">
      {scopes.filter(isScopeKey).map((s) => (
        <span key={s} className="delegation-scope-pill">
          {t(`scope.${s}`)}
        </span>
      ))}
    </span>
  );
}

function formatDateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return "—";

  const formatDate = (d: string) => {
    const [year, month, day] = d.split("-");
    return `${day}/${month}/${year}`;
  };

  if (startsAt && endsAt) {
    return `${formatDate(startsAt)} – ${formatDate(endsAt)}`;
  }
  if (startsAt) return `From ${formatDate(startsAt)}`;
  return `Until ${formatDate(endsAt!)}`;
}

export function DelegationTable({
  delegations,
  onEdit,
  onDeactivate,
  onReactivate
}: DelegationTableProps) {
  const t = useTranslations("delegations");

  return (
    <div className="delegation-table-wrapper">
      <table className="delegation-table" aria-label={t("tableAriaLabel")}>
        <thead>
          <tr>
            <th>{t("column.principal")}</th>
            <th>{t("column.delegate")}</th>
            <th>{t("column.type")}</th>
            <th>{t("column.scope")}</th>
            <th>{t("column.activation")}</th>
            <th>{t("column.dates")}</th>
            <th>{t("column.status")}</th>
            <th>{t("column.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {delegations.map((d) => {
            const isExpired = d.effectiveStatus === "expired";
            const isInactive = d.effectiveStatus === "inactive";
            const canReactivate = isInactive && !isExpired;
            const canDeactivate = d.isActive;

            return (
              <tr
                key={d.id}
                className={
                  isInactive || isExpired ? "delegation-row-dimmed" : undefined
                }
              >
                <td>
                  <div className="delegation-person-cell">
                    <span className="delegation-person-name">{d.principalName}</span>
                    {d.principalDepartment ? (
                      <span className="delegation-person-dept">
                        {d.principalDepartment}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className="delegation-person-cell">
                    <span className="delegation-person-name">{d.delegateName}</span>
                    {d.delegateDepartment ? (
                      <span className="delegation-person-dept">
                        {d.delegateDepartment}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>{t(`type.${d.delegateType}`)}</td>
                <td>
                  <ScopePills scopes={d.scope} />
                </td>
                <td>{t(`activation.${d.activation}`)}</td>
                <td className="delegation-date-cell">
                  {formatDateRange(d.startsAt, d.endsAt)}
                </td>
                <td>
                  <StatusBadge status={d.effectiveStatus} />
                </td>
                <td>
                  <div className="delegation-actions">
                    {canDeactivate ? (
                      <>
                        <button
                          type="button"
                          className="delegation-action-link"
                          onClick={() => onEdit(d)}
                        >
                          {t("edit")}
                        </button>
                        <button
                          type="button"
                          className="delegation-action-link delegation-action-danger"
                          onClick={() => onDeactivate(d)}
                        >
                          {t("deactivate")}
                        </button>
                      </>
                    ) : null}
                    {canReactivate ? (
                      <button
                        type="button"
                        className="delegation-action-link"
                        onClick={() => onReactivate(d)}
                      >
                        {t("reactivate")}
                      </button>
                    ) : null}
                    {isExpired && !d.isActive ? (
                      <span
                        className="delegation-action-disabled"
                        title={t("expiredCannotReactivate")}
                      >
                        {t("expired")}
                      </span>
                    ) : null}
                    {isExpired && d.isActive ? (
                      <button
                        type="button"
                        className="delegation-action-link delegation-action-danger"
                        onClick={() => onDeactivate(d)}
                      >
                        {t("deactivate")}
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
  );
}
