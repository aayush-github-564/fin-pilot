import { z } from "zod";
import { format, isValid, parseISO } from "date-fns";
import { ArrowUp, Bot, MessageCircle, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { formatMoney } from "../../lib/money";
import { useCompany, useRole } from "../companies/company-context";
import type { FinancialQuery, FinancialQueryType } from "./api";
import { useAskFinancialQuestion } from "./hooks";
import {
  budgetVsActualFactsSchema,
  cashFlowFactsSchema,
  expensesByCategoryFactsSchema,
  largestExpensesFactsSchema,
} from "./facts";

const SUGGESTIONS = [
  { label: "Cash flow summary", question: "Summarize my cash flow this month." },
  { label: "Expenses by category", question: "Show my expenses by category this month." },
  { label: "Largest expenses", question: "What were my largest expenses this month?" },
  { label: "Budget vs actual", question: "Compare this month's budget with actual spending." },
] as const;

const periodLabels: Record<string, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  year_to_date: "Year to date",
};

type ChatMessage = { question: string; response: FinancialQuery };

function formatDate(value: string | null) {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "MMM d, yyyy") : value;
}

function errorText(error: unknown, rateLimitSeconds: number) {
  if (error instanceof ApiError && error.status === 429) {
    return rateLimitSeconds > 0
      ? `You've reached the question limit. Try again in ${rateLimitSeconds} second${rateLimitSeconds === 1 ? "" : "s"}.`
      : "You've reached the question limit. Try again shortly.";
  }
  if (error instanceof ApiError && error.status === 503) {
    return "FinPilot's financial query service is temporarily unavailable. Your question is still here; try again shortly.";
  }
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Your question could not be answered.";
}

function periodName(period: string | null) {
  if (!period) return null;
  if (/^\d{4}-\d{2}$/.test(period)) return period;
  return periodLabels[period] ?? period;
}

function provenance(response: FinancialQuery) {
  const period = periodName(response.period);
  const start = formatDate(response.start_date);
  const end = formatDate(response.end_date);
  const range = start && end ? `${start} – ${end}` : null;
  return [period, range].filter(Boolean).join(" · ");
}

function topCountLabel(kind: string, itemCount: number) {
  return `Showing the top ${itemCount} ${kind}.`;
}

function FactsBreakdown({ type, facts, currency }: {
  type: FinancialQueryType;
  facts: Record<string, unknown> | undefined;
  currency: string | null;
}) {
  if (!facts) return null;

  if (type === "cash_flow_summary") {
    const parsed = cashFlowFactsSchema.safeParse(facts);
    if (!parsed.success) return null;
    return <div className="mt-4 grid gap-2 sm:grid-cols-3">
      <Metric label="Inflows" value={formatMoney(parsed.data.inflows, currency)} />
      <Metric label="Outflows" value={formatMoney(parsed.data.outflows, currency)} />
      <Metric label="Net cash flow" value={formatMoney(parsed.data.net_cash_flow, currency)} />
      <p className="text-xs text-slate-500 sm:col-span-3">Based on {parsed.data.transaction_count} transactions.</p>
    </div>;
  }

  if (type === "expenses_by_category") {
    const parsed = expensesByCategoryFactsSchema.safeParse(facts);
    if (!parsed.success) return null;
    return <div className="mt-4 space-y-2">
      {parsed.data.items.length === 0 ? <p className="text-sm text-slate-600">No categorized expenses were found in this period.</p> :
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Transactions</th></tr></thead>
            <tbody>{parsed.data.items.map((item) => <tr className="border-t border-slate-100" key={item.category_id}><td className="px-3 py-2">{item.category_name}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(item.amount, currency)}</td><td className="px-3 py-2 text-right tabular-nums">{item.transaction_count}</td></tr>)}</tbody>
          </table>
        </div>}
      {parsed.data.has_more && <p className="text-xs text-slate-500">{topCountLabel("categories", parsed.data.items.length)}</p>}
    </div>;
  }

  if (type === "largest_expenses") {
    const parsed = largestExpensesFactsSchema.safeParse(facts);
    if (!parsed.success) return null;
    return <div className="mt-4 space-y-2">
      {parsed.data.items.length === 0 ? <p className="text-sm text-slate-600">No expenses were found in this period.</p> :
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {parsed.data.items.map((item, index) => <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" key={`${item.date}-${index}`}>
            <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{item.description || "Expense"}</p><p className="mt-1 text-xs text-slate-500">{formatDate(item.date)}{item.category_name ? ` · ${item.category_name}` : ""}</p></div>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatMoney(item.amount, currency)}</span>
          </li>)}
        </ul>}
      {parsed.data.has_more && <p className="text-xs text-slate-500">{topCountLabel("expenses", parsed.data.items.length)}</p>}
    </div>;
  }

  if (type === "budget_vs_actual") {
    const parsed = budgetVsActualFactsSchema.safeParse(facts);
    if (!parsed.success) return null;
    return <div className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Budgeted" value={formatMoney(parsed.data.total_budgeted, currency)} />
        <Metric label="Actual" value={formatMoney(parsed.data.total_actual, currency)} />
        <Metric label="Remaining" value={formatMoney(parsed.data.total_remaining, currency)} />
      </div>
      {parsed.data.items.length > 0 && <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {parsed.data.items.map((item) => <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" key={`${item.category_kind}-${item.category_name}`}>
          <div><p className="text-sm font-medium text-slate-800">{item.category_name}</p><p className="mt-1 text-xs text-slate-500">{item.category_kind} · {item.transaction_count} transactions{item.over_budget ? " · Over budget" : ""}</p></div>
          <div className="text-right text-xs text-slate-600"><p>Budget {formatMoney(item.budgeted_amount, currency)}</p><p>Actual {formatMoney(item.actual_amount, currency)}</p></div>
        </li>)}
      </ul>}
      {parsed.data.has_more && <p className="text-xs text-slate-500">{topCountLabel("budget categories", parsed.data.items.length)}</p>}
    </div>;
  }

  return null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-white px-3 py-3">
    <p className="text-xs font-medium text-slate-500">{label}</p>
    <p className="mt-1 text-base font-semibold tabular-nums text-slate-950">{value}</p>
  </div>;
}

