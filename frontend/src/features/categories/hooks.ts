import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createCategory, deleteCategory, listCategories, updateCategory, type CategoryCreate, type CategoryUpdate } from "./api";

export const categoryManagerQueryKey = (companyId: string) => ["company", companyId, "categories"] as const;

export function useManagedCategories(companyId: string) {
  return useQuery({
    queryKey: categoryManagerQueryKey(companyId),
    queryFn: () => listCategories(companyId),
    enabled: Boolean(companyId),
    retry: false,
  });
}

function useInvalidateCategoryData(companyId: string) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: categoryManagerQueryKey(companyId) }),
    queryClient.invalidateQueries({ queryKey: ["company", companyId, "budgets"] }),
    queryClient.invalidateQueries({ queryKey: ["company", companyId, "metrics"] }),
    queryClient.invalidateQueries({ queryKey: ["company", companyId, "transactions"] }),
  ]);
}

export function useCreateCategory(companyId: string) {
  const invalidate = useInvalidateCategoryData(companyId);
  return useMutation({
    mutationFn: (body: CategoryCreate) => createCategory(companyId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useUpdateCategory(companyId: string) {
  const invalidate = useInvalidateCategoryData(companyId);
  return useMutation({
    mutationFn: ({ categoryId, body }: { categoryId: string; body: CategoryUpdate }) => updateCategory(companyId, categoryId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useDeleteCategory(companyId: string) {
  const invalidate = useInvalidateCategoryData(companyId);
  return useMutation({
    mutationFn: (categoryId: string) => deleteCategory(companyId, categoryId),
    retry: false,
    onSuccess: invalidate,
  });
}
