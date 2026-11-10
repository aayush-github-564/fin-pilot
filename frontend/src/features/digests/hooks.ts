import { useQuery } from "@tanstack/react-query";

import { getWeeklyDigest } from "./api";

export function weeklyDigestQueryKey(companyId: string, periodStart?: string) {
  return ["company", companyId, "digests", "weekly", periodStart ?? "latest"] as const;
}

export function useWeeklyDigest(companyId: string, periodStart?: string) {
  return useQuery({
    queryKey: weeklyDigestQueryKey(companyId, periodStart),
    queryFn: () => getWeeklyDigest(companyId, periodStart),
    retry: false,
  });
}
