import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../../api/errors";
import {
  acceptTransactionSuggestion,
  createTransaction,
  deleteTransaction,
  importTransactionsCsv,
  listCategories,
  listTransactions,
  listTransactionsForReview,
  updateTransaction,
  type TransactionCreate,
  type TransactionListQuery,
  type TransactionUpdate,
  type ReviewListQuery,
} from "./api";

const RECENT_TRANSACTION_LIMIT = 5;

export const recentTransactionsQueryKey = (companyId: string) =>
  ["company", companyId, "transactions", "recent", RECENT_TRANSACTION_LIMIT] as const;

export const reviewQueueCountQueryKey = (companyId: string) =>
  ["company", companyId, "transactions", "review-count"] as const;

export const transactionListQueryKey = (
  companyId: string,
  query: TransactionListQuery,
) => ["company", companyId, "transactions", "list", query] as const;

export const categoryListQueryKey = (companyId: string) =>
  ["company", companyId, "categories"] as const;

export const reviewQueueQueryKey = (companyId: string, query: ReviewListQuery) =>
  ["company", companyId, "transactions", "review", query] as const;

export function useReviewTransactions(companyId: string, query: ReviewListQuery) {
  return useQuery({
    queryKey: reviewQueueQueryKey(companyId, query),
    queryFn: () => listTransactionsForReview(companyId, query),
    enabled: Boolean(companyId),
  });
}

export function useTransactions(companyId: string, query: TransactionListQuery) {
  return useQuery({
    queryKey: transactionListQueryKey(companyId, query),
    queryFn: () => listTransactions(companyId, query),
    enabled: Boolean(companyId),
  });
}

export function useCategories(companyId: string) {
  return useQuery({
    queryKey: categoryListQueryKey(companyId),
    queryFn: () => listCategories(companyId),
    enabled: Boolean(companyId),
  });
}

function useInvalidateTransactionData(companyId: string) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["company", companyId, "transactions"] }),
    queryClient.invalidateQueries({ queryKey: ["company", companyId, "metrics"] }),
  ]);
}

export function useCreateTransaction(companyId: string) {
  const invalidate = useInvalidateTransactionData(companyId);
  return useMutation({
    mutationFn: (body: TransactionCreate) => createTransaction(companyId, body),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction(companyId: string) {
  const invalidate = useInvalidateTransactionData(companyId);
  return useMutation({
    mutationFn: ({ transactionId, body }: { transactionId: string; body: TransactionUpdate }) =>
      updateTransaction(companyId, transactionId, body),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction(companyId: string) {
  const invalidate = useInvalidateTransactionData(companyId);
  return useMutation({
    mutationFn: (transactionId: string) => deleteTransaction(companyId, transactionId),
    onSuccess: invalidate,
  });
}

export function useImportTransactionsCsv(companyId: string) {
  const invalidate = useInvalidateTransactionData(companyId);
  return useMutation({
    mutationFn: (file: File) => importTransactionsCsv(companyId, file),
    onSuccess: invalidate,
  });
}

export function useAcceptTransactionSuggestion(companyId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTransactionData(companyId);
  return useMutation({
    mutationFn: (transactionId: string) =>
      acceptTransactionSuggestion(companyId, transactionId),
    retry: false,
    onSuccess: invalidate,
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) {
        await queryClient.invalidateQueries({
          queryKey: ["company", companyId, "transactions"],
        });
      }
    },
  });
}

export function useOverrideReviewCategory(companyId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTransactionData(companyId);
  return useMutation({
    mutationFn: ({ transactionId, categoryId }: { transactionId: string; categoryId: string }) =>
      updateTransaction(companyId, transactionId, { category_id: categoryId }),
    retry: false,
    onSuccess: invalidate,
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) {
        await queryClient.invalidateQueries({
          queryKey: ["company", companyId, "transactions"],
        });
      }
    },
  });
}

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
