import type { components } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type Budget = components["schemas"]["BudgetRead"];
export type BudgetCreate = components["schemas"]["BudgetCreate"];
export type BudgetUpdate = components["schemas"]["BudgetUpdate"];

export async function listBudgets(companyId: string): Promise<Budget[]> {
  const result = await api.GET("/api/v1/companies/{company_id}/budgets", {
    params: { path: { company_id: companyId } },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no budget list.");
  return result.data;
}

export async function createBudget(companyId: string, body: BudgetCreate): Promise<Budget> {
  const result = await api.POST("/api/v1/companies/{company_id}/budgets", {
    params: { path: { company_id: companyId } },
    body,
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no saved budget.");
  return result.data;
}

export async function updateBudget(companyId: string, budgetId: string, body: BudgetUpdate): Promise<Budget> {
  const result = await api.PATCH("/api/v1/companies/{company_id}/budgets/{budget_id}", {
    params: { path: { company_id: companyId, budget_id: budgetId } },
    body,
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no updated budget.");
  return result.data;
}

export async function deleteBudget(companyId: string, budgetId: string): Promise<void> {
  const result = await api.DELETE("/api/v1/companies/{company_id}/budgets/{budget_id}", {
    params: { path: { company_id: companyId, budget_id: budgetId } },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
}
