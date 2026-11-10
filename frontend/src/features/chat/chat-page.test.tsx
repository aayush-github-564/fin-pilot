import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import { server } from "../../test/server";
import type { FinancialQuery } from "./api";
import { ChatPage } from "./chat-page";

const company: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
};

function response(overrides: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    query_id: "11111111-1111-4111-8111-111111111111",
    supported: true,
    answer: "From Nov 1 through Nov 9, inflows were 450.00 and net cash flow was 324.50.",
    query_type: "cash_flow_summary",
    period: "this_month",
    start_date: "2026-11-01",
    end_date: "2026-11-09",
    facts: {
      inflows: "450.00",
      outflows: "125.50",
      net_cash_flow: "324.50",
      transaction_count: 2,
    },
    ...overrides,
  };
}

function renderChat(role: CompanyMembership["role"] = "owner") {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CompanyProvider company={{ ...company, role }}>
        <ChatPage />
      </CompanyProvider>
    </QueryClientProvider>,
  );
}

describe("financial chat page", () => {
  it("sends a suggested question and renders deterministic facts with provenance", async () => {
    let requestBody: unknown;
    server.use(http.post("*/api/v1/companies/company-a/chat/query", async ({ request }) => {
      requestBody = await request.json();
      return HttpResponse.json(response());
    }));
    const user = userEvent.setup();
    renderChat();

    expect(screen.getByText(/There is no saved chat history/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cash flow summary" }));

    expect(await screen.findByText(/From Nov 1 through Nov 9/)).toBeInTheDocument();
    expect(requestBody).toEqual({ question: "Summarize my cash flow this month." });
    expect(screen.getByText(/Period: This month · Nov 1, 2026 – Nov 9, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Net cash flow")).toBeInTheDocument();
    expect(screen.getByText("$324.50")).toBeInTheDocument();
    expect(screen.getByText(/AI selected the query and did not calculate/)).toBeInTheDocument();
  });

  it("renders top-N expenses and reports unsupported questions as a friendly answer", async () => {
    let callCount = 0;
    server.use(http.post("*/api/v1/companies/company-a/chat/query", async ({ request }) => {
      const body = await request.json() as { question: string };
      callCount += 1;
      if (body.question.includes("largest")) {
        return HttpResponse.json(response({
          answer: "Here are your largest expenses.",
          query_id: "22222222-2222-4222-8222-222222222222",
          query_type: "largest_expenses",
          facts: {
            items: [{ date: "2026-11-04", description: "November rent", amount: "125.50", category_name: "Rent" }],
            has_more: true,
          },
        }));
      }
      return HttpResponse.json(response({
        answer: "I can answer questions about cash flow, expense categories, largest expenses, and this or last month's budgets.",
        query_id: "33333333-3333-4333-8333-333333333333",
        supported: false,
        query_type: "unsupported",
        period: null,
        start_date: null,
        end_date: null,
        facts: {},
      }));
    }));
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: "Largest expenses" }));
    expect(await screen.findByText("November rent")).toBeInTheDocument();
    expect(screen.getByText("Showing the top 1 expenses.")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Ask a finance question" }), "Tell me a joke");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(/I can answer questions about cash flow/)).toBeInTheDocument();
    expect(screen.getByText("Unsupported question")).toBeInTheDocument();
    expect(callCount).toBe(2);
  });

  it("renders expense-category and budget facts from the response schemas", async () => {
    server.use(http.post("*/api/v1/companies/company-a/chat/query", async ({ request }) => {
      const body = await request.json() as { question: string };
      if (body.question.includes("category")) {
        return HttpResponse.json(response({
          query_id: "44444444-4444-4444-8444-444444444444",
          answer: "Rent was the largest category.",
          query_type: "expenses_by_category",
          facts: {
            items: [{ category_id: "55555555-5555-4555-8555-555555555555", category_name: "Rent", amount: "500.00", transaction_count: 4 }],
            has_more: false,
          },
        }));
      }
      return HttpResponse.json(response({
        query_id: "66666666-6666-4666-8666-666666666666",
        answer: "Your budget details are ready.",
        query_type: "budget_vs_actual",
        period: "this_month",
        facts: {
          period: "2026-11",
          total_budgeted: "1000.00",
          total_actual: "1250.00",
          total_remaining: "-250.00",
          items: [{ category_name: "Rent", category_kind: "expense", budgeted_amount: "1000.00", actual_amount: "1250.00", remaining_amount: "-250.00", transaction_count: 4, over_budget: true }],
          has_more: false,
        },
      }));
    }));
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: "Expenses by category" }));
    expect((await screen.findAllByText("Rent")).length).toBeGreaterThan(0);
    expect(screen.getByText("Transactions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Budget vs actual" }));
    expect(await screen.findByText(/Over budget/)).toBeInTheDocument();
    expect(screen.getByText("Budgeted")).toBeInTheDocument();
    expect(screen.getByText("Actual")).toBeInTheDocument();
  });

  it("falls back to the text answer when facts do not match the query schema", async () => {
    server.use(http.post("*/api/v1/companies/company-a/chat/query", () => HttpResponse.json(response({
      answer: "The answer remains available even if details are malformed.",
      facts: { inflows: 450, outflows: "125.50" },
    }))));
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: "Cash flow summary" }));

    expect(await screen.findByText("The answer remains available even if details are malformed.")).toBeInTheDocument();
    expect(screen.getByText(/structured breakdown could not be shown/)).toBeInTheDocument();
    expect(screen.queryByText("Net cash flow")).not.toBeInTheDocument();
  });

  it("keeps the question and disables input during the Retry-After countdown", async () => {
    server.use(http.post("*/api/v1/companies/company-a/chat/query", () =>
      HttpResponse.json({ detail: "Financial Q&A rate limit exceeded" }, {
        status: 429,
        headers: { "Retry-After": "3" },
      }),
    ));
    const user = userEvent.setup();
    renderChat();
    const input = screen.getByRole("textbox", { name: "Ask a finance question" });
    await user.type(input, "What was my cash flow?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText(/Try again in 3 seconds/)).toBeInTheDocument();
    expect(input).toHaveValue("What was my cash flow?");
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cash flow summary" })).toBeDisabled();
  });

  it("lets viewers use chat and preserves their question when the service is unavailable", async () => {
    server.use(http.post("*/api/v1/companies/company-a/chat/query", () =>
      HttpResponse.json({ detail: "Financial Q&A is temporarily unavailable" }, { status: 503 }),
    ));
    const user = userEvent.setup();
    renderChat("viewer");
    const input = screen.getByRole("textbox", { name: "Ask a finance question" });

    await user.type(input, "Summarize cash flow");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText(/temporarily unavailable/)).toBeInTheDocument();
    expect(input).toHaveValue("Summarize cash flow");
    expect(input).toBeEnabled();
    expect(within(screen.getByRole("group", { name: "Suggested questions" })).getByRole("button", { name: "Budget vs actual" })).toBeEnabled();
  });
});
