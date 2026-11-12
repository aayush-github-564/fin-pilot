import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import { queryClient } from "../app/query-client";
import { server } from "./server";

vi.mock("../lib/supabase", () => {
  const listeners = new Set<(event: string, session: unknown) => void>();
  const getSession = async () => {
    const accessToken = window.sessionStorage.getItem("test.supabase.accessToken");
    return { data: { session: accessToken ? { access_token: accessToken, user: {} } : null }, error: null };
  };
  const setSession = (accessToken: string) => {
    window.sessionStorage.setItem("test.supabase.accessToken", accessToken);
    for (const listener of listeners) listener("SIGNED_IN", { access_token: accessToken, user: {} });
  };
  return {
    supabase: {
      auth: {
        getSession,
        onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
          listeners.add(listener);
          return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
        },
        signOut: async () => {
          window.sessionStorage.removeItem("test.supabase.accessToken");
          for (const listener of listeners) listener("SIGNED_OUT", null);
          return { error: null };
        },
        signInWithPassword: async () => { setSession("mock-session-token"); return { error: null, data: {} }; },
        signUp: async () => ({ error: null, data: { user: null, session: null } }),
        verifyOtp: async () => { setSession("mock-session-token"); return { error: null, data: {} }; },
        resend: async () => ({ error: null, data: {} }),
        resetPasswordForEmail: async () => ({ error: null, data: {} }),
        updateUser: async () => ({ error: null, data: {} }),
        signInWithOAuth: async () => ({ error: null, data: {} }),
      },
    },
  };
});

beforeAll(() => server.listen());
beforeEach(() => {
  window.sessionStorage.clear();
  queryClient.clear();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
