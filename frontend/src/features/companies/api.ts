import type { components } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type CompanyMembership = Omit<components["schemas"]["CompanyMembershipRead"], "permissions"> & {
  permissions?: string[];
};
export type Company = components["schemas"]["CompanyRead"];

export async function listCompanies(): Promise<CompanyMembership[]> {
  const result = await api.GET("/api/v1/companies");
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no company list.");
  return result.data;
}

export async function createCompany(input: {
  name: string;
  currency_code: string;
}): Promise<Company> {
  const result = await api.POST("/api/v1/companies", { body: input });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no company.");
  return result.data;
}

export async function setCompanyCurrency(
  companyId: string,
  currencyCode: string,
): Promise<Company> {
  const result = await api.PATCH("/api/v1/companies/{company_id}", {
    params: { path: { company_id: companyId } },
    body: { currency_code: currencyCode },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no company.");
  return result.data;
}

export async function updateCompanyName(companyId: string, name: string): Promise<Company> {
  const result = await api.PATCH("/api/v1/companies/{company_id}", {
    params: { path: { company_id: companyId } },
    body: { name },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no updated company.");
  return result.data;
}
