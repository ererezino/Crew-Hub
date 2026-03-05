export default function SettingsLoading() {
  return (
    <div className="settings-loading" aria-hidden="true">
      <div className="settings-skeleton settings-skeleton-tabs" />
      <div className="settings-skeleton settings-skeleton-form" />
      <div className="settings-skeleton settings-skeleton-form" />
      <div className="settings-skeleton table-skeleton" />
    </div>
  );
}
