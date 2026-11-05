import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

import { clearAccessToken } from "../lib/auth-token";
import { queryClient } from "../app/query-client";
import { server } from "./server";

beforeAll(() => server.listen());
beforeEach(() => {
  clearAccessToken();
  window.sessionStorage.clear();
  queryClient.clear();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
