import { useQuery } from "@tanstack/react-query";

import { getBudgetVsActual, getCashFlowMetrics, getInvoiceDocumentCounts, type BudgetVsActualQuery, type CashFlowQuery } from "./api";

const MAX_PROCESSING_REFRESHES = 30;
const PROCESSING_REFRESH_INTERVAL_MS = 3_000;

export const invoiceDocumentCountsQueryKey = (companyId: string) =>
  ["company", companyId, "metrics", "invoice-documents"] as const;

export const cashFlowQueryKey = (companyId: string, query: CashFlowQuery) =>
  ["company", companyId, "metrics", "cash-flow", query] as const;

export const budgetVsActualQueryKey = (
  companyId: string,
  query: BudgetVsActualQuery,
) => ["company", companyId, "metrics", "budget-vs-actual", query.period] as const;

export function useCashFlowMetrics(companyId: string, query: CashFlowQuery, enabled = true) {
  return useQuery({
    queryKey: cashFlowQueryKey(companyId, query),
    queryFn: () => getCashFlowMetrics(companyId, query),
    enabled: Boolean(companyId && enabled),
  });
}

export function useBudgetVsActual(companyId: string, period: string, enabled = true) {
  const query = { period };
  return useQuery({
    queryKey: budgetVsActualQueryKey(companyId, query),
    queryFn: () => getBudgetVsActual(companyId, query),
    enabled: Boolean(companyId && period && enabled),
  });
}

export function useInvoiceDocumentCounts(companyId: string) {
  return useQuery({
    queryKey: invoiceDocumentCountsQueryKey(companyId),
    queryFn: () => getInvoiceDocumentCounts(companyId),
    enabled: Boolean(companyId),
    refetchInterval: (currentQuery) => {
      const isProcessing = (currentQuery.state.data?.processing ?? 0) > 0;
      const refreshCount = currentQuery.state.dataUpdateCount + currentQuery.state.errorUpdateCount;
      return isProcessing && refreshCount < MAX_PROCESSING_REFRESHES
        ? PROCESSING_REFRESH_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: false,
  });
}
