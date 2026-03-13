"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { SlidePanel } from "../../../components/shared/slide-panel";
import { countryFlagFromCode } from "../../../lib/countries";
import { DEPARTMENTS } from "../../../lib/departments";
import { formatDate } from "../../../lib/datetime";
import type { CrewMember, CrewListResponseData } from "../../../types/people";

/* ── Constants ── */

const DEPT_COLORS: Record<string, { accent: string; light: string }> = {
  marketing: { accent: "#f59e0b", light: "#fffbeb" },
  "marketing & growth": { accent: "#f59e0b", light: "#fffbeb" },
  "content & marketing": { accent: "#f59e0b", light: "#fffbeb" },
  growth: { accent: "#f59e0b", light: "#fffbeb" },
  "customer success": { accent: "#10b981", light: "#ecfdf5" },
  engineering: { accent: "#6366f1", light: "#eef2ff" },
  finance: { accent: "#0ea5e9", light: "#f0f9ff" },
  "finance & accounting": { accent: "#0ea5e9", light: "#f0f9ff" },
  hr: { accent: "#ec4899", light: "#fdf2f8" },
  "human resources": { accent: "#ec4899", light: "#fdf2f8" },
  operations: { accent: "#8b5cf6", light: "#f5f3ff" },
  sales: { accent: "#ef4444", light: "#fef2f2" },
  "business development": { accent: "#ef4444", light: "#fef2f2" },
  design: { accent: "#f472b6", light: "#fdf2f8" },
  product: { accent: "#14b8a6", light: "#f0fdfa" },
  compliance: { accent: "#64748b", light: "#f8fafc" },
  legal: { accent: "#64748b", light: "#f8fafc" },
  founders: { accent: "#FD8B05", light: "#FFF3DC" }
};
const DEFAULT_COLOR = { accent: "#64748b", light: "#f8fafc" };

function getDeptColor(dept: string | null) {
  if (!dept) return DEFAULT_COLOR;
  return DEPT_COLORS[dept.toLowerCase()] ?? DEFAULT_COLOR;
}

