import type { components, operations } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type SpendingAnomaly = components["schemas"]["SpendingAnomalyRead"];
export type SpendingAnomalyReport = components["schemas"]["SpendingAnomalyReportRead"];
export type AnomalyQuery = NonNullable<
  operations["get_spending_anomalies_api_v1_companies__company_id__insights_anomalies_get"]["parameters"]["query"]
>;

export async function getSpendingAnomalies(
  companyId: string,
  query: Required<AnomalyQuery>,
): Promise<SpendingAnomalyReport> {
  const result = await api.GET("/api/v1/companies/{company_id}/insights/anomalies", {
    params: { path: { company_id: companyId }, query },
  });
  if (!result.response.ok) {
    throw await normalizeApiError(result.response, result.error);
  }
  if (!result.data) throw new Error("The server returned no anomaly report.");
  return result.data;
}
