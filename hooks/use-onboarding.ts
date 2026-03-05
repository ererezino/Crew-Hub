"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  AtRiskInstance,
  AtRiskOnboardingsResponse,
  OnboardingInstanceDetailResponse,
  OnboardingInstanceDetailResponseData,
  OnboardingInstanceSummary,
  OnboardingInstanceStatus,
  OnboardingInstancesResponse,
  OnboardingTemplate,
  OnboardingTemplatesResponse,
  OnboardingType
} from "../types/onboarding";

type InstancesScope = "all" | "me" | "reports";

type UseOnboardingInstancesOptions = {
  scope?: InstancesScope;
  status?: OnboardingInstanceStatus;
  type?: OnboardingType;
};

type UseOnboardingInstancesResult = {
  instances: OnboardingInstanceSummary[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

type UseOnboardingTemplatesResult = {
  templates: OnboardingTemplate[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

type UseOnboardingInstanceDetailResult = {
  detail: OnboardingInstanceDetailResponseData | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

function buildInstancesUrl({
  scope = "all",
  status,
  type
}: UseOnboardingInstancesOptions): string {
  const params = new URLSearchParams({
    scope
  });

  if (status) {
    params.set("status", status);
  }

  if (type) {
    params.set("type", type);
  }

  return `/api/v1/onboarding/instances?${params.toString()}`;
}

function buildTemplatesUrl(type?: OnboardingType): string {
  if (!type) {
    return "/api/v1/onboarding/templates";
  }

  const params = new URLSearchParams({
    type
  });

  return `/api/v1/onboarding/templates?${params.toString()}`;
}

export function useOnboardingInstances(
  options: UseOnboardingInstancesOptions = {}
): UseOnboardingInstancesResult {
  const scope = options.scope ?? "all";
  const status = options.status;
  const type = options.type;

  const [instances, setInstances] = useState<
    OnboardingInstanceSummary[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildInstancesUrl({
        scope,
        status,
        type
      }),
    [scope, status, type]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const fetchInstances = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as OnboardingInstancesResponse;

        if (!response.ok || !payload.data) {
          setInstances([]);
          setErrorMessage(payload.error?.message ?? "Unable to load onboarding instances.");
          return;
        }

        setInstances(payload.data.instances);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setInstances([]);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load onboarding instances."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchInstances();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    instances,
    isLoading,
    errorMessage,
    refresh
  };
}

export function useOnboardingTemplates(type?: OnboardingType): UseOnboardingTemplatesResult {
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(() => buildTemplatesUrl(type), [type]);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchTemplates = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as OnboardingTemplatesResponse;

        if (!response.ok || !payload.data) {
          setTemplates([]);
          setErrorMessage(payload.error?.message ?? "Unable to load onboarding templates.");
          return;
        }

        setTemplates(payload.data.templates);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setTemplates([]);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load onboarding templates."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchTemplates();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    templates,
    isLoading,
    errorMessage,
    refresh
  };
}

export function useOnboardingInstanceDetail(
  instanceId: string | null
): UseOnboardingInstanceDetailResult {
  const [detail, setDetail] = useState<OnboardingInstanceDetailResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () => (instanceId ? `/api/v1/onboarding/instances/${instanceId}` : null),
    [instanceId]
  );

  useEffect(() => {
    if (!endpoint) {
      setDetail(null);
      setIsLoading(false);
      setErrorMessage("Onboarding instance id is required.");
      return;
    }

    const abortController = new AbortController();

    const fetchInstance = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as OnboardingInstanceDetailResponse;

        if (!response.ok || !payload.data) {
          setDetail(null);
          setErrorMessage(payload.error?.message ?? "Unable to load onboarding instance.");
          return;
        }

        setDetail(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setDetail(null);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load onboarding instance."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchInstance();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    detail,
    isLoading,
    errorMessage,
    refresh
  };
}

type UseAtRiskOnboardingsResult = {
  instances: AtRiskInstance[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

export function useAtRiskOnboardings(): UseAtRiskOnboardingsResult {
  const [instances, setInstances] = useState<AtRiskInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchAtRisk = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(
          "/api/v1/onboarding/at-risk",
          abortController.signal
        );

        const payload = (await response.json()) as AtRiskOnboardingsResponse;

        if (!response.ok || !payload.data) {
          setInstances([]);
          setErrorMessage(payload.error?.message ?? "Unable to load at-risk onboarding data.");
          return;
        }

        setInstances(payload.data.instances);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setInstances([]);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load at-risk onboarding data."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchAtRisk();

    return () => {
      abortController.abort();
    };
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    instances,
    isLoading,
    errorMessage,
    refresh
  };
}
