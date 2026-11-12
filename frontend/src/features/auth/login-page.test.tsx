import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "../../app/app";
import { AuthProvider } from "../../app/auth-context";
import { queryClient } from "../../app/query-client";
import { server } from "../../test/server";

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Supabase account access", () => {
  it("signs in through the persisted Supabase session and opens the workspace picker", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/auth/me", () => HttpResponse.json({
        id: "user-1", email: "owner@example.com", full_name: "Owner", avatar_url: null,
        created_at: "2026-11-05T12:00:00Z",
      })),
      http.get("*/api/v1/companies", () => HttpResponse.json([])),
    );

    renderAt("/login");
    await user.type(await screen.findByLabelText("Email address"), "owner@example.com");
    await user.type(await screen.findByLabelText("Password"), "safe-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Your company workspace starts here")).toBeInTheDocument();
  });

  it("asks new accounts to verify their email", async () => {
    const user = userEvent.setup();
    renderAt("/register");
    await user.type(await screen.findByLabelText("Full name"), "New Owner");
    await user.type(await screen.findByLabelText("Email address"), "new@example.com");
    await user.type(await screen.findByLabelText("Password"), "correct horse battery staple");
    await user.type(await screen.findByLabelText("Confirm password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    expect(screen.getByText(/six-digit code sent to new@example.com/i)).toBeInTheDocument();
  });
});
