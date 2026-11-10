import type { components, operations } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type FinancialQuery = components["schemas"]["FinancialQueryRead"];
export type FinancialQueryRequest = components["schemas"]["FinancialQueryRequest"];
export type FinancialQueryType = FinancialQuery["query_type"];
type CompanyPath = operations["ask_financial_question_api_v1_companies__company_id__chat_query_post"]["parameters"]["path"];

export async function askFinancialQuestion(
  companyId: CompanyPath["company_id"],
  body: FinancialQueryRequest,
): Promise<FinancialQuery> {
  const result = await api.POST("/api/v1/companies/{company_id}/chat/query", {
    params: { path: { company_id: companyId } },
    body,
  });
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no answer.");
  return result.data;
}
