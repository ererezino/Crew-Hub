import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidate every React Query surface that renders approval/expense state.
 *
 * Approval decisions are visible in many places at once: the approvals queue
 * itself (all stages, not just the one acted on), the tab badges, the sidebar
 * count, the dashboard "Pending decisions" widget, the expenses list/reports,
 * and the time-off summary/calendar. Refreshing only the acted-on list leaves
 * the other surfaces serving already-decided items from a still-fresh cache
 * (staleTime 90s–5min with refetchOnWindowFocus disabled), so approvers see
 * ghosts: rows they just approved still pending elsewhere, or frozen badges.
 *
 * invalidateQueries marks matching caches stale everywhere and actively
 * refetches only the currently mounted ones — cheap to call broadly.
 */
export function invalidateApprovalSurfaces(queryClient: QueryClient): Promise<void> {
  const prefixes: readonly (readonly string[])[] = [
    ["approvals-tab-counts"],
    ["sidebar-approvals-count"],
    ["expense-approvals"],
    ["time-off-approvals"],
    ["dashboard"],
    ["expenses"],
    ["expense-reports"],
    ["time-off-summary"],
    ["time-off-calendar"]
  ];

  return Promise.all(
    prefixes.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] }))
  ).then(() => undefined);
}
