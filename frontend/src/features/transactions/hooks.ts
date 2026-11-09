import { useQuery } from "@tanstack/react-query";

import { listTransactions } from "./api";

const RECENT_TRANSACTION_LIMIT = 5;

export const recentTransactionsQueryKey = (companyId: string) =>
  ["company", companyId, "transactions", "recent", RECENT_TRANSACTION_LIMIT] as const;

export const reviewQueueCountQueryKey = (companyId: string) =>
  ["company", companyId, "transactions", "review-count"] as const;

export function useRecentTransactions(companyId: string) {
  return useQuery({
    queryKey: recentTransactionsQueryKey(companyId),
    queryFn: () =>
      listTransactions(companyId, { offset: 0, limit: RECENT_TRANSACTION_LIMIT }),
    enabled: Boolean(companyId),
  });
}

export function useReviewQueueCount(companyId: string) {
  return useQuery({
    queryKey: reviewQueueCountQueryKey(companyId),
    queryFn: async () => {
      const page = await listTransactions(companyId, {
        offset: 0,
        limit: 1,
        categorization_status: "needs_review",
      });
      return page.total;
    },
    enabled: Boolean(companyId),
  });
}
