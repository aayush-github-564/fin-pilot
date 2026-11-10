import type { components, operations } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type TransactionPage = components["schemas"]["TransactionPageRead"];
export type Transaction = components["schemas"]["TransactionRead"];
export type Category = components["schemas"]["CategoryRead"];
export type TransactionCreate = components["schemas"]["TransactionCreate"];
export type TransactionUpdate = components["schemas"]["TransactionUpdate"];
export type CSVImportResult = components["schemas"]["CSVImportRead"];
export type TransactionListQuery = NonNullable<
  operations["list_transactions_api_v1_companies__company_id__transactions_get"]["parameters"]["query"]
>;
export type ReviewListQuery = NonNullable<
  operations["list_transactions_for_review_api_v1_companies__company_id__transactions_review_get"]["parameters"]["query"]
>;

export async function listTransactions(
  companyId: string,
  query: TransactionListQuery,
): Promise<TransactionPage> {
  const result = await api.GET(
    "/api/v1/companies/{company_id}/transactions",
    { params: { path: { company_id: companyId }, query } },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no transaction list.");
  return result.data;
}

export async function listTransactionsForReview(
  companyId: string,
  query: ReviewListQuery,
): Promise<Transaction[]> {
  const result = await api.GET(
    "/api/v1/companies/{company_id}/transactions/review",
    { params: { path: { company_id: companyId }, query } },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no review queue.");
  return result.data;
}

export async function acceptTransactionSuggestion(
  companyId: string,
  transactionId: string,
): Promise<Transaction> {
  const result = await api.POST(
    "/api/v1/companies/{company_id}/transactions/{transaction_id}/accept-suggestion",
    { params: { path: { company_id: companyId, transaction_id: transactionId } } },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no reviewed transaction.");
  return result.data;
}

export async function getTransaction(
  companyId: string,
  transactionId: string,
): Promise<Transaction> {
  const result = await api.GET(
    "/api/v1/companies/{company_id}/transactions/{transaction_id}",
    { params: { path: { company_id: companyId, transaction_id: transactionId } } },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no transaction status.");
  return result.data;
}

export async function importTransactionsCsv(
  companyId: string,
  file: File,
): Promise<CSVImportResult> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const result = await api.POST(
    "/api/v1/companies/{company_id}/transactions/import-csv",
    {
      params: { path: { company_id: companyId } },
      // openapi-typescript currently types this binary multipart field as string.
      // openapi-fetch's default serializer passes FormData through and sets its boundary.
      body: formData as unknown as components["schemas"]["Body_import_transactions_csv_api_v1_companies__company_id__transactions_import_csv_post"],
    },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no CSV import report.");
  return result.data;
}

export async function listCategories(companyId: string): Promise<Category[]> {
  const result = await api.GET("/api/v1/companies/{company_id}/categories", {
    params: { path: { company_id: companyId } },
  });
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no categories.");
  return result.data;
}

export async function createTransaction(
  companyId: string,
  body: TransactionCreate,
): Promise<Transaction> {
  const result = await api.POST("/api/v1/companies/{company_id}/transactions", {
    params: { path: { company_id: companyId } },
    body,
  });
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no saved transaction.");
  return result.data;
}

export async function updateTransaction(
  companyId: string,
  transactionId: string,
  body: TransactionUpdate,
): Promise<Transaction> {
  const result = await api.PATCH(
    "/api/v1/companies/{company_id}/transactions/{transaction_id}",
    {
      params: { path: { company_id: companyId, transaction_id: transactionId } },
      body,
    },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no updated transaction.");
  return result.data;
}

export async function deleteTransaction(
  companyId: string,
  transactionId: string,
): Promise<void> {
  const result = await api.DELETE(
    "/api/v1/companies/{company_id}/transactions/{transaction_id}",
    { params: { path: { company_id: companyId, transaction_id: transactionId } } },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
}
