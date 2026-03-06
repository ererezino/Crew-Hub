"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "../components/shared/confirm-dialog";

type ConfirmTone = "default" | "danger";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type PendingConfirm = ConfirmOptions;

type ConfirmResolver = (value: boolean) => void;

export function useConfirmAction() {
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const resolverRef = useRef<ConfirmResolver | null>(null);

  const resolveAndReset = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setPendingConfirm(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPendingConfirm(options);
    });
  }, []);

  const handleCancel = useCallback(() => {
    resolveAndReset(false);
  }, [resolveAndReset]);

  const handleConfirm = useCallback(() => {
    resolveAndReset(true);
  }, [resolveAndReset]);

  const confirmDialog = useMemo(
    () => (
      <ConfirmDialog
        isOpen={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? "Confirm action"}
        description={pendingConfirm?.description}
        confirmLabel={pendingConfirm?.confirmLabel}
        cancelLabel={pendingConfirm?.cancelLabel}
        tone={pendingConfirm?.tone}
        isConfirming={false}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    ),
    [handleCancel, handleConfirm, pendingConfirm]
  );

  return {
    confirm,
    confirmDialog
  };
}
