import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

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

const registeredUser = {
  id: "user-1",
  email: "owner@example.com",
  created_at: "2026-11-05T12:00:00Z",
};

describe("account access", () => {
  it("registers, signs in with form encoding, and opens the company picker", async () => {
    const user = userEvent.setup();
    const register = vi.fn();
    const login = vi.fn();

    server.use(
      http.post("*/api/v1/auth/register", async ({ request }) => {
        register(await request.json());
        return HttpResponse.json(registeredUser, { status: 201 });
      }),
      http.post("*/api/v1/auth/login", async ({ request }) => {
        login({
          contentType: request.headers.get("content-type"),
          body: new URLSearchParams(await request.text()),
        });
        return HttpResponse.json({ access_token: "session-token", token_type: "bearer" });
      }),
      http.get("*/api/v1/auth/me", () => HttpResponse.json(registeredUser)),
      http.get("*/api/v1/companies", () => HttpResponse.json([])),
    );

    renderAt("/register");
    await user.type(await screen.findByLabelText("Email address"), registeredUser.email);
    await user.type(await screen.findByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Your company workspace starts here")).toBeInTheDocument();
    expect(register).toHaveBeenCalledWith({
      email: registeredUser.email,
      password: "correct horse battery staple",
    });
    expect(login).toHaveBeenCalledWith({
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        username: registeredUser.email,
        password: "correct horse battery staple",
      }),
    });
    expect(window.sessionStorage.getItem("finpilot.accessToken")).toBe("session-token");
  });

  it("keeps the login form on invalid credentials and shows the API message", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/v1/auth/login", () =>
        HttpResponse.json({ detail: "Incorrect email or password" }, { status: 401 }),
      ),
    );

    renderAt("/login");
    const email = await screen.findByLabelText("Email address");
    await user.type(email, "owner@example.com");
    await user.type(await screen.findByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
    expect(email).toHaveValue("owner@example.com");
    expect(screen.getByRole("heading", { name: "Sign in to your workspace" })).toBeInTheDocument();
  });
});
