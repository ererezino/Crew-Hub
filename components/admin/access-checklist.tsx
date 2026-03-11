"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

export type AccessChecklistItem = {
  key: string;
  label: string;
  groupLabel: string;
  description?: string;
};

type AccessChecklistProps = {
  items: AccessChecklistItem[];
  selectedKeys: string[];
  onToggle: (navItemKey: string, checked: boolean) => void;
  disabled?: boolean;
};

export function AccessChecklist({
  items,
  selectedKeys,
  onToggle,
  disabled = false
}: AccessChecklistProps) {
  const t = useTranslations("adminUsers");
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const groupedItems = useMemo(() => {
    const map = new Map<string, AccessChecklistItem[]>();

    for (const item of items) {
      const groupItems = map.get(item.groupLabel) ?? [];
      groupItems.push(item);
      map.set(item.groupLabel, groupItems);
    }

    return [...map.entries()];
  }, [items]);

  return (
    <section className="settings-card">
      <div>
        <h3 className="section-title">{t('accessChecklist.title')}</h3>
        <p className="settings-card-description">
          {t('accessChecklist.description')}
        </p>
      </div>

      <div className="admin-users-access-grid">
        {groupedItems.map(([groupLabel, groupItems]) => (
          <fieldset key={groupLabel} className="admin-users-access-group">
            <legend className="form-label">{groupLabel}</legend>
            <div className="admin-users-access-options">
              {groupItems.map((item) => (
                <label key={item.key} className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedKeySet.has(item.key)}
                    disabled={disabled}
                    onChange={(event) => onToggle(item.key, event.currentTarget.checked)}
                  />
                  <span>
                    {item.label}
                    {item.description ? (
                      <span className="admin-users-access-description"> - {item.description}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