/** Darken a hex color by a percentage (0-1). */
function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, ((num >> 16) & 0xff) * (1 - amount));
  const g = Math.max(0, ((num >> 8) & 0xff) * (1 - amount));
  const b = Math.max(0, (num & 0xff) * (1 - amount));
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function getInitials(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "?";
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0][0] ?? ""}${tokens[1][0] ?? ""}`.toUpperCase();
}

/* ── Social icon helpers ── */

type SocialEntry = { key: string; url: string; label: string; icon: string };

function getSocials(member: CrewMember): SocialEntry[] {
  const entries: SocialEntry[] = [];
  if (member.socialLinkedin) entries.push({ key: "linkedin", url: member.socialLinkedin, label: "LinkedIn", icon: "in" });
  if (member.socialTwitter) entries.push({ key: "twitter", url: member.socialTwitter, label: "Twitter / X", icon: "𝕏" });
  if (member.socialInstagram) entries.push({ key: "instagram", url: member.socialInstagram, label: "Instagram", icon: "📷" });
  if (member.socialGithub) entries.push({ key: "github", url: member.socialGithub, label: "GitHub", icon: "⌨" });
  if (member.socialWebsite) entries.push({ key: "website", url: member.socialWebsite, label: "Website", icon: "🌐" });
  return entries;
}

/* ── Props ── */

type TheCrewClientProps = {
  currentUserId: string;
  isAdmin: boolean;
};

/* ── Component ── */

export function TheCrewClient({ currentUserId, isAdmin }: TheCrewClientProps) {
  const t = useTranslations("theCrew");

  /* ── Data fetching ── */
  const [members, setMembers] = useState<CrewMember[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCrew = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/the-crew");
      const payload = (await res.json()) as { data?: CrewListResponseData | null; error?: { message: string } | null };
      if (!res.ok || !payload.data) {
        setError(payload.error?.message ?? "Unable to load crew.");
        return;
      }
      setMembers(payload.data.members);
      setTotalCount(payload.data.totalCount);
    } catch {
      setError("Unable to load crew.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchCrew(); }, [fetchCrew]);

  /* ── Search + filter + view state ── */
  const [search, setSearch] = useState("");
  const [activeDept, setActiveDept] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "by-team">("by-team");

  /* ── Derived: departments list ── */
  const departments = useMemo(() => {
    const deptSet = new Map<string, number>();
    for (const m of members) {
      const d = m.department ?? "Other";
      deptSet.set(d, (deptSet.get(d) ?? 0) + 1);
    }
    return [...deptSet.entries()]
      .sort(([a], [b]) => {
        if (a.toLowerCase() === "founders") return -1;
        if (b.toLowerCase() === "founders") return 1;
        const aIdx = (DEPARTMENTS as readonly string[]).indexOf(a);
        const bIdx = (DEPARTMENTS as readonly string[]).indexOf(b);
        // Known departments sort by their DEPARTMENTS order; unknowns go to the end alphabetically
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.localeCompare(b);
      })
      .map(([name, count]) => ({ name, count }));
  }, [members]);

  /* ── Derived: filtered members ── */
  const filtered = useMemo(() => {
    let list = members;
    if (activeDept) {
      list = list.filter((m) => (m.department ?? "Other") === activeDept);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.fullName.toLowerCase().includes(q) ||
          (m.title ?? "").toLowerCase().includes(q) ||
          (m.department ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [members, activeDept, search]);

  /* ── Derived: grouped members (for "By team" mode) ── */
  const grouped = useMemo(() => {
    if (viewMode !== "by-team") return null;
    const map = new Map<string, CrewMember[]>();
    for (const m of filtered) {
      const d = m.department ?? "Other";
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(m);
    }
    const sorted: [string, CrewMember[]][] = [];
    for (const dept of departments) {
      const group = map.get(dept.name);
      if (group && group.length > 0) sorted.push([dept.name, group]);
    }
    for (const [k, v] of map) {
      if (!sorted.some(([name]) => name === k)) sorted.push([k, v]);
    }
    return sorted;
  }, [filtered, departments, viewMode]);

  /* ── Profile drawer ── */
  const [selectedMember, setSelectedMember] = useState<CrewMember | null>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);

  const openDrawer = useCallback((member: CrewMember) => {
    drawerTriggerRef.current = document.activeElement as HTMLElement | null;
    setSelectedMember(member);
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedMember(null);
    // Restore focus to the card that opened the drawer
    requestAnimationFrame(() => {
      drawerTriggerRef.current?.focus();
      drawerTriggerRef.current = null;
    });
  }, []);

  /* ── Moderation drawer ── */
  const [moderatingMember, setModeratingMember] = useState<CrewMember | null>(null);
  const [modValues, setModValues] = useState<Record<string, string>>({});
  const [modVisible, setModVisible] = useState(true);
  const [isModSaving, setIsModSaving] = useState(false);
  const [modMessage, setModMessage] = useState<string | null>(null);

  const openModeration = useCallback((member: CrewMember) => {
    setModeratingMember(member);
    setModValues({
      bio: member.bio ?? "",
      socialLinkedin: member.socialLinkedin ?? "",
      socialTwitter: member.socialTwitter ?? "",
      socialInstagram: member.socialInstagram ?? "",
      socialGithub: member.socialGithub ?? "",
      socialWebsite: member.socialWebsite ?? "",
      favoriteMusic: member.favoriteMusic ?? "",
      favoriteBooks: member.favoriteBooks ?? "",
      favoriteSports: member.favoriteSports ?? ""
    });
    setModVisible(true);
    setModMessage(null);
  }, []);

  const handleModSave = useCallback(async () => {
    if (!moderatingMember) return;
    setIsModSaving(true);
    setModMessage(null);
    try {
      const body: Record<string, unknown> = {};
      if (modValues.bio !== (moderatingMember.bio ?? "")) body.bio = modValues.bio || null;
      if (modValues.socialLinkedin !== (moderatingMember.socialLinkedin ?? "")) body.socialLinkedin = modValues.socialLinkedin || null;
      if (modValues.socialTwitter !== (moderatingMember.socialTwitter ?? "")) body.socialTwitter = modValues.socialTwitter || null;
      if (modValues.socialInstagram !== (moderatingMember.socialInstagram ?? "")) body.socialInstagram = modValues.socialInstagram || null;
      if (modValues.socialGithub !== (moderatingMember.socialGithub ?? "")) body.socialGithub = modValues.socialGithub || null;
      if (modValues.socialWebsite !== (moderatingMember.socialWebsite ?? "")) body.socialWebsite = modValues.socialWebsite || null;
      if (modValues.favoriteMusic !== (moderatingMember.favoriteMusic ?? "")) body.favoriteMusic = modValues.favoriteMusic || null;
      if (modValues.favoriteBooks !== (moderatingMember.favoriteBooks ?? "")) body.favoriteBooks = modValues.favoriteBooks || null;
      if (modValues.favoriteSports !== (moderatingMember.favoriteSports ?? "")) body.favoriteSports = modValues.favoriteSports || null;
      body.directoryVisible = modVisible;

      const res = await fetch(`/api/v1/the-crew/${moderatingMember.id}/moderate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const payload = (await res.json()) as { error?: { message: string } | null };
        setModMessage(payload.error?.message ?? "Unable to update.");
        return;
      }

      setModMessage(t("moderate.saved"));
      void fetchCrew();
    } catch {
      setModMessage(t("moderate.failed"));
    } finally {
      setIsModSaving(false);
    }
  }, [moderatingMember, modValues, modVisible, fetchCrew]);

  /* ── Render helpers ── */

  const renderCard = (member: CrewMember, index: number) => {
    const color = getDeptColor(member.department);
    return (
      <article
        key={member.id}
        className="crew-card"
        onClick={() => openDrawer(member)}
        role="button"
        tabIndex={0}
        aria-label={[member.fullName, member.title, member.department].filter(Boolean).join(", ")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(member); } }}
      >
        {/* Admin moderate icon */}
        {isAdmin ? (
          <button
            type="button"
            className="crew-card-moderate"
            title={t("moderate.title")}
            onClick={(e) => { e.stopPropagation(); openModeration(member); }}
          >
            ⚙
          </button>
        ) : null}

        {/* Photo area */}
        <div className="crew-avatar-wrap">
          {member.avatarUrl ? (
            <Image
              src={member.avatarUrl}
              alt={member.fullName}
              width={400}
              height={300}
              className="crew-avatar-img"
              sizes="(max-width: 480px) 100vw, (max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
              priority={index < 8}
              unoptimized
            />
          ) : (
            <span
              className="crew-avatar-fallback"
              role="img"
              aria-label={`${getInitials(member.fullName)} of ${member.fullName}`}
              style={{ background: `linear-gradient(135deg, ${color.accent}, ${darkenColor(color.accent, 0.25)})` }}
            >
              {getInitials(member.fullName)}
            </span>
          )}
        </div>

        {/* Caption */}
        <div className="crew-card-body">
          <h3 className="crew-card-name">{member.fullName}</h3>
          {member.title ? <p className="crew-card-title">{member.title}</p> : null}
          {member.department ? (
            <div className="crew-card-dept">
              <span className="crew-card-dept-dot" style={{ backgroundColor: color.accent }} />
              <span className="crew-card-dept-label">{member.department}</span>
            </div>
          ) : null}
        </div>
      </article>
    );
  };

  const renderSkeleton = () => (
    <div className="crew-card-skeleton">
      <div className="crew-skeleton-photo" />
      <div className="crew-skeleton-caption">
        <div className="crew-skeleton-line" />
        <div className="crew-skeleton-line" />
        <div className="crew-skeleton-line" />
      </div>
    </div>
  );

  /* ── Render ── */

  return (
    <div className="crew-page">
      {/* ── Hero ── */}
      <div className="crew-hero">
        <h1 className="crew-hero-heading">
          {t("pageTitle")}
        </h1>
        <p className="crew-hero-subtitle">
          {t("pageSubtitle")}
        </p>
        {!isLoading && (
          <div className="crew-hero-stats">
            <span>{t("statMembers", { count: totalCount })}</span>
            <span className="crew-hero-dot" aria-hidden="true" />
            <span>{t("statDepartments", { count: departments.length })}</span>
          </div>
        )}
      </div>

      {/* ── Search + filter (hidden while loading) ── */}
      {!isLoading && (
        <>
          <div className="crew-search-bar">
            <input
              type="text"
              className="form-input crew-search-input"
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>

          <div className="crew-filter-bar">
            <div className="crew-chips">
              <button
                type="button"
                className={`crew-chip ${activeDept === null ? "crew-chip-active" : ""}`}
                aria-pressed={activeDept === null}
                onClick={() => setActiveDept(null)}
              >
                {t("chipAll")}
              </button>
              {departments.map((dept) => (
                <button
                  key={dept.name}
                  type="button"
                  className={`crew-chip ${activeDept === dept.name ? "crew-chip-active" : ""}`}
                  aria-pressed={activeDept === dept.name}
                  style={activeDept === dept.name ? { backgroundColor: getDeptColor(dept.name).accent, color: "#fff", borderColor: getDeptColor(dept.name).accent } : undefined}
                  onClick={() => setActiveDept(activeDept === dept.name ? null : dept.name)}
                >
                  {dept.name} ({dept.count})
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`crew-view-toggle ${viewMode === "by-team" ? "crew-view-toggle-active" : ""}`}
              onClick={() => setViewMode(viewMode === "all" ? "by-team" : "all")}
              aria-pressed={viewMode === "by-team"}
            >
              {t("viewByTeam")}
            </button>
          </div>
        </>
      )}

      {/* ── Loading / Error / Empty / Grid ── */}
      {isLoading ? (
        <div className="crew-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>{renderSkeleton()}</div>
          ))}
        </div>
      ) : error ? (
        <div className="crew-empty">
          <p>{error}</p>
          <button type="button" className="button" onClick={() => void fetchCrew()}>{t("retry")}</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="crew-empty">
          <p>{t("emptyTitle")}</p>
        </div>
      ) : viewMode === "by-team" && grouped ? (
        /* ── By Team mode: flat grid with label dividers ── */
        <div className="crew-grid">
          {grouped.map(([deptName, deptMembers]) => {
            const color = getDeptColor(deptName);
            // Find the global index for priority loading
            let globalIdx = 0;
            for (const [, prevMembers] of grouped) {
              if (prevMembers === deptMembers) break;
              globalIdx += prevMembers.length;
            }
            return [
              /* Department divider */
              <div key={`divider-${deptName}`} className="crew-dept-divider">
                <span className="crew-dept-divider-dot" style={{ backgroundColor: color.accent }} />
                <h2 className="crew-dept-divider-name">{deptName}</h2>
                <span className="crew-dept-divider-count">{t("memberCount", { count: deptMembers.length })}</span>
                <span className="crew-dept-divider-line" />
              </div>,
              /* Cards */
              ...deptMembers.map((member, i) => renderCard(member, globalIdx + i))
            ];
          }).flat()}
        </div>
      ) : (
        /* ── Everyone mode: flat grid ── */
        <div className="crew-grid">
          {filtered.map((member, i) => renderCard(member, i))}
        </div>
      )}

      {/* ── Profile Drawer ── */}
      {selectedMember ? (
        <SlidePanel
          isOpen={!!selectedMember}
          title={selectedMember.fullName}
          onClose={closeDrawer}
        >
          <div className="crew-drawer">
            {/* Hero image */}
            <div className="crew-drawer-hero">
              {selectedMember.avatarUrl ? (
                <Image
                  src={selectedMember.avatarUrl}
                  alt={selectedMember.fullName}
                  width={600}
                  height={450}
                  className="crew-drawer-hero-img"
                  unoptimized
                />
              ) : (
                <span
                  className="crew-drawer-hero-fallback"
                  role="img"
                  aria-label={`${getInitials(selectedMember.fullName)} of ${selectedMember.fullName}`}
                  style={{ background: `linear-gradient(135deg, ${getDeptColor(selectedMember.department).accent}, ${darkenColor(getDeptColor(selectedMember.department).accent, 0.25)})` }}
                >
                  {getInitials(selectedMember.fullName)}
                </span>
              )}
            </div>

            {/* Identity */}
            <div className="crew-drawer-identity">
              <h2 className="crew-drawer-name">{selectedMember.fullName}</h2>
              {(selectedMember.title || selectedMember.department) ? (
                <p className="crew-drawer-role">
                  {selectedMember.title ?? ""}
                  {selectedMember.title && selectedMember.department ? (
                    <>
                      <span style={{ color: "var(--text-muted)" }}> · </span>
                      <span className="crew-drawer-role-dot" style={{ backgroundColor: getDeptColor(selectedMember.department).accent, display: "inline-block", verticalAlign: "middle" }} />
                      {" "}{selectedMember.department}
                    </>
                  ) : selectedMember.department ? (
                    <>
                      <span className="crew-drawer-role-dot" style={{ backgroundColor: getDeptColor(selectedMember.department).accent, display: "inline-block", verticalAlign: "middle" }} />
                      {" "}{selectedMember.department}
                    </>
                  ) : null}
                </p>
              ) : null}
              {(selectedMember.countryCode || selectedMember.pronouns || selectedMember.startDate) ? (
                <p className="crew-drawer-meta">
                  {selectedMember.countryCode ? <span>{countryFlagFromCode(selectedMember.countryCode)}</span> : null}
                  {selectedMember.pronouns ? (
                    <>
                      {selectedMember.countryCode ? <span className="crew-drawer-meta-sep">·</span> : null}
                      <span>{selectedMember.pronouns}</span>
                    </>
                  ) : null}
                  {selectedMember.startDate ? (
                    <>
                      {(selectedMember.countryCode || selectedMember.pronouns) ? <span className="crew-drawer-meta-sep">·</span> : null}
                      <span>{t("drawer.joined", { date: formatDate(selectedMember.startDate) })}</span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>

            {/* Bio */}
            {selectedMember.bio ? (
              <div className="crew-drawer-section">
                <h3 className="crew-drawer-section-title">{t("drawer.bio")}</h3>
                <p className="crew-drawer-bio">{selectedMember.bio}</p>
              </div>
            ) : null}

            {/* Favorites */}
            {(selectedMember.favoriteMusic || selectedMember.favoriteBooks || selectedMember.favoriteSports) ? (
              <div className="crew-drawer-section">
                <h3 className="crew-drawer-section-title">{t("drawer.favorites")}</h3>
                <div className="crew-drawer-favorites">
                  {selectedMember.favoriteMusic ? <p className="crew-drawer-favorite-item">🎵 {selectedMember.favoriteMusic}</p> : null}
                  {selectedMember.favoriteBooks ? <p className="crew-drawer-favorite-item">📚 {selectedMember.favoriteBooks}</p> : null}
                  {selectedMember.favoriteSports ? <p className="crew-drawer-favorite-item">⚽ {selectedMember.favoriteSports}</p> : null}
                </div>
              </div>
            ) : null}

            {/* Social */}
            {getSocials(selectedMember).length > 0 ? (
              <div className="crew-drawer-section">
                <h3 className="crew-drawer-section-title">{t("drawer.connect")}</h3>
                <div className="crew-drawer-socials">
                  {getSocials(selectedMember).map((s) => (
                    <a
                      key={s.key}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="crew-drawer-social-link"
                    >
                      <span className="crew-drawer-social-icon">{s.icon}</span>
                      {s.label}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Edit my profile */}
            {selectedMember.id === currentUserId ? (
              <div className="crew-drawer-edit">
                <Link href="/settings" className="button button-accent">
                  {t("drawer.editMyProfile")}
                </Link>
              </div>
            ) : null}
          </div>
        </SlidePanel>
      ) : null}

      {/* ── Moderation Drawer (admin only) ── */}
      {moderatingMember && isAdmin ? (
        <SlidePanel
          isOpen={!!moderatingMember}
          title={t("moderate.title")}
          onClose={() => setModeratingMember(null)}
        >
          <div className="crew-mod-drawer">
            <p className="crew-mod-notice">
              {t("moderate.notice")}
            </p>

            <label className="crew-mod-toggle">
              <input
                type="checkbox"
                checked={modVisible}
                onChange={(e) => setModVisible(e.currentTarget.checked)}
              />
              <span>{t("moderate.directoryVisible")}</span>
            </label>

            <label className="form-field">
              <span className="form-label-sm">{t("moderate.bioLabel")}</span>
              <textarea
                className="form-input"
                rows={3}
                maxLength={500}
                value={modValues.bio ?? ""}
                onChange={(e) => setModValues({ ...modValues, bio: e.currentTarget.value })}
              />
            </label>

            <label className="form-field">
              <span className="form-label-sm">{t("moderate.linkedinLabel")}</span>
              <input className="form-input" maxLength={255} value={modValues.socialLinkedin ?? ""} onChange={(e) => setModValues({ ...modValues, socialLinkedin: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">{t("moderate.twitterLabel")}</span>
              <input className="form-input" maxLength={255} value={modValues.socialTwitter ?? ""} onChange={(e) => setModValues({ ...modValues, socialTwitter: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">{t("moderate.instagramLabel")}</span>
              <input className="form-input" maxLength={255} value={modValues.socialInstagram ?? ""} onChange={(e) => setModValues({ ...modValues, socialInstagram: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">{t("moderate.githubLabel")}</span>
              <input className="form-input" maxLength={255} value={modValues.socialGithub ?? ""} onChange={(e) => setModValues({ ...modValues, socialGithub: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">{t("moderate.websiteLabel")}</span>
              <input className="form-input" maxLength={255} value={modValues.socialWebsite ?? ""} onChange={(e) => setModValues({ ...modValues, socialWebsite: e.currentTarget.value })} />
            </label>

            <label className="form-field">
              <span className="form-label-sm">{t("moderate.musicLabel")}</span>
              <input className="form-input" maxLength={200} value={modValues.favoriteMusic ?? ""} onChange={(e) => setModValues({ ...modValues, favoriteMusic: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">{t("moderate.booksLabel")}</span>
              <input className="form-input" maxLength={200} value={modValues.favoriteBooks ?? ""} onChange={(e) => setModValues({ ...modValues, favoriteBooks: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">{t("moderate.sportsLabel")}</span>
              <input className="form-input" maxLength={200} value={modValues.favoriteSports ?? ""} onChange={(e) => setModValues({ ...modValues, favoriteSports: e.currentTarget.value })} />
            </label>

            <div className="settings-actions">
              <button
                type="button"
                className="button button-accent"
                disabled={isModSaving}
                onClick={() => void handleModSave()}
              >
                {isModSaving ? t("moderate.saving") : t("moderate.save")}
              </button>
            </div>

            {modMessage ? <p className="settings-feedback">{modMessage}</p> : null}
          </div>
        </SlidePanel>
      ) : null}
    </div>
  );
}
