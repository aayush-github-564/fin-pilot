import type { components } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type CurrentUser = components["schemas"]["UserRead"];
export async function getCurrentUser(): Promise<CurrentUser> {
  const result = await api.GET("/api/v1/auth/me");
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no user information.");
  return result.data;
}
