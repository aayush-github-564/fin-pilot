import { useQuery } from "@tanstack/react-query";

import { getCurrentUser } from "./api";

export const currentUserQueryKey = ["auth", "me"] as const;

export function useCurrentUser(enabled = true) {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: getCurrentUser,
    enabled,
    retry: false,
  });
}
