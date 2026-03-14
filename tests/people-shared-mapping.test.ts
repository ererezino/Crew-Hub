import { describe, expect, it } from "vitest";

import {
  buildMeta,
  deriveAccessStatus,
  mapProfileRow,
  normalizeRoles,
  profileRowSchema,
  type ProfileRow
} from "../lib/people/shared";

/**
 * Regression tests for the shared People helpers extracted in W2.1.
 *
 * These verify that `profileRowSchema` and `mapProfileRow` produce identical
 * output regardless of whether the input data comes from the list route's
 * SELECT (which includes social fields but omits date_of_birth and
 * notice_period_end_date) or the detail route's SELECT (which includes
 * date_of_birth and notice_period_end_date but omits social fields).
 */

// ── Fixtures ──

/** Simulates a row returned by the list route's SELECT (has social, no dob/notice). */
const LIST_ROUTE_ROW = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "alice@test.com",
  full_name: "Alice Smith",
  roles: ["EMPLOYEE", "MANAGER"],
  department: "Engineering",
  title: "Staff Engineer",
  country_code: "US",
  timezone: "America/New_York",
  phone: "+15551234567",
  start_date: "2024-06-01",
  // date_of_birth: absent
  // notice_period_end_date: absent
  manager_id: "b0000000-0000-4000-8000-000000000002",
  employment_type: "full_time" as const,
  payroll_mode: "employee_usd_withholding" as const,
  primary_currency: "USD",
  status: "active" as const,
  avatar_url: "https://example.com/avatar.jpg",
  directory_visible: true,
  schedule_type: "standard",
  weekend_shift_hours: null,
  bio: "Hello world",
  pronouns: "she/her",
  emergency_contact_name: "Bob Smith",
  emergency_contact_phone: "+15559876543",
  emergency_contact_relationship: "Spouse",
  favorite_music: "Jazz",
  favorite_books: "Sci-fi",
  favorite_sports: "Tennis",
  privacy_settings: { showEmail: true, showPhone: false },
  social_linkedin: "https://linkedin.com/in/alice",
  social_twitter: "@alice",
  social_instagram: null,
  social_github: "alice-gh",
  social_website: null,
  crew_hub_joined_at: "2024-06-15T10:00:00Z",
  first_invited_at: "2024-06-01T08:00:00Z",
  account_setup_at: "2024-06-15T10:00:00Z",
  last_seen_at: "2024-07-01T12:00:00Z",
  created_at: "2024-06-01T00:00:00Z",
  updated_at: "2024-07-01T00:00:00Z"
};

/** Simulates a row returned by the detail route's SELECT (has dob/notice, no social). */
const DETAIL_ROUTE_ROW = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "alice@test.com",
  full_name: "Alice Smith",
  roles: ["EMPLOYEE", "MANAGER"],
  department: "Engineering",
  title: "Staff Engineer",
  country_code: "US",
  timezone: "America/New_York",
  phone: "+15551234567",
  start_date: "2024-06-01",
  date_of_birth: "1990-03-25",
  manager_id: "b0000000-0000-4000-8000-000000000002",
  employment_type: "full_time" as const,
  payroll_mode: "employee_usd_withholding" as const,
  primary_currency: "USD",
  status: "active" as const,
  notice_period_end_date: "2025-01-31",
  avatar_url: "https://example.com/avatar.jpg",
  directory_visible: true,
  // schedule_type: absent (optional in detail route)
  // weekend_shift_hours: absent
  bio: "Hello world",
  pronouns: "she/her",
  emergency_contact_name: "Bob Smith",
  emergency_contact_phone: "+15559876543",
  emergency_contact_relationship: "Spouse",
  favorite_music: "Jazz",
  favorite_books: "Sci-fi",
  favorite_sports: "Tennis",
  privacy_settings: { showEmail: true, showPhone: false },
  // social_*: absent
  crew_hub_joined_at: "2024-06-15T10:00:00Z",
  first_invited_at: "2024-06-01T08:00:00Z",
  account_setup_at: "2024-06-15T10:00:00Z",
  last_seen_at: "2024-07-01T12:00:00Z",
  created_at: "2024-06-01T00:00:00Z",
  updated_at: "2024-07-01T00:00:00Z"
};

const MANAGER_NAMES = new Map([
  ["b0000000-0000-4000-8000-000000000002", "Bob Manager"]
]);

// ── Schema parsing tests ──

