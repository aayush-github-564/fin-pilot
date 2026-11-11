import { addDays, format, isValid, parseISO } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Mail, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { formatMoney } from "../../lib/money";
import { useCompany } from "../companies/company-context";
import type { WeeklyDigest } from "./api";
import { weeklyDigestFactsSchema } from "./facts";
import { useWeeklyDigest, weeklyDigestQueryKey } from "./hooks";

function formatDate(value: string) {
  const date = parseISO(value);
  return isValid(date) ? format(date, "MMM d, yyyy") : value;
}

function shiftWeek(value: string, days: number) {
  return format(addDays(parseISO(value), days), "yyyy-MM-dd");
}

const deliveryText: Record<NonNullable<WeeklyDigest["delivery_status"]>, string> = {
  pending: "Email delivery is waiting.",
  not_configured: "Digest saved; email is not configured.",
  sending: "Email delivery is in progress.",
  sent: "Digest emailed to you.",
  failed: "Email delivery failed; the digest is still saved.",
};

function Trend({ label, value }: { label: string; value: string }) {
  const isUp = value === "increased" || value === "started";
  const isDown = value === "decreased";
  const Icon = isUp ? TrendingUp : TrendingDown;
  const text = value === "no_previous_activity" ? "No previous activity" : value.charAt(0).toUpperCase() + value.slice(1);
  return <div className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-4 py-3">
    <span className="text-sm text-muted">{label}</span>
    <span className={`flex items-center gap-1.5 text-sm font-semibold ${isUp ? "text-pine" : isDown ? "text-positive" : "text-foreground-body"}`}>
      {(isUp || isDown) && <Icon aria-hidden="true" className="size-4" />}{text}
    </span>
  </div>;
}

