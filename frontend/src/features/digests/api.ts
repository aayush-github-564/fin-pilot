import type { components, operations } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type WeeklyDigest = components["schemas"]["WeeklyDigestRead"];
export type WeeklyDigestQuery = NonNullable<
  operations["get_latest_weekly_digest_api_v1_companies__company_id__digests_weekly_get"]["parameters"]["query"]
>;

export async function getWeeklyDigest(companyId: string, periodStart?: string): Promise<WeeklyDigest> {
  const result = await api.GET("/api/v1/companies/{company_id}/digests/weekly", {
    params: {
      path: { company_id: companyId },
      ...(periodStart ? { query: { period_start: periodStart } } : {}),
    },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no weekly digest.");
  return result.data;
}