describe("profileRowSchema (W2.1)", () => {
  it("parses list-route shaped data (social present, dob/notice absent)", () => {
    const result = profileRowSchema.safeParse(LIST_ROUTE_ROW);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date_of_birth).toBeNull();
      expect(result.data.notice_period_end_date).toBeNull();
      expect(result.data.social_linkedin).toBe("https://linkedin.com/in/alice");
      expect(result.data.social_github).toBe("alice-gh");
    }
  });

  it("parses detail-route shaped data (dob/notice present, social absent)", () => {
    const result = profileRowSchema.safeParse(DETAIL_ROUTE_ROW);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date_of_birth).toBe("1990-03-25");
      expect(result.data.notice_period_end_date).toBe("2025-01-31");
      expect(result.data.social_linkedin).toBeNull();
      expect(result.data.social_twitter).toBeNull();
    }
  });

  it("parses a minimal row with all optional fields absent", () => {
    const minimal = {
      id: "a0000000-0000-4000-8000-000000000001",
      email: "min@test.com",
      full_name: "Min User",
      roles: ["EMPLOYEE"],
      department: null,
      title: null,
      country_code: null,
      timezone: null,
      phone: null,
      start_date: null,
      manager_id: null,
      employment_type: "contractor",
      payroll_mode: "contractor_usd_no_withholding",
      primary_currency: "USD",
      status: "active",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z"
    };

    const result = profileRowSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      // All optional fields defaulted to null
      expect(result.data.date_of_birth).toBeNull();
      expect(result.data.notice_period_end_date).toBeNull();
      expect(result.data.social_linkedin).toBeNull();
      expect(result.data.avatar_url).toBeNull();
      expect(result.data.bio).toBeNull();
      expect(result.data.schedule_type).toBeNull();
      expect(result.data.privacy_settings).toBeNull();
      expect(result.data.directory_visible).toBe(true);
    }
  });
});

// ── Mapper tests ──

describe("mapProfileRow (W2.1)", () => {
  it("maps list-route data to PersonRecord with correct field values", () => {
    const parsed = profileRowSchema.parse(LIST_ROUTE_ROW);
    const person = mapProfileRow(parsed, MANAGER_NAMES, null);

    expect(person.id).toBe(LIST_ROUTE_ROW.id);
    expect(person.email).toBe("alice@test.com");
    expect(person.fullName).toBe("Alice Smith");
    expect(person.roles).toEqual(["EMPLOYEE", "MANAGER"]);
    expect(person.managerName).toBe("Bob Manager");
    expect(person.dateOfBirth).toBeNull();
    expect(person.noticePeriodEndDate).toBeNull();
    expect(person.socialLinkedin).toBe("https://linkedin.com/in/alice");
    expect(person.socialGithub).toBe("alice-gh");
    expect(person.crewTag).toBeNull();
    expect(person.inviteStatus).toBe("signed_in");
    expect(person.privacySettings).toEqual({ showEmail: true, showPhone: false });
  });

  it("maps detail-route data to PersonRecord with correct field values", () => {
    const parsed = profileRowSchema.parse(DETAIL_ROUTE_ROW);
    const person = mapProfileRow(parsed, MANAGER_NAMES, "CT-001");

    expect(person.dateOfBirth).toBe("1990-03-25");
    expect(person.noticePeriodEndDate).toBe("2025-01-31");
    expect(person.socialLinkedin).toBeNull();
    expect(person.socialTwitter).toBeNull();
    expect(person.crewTag).toBe("CT-001");
    expect(person.inviteStatus).toBe("signed_in");
  });

  it("resolves managerName as null when manager_id is not in map", () => {
    const parsed = profileRowSchema.parse(LIST_ROUTE_ROW);
    const person = mapProfileRow(parsed, new Map(), null);

    expect(person.managerId).toBe("b0000000-0000-4000-8000-000000000002");
    expect(person.managerName).toBeNull();
  });

  it("resolves managerName as null when manager_id is null", () => {
    const row = { ...LIST_ROUTE_ROW, manager_id: null };
    const parsed = profileRowSchema.parse(row);
    const person = mapProfileRow(parsed, MANAGER_NAMES, null);

    expect(person.managerId).toBeNull();
    expect(person.managerName).toBeNull();
  });

  it("normalizes invalid privacy_settings to empty object", () => {
    const row = { ...LIST_ROUTE_ROW, privacy_settings: "invalid" };
    const parsed = profileRowSchema.parse(row);
    const person = mapProfileRow(parsed, MANAGER_NAMES, null);

    expect(person.privacySettings).toEqual({});
  });

  it("normalizes null privacy_settings to empty object", () => {
    const row = { ...LIST_ROUTE_ROW, privacy_settings: null };
    const parsed = profileRowSchema.parse(row);
    const person = mapProfileRow(parsed, MANAGER_NAMES, null);

    expect(person.privacySettings).toEqual({});
  });

  it("filters out invalid roles from the roles array", () => {
    const row = { ...LIST_ROUTE_ROW, roles: ["EMPLOYEE", "FAKE_ROLE", "MANAGER"] };
    const parsed = profileRowSchema.parse(row);
    const person = mapProfileRow(parsed, MANAGER_NAMES, null);

    expect(person.roles).toEqual(["EMPLOYEE", "MANAGER"]);
  });
});

