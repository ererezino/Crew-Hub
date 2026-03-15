"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";

export type RoutingRule = {
  id: string;
  name: string;
  department: string | null;
  min_amount: number | null;
  max_amount: number | null;
  category: string | null;
  approver_type: "department_owner" | "specific_person";
  approver_id: string | null;
  approver_name: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type RoutingRulesData = {
  rules: RoutingRule[];
};

type RoutingRulesResponse = {
  data?: RoutingRulesData | null;
  error?: { message?: string | null } | null;
};

type MutationResult = { success: boolean; errorMessage: string | null };

type UseExpenseRoutingRulesState = {
  data: RoutingRulesData | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
  createRule: (payload: Record<string, unknown>) => Promise<MutationResult>;
  updateRule: (ruleId: string, payload: Record<string, unknown>) => Promise<MutationResult>;
  deactivateRule: (ruleId: string) => Promise<MutationResult>;
};

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string | null } | null };
    return payload.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
}

export function useExpenseRoutingRules(): UseExpenseRoutingRulesState {
  const [data, setData] = useState<RoutingRulesData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry("/api/v1/expense-routing-rules", abortController.signal);

        const payload = (await response.json()) as RoutingRulesResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load routing rules.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load routing rules.");
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

  const createRule = useCallback(
    async (payload: Record<string, unknown>): Promise<MutationResult> => {
      try {
        const response = await fetch("/api/v1/expense-routing-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          return {
            success: false,
            errorMessage: await parseErrorMessage(response)
          };
        }

        refresh();

        return { success: true, errorMessage: null };
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unable to create routing rule."
        };
      }
    },
    [refresh]
  );

  const updateRule = useCallback(
    async (ruleId: string, payload: Record<string, unknown>): Promise<MutationResult> => {
      try {
        const response = await fetch(`/api/v1/expense-routing-rules/${ruleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          return {
            success: false,
            errorMessage: await parseErrorMessage(response)
          };
        }

        refresh();

        return { success: true, errorMessage: null };
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unable to update routing rule."
        };
      }
    },
    [refresh]
  );

  const deactivateRule = useCallback(
    async (ruleId: string): Promise<MutationResult> => {
      return updateRule(ruleId, { is_active: false });
    },
    [updateRule]
  );

  return {
    data,
    isLoading,
    errorMessage,
    refresh,
    createRule,
    updateRule,
    deactivateRule
  };
}
