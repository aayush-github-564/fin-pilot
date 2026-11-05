import createClient from "openapi-fetch";

import { clearAccessToken, getAccessToken } from "../lib/auth-token";
import type { paths } from "./schema";

const apiOrigin = typeof window === "undefined" ? "" : window.location.origin;
export const api = createClient<paths>({
  baseUrl: apiOrigin,
  fetch: (...args) => globalThis.fetch(...args),
});

api.use({
  onRequest({ request }) {
    const token = getAccessToken();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    request.headers.set("Accept", "application/json");
    return request;
  },
  onResponse({ request, response }) {
    const isLoginRequest = request.url.endsWith("/api/v1/auth/login");
    if (response.status === 401 && !isLoginRequest) {
      clearAccessToken();
      window.dispatchEvent(new Event("finpilot:unauthorized"));
    }
    return response;
  },
});