function FactsView({ digest, currency }: { digest: WeeklyDigest; currency: string | null }) {
  const parsed = weeklyDigestFactsSchema.safeParse(digest.facts);
  if (!parsed.success) return <p className="text-sm text-muted">Detailed figures are unavailable for this digest. The summary above is still available.</p>;
  const facts = parsed.data;
  return <div className="space-y-5">
    <section aria-labelledby="week-comparison" className="space-y-3">
      <h2 className="text-base font-semibold text-foreground" id="week-comparison">This week compared with last week</h2>
      <div className="flex flex-wrap gap-2">
        <Badge variant={facts.signals.net_cash_flow === "positive" ? "success" : facts.signals.net_cash_flow === "negative" ? "danger" : "neutral"}>
          {facts.signals.net_cash_flow === "positive" ? "Positive net cash flow" : facts.signals.net_cash_flow === "negative" ? "Negative net cash flow" : "Balanced cash flow"}
        </Badge>
        <Badge variant="neutral">{facts.signals.activity === "no_transactions" ? "No transactions recorded" : "Transactions recorded"}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {[{ label: "This week", values: facts.current_week }, { label: "Previous week", values: facts.previous_week }].map(({ label, values }) => <Card className="p-4" key={label}>
          <h3 className="text-sm font-semibold text-foreground-body">{label}</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <Metric label="Money in" value={formatMoney(values.inflows, currency)} />
            <Metric label="Money out" value={formatMoney(values.outflows, currency)} />
            <Metric label="Net cash flow" value={formatMoney(values.net_cash_flow, currency)} />
            <Metric label="Transactions" value={String(values.transaction_count)} />
          </dl>
        </Card>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Trend label="Money in" value={facts.signals.inflows_trend} />
        <Trend label="Money out" value={facts.signals.outflows_trend} />
      </div>
    </section>

    <section aria-labelledby="top-expenses" className="space-y-3">
      <h2 className="text-base font-semibold text-foreground" id="top-expenses">Top expense categories</h2>
      {facts.top_expense_categories.items.length === 0 ? <p className="text-sm text-muted">No categorized expenses were recorded this week.</p> : <div className="divide-y divide-line rounded-md border border-border bg-surface">
        {facts.top_expense_categories.items.map((item) => <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" key={item.category_name}>
          <span className="text-sm font-medium text-foreground-body">{item.category_name}<span className="ml-2 text-xs text-muted">{item.transaction_count} transactions</span></span>
          <span className="text-sm font-semibold tabular-nums text-foreground">{formatMoney(item.outflows, currency)}</span>
        </div>)}
      </div>}
      {facts.top_expense_categories.truncated && <p className="text-sm text-pine" role="status">Only the five largest expense categories are shown.</p>}
    </section>

    <section aria-labelledby="budget-summary" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold text-foreground" id="budget-summary">Month-to-date budget · {facts.month_to_date_budget.period}</h2>
        {facts.signals.month_to_date_budget === "over_budget" && <Badge variant="danger">Over budget</Badge>}
        {facts.signals.month_to_date_budget === "within_budget" && <Badge variant="success">Within budget</Badge>}
      </div>
      {facts.month_to_date_budget.items.length === 0 ? <p className="text-sm text-muted">No budgets are set for this month.</p> : <>
        <dl className="grid gap-3 sm:grid-cols-3"><Metric label="Budgeted" value={formatMoney(facts.month_to_date_budget.total_budgeted, currency)} /><Metric label="Actual" value={formatMoney(facts.month_to_date_budget.total_actual, currency)} /><Metric label="Remaining" value={formatMoney(facts.month_to_date_budget.total_remaining, currency)} /></dl>
        <div className="divide-y divide-line rounded-md border border-border bg-surface">
          {facts.month_to_date_budget.items.map((item) => <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" key={`${item.category_kind}-${item.category_name}`}>
            <span className="text-sm font-medium text-foreground-body">{item.category_name}{item.over_budget && <Badge className="ml-2" variant="danger">Over budget</Badge>}</span>
            <span className="text-sm tabular-nums text-foreground-body">{formatMoney(item.actual_amount, currency)} / {formatMoney(item.budgeted_amount, currency)}</span>
          </div>)}
        </div>
      </>}
      {facts.month_to_date_budget.items_truncated && <p className="text-sm text-pine" role="status">Some budget categories are not shown because the report reached its display limit.</p>}
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-muted">{label}</dt><dd className="font-semibold tabular-nums text-foreground">{value}</dd></div>;
}

function DigestView({ digest, currency }: { digest: WeeklyDigest; currency: string | null }) {
  return <div className="space-y-5">
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2"><Badge variant={digest.summary_source === "llm" ? "info" : "neutral"}>{digest.summary_source === "llm" ? "AI-written summary" : "Template summary"}</Badge><Badge variant="neutral">Figures computed by FinPilot</Badge></div>
      <p className="mt-4 whitespace-pre-wrap text-base leading-7 text-foreground-body">{digest.summary}</p>
      <p className="mt-3 text-xs text-muted">Week: {formatDate(digest.period_start)} – {formatDate(digest.period_end)}. Amounts and comparisons come from the company’s records.</p>
      {digest.delivery_status && <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Mail aria-hidden="true" className="size-4" />{deliveryText[digest.delivery_status]}</p>}
    </Card>
    <FactsView currency={currency} digest={digest} />
  </div>;
}

function CompanyDigests({ companyId, currency }: { companyId: string; currency: string | null }) {
  const [periodStart, setPeriodStart] = useState<string>();
  const queryClient = useQueryClient();
  const query = useWeeklyDigest(companyId, periodStart);
  const latestPeriod = queryClient.getQueryData<WeeklyDigest>(weeklyDigestQueryKey(companyId))?.period_start;

  const shownStart = query.data?.period_start ?? periodStart;
  const nextDisabled = !periodStart || !latestPeriod || shiftWeek(periodStart, 7) > latestPeriod;
  const emptyWeek = query.error instanceof ApiError && query.error.status === 404;

  return <div className="mx-auto max-w-5xl space-y-6">
    <div>
      <p className="fp-eyebrow">Reports</p>
      <h1 className="fp-page-title mt-2">Weekly <em>digests</em></h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">A saved summary of the previous full week, with figures calculated from your company’s records.</p>
    </div>
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground-body"><CalendarDays aria-hidden="true" className="size-4" />{shownStart ? `${formatDate(shownStart)} week` : "Latest available week"}</div>
      <div className="flex gap-2">
        <Button disabled={!shownStart || query.isFetching} onClick={() => { if (shownStart) setPeriodStart(shiftWeek(shownStart, -7)); }} variant="secondary"><ChevronLeft aria-hidden="true" className="size-4" />Previous week</Button>
        <Button disabled={nextDisabled || query.isFetching} onClick={() => { if (periodStart) { const next = shiftWeek(periodStart, 7); setPeriodStart(latestPeriod && next >= latestPeriod ? undefined : next); } }} variant="secondary">Next week<ChevronRight aria-hidden="true" className="size-4" /></Button>
      </div>
    </Card>
    {query.isPending && <Card><LoadingState label="Loading weekly digest" /></Card>}
    {query.isError && !emptyWeek && <Card className="space-y-4 p-5"><ErrorMessage>{query.error instanceof Error ? query.error.message : "The weekly digest could not load."}</ErrorMessage><Button onClick={() => void query.refetch()} variant="secondary">Try again</Button></Card>}
    {emptyWeek && <Card className="px-6 py-10 text-center"><CalendarDays aria-hidden="true" className="mx-auto size-7 text-muted" /><h2 className="mt-3 text-base font-semibold text-foreground">No digest for this week</h2><p className="mt-1 text-sm text-muted">A digest has not been saved for this week. Try an adjacent week or check again after the scheduled report is created.</p></Card>}
    {query.data && <DigestView currency={currency} digest={query.data} />}
  </div>;
}

export function DigestsPage() {
  const company = useCompany();
  return <CompanyDigests companyId={company.company_id} currency={company.currency_code} key={company.company_id} />;
}
