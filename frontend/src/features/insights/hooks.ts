import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getSpendingAnomalies, type AnomalyQuery } from "./api";

export function anomalyQueryKey(companyId: string, query: Required<AnomalyQuery>) {
  return ["company", companyId, "insights", "anomalies", query] as const;
}

export function useRunAnomalyScan(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (query: Required<AnomalyQuery>) => queryClient.fetchQuery({
      queryKey: anomalyQueryKey(companyId, query),
      queryFn: () => getSpendingAnomalies(companyId, query),
      staleTime: 30_000,
      retry: false,
    }),
    retry: false,
  });
}