// ── deriveAccessStatus tests ──

describe("deriveAccessStatus (W2.1)", () => {
  it("returns signed_in when crewHubJoinedAt is set", () => {
    expect(deriveAccessStatus("2024-06-15T10:00:00Z", "2024-06-01T08:00:00Z"))
      .toBe("signed_in");
  });

  it("returns invited when only firstInvitedAt is set", () => {
    expect(deriveAccessStatus(null, "2024-06-01T08:00:00Z"))
      .toBe("invited");
  });

  it("returns not_invited when both are null", () => {
    expect(deriveAccessStatus(null, null))
      .toBe("not_invited");
  });

  it("returns signed_in even when firstInvitedAt is null (edge case)", () => {
    expect(deriveAccessStatus("2024-06-15T10:00:00Z", null))
      .toBe("signed_in");
  });
});

// ── normalizeRoles tests ──

describe("normalizeRoles (W2.1)", () => {
  it("filters valid roles from mixed input", () => {
    expect(normalizeRoles(["EMPLOYEE", "bogus", "SUPER_ADMIN"]))
      .toEqual(["EMPLOYEE", "SUPER_ADMIN"]);
  });

  it("returns empty array for all-invalid input", () => {
    expect(normalizeRoles(["admin", "user"])).toEqual([]);
  });
});

// ── buildMeta tests ──

describe("buildMeta (W2.1)", () => {
  it("returns an object with a valid ISO timestamp", () => {
    const meta = buildMeta();
    expect(meta).toHaveProperty("timestamp");
    expect(new Date(meta.timestamp).toISOString()).toBe(meta.timestamp);
  });
});

// ── Output shape equivalence ──

describe("list vs detail route output equivalence (W2.1)", () => {
  it("both shapes produce PersonRecord with all required keys", () => {
    const listParsed = profileRowSchema.parse(LIST_ROUTE_ROW);
    const detailParsed = profileRowSchema.parse(DETAIL_ROUTE_ROW);

    const listPerson = mapProfileRow(listParsed, MANAGER_NAMES, null);
    const detailPerson = mapProfileRow(detailParsed, MANAGER_NAMES, "CT-001");

    const requiredKeys: (keyof typeof listPerson)[] = [
      "id", "email", "fullName", "roles", "department", "title",
      "countryCode", "timezone", "phone", "startDate", "dateOfBirth",
      "managerId", "managerName", "employmentType", "payrollMode",
      "primaryCurrency", "status", "noticePeriodEndDate", "avatarUrl",
      "bio", "favoriteMusic", "favoriteBooks", "favoriteSports",
      "emergencyContactName", "emergencyContactPhone",
      "emergencyContactRelationship", "pronouns", "socialLinkedin",
      "socialTwitter", "socialInstagram", "socialGithub", "socialWebsite",
      "directoryVisible", "privacySettings", "scheduleType",
      "weekendShiftHours", "crewTag", "inviteStatus",
      "crewHubJoinedAt", "firstInvitedAt", "accountSetupAt",
      "lastSeenAt", "createdAt", "updatedAt"
    ];

    for (const key of requiredKeys) {
      expect(listPerson).toHaveProperty(key);
      expect(detailPerson).toHaveProperty(key);
    }
  });

  it("shared fields have identical values across both shapes", () => {
    const listParsed = profileRowSchema.parse(LIST_ROUTE_ROW);
    const detailParsed = profileRowSchema.parse(DETAIL_ROUTE_ROW);

    const listPerson = mapProfileRow(listParsed, MANAGER_NAMES, null);
    const detailPerson = mapProfileRow(detailParsed, MANAGER_NAMES, null);

    // Fields that are present in both SELECTs should produce identical values
    expect(listPerson.id).toBe(detailPerson.id);
    expect(listPerson.email).toBe(detailPerson.email);
    expect(listPerson.fullName).toBe(detailPerson.fullName);
    expect(listPerson.roles).toEqual(detailPerson.roles);
    expect(listPerson.department).toBe(detailPerson.department);
    expect(listPerson.status).toBe(detailPerson.status);
    expect(listPerson.inviteStatus).toBe(detailPerson.inviteStatus);
    expect(listPerson.managerName).toBe(detailPerson.managerName);
    expect(listPerson.privacySettings).toEqual(detailPerson.privacySettings);
  });
});
