import type { CountryPayrollEngine } from "../../../types/payroll";
import { nigeriaEngine } from "./nigeria";

const COUNTRY_ENGINE_REGISTRY: Readonly<Record<string, CountryPayrollEngine>> = {
  NG: nigeriaEngine
};

export function getCountryEngine(countryCode: string | null | undefined): CountryPayrollEngine | null {
  if (!countryCode) {
    return null;
  }

  const normalizedCountryCode = countryCode.trim().toUpperCase();

  if (!normalizedCountryCode) {
    return null;
  }

  return COUNTRY_ENGINE_REGISTRY[normalizedCountryCode] ?? null;
}

export function listRegisteredCountryEngines(): string[] {
  return Object.keys(COUNTRY_ENGINE_REGISTRY);
}
