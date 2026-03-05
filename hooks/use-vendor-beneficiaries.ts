"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
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
    const abortController = new AbortController();

    async function fetchVendors() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry("/api/v1/vendor-beneficiaries", abortController.signal);
        const json: VendorBeneficiariesListResponse = await response.json();

        if (abortController.signal.aborted) return;

        if (json.error) {
          setErrorMessage(json.error.message);
          setVendors([]);
        } else if (json.data) {
          setVendors(json.data.vendors);
        }
      } catch {
        if (!abortController.signal.aborted) {
          setErrorMessage("Failed to load saved vendors.");
          setVendors([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    fetchVendors();

    return () => {
      abortController.abort();
    };
  }, [refreshKey]);

  return { vendors, isLoading, errorMessage, refresh };
}
