"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { SlidePanel } from "../../../components/shared/slide-panel";
import { countryFlagFromCode } from "../../../lib/countries";
import { formatDate } from "../../../lib/datetime";
import type { CrewMember, CrewListResponseData } from "../../../types/people";

/* ── Constants ── */

const DEPT_COLORS: Record<string, { accent: string; light: string }> = {
  marketing: { accent: "#f59e0b", light: "#fffbeb" },
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

  /* ── Search + filter state ── */
  const [search, setSearch] = useState("");
  const [activeDept, setActiveDept] = useState<string | null>(null);

  /* ── Derived: departments list ── */
  const departments = useMemo(() => {
    const deptSet = new Map<string, number>();
    for (const m of members) {
      const d = m.department ?? "Other";
      deptSet.set(d, (deptSet.get(d) ?? 0) + 1);
    }
    // Sort: Founders first (if any), then alphabetical
    return [...deptSet.entries()]
      .sort(([a], [b]) => {
        if (a.toLowerCase() === "founders") return -1;
        if (b.toLowerCase() === "founders") return 1;
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

  /* ── Grouped by department ── */
  const grouped = useMemo(() => {
    const map = new Map<string, CrewMember[]>();
    for (const m of filtered) {
      const d = m.department ?? "Other";
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(m);
    }
    // Maintain same sort as departments chips
    const sorted: [string, CrewMember[]][] = [];
    for (const dept of departments) {
      const group = map.get(dept.name);
      if (group && group.length > 0) sorted.push([dept.name, group]);
    }
    // Add any remaining (shouldn't happen normally)
    for (const [k, v] of map) {
      if (!sorted.some(([name]) => name === k)) sorted.push([k, v]);
    }
    return sorted;
  }, [filtered, departments]);

  /* ── Profile drawer ── */
  const [selectedMember, setSelectedMember] = useState<CrewMember | null>(null);

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
    setModVisible(true); // directory_visible — we don't have it client-side, assume true
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

      setModMessage("Profile updated. The user has been notified.");
      // Refresh data
      void fetchCrew();
    } catch {
      setModMessage("Unable to update.");
    } finally {
      setIsModSaving(false);
    }
  }, [moderatingMember, modValues, modVisible, fetchCrew]);

  /* ── Collapsed department state ── */
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const toggleDept = (dept: string) => {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  /* ── Render ── */

  return (
    <div className="crew-page">
      {/* ── Hero ── */}
      <div className="crew-hero">
        <p className="crew-hero-subtitle">
          Get to know the people behind the work — their stories, interests, and what makes the team special.
        </p>
        <div className="crew-hero-stats">
          <span>{totalCount} crew member{totalCount !== 1 ? "s" : ""}</span>
          <span className="crew-hero-dot">·</span>
          <span>{departments.length} department{departments.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="crew-search-bar">
        <input
          type="text"
          className="form-input crew-search-input"
          placeholder="Search by name, title, or department..."
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </div>

      {/* ── Department filter chips ── */}
      <div className="crew-chips">
        <button
          type="button"
          className={`crew-chip ${activeDept === null ? "crew-chip-active" : ""}`}
          onClick={() => setActiveDept(null)}
        >
          All
        </button>
        {departments.map((dept) => (
          <button
            key={dept.name}
            type="button"
            className={`crew-chip ${activeDept === dept.name ? "crew-chip-active" : ""}`}
            style={activeDept === dept.name ? { backgroundColor: getDeptColor(dept.name).accent, color: "#fff", borderColor: getDeptColor(dept.name).accent } : undefined}
            onClick={() => setActiveDept(activeDept === dept.name ? null : dept.name)}
          >
            {dept.name} ({dept.count})
          </button>
        ))}
      </div>

      {/* ── Loading / Error / Empty ── */}
      {isLoading ? (
        <div className="crew-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="crew-card crew-card-skeleton">
              <div className="crew-avatar-skeleton" />
              <div className="crew-text-skeleton" style={{ width: "70%" }} />
              <div className="crew-text-skeleton" style={{ width: "50%" }} />
              <div className="crew-text-skeleton" style={{ width: "40%" }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="crew-empty">
          <p>{error}</p>
          <button type="button" className="button" onClick={() => void fetchCrew()}>Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="crew-empty">
          <p>No crew members match your search.</p>
        </div>
      ) : (
        /* ── Department sections ── */
        <div className="crew-sections">
          {grouped.map(([deptName, deptMembers]) => {
            const color = getDeptColor(deptName);
            const isCollapsed = collapsedDepts.has(deptName);
            return (
              <section key={deptName} className="crew-dept-section">
                <button
                  type="button"
                  className="crew-dept-header"
                  onClick={() => toggleDept(deptName)}
                  aria-expanded={!isCollapsed}
                >
                  <span className="crew-dept-bar" style={{ backgroundColor: color.accent }} />
                  <span className="crew-dept-name">{deptName}</span>
                  <span className="crew-dept-count">{deptMembers.length} member{deptMembers.length !== 1 ? "s" : ""}</span>
                  <span className={`crew-dept-chevron ${isCollapsed ? "crew-dept-chevron-collapsed" : ""}`}>▾</span>
                </button>

                {!isCollapsed ? (
                  <div className="crew-grid">
                    {deptMembers.map((member) => {
                      const socials = getSocials(member);
                      return (
                        <article
                          key={member.id}
                          className="crew-card"
                          onClick={() => setSelectedMember(member)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedMember(member); } }}
                        >
                          {/* Admin moderate icon */}
                          {isAdmin ? (
                            <button
                              type="button"
                              className="crew-card-moderate"
                              title="Moderate profile"
                              onClick={(e) => { e.stopPropagation(); openModeration(member); }}
                            >
                              ⚙
                            </button>
                          ) : null}

                          {/* Avatar */}
                          <div className="crew-avatar-wrap">
                            {member.avatarUrl ? (
                              <Image
                                src={member.avatarUrl}
                                alt={member.fullName}
                                width={400}
                                height={300}
                                className="crew-avatar-img"
                                unoptimized
                              />
                            ) : (
                              <span
                                className="crew-avatar-fallback"
                                style={{ background: `linear-gradient(135deg, ${color.accent}, ${color.accent}dd)` }}
                              >
                                {getInitials(member.fullName)}
                              </span>
                            )}
                          </div>

                          {/* Info */}
                          <div className="crew-card-body">
                            <h3 className="crew-card-name">{member.fullName}</h3>
                            {member.title ? <p className="crew-card-title">{member.title}</p> : null}
                            <p className="crew-card-meta">
                              {member.countryCode ? <span>{countryFlagFromCode(member.countryCode)}</span> : null}
                              {member.pronouns ? <span className="crew-card-pronouns">{member.pronouns}</span> : null}
                            </p>
                            {member.bio ? (
                              <p className="crew-card-bio">{member.bio}</p>
                            ) : null}
                            {socials.length > 0 ? (
                              <div className="crew-social-row">
                                {socials.map((s) => (
                                  <a
                                    key={s.key}
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="crew-social-icon"
                                    title={s.label}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {s.icon}
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {/* ── Profile Drawer (read-only) ── */}
      {selectedMember ? (
        <SlidePanel
          isOpen={!!selectedMember}
          title={selectedMember.fullName}
          onClose={() => setSelectedMember(null)}
        >
          <div className="crew-drawer">
            {/* Photo */}
            <div className="crew-drawer-photo">
              {selectedMember.avatarUrl ? (
                <Image
                  src={selectedMember.avatarUrl}
                  alt={selectedMember.fullName}
                  width={600}
                  height={450}
                  className="crew-drawer-img"
                  unoptimized
                />
              ) : (
                <span
                  className="crew-drawer-fallback"
                  style={{ background: `linear-gradient(135deg, ${getDeptColor(selectedMember.department).accent}, ${getDeptColor(selectedMember.department).accent}dd)` }}
                >
                  {getInitials(selectedMember.fullName)}
                </span>
              )}
            </div>

            {/* Identity */}
            <div className="crew-drawer-identity">
              <h2 className="crew-drawer-name">{selectedMember.fullName}</h2>
              <p className="crew-drawer-role">
                {selectedMember.title ?? "Team member"}
                {selectedMember.department ? ` · ${selectedMember.department}` : ""}
              </p>
              <p className="crew-drawer-meta">
                {selectedMember.countryCode ? `${countryFlagFromCode(selectedMember.countryCode)} ` : ""}
                {selectedMember.pronouns ? `${selectedMember.pronouns} · ` : ""}
                {selectedMember.startDate ? `Joined ${formatDate(selectedMember.startDate)}` : ""}
              </p>
            </div>

            {/* Bio */}
            {selectedMember.bio ? (
              <div className="crew-drawer-section">
                <h3 className="crew-drawer-section-title">Bio</h3>
                <p className="crew-drawer-bio">{selectedMember.bio}</p>
              </div>
            ) : null}

            {/* Favorites */}
            {(selectedMember.favoriteMusic || selectedMember.favoriteBooks || selectedMember.favoriteSports) ? (
              <div className="crew-drawer-section">
                <h3 className="crew-drawer-section-title">Favorites</h3>
                <div className="crew-drawer-favorites">
                  {selectedMember.favoriteMusic ? <p>🎵 {selectedMember.favoriteMusic}</p> : null}
                  {selectedMember.favoriteBooks ? <p>📚 {selectedMember.favoriteBooks}</p> : null}
                  {selectedMember.favoriteSports ? <p>⚽ {selectedMember.favoriteSports}</p> : null}
                </div>
              </div>
            ) : null}

            {/* Social */}
            {getSocials(selectedMember).length > 0 ? (
              <div className="crew-drawer-section">
                <h3 className="crew-drawer-section-title">Connect</h3>
                <div className="crew-drawer-socials">
                  {getSocials(selectedMember).map((s) => (
                    <a
                      key={s.key}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="crew-drawer-social-link"
                    >
                      <span className="crew-social-icon">{s.icon}</span>
                      {s.label}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Edit my profile (own card only) */}
            {selectedMember.id === currentUserId ? (
              <div className="crew-drawer-section crew-drawer-edit">
                <Link href="/settings" className="button button-accent">
                  Edit my profile
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
          title={`Moderate: ${moderatingMember.fullName}`}
          onClose={() => setModeratingMember(null)}
        >
          <div className="crew-mod-drawer">
            <p className="crew-mod-notice">
              Changes are logged and the user will be notified.
            </p>

            {/* Visibility toggle */}
            <label className="crew-mod-toggle">
              <input
                type="checkbox"
                checked={modVisible}
                onChange={(e) => setModVisible(e.currentTarget.checked)}
              />
              <span>Visible on The Crew</span>
            </label>

            {/* Editable fields */}
            <label className="form-field">
              <span className="form-label-sm">Bio</span>
              <textarea
                className="form-input"
                rows={3}
                maxLength={500}
                value={modValues.bio ?? ""}
                onChange={(e) => setModValues({ ...modValues, bio: e.currentTarget.value })}
              />
            </label>

            <label className="form-field">
              <span className="form-label-sm">LinkedIn</span>
              <input className="form-input" maxLength={255} value={modValues.socialLinkedin ?? ""} onChange={(e) => setModValues({ ...modValues, socialLinkedin: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">Twitter / X</span>
              <input className="form-input" maxLength={255} value={modValues.socialTwitter ?? ""} onChange={(e) => setModValues({ ...modValues, socialTwitter: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">Instagram</span>
              <input className="form-input" maxLength={255} value={modValues.socialInstagram ?? ""} onChange={(e) => setModValues({ ...modValues, socialInstagram: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">GitHub</span>
              <input className="form-input" maxLength={255} value={modValues.socialGithub ?? ""} onChange={(e) => setModValues({ ...modValues, socialGithub: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">Website</span>
              <input className="form-input" maxLength={255} value={modValues.socialWebsite ?? ""} onChange={(e) => setModValues({ ...modValues, socialWebsite: e.currentTarget.value })} />
            </label>

            <label className="form-field">
              <span className="form-label-sm">Favorite Music</span>
              <input className="form-input" maxLength={200} value={modValues.favoriteMusic ?? ""} onChange={(e) => setModValues({ ...modValues, favoriteMusic: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">Favorite Books</span>
              <input className="form-input" maxLength={200} value={modValues.favoriteBooks ?? ""} onChange={(e) => setModValues({ ...modValues, favoriteBooks: e.currentTarget.value })} />
            </label>
            <label className="form-field">
              <span className="form-label-sm">Favorite Sports</span>
              <input className="form-input" maxLength={200} value={modValues.favoriteSports ?? ""} onChange={(e) => setModValues({ ...modValues, favoriteSports: e.currentTarget.value })} />
            </label>

            <div className="settings-actions">
              <button
                type="button"
                className="button button-accent"
                disabled={isModSaving}
                onClick={() => void handleModSave()}
              >
                {isModSaving ? "Saving..." : "Save changes"}
              </button>
            </div>

            {modMessage ? <p className="settings-feedback">{modMessage}</p> : null}
          </div>
        </SlidePanel>
      ) : null}
    </div>
  );
}
