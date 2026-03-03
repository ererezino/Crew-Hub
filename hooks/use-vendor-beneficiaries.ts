"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  VendorBeneficiariesListResponse,
  VendorBeneficiary
} from "../types/vendor-beneficiaries";

type UseVendorBeneficiariesState = {
  vendors: VendorBeneficiary[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

export function useVendorBeneficiaries(): UseVendorBeneficiariesState {
  const [vendors, setVendors] = useState<VendorBeneficiary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchVendors() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch("/api/v1/vendor-beneficiaries");
        const json: VendorBeneficiariesListResponse = await response.json();

        if (cancelled) return;

        if (json.error) {
          setErrorMessage(json.error.message);
          setVendors([]);
        } else if (json.data) {
          setVendors(json.data.vendors);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("Failed to load saved vendors.");
          setVendors([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchVendors();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { vendors, isLoading, errorMessage, refresh };
}
