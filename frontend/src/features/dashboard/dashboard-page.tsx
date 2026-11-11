import { zodResolver } from "@hookform/resolvers/zod";
import {
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  subDays,
} from "date-fns";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Wallet,
} from "lucide-react";
import { lazy, Suspense, useState, type FormEvent, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { formatMoney, formatRunwayMonths } from "../../lib/money";
import { useCompany, useRole } from "../companies/company-context";
import { useBudgetVsActual, useCashFlowMetrics } from "../metrics/hooks";
import { useRecentTransactions, useReviewQueueCount } from "../transactions/hooks";

const CashFlowChart = lazy(() =>
  import("./cash-flow-chart").then((module) => ({ default: module.CashFlowChart })),
);

const PRESET_DAYS = [30, 90, 365] as const;
const cashBalanceSchema = z.object({
  cash_balance: z.string().trim().refine(
    (value) => value === "" || /^\d{1,10}(\.\d{1,2})?$/.test(value),
    "Enter a non-negative balance with up to two decimal places.",
  ),
});

type CashBalanceFields = z.infer<typeof cashBalanceSchema>;
type DateRange = { start_date: string; end_date: string };

function todayUtc(): string {
  const today = new Date();
  const year = String(today.getUTCFullYear()).padStart(4, "0");
  const month = String(today.getUTCMonth() + 1).padStart(2, "0");
  const day = String(today.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetRange(days: number): DateRange {
  const endDate = todayUtc();
  return {
    start_date: format(subDays(parseISO(endDate), days - 1), "yyyy-MM-dd"),
    end_date: endDate,
  };
}

function queryError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "This information could not be loaded.";
}

function QueryStatus({
  isPending,
  isError,
  error,
  onRetry,
  label,
}: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  label: string;
}) {
  if (isPending) return <LoadingState label={label} />;
  if (!isError) return null;
  return (
    <div className="space-y-3">
      <ErrorMessage>{queryError(error)}</ErrorMessage>
      <Button onClick={onRetry} variant="secondary">Try again</Button>
    </div>
  );
}

function MetricCard({
  title,
  detail,
  icon,
  children,
}: {
  title: string;
  detail: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted">{title}</p>
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-raised text-accent">
            {icon}
          </span>
        </div>
        <div className="mt-3 min-h-9 text-2xl font-semibold tracking-tight text-foreground">
          {children}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
      </CardHeader>
    </Card>
  );
}

function CashFlowRangeControls({
  range,
  draftRange,
  activePreset,
  granularity,
  cashBalanceForm,
  rangeError,
  onPreset,
  onDraftChange,
  onApplyRange,
  onGranularity,
  onApplyCashBalance,
}: {
  range: DateRange;
  draftRange: DateRange;
  activePreset: number | null;
  granularity: "day" | "month";
  cashBalanceForm: ReturnType<typeof useForm<CashBalanceFields>>;
  rangeError: string;
  onPreset: (days: (typeof PRESET_DAYS)[number]) => void;
  onDraftChange: (field: keyof DateRange, value: string) => void;
  onApplyRange: (event: FormEvent<HTMLFormElement>) => void;
  onGranularity: (value: "day" | "month") => void;
  onApplyCashBalance: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card>
      <CardHeader className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays aria-hidden="true" className="size-5 text-accent" />
              Cash-flow period
            </CardTitle>
            <CardDescription className="mt-1">
              Choose up to 366 calendar days. Values are computed by the metrics service.
            </CardDescription>
          </div>
          <div aria-label="Cash-flow chart grouping" className="inline-flex rounded-md bg-linen p-1" role="group">
            {(["month", "day"] as const).map((value) => (
              <button
                aria-pressed={granularity === value}
                className={`min-h-9 rounded-sm px-3 text-sm font-semibold transition ${
                  granularity === value
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
                key={value}
                onClick={() => onGranularity(value)}
                type="button"
              >
                {value === "month" ? "Monthly" : "Daily"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESET_DAYS.map((days) => (
            <Button
              aria-pressed={activePreset === days}
              className={activePreset === days ? "ring-2 ring-accent/20 ring-offset-2" : ""}
              key={days}
              onClick={() => onPreset(days)}
              size="sm"
              variant={activePreset === days ? "primary" : "secondary"}
            >
              Last {days} days
            </Button>
          ))}
          <Badge className="self-center" variant="neutral">
            {range.start_date} – {range.end_date}
          </Badge>
        </div>

        <form className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={onApplyRange}>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted" htmlFor="cash-flow-start">
              From
            </label>
            <Input
              id="cash-flow-start"
              onChange={(event) => onDraftChange("start_date", event.currentTarget.value)}
              type="date"
              value={draftRange.start_date}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted" htmlFor="cash-flow-end">
              Through
            </label>
            <Input
              id="cash-flow-end"
              onChange={(event) => onDraftChange("end_date", event.currentTarget.value)}
              type="date"
              value={draftRange.end_date}
            />
          </div>
          <Button className="sm:mb-0" size="sm" type="submit" variant="secondary">
            Apply dates
          </Button>
          {rangeError && <p className="text-sm text-negative sm:col-span-3" role="alert">{rangeError}</p>}
        </form>

        <form className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(200px,320px)_auto] sm:items-end" noValidate onSubmit={onApplyCashBalance}>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted" htmlFor="cash-balance">
              Current cash balance (optional)
            </label>
            <Input
              autoComplete="off"
              id="cash-balance"
              inputMode="decimal"
              placeholder="e.g. 25000.00"
              {...cashBalanceForm.register("cash_balance")}
            />
            {cashBalanceForm.formState.errors.cash_balance && (
              <p className="text-xs text-negative" role="alert">
                {cashBalanceForm.formState.errors.cash_balance.message}
              </p>
            )}
          </div>
          <Button size="sm" type="submit" variant="secondary">Update runway estimate</Button>
          <p className="text-xs leading-5 text-muted sm:col-span-2">
            This balance is sent only with the metrics request and is not saved to company records.
          </p>
        </form>
      </CardHeader>
    </Card>
  );
}

function BudgetPanel({
  period,
  currencyCode,
  data,
  isPending,
  isError,
  error,
  onRetry,
  onPeriodChange,
}: {
  period: string;
  currencyCode: string | null;
  data: ReturnType<typeof useBudgetVsActual>["data"];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onPeriodChange: (value: string) => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Budget vs actual</CardTitle>
            <CardDescription className="mt-1">For the selected accounting month.</CardDescription>
          </div>
          <label className="sr-only" htmlFor="budget-period">Budget month</label>
          <Input
            className="w-auto min-w-40"
            id="budget-period"
            onChange={(event) => onPeriodChange(event.currentTarget.value)}
            type="month"
            value={period}
          />
        </div>

        {!period ? (
          <p className="mt-5 rounded-md bg-surface-raised p-4 text-sm text-muted" role="status">
            Choose a month to view its budget report.
          </p>
        ) : isPending || isError ? (
          <QueryStatus
            error={error}
            isError={isError}
            isPending={isPending}
            label="Loading budget totals"
            onRetry={onRetry}
          />
        ) : data && data.items.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border bg-surface-raised p-5 text-center">
            <p className="font-semibold text-foreground-body">No budgets for {period || "this month"}</p>
            <p className="mt-1 text-sm text-muted">Budget totals will appear here once this company has budgets.</p>
          </div>
        ) : data ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 rounded-md bg-surface-raised p-4 sm:grid-cols-3">
              <SummaryAmount label="Budgeted" value={data.total_budgeted} currencyCode={currencyCode} />
              <SummaryAmount label="Actual" value={data.total_actual} currencyCode={currencyCode} />
              <SummaryAmount label="Remaining" value={data.total_remaining} currencyCode={currencyCode} />
            </div>
            <div className="mt-5 space-y-4">
              {data.items.map((item) => (
                <div className="border-b border-line pb-4 last:border-0 last:pb-0" key={item.category_id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground-body">{item.category_name}</span>
                      <Badge variant="neutral">{item.category_kind}</Badge>
                    </div>
                    {item.over_budget && <Badge className="bg-negative/10 text-negative" variant="neutral">Over budget</Badge>}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                    <SummaryAmount label="Actual" value={item.actual_amount} currencyCode={currencyCode} />
                    <SummaryAmount label="Budget" value={item.budgeted_amount} currencyCode={currencyCode} />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </CardHeader>
    </Card>
  );
}

function SummaryAmount({
  label,
  value,
  currencyCode,
}: {
  label: string;
  value: string;
  currencyCode: string | null;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate font-semibold tabular-nums text-foreground-body">
        {formatMoney(value, currencyCode)}
      </p>
    </div>
  );
}

function RecentTransactions({
  currencyCode,
  data,
  isPending,
  isError,
  error,
  onRetry,
}: {
  currencyCode: string | null;
  data: ReturnType<typeof useRecentTransactions>["data"];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Recent transactions</CardTitle>
        <CardDescription className="mt-1">The five latest records in this company.</CardDescription>
        {isPending || isError ? (
          <QueryStatus
            error={error}
            isError={isError}
            isPending={isPending}
            label="Loading recent transactions"
            onRetry={onRetry}
          />
        ) : data && data.items.length === 0 ? (
          <div className="mt-5 rounded-md border border-dashed border-border bg-surface-raised p-5 text-center">
            <p className="font-semibold text-foreground-body">No transactions yet</p>
            <p className="mt-1 text-sm text-muted">New company records will appear here.</p>
          </div>
        ) : data ? (
          <div className="mt-4 divide-y divide-line">
            {data.items.map((transaction) => (
              <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-1" key={transaction.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground-body">
                    {transaction.description?.trim() || "Untitled transaction"}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <time dateTime={transaction.date}>{format(parseISO(transaction.date), "MMM d, yyyy")}</time>
                    <Badge variant="neutral">{transaction.categorization_status.replaceAll("_", " ")}</Badge>
                  </div>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatMoney(transaction.amount, currencyCode)}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </CardHeader>
    </Card>
  );
}

export function DashboardPage() {
  const company = useCompany();
  const { role } = useRole();
  const [range, setRange] = useState(() => presetRange(90));
  const [draftRange, setDraftRange] = useState(range);
  const [activePreset, setActivePreset] = useState<number | null>(90);
  const [granularity, setGranularity] = useState<"day" | "month">("month");
  const [rangeError, setRangeError] = useState("");
  const [period, setPeriod] = useState(() => format(new Date(), "yyyy-MM"));
  const [cashBalance, setCashBalance] = useState<string | undefined>();
  const cashBalanceForm = useForm<CashBalanceFields>({
    resolver: zodResolver(cashBalanceSchema),
    defaultValues: { cash_balance: "" },
  });

  const metricsQuery = useCashFlowMetrics(company.company_id, {
    start_date: range.start_date,
    end_date: range.end_date,
    granularity,
    ...(cashBalance ? { cash_balance: cashBalance } : {}),
  });
  const budgetQuery = useBudgetVsActual(company.company_id, period);
  const recentQuery = useRecentTransactions(company.company_id);
  const reviewCountQuery = useReviewQueueCount(company.company_id);

  function choosePreset(days: (typeof PRESET_DAYS)[number]) {
    const nextRange = presetRange(days);
    setRange(nextRange);
    setDraftRange(nextRange);
    setActivePreset(days);
    setRangeError("");
  }

  function applyCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftRange.start_date || !draftRange.end_date) {
      setRangeError("Choose both a start and end date.");
      return;
    }
    const startDate = parseISO(draftRange.start_date);
    const endDate = parseISO(draftRange.end_date);
    if (!isValid(startDate) || !isValid(endDate)) {
      setRangeError("Enter valid calendar dates.");
      return;
    }
    if (endDate < startDate) {
      setRangeError("The end date must be on or after the start date.");
      return;
    }
    if (differenceInCalendarDays(endDate, startDate) + 1 > 366) {
      setRangeError("Choose a date range of 366 days or fewer.");
      return;
    }
    setRange(draftRange);
    setActivePreset(null);
    setRangeError("");
  }

  function applyCashBalance(event: FormEvent<HTMLFormElement>) {
    void cashBalanceForm.handleSubmit((values) => {
      setCashBalance(values.cash_balance || undefined);
    })(event);
  }

  const metrics = metricsQuery.data;
  const burn = metrics ? Number(metrics.average_monthly_net_burn) : 0;
  const burnValue = metrics
    ? burn < 0
      ? "Generating cash"
      : burn === 0
        ? "No net burn"
        : `${formatMoney(metrics.average_monthly_net_burn, company.currency_code)} / mo`
    : null;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-xl bg-dark-bg px-6 py-7 text-dark-text shadow-xl  sm:px-9 sm:py-9">
        <div aria-hidden="true" className="absolute -right-14 -top-28 size-80 rounded-pill bg-dark-accent/20 blur-[90px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-dark-border bg-dark-surface text-dark-accent" variant="neutral">Company overview</Badge>
              <Badge className="border border-dark-border bg-dark-bg text-dark-text-muted" variant="neutral">{role}</Badge>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Welcome to {company.name}</h1>
            <p className="mt-2 text-sm leading-6 text-dark-text-muted">
              Financial totals and runway are supplied by FinPilot's company-scoped metrics service.
            </p>
          </div>
          <div className="relative rounded-lg border border-dark-border bg-dark-surface px-4 py-3 text-sm text-dark-text-muted">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Accounting currency</p>
            <p className="mt-1 font-semibold text-dark-text">{company.currency_code ?? "Owner setup needed"}</p>
          </div>
        </div>
      </section>

      <CashFlowRangeControls
        activePreset={activePreset}
        cashBalanceForm={cashBalanceForm}
        draftRange={draftRange}
        granularity={granularity}
        onApplyCashBalance={applyCashBalance}
        onApplyRange={applyCustomRange}
        onDraftChange={(field, value) => setDraftRange((current) => ({ ...current, [field]: value }))}
        onGranularity={setGranularity}
        onPreset={choosePreset}
        range={range}
        rangeError={rangeError}
      />

      <section aria-label="Financial key performance indicators" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard detail="For the selected cash-flow period" icon={<ArrowDownRight aria-hidden="true" className="size-5" />} title="Inflows">
          {metricsQuery.isPending || metricsQuery.isError ? (
            <QueryStatus error={metricsQuery.error} isError={metricsQuery.isError} isPending={metricsQuery.isPending} label="Loading inflows" onRetry={() => void metricsQuery.refetch()} />
          ) : formatMoney(metricsQuery.data.total_inflows, company.currency_code)}
        </MetricCard>
        <MetricCard detail="Positive magnitude, for the selected period" icon={<ArrowUpRight aria-hidden="true" className="size-5" />} title="Outflows">
          {metricsQuery.isPending || metricsQuery.isError ? (
            <QueryStatus error={metricsQuery.error} isError={metricsQuery.isError} isPending={metricsQuery.isPending} label="Loading outflows" onRetry={() => void metricsQuery.refetch()} />
          ) : formatMoney(metricsQuery.data.total_outflows, company.currency_code)}
        </MetricCard>
        <MetricCard detail="Returned directly by the metrics service" icon={<Activity aria-hidden="true" className="size-5" />} title="Net cash flow">
          {metricsQuery.isPending || metricsQuery.isError ? (
            <QueryStatus error={metricsQuery.error} isError={metricsQuery.isError} isPending={metricsQuery.isPending} label="Loading net cash flow" onRetry={() => void metricsQuery.refetch()} />
          ) : formatMoney(metricsQuery.data.net_cash_flow, company.currency_code)}
        </MetricCard>
        <MetricCard detail="Average monthly net burn across this period" icon={<CircleDollarSign aria-hidden="true" className="size-5" />} title="Average monthly burn">
          {metricsQuery.isPending || metricsQuery.isError ? (
            <QueryStatus error={metricsQuery.error} isError={metricsQuery.isError} isPending={metricsQuery.isPending} label="Loading burn estimate" onRetry={() => void metricsQuery.refetch()} />
          ) : burnValue}
        </MetricCard>
        <MetricCard detail={metrics?.runway_status === "cash_balance_required" ? "Add a cash balance above to estimate runway" : metrics?.runway_status === "no_net_burn" ? "No positive net burn to divide against" : "Estimated from the supplied cash balance"} icon={<Wallet aria-hidden="true" className="size-5" />} title="Runway">
          {metricsQuery.isPending || metricsQuery.isError ? (
            <QueryStatus error={metricsQuery.error} isError={metricsQuery.isError} isPending={metricsQuery.isPending} label="Loading runway estimate" onRetry={() => void metricsQuery.refetch()} />
          ) : metrics?.runway_status === "estimated" && metrics.runway_months !== null ? (
            <>{formatRunwayMonths(metrics.runway_months)} <span className="text-base font-medium text-muted">months</span></>
          ) : metrics?.runway_status === "no_net_burn" ? (
            <span className="text-lg">No estimate needed</span>
          ) : (
            <span className="text-lg">Add cash balance</span>
          )}
        </MetricCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.85fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Cash flow</CardTitle>
                <CardDescription className="mt-1">
                  Inflows and outflows by {granularity} for {metrics?.start_date ?? range.start_date} through {metrics?.end_date ?? range.end_date}.
                </CardDescription>
              </div>
              {metrics && <Badge variant="neutral">{metrics.transaction_count} transactions</Badge>}
            </div>
            <div className="mt-5">
              {metricsQuery.isPending || metricsQuery.isError ? (
                <QueryStatus error={metricsQuery.error} isError={metricsQuery.isError} isPending={metricsQuery.isPending} label="Loading cash-flow chart" onRetry={() => void metricsQuery.refetch()} />
              ) : metrics ? (
                <Suspense fallback={<LoadingState label="Loading the cash-flow chart" />}>
                  <CashFlowChart currencyCode={company.currency_code} metrics={metrics} />
                </Suspense>
              ) : null}
            </div>
          </CardHeader>
        </Card>

        <BudgetPanel
          currencyCode={company.currency_code}
          data={budgetQuery.data}
          error={budgetQuery.error}
          isError={budgetQuery.isError}
          isPending={budgetQuery.isPending}
          onPeriodChange={setPeriod}
          onRetry={() => void budgetQuery.refetch()}
          period={period}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(260px,0.7fr)_minmax(0,1.3fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Review queue</CardTitle>
                <CardDescription className="mt-1">Transactions awaiting category review.</CardDescription>
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-caution/20 text-pine">
                <Clock3 aria-hidden="true" className="size-5" />
              </span>
            </div>
            {reviewCountQuery.isPending || reviewCountQuery.isError ? (
              <QueryStatus error={reviewCountQuery.error} isError={reviewCountQuery.isError} isPending={reviewCountQuery.isPending} label="Loading review queue count" onRetry={() => void reviewCountQuery.refetch()} />
            ) : reviewCountQuery.data === 0 ? (
              <div className="mt-5 rounded-md bg-positive/10 p-4">
                <p className="font-semibold text-positive">Queue clear</p>
                <p className="mt-1 text-sm text-positive">There are no transactions waiting for category review.</p>
              </div>
            ) : (
              <div className="mt-5 flex items-end gap-2">
                <span className="text-4xl font-semibold tabular-nums tracking-tight text-foreground">{reviewCountQuery.data}</span>
                <span className="pb-1 text-sm text-muted">to review</span>
              </div>
            )}
          </CardHeader>
        </Card>

        <RecentTransactions
          currencyCode={company.currency_code}
          data={recentQuery.data}
          error={recentQuery.error}
          isError={recentQuery.isError}
          isPending={recentQuery.isPending}
          onRetry={() => void recentQuery.refetch()}
        />
      </section>
    </div>
  );
}
