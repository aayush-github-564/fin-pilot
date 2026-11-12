import createClient from "openapi-fetch";

import { supabase } from "../lib/supabase";
import type { paths } from "./schema";

const apiOrigin = typeof window === "undefined" ? "" : window.location.origin;
export const api = createClient<paths>({
  baseUrl: apiOrigin,
  fetch: (...args) => globalThis.fetch(...args),
});

api.use({
  async onRequest({ request }) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      request.headers.set("Authorization", `Bearer ${data.session.access_token}`);
    }
    request.headers.set("Accept", "application/json");
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401) {
      window.dispatchEvent(new Event("finpilot:unauthorized"));
    }
    return response;
  },
});
