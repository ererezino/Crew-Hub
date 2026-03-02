"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  BenchmarkCreateResponse,
  CompensationBandAssignmentCreateResponse,
  CompensationBandCreateResponse,
  CompensationBandsResponse,
  CompensationBandsResponseData
} from "../types/compensation-bands";

type UseCompensationBandsState = {
  data: CompensationBandsResponseData | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
  createBand: (payload: Record<string, unknown>) => Promise<{ success: boolean; errorMessage: string | null }>;
  createBenchmark: (
    payload: Record<string, unknown>
  ) => Promise<{ success: boolean; errorMessage: string | null }>;
  createAssignment: (
    payload: Record<string, unknown>
  ) => Promise<{ success: boolean; errorMessage: string | null }>;
  updateBand: (
    bandId: string,
    payload: Record<string, unknown>
  ) => Promise<{ success: boolean; errorMessage: string | null }>;
};

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string | null } | null };
    return payload.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
}

async function postJson<TResponse>(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<{ success: boolean; errorMessage: string | null; data: TResponse | null }> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const json = (await response.json()) as { data?: TResponse | null; error?: { message?: string | null } | null };

    if (!response.ok || !json.data) {
      return {
        success: false,
        errorMessage: json.error?.message ?? "Request failed.",
        data: null
      };
    }

    return {
      success: true,
      errorMessage: null,
      data: json.data
    };
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : "Request failed.",
      data: null
    };
  }
}

export function useCompensationBands(): UseCompensationBandsState {
  const [data, setData] = useState<CompensationBandsResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch("/api/v1/compensation/admin/bands", {
          method: "GET",
          signal: abortController.signal
        });

        const payload = (await response.json()) as CompensationBandsResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load compensation bands.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load compensation bands.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      abortController.abort();
    };
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  const createBand = useCallback(
    async (payload: Record<string, unknown>) => {
      const result = await postJson<CompensationBandCreateResponse["data"]>(
        "/api/v1/compensation/admin/bands",
        {
          ...payload,
          type: "band"
        }
      );

      if (result.success) {
        refresh();
      }

      return {
        success: result.success,
        errorMessage: result.errorMessage
      };
    },
    [refresh]
  );

  const createBenchmark = useCallback(
    async (payload: Record<string, unknown>) => {
      const result = await postJson<BenchmarkCreateResponse["data"]>(
        "/api/v1/compensation/admin/bands",
        {
          ...payload,
          type: "benchmark"
        }
      );

      if (result.success) {
        refresh();
      }

      return {
        success: result.success,
        errorMessage: result.errorMessage
      };
    },
    [refresh]
  );

  const createAssignment = useCallback(
    async (payload: Record<string, unknown>) => {
      const result = await postJson<CompensationBandAssignmentCreateResponse["data"]>(
        "/api/v1/compensation/admin/bands",
        {
          ...payload,
          type: "assignment"
        }
      );

      if (result.success) {
        refresh();
      }

      return {
        success: result.success,
        errorMessage: result.errorMessage
      };
    },
    [refresh]
  );

  const updateBand = useCallback(
    async (bandId: string, payload: Record<string, unknown>) => {
      try {
        const response = await fetch(`/api/v1/compensation/admin/bands/${bandId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          return {
            success: false,
            errorMessage: await parseErrorMessage(response)
          };
        }

        refresh();

        return {
          success: true,
          errorMessage: null
        };
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unable to update compensation band."
        };
      }
    },
    [refresh]
  );

  return {
    data,
    isLoading,
    errorMessage,
    refresh,
    createBand,
    createBenchmark,
    createAssignment,
    updateBand
  };
}
