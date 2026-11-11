import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createBudget, deleteBudget, listBudgets, updateBudget, type BudgetCreate, type BudgetUpdate } from "./api";

export const budgetListQueryKey = (companyId: string) => ["company", companyId, "budgets"] as const;

export function useBudgets(companyId: string) {
  return useQuery({
    queryKey: budgetListQueryKey(companyId),
    queryFn: () => listBudgets(companyId),
    enabled: Boolean(companyId),
    retry: false,
  });
}

function useInvalidateBudgetData(companyId: string) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: budgetListQueryKey(companyId) }),
    queryClient.invalidateQueries({ queryKey: ["company", companyId, "metrics"] }),
  ]);
}

export function useCreateBudget(companyId: string) {
  const invalidate = useInvalidateBudgetData(companyId);
  return useMutation({
    mutationFn: (body: BudgetCreate) => createBudget(companyId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useUpdateBudget(companyId: string) {
  const invalidate = useInvalidateBudgetData(companyId);
  return useMutation({
    mutationFn: ({ budgetId, body }: { budgetId: string; body: BudgetUpdate }) => updateBudget(companyId, budgetId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useDeleteBudget(companyId: string) {
  const invalidate = useInvalidateBudgetData(companyId);
  return useMutation({
    mutationFn: (budgetId: string) => deleteBudget(companyId, budgetId),
    retry: false,
    onSuccess: invalidate,
  });
}