function CompanyChat({ companyId, currency }: { companyId: string; currency: string | null }) {
  const { role } = useRole();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const mutation = useAskFinancialQuestion(companyId);

  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setRateLimitSeconds((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [rateLimitSeconds]);

  const sendQuestion = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || mutation.isPending || rateLimitSeconds > 0) return;
    setQuestion(trimmed);
    mutation.reset();
    mutation.mutate(trimmed, {
      onSuccess: (response) => {
        setMessages((current) => [...current, { question: trimmed, response }]);
        setQuestion("");
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 429) {
          setRateLimitSeconds(Math.max(1, error.retryAfterSeconds ?? 1));
        }
      },
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendQuestion(question);
  };

  return <div className="mx-auto max-w-4xl space-y-6">
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-900">FinPilot assistant · {role}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Ask about your finances</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Ask about cash flow, expenses by category, largest expenses, or this and last month's budgets.</p>
    </div>

    <Card className="overflow-hidden">
      <CardHeader className="border-b border-slate-100">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-900"><MessageCircle aria-hidden="true" className="size-5" /></span>
          <div><CardTitle>Company finance Q&amp;A</CardTitle><CardDescription className="mt-1">Messages stay only on this page and are cleared when you leave. There is no saved chat history.</CardDescription></div>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600" role="note">
          FinPilot computes financial figures from company data. AI only selects which supported query to run; it does not calculate the figures.
        </div>
      </CardHeader>

      <div className="space-y-4 p-4 sm:p-5">
        {messages.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-8 text-center">
          <Bot aria-hidden="true" className="mx-auto size-7 text-cyan-800" />
          <p className="mt-3 text-sm font-semibold text-slate-800">Ask a question about this company's financial data</p>
          <p className="mt-1 text-xs text-slate-500">Pick an example or type your own question.</p>
        </div> : <div aria-label="Conversation" className="space-y-4" role="log">
          {messages.map(({ question: asked, response }) => <article className="space-y-3" key={response.query_id}>
            <div className="ml-auto flex max-w-[90%] items-start gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm leading-6 text-white sm:max-w-[80%]">
              <UserRound aria-hidden="true" className="mt-1 size-4 shrink-0 text-cyan-200" /><p>{asked}</p>
            </div>
            <Card className="mr-auto max-w-full bg-slate-50 p-4 sm:max-w-[92%]">
              <div className="flex flex-wrap items-center gap-2">
                <Bot aria-hidden="true" className="size-4 text-cyan-900" />
                <span className="text-xs font-bold text-slate-800">FinPilot</span>
                <Badge variant={response.supported ? "success" : "neutral"}>{response.supported ? "Company data" : "Unsupported question"}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-800">{response.answer}</p>
              {response.supported && <>
                {provenance(response) && <p className="mt-3 text-xs text-slate-500">Period: {provenance(response)}</p>}
                <FactsBreakdown currency={currency} facts={response.facts} type={response.query_type} />
                {!hasValidFacts(response.query_type, response.facts) && <p className="mt-3 text-xs text-slate-500">The text answer is available; a structured breakdown could not be shown for this response.</p>}
                <p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">Figures are computed from this company's data. AI selected the query and did not calculate these values.</p>
              </>}
            </Card>
          </article>)}
        </div>}

        {mutation.isPending && <div className="mr-auto max-w-[92%] rounded-2xl bg-slate-50 px-4 py-3"><LoadingState label="Checking company data" /></div>}
        {mutation.error && <ErrorMessage>{errorText(mutation.error, rateLimitSeconds)}</ErrorMessage>}

        <div className="flex flex-wrap gap-2" aria-label="Suggested questions" role="group">
          {SUGGESTIONS.map((suggestion) => <Button
            disabled={mutation.isPending || rateLimitSeconds > 0}
            key={suggestion.label}
            onClick={() => sendQuestion(suggestion.question)}
            size="sm"
            variant="secondary"
          >{suggestion.label}</Button>)}
        </div>

        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
          <label className="sr-only" htmlFor="finance-question">Ask a finance question</label>
          <Input
            autoComplete="off"
            disabled={mutation.isPending || rateLimitSeconds > 0}
            id="finance-question"
            maxLength={1000}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            placeholder="For example, summarize cash flow this month"
            value={question}
          />
          <Button disabled={mutation.isPending || rateLimitSeconds > 0 || !question.trim()} type="submit">
            <ArrowUp aria-hidden="true" className="size-4" />Ask
          </Button>
        </form>
        <p className="text-right text-xs text-slate-500">{question.length}/1000</p>
      </div>
    </Card>
  </div>;
}

function hasValidFacts(type: FinancialQueryType, facts: Record<string, unknown> | undefined) {
  if (!facts) return false;
  const schemas: Partial<Record<FinancialQueryType, z.ZodType>> = {
    cash_flow_summary: cashFlowFactsSchema,
    expenses_by_category: expensesByCategoryFactsSchema,
    largest_expenses: largestExpensesFactsSchema,
    budget_vs_actual: budgetVsActualFactsSchema,
  };
  const schema = schemas[type];
  return schema?.safeParse(facts).success ?? false;
}

export function ChatPage() {
  const company = useCompany();
  return <CompanyChat companyId={company.company_id} currency={company.currency_code} key={company.company_id} />;
}
