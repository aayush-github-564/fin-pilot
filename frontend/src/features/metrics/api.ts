import type { components, operations } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type CashFlowMetrics = components["schemas"]["CashFlowMetricsRead"];
export type BudgetVsActual = components["schemas"]["BudgetVsActualRead"];
export type InvoiceDocumentCounts = components["schemas"]["InvoiceDocumentCountsRead"];

export type CashFlowQuery = NonNullable<
  operations["get_cash_flow_metrics_api_v1_companies__company_id__metrics_cash_flow_get"]["parameters"]["query"]
>;
export type BudgetVsActualQuery = NonNullable<
  operations["get_budget_vs_actual_api_v1_companies__company_id__metrics_budget_vs_actual_get"]["parameters"]["query"]
>;

export async function getInvoiceDocumentCounts(
  companyId: string,
): Promise<InvoiceDocumentCounts> {
  const result = await api.GET(
    "/api/v1/companies/{company_id}/metrics/documents",
    { params: { path: { company_id: companyId } } },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no document counts.");
  return result.data;
}

export async function getCashFlowMetrics(
  companyId: string,
  query: CashFlowQuery,
): Promise<CashFlowMetrics> {
  const result = await api.GET(
    "/api/v1/companies/{company_id}/metrics/cash-flow",
    { params: { path: { company_id: companyId }, query } },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no cash-flow metrics.");
  return result.data;
}

export async function getBudgetVsActual(
  companyId: string,
  query: BudgetVsActualQuery,
): Promise<BudgetVsActual> {
  const result = await api.GET(
    "/api/v1/companies/{company_id}/metrics/budget-vs-actual",
    { params: { path: { company_id: companyId }, query } },
  );
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no budget report.");
  return result.data;
}
