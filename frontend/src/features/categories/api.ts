import type { components } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type Category = components["schemas"]["CategoryRead"];
export type CategoryCreate = components["schemas"]["CategoryCreate"];
export type CategoryUpdate = components["schemas"]["CategoryUpdate"];
export type CategoryKind = components["schemas"]["CategoryKind"];

export async function listCategories(companyId: string): Promise<Category[]> {
  const result = await api.GET("/api/v1/companies/{company_id}/categories", {
    params: { path: { company_id: companyId } },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no category list.");
  return result.data;
}

export async function createCategory(companyId: string, body: CategoryCreate): Promise<Category> {
  const result = await api.POST("/api/v1/companies/{company_id}/categories", {
    params: { path: { company_id: companyId } },
    body,
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no saved category.");
  return result.data;
}

export async function updateCategory(companyId: string, categoryId: string, body: CategoryUpdate): Promise<Category> {
  const result = await api.PATCH("/api/v1/companies/{company_id}/categories/{category_id}", {
    params: { path: { company_id: companyId, category_id: categoryId } },
    body,
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no updated category.");
  return result.data;
}

export async function deleteCategory(companyId: string, categoryId: string): Promise<void> {
  const result = await api.DELETE("/api/v1/companies/{company_id}/categories/{category_id}", {
    params: { path: { company_id: companyId, category_id: categoryId } },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
}
