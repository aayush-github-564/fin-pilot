import type { components, paths } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";
import { setAccessToken } from "../../lib/auth-token";

export type CurrentUser = components["schemas"]["UserRead"];
type LoginToken = paths["/api/v1/auth/login"]["post"]["responses"][200]["content"]["application/json"];

export async function getCurrentUser(): Promise<CurrentUser> {
  const result = await api.GET("/api/v1/auth/me");
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no user information.");
  return result.data;
}

export async function createAccount(email: string, password: string): Promise<void> {
  const result = await api.POST("/api/v1/auth/register", {
    body: { email, password },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
}

export async function signIn(email: string, password: string): Promise<void> {
  const result = await api.POST("/api/v1/auth/login", {
    body: { username: email, password, scope: "" },
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    bodySerializer: () =>
      new URLSearchParams({ username: email, password }).toString(),
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  const token = result.data as LoginToken | undefined;
  if (!token?.access_token) throw new Error("The server returned no access token.");
  setAccessToken(token.access_token);
}
