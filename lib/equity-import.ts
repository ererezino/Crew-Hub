import type { EquityGrantStatus, EquityGrantType } from "../types/compensation";
import { calculateVestingProgress } from "./compensation";

export type ImportedEquityGrant = {
  sourceFileName: string;
  optioneeName: string;
  grantDate: string;
  vestingStartDate: string;
  expirationDate: string;
  grantType: EquityGrantType;
  numberOfShares: number;
  exercisePriceCents: number | null;
  cliffMonths: number;
  vestingDurationMonths: number;
  boardApprovalDate: string;
  status: EquityGrantStatus;
  vestingScheduleSummary: string;
  terminationPeriodMonths: number | null;
};

export type EquityImportProfile = {
  id: string;
  orgId: string;
  fullName: string;
  email: string | null;
};

export type EquityImportProfileMatch = {
  profile: EquityImportProfile;
  score: number;
};

const NAME_STOP_WORDS = new Set(["mrs", "mr", "ms", "dr", "epouse"]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeName(value: string): string {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/-/g, " ")
  );
}

function tokenizeName(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !NAME_STOP_WORDS.has(token));
}

function commonPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function tokenMatches(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  const shorterLength = Math.min(left.length, right.length);

  if (shorterLength >= 4 && (left.includes(right) || right.includes(left))) {
    return true;
  }

  return shorterLength >= 4 && commonPrefixLength(left, right) >= Math.min(5, shorterLength);
}

function scoreNameMatch(importedName: string, profileName: string): number {
  const importedNormalized = normalizeName(importedName);
  const profileNormalized = normalizeName(profileName);

  if (importedNormalized === profileNormalized) {
    return 10;
  }

  const importedTokens = Array.from(new Set(tokenizeName(importedName)));
  const profileTokens = Array.from(new Set(tokenizeName(profileName)));

  if (importedTokens.length === 0 || profileTokens.length === 0) {
    return 0;
  }

  const matchedImportedCount = importedTokens.filter((token) =>
    profileTokens.some((candidate) => tokenMatches(token, candidate))
  ).length;
  const matchedProfileCount = profileTokens.filter((token) =>
    importedTokens.some((candidate) => tokenMatches(token, candidate))
  ).length;

  const importedCoverage = matchedImportedCount / importedTokens.length;
  const profileCoverage = matchedProfileCount / profileTokens.length;
  const sharedCoverage = (importedCoverage + profileCoverage) / 2;
  const firstTokenBonus =
    importedTokens[0] && profileTokens[0] && tokenMatches(importedTokens[0], profileTokens[0]) ? 0.6 : 0;
  const lastTokenBonus =
    importedTokens.at(-1) && profileTokens.at(-1) && tokenMatches(importedTokens.at(-1)!, profileTokens.at(-1)!)
      ? 0.6
      : 0;
  const containmentBonus =
    importedNormalized.includes(profileNormalized) || profileNormalized.includes(importedNormalized) ? 0.4 : 0;

  return sharedCoverage * 5 + firstTokenBonus + lastTokenBonus + containmentBonus;
}

function extractSingleLineField(text: string, label: string): string {
  const pattern = new RegExp(`${label}:\\s*\\n([^\\n]+)`, "i");
  const match = text.match(pattern);

  if (!match?.[1]) {
    throw new Error(`Missing field "${label}" in agreement text.`);
  }

  return normalizeWhitespace(match[1]);
}

function extractScheduleSummary(text: string): string {
  const match = text.match(/Vesting\/Exercise Schedule:\s*([\s\S]*?)\nTermination Period:/i);

  if (!match?.[1]) {
    throw new Error('Missing "Vesting/Exercise Schedule" block in agreement text.');
  }

  return normalizeWhitespace(match[1]);
}

function parseUsLongDate(value: string): string {
  const parsedDate = new Date(`${value} UTC`);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`Unable to parse agreement date "${value}".`);
  }

  return parsedDate.toISOString().slice(0, 10);
}

function parseShareCount(value: string): number {
  const parsedValue = Number.parseFloat(value.replace(/,/g, ""));

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`Unable to parse share count "${value}".`);
  }

  return parsedValue;
}

function parseExercisePriceCents(value: string): number | null {
  const normalizedValue = value.replace(/\$/g, "").trim();
  const parsedValue = Number.parseFloat(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Math.round(parsedValue * 100);
}

function mapGrantType(value: string): EquityGrantType {
  const normalizedValue = normalizeWhitespace(value).toLowerCase();

  if (normalizedValue.includes("nonstatutory")) {
    return "NSO";
  }

  if (normalizedValue.includes("incentive")) {
    return "ISO";
  }

  if (normalizedValue.includes("restricted stock")) {
    return "RSU";
  }

  throw new Error(`Unsupported option type "${value}".`);
}

function deriveGrantStatus(grant: Pick<ImportedEquityGrant, "numberOfShares" | "vestingStartDate" | "cliffMonths" | "vestingDurationMonths">): EquityGrantStatus {
  const vesting = calculateVestingProgress(grant);
  return vesting.isFullyVested ? "vested" : "active";
}

export function parseEsopAgreementText(text: string, sourceFileName: string): ImportedEquityGrant {
  const optioneeNameMatch = text.match(/NOTICE OF STOCK OPTION GRANT\s*\n([^\n]+)/i);

  if (!optioneeNameMatch?.[1]) {
    throw new Error(`Missing optionee name in ${sourceFileName}.`);
  }

  const optioneeName = normalizeWhitespace(optioneeNameMatch[1]);
  const grantDate = parseUsLongDate(extractSingleLineField(text, "Date of Grant"));
  const expirationDate = parseUsLongDate(extractSingleLineField(text, "Expiration Date"));
  const vestingStartDate = parseUsLongDate(extractSingleLineField(text, "Vesting Commencement Date"));
  const grantType = mapGrantType(extractSingleLineField(text, "Type of Option"));
  const numberOfShares = parseShareCount(extractSingleLineField(text, "Total Number of Shares"));
  const exercisePriceCents = parseExercisePriceCents(extractSingleLineField(text, "Exercise Price Per Share"));
  const vestingScheduleSummary = extractScheduleSummary(text);
  const terminationPeriodMatch = text.match(/Termination Period:\s*You may exercise this Option for (\d+) month\(s\)/i);
  const terminationPeriodMonths = terminationPeriodMatch?.[1]
    ? Number.parseInt(terminationPeriodMatch[1], 10)
    : null;

  const parsedGrant: ImportedEquityGrant = {
    sourceFileName,
    optioneeName,
    grantDate,
    vestingStartDate,
    expirationDate,
    grantType,
    numberOfShares,
    exercisePriceCents,
    cliffMonths: 12,
    vestingDurationMonths: 48,
    boardApprovalDate: grantDate,
    status: "active",
    vestingScheduleSummary,
    terminationPeriodMonths
  };

  parsedGrant.status = deriveGrantStatus(parsedGrant);

  return parsedGrant;
}

export function findBestProfileMatch(
  importedName: string,
  profiles: EquityImportProfile[]
): EquityImportProfileMatch | null {
  const rankedMatches = profiles
    .map((profile) => ({
      profile,
      score: scoreNameMatch(importedName, profile.fullName)
    }))
    .sort((left, right) => right.score - left.score);

  const bestMatch = rankedMatches[0];
  const secondBestMatch = rankedMatches[1];

  if (!bestMatch || bestMatch.score < 3.6) {
    return null;
  }

  if (secondBestMatch && bestMatch.score - secondBestMatch.score < 0.35) {
    return null;
  }

  return bestMatch;
}
