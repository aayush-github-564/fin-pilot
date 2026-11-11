import { useQuery } from "@tanstack/react-query";

import { getBudgetVsActual, getCashFlowMetrics, type BudgetVsActualQuery, type CashFlowQuery } from "./api";

export const cashFlowQueryKey = (companyId: string, query: CashFlowQuery) =>
  ["company", companyId, "metrics", "cash-flow", query] as const;

export const budgetVsActualQueryKey = (
  companyId: string,
  query: BudgetVsActualQuery,
) => ["company", companyId, "metrics", "budget-vs-actual", query.period] as const;

export function useCashFlowMetrics(companyId: string, query: CashFlowQuery) {
  return useQuery({
    queryKey: cashFlowQueryKey(companyId, query),
    queryFn: () => getCashFlowMetrics(companyId, query),
    enabled: Boolean(companyId),
  });
}

export function useBudgetVsActual(companyId: string, period: string) {
  const query = { period };
  return useQuery({
    queryKey: budgetVsActualQueryKey(companyId, query),
    queryFn: () => getBudgetVsActual(companyId, query),
    enabled: Boolean(companyId && period),
  });
}
