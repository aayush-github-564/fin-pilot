import type { components, operations } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type TransactionPage = components["schemas"]["TransactionPageRead"];
export type TransactionListQuery = Pick<
  NonNullable<
    operations["list_transactions_api_v1_companies__company_id__transactions_get"]["parameters"]["query"]
  >,
  "offset" | "limit" | "categorization_status"
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
