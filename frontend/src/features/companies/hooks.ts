import { useQuery } from "@tanstack/react-query";

import { listCompanies } from "./api";

// The company directory is account-wide; company-specific data keys use the
// selected company ID after this query establishes the user's memberships.
export const companiesQueryKey = ["company", "directory"] as const;
export function useCompanies(enabled = true) {
  return useQuery({
    queryKey: companiesQueryKey,
    queryFn: listCompanies,
    enabled,
  });
}
