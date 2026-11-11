import { format, isValid, parseISO } from "date-fns";
import { Activity, ExternalLink, Search, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { formatFigureText, formatMoney } from "../../lib/money";
import { useCompany, useRole } from "../companies/company-context";
import type { SpendingAnomaly, SpendingAnomalyReport } from "./api";
import { useRunAnomalyScan } from "./hooks";

const DAY_MIN = 1;
const DAY_MAX = 90;
const BASELINE_MIN = 30;
const BASELINE_MAX = 730;

function formatDate(value: string) {
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "MMM d, yyyy") : value;
}

function errorText(error: unknown) {
  if (error instanceof ApiError && error.status === 503) {
    return "The anomaly scan is temporarily unavailable. Try again shortly.";
  }
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The anomaly scan could not be completed.";
}

function AnomalyCard({ anomaly, companyId, currency }: {
  anomaly: SpendingAnomaly;
  companyId: string;
  currency: string | null;
}) {
  const basis = anomaly.comparison_basis === "vendor" ? "Vendor history" : "Category history";
  const subject = anomaly.description || anomaly.category_name || "Expense";

  return <article className="rounded-lg border border-card-line bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="danger">Unusual expense</Badge>
          <Badge variant="neutral">{basis}</Badge>
          <Badge variant={anomaly.explanation_source === "llm" ? "info" : "neutral"}>
            {anomaly.explanation_source === "llm" ? "LLM explanation" : "Deterministic explanation"}
          </Badge>
        </div>
        <h3 className="mt-3 break-words text-base font-semibold text-foreground">{subject}</h3>
        <p className="mt-1 text-xs text-muted">{formatDate(anomaly.date)}{anomaly.category_name ? ` · ${anomaly.category_name}` : ""}</p>
      </div>
      <p className="fp-figure shrink-0 text-lg font-semibold text-foreground">{formatMoney(anomaly.amount, currency)}</p>
    </div>

    <dl className="mt-4 grid gap-3 rounded-md bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Baseline average" value={formatMoney(anomaly.baseline_average, currency)} />
      <Metric label="Compared with" value={`${anomaly.baseline_transaction_count} prior expenses`} />
      <Metric label="Ratio to average" value={`${formatFigureText(anomaly.ratio_to_average)}×`} />
      <Metric label="Z-score" value={anomaly.z_score === null ? "Not available" : formatFigureText(anomaly.z_score)} />
    </dl>

    <p className="mt-4 text-sm leading-6 text-foreground-body">{anomaly.explanation}</p>
    <Link
      className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-accent underline decoration-accent underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/10"
      to={`/c/${companyId}/transactions/${anomaly.transaction_id}`}
    >
      <ExternalLink aria-hidden="true" className="size-4" />View transaction
    </Link>
  </article>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div>
    <dt className="text-xs font-medium text-muted">{label}</dt>
    <dd className="fp-figure mt-1 break-words text-sm font-semibold text-foreground">{value}</dd>
  </div>;
}

function TruncationNotice({ report }: { report: SpendingAnomalyReport }) {
  if (!report.scan_truncated && !report.anomalies_truncated) return null;
  return <div className="flex items-start gap-3 rounded-md border border-caution/40 bg-caution/20 p-4 text-sm leading-6 text-pine" role="status">
    <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <p>
      {report.scan_truncated && "The scan reached its transaction limit, so some recent expenses were not checked. "}
      {report.anomalies_truncated && "The report reached its anomaly limit, so additional anomalies are not shown."}
    </p>
  </div>;
}

function CompanyAnomalies({ companyId, currency }: { companyId: string; currency: string | null }) {
  const { role } = useRole();
  const [days, setDays] = useState("30");
  const [baselineDays, setBaselineDays] = useState("180");
  const [report, setReport] = useState<{ data: SpendingAnomalyReport; days: number; baselineDays: number } | null>(null);
  const scan = useRunAnomalyScan(companyId);
  const parsedDays = Number(days);
  const parsedBaseline = Number(baselineDays);
  const validDays = Number.isInteger(parsedDays) && parsedDays >= DAY_MIN && parsedDays <= DAY_MAX;
  const validBaseline = Number.isInteger(parsedBaseline) && parsedBaseline >= BASELINE_MIN && parsedBaseline <= BASELINE_MAX;
  const valid = validDays && validBaseline;

  const clearReport = () => {
    setReport(null);
    scan.reset();
  };

  const runScan = () => {
    if (!valid) return;
    const requestDays = parsedDays;
    const requestBaseline = parsedBaseline;
    scan.mutate(
      { days: requestDays, baseline_days: requestBaseline },
      { onSuccess: (data) => setReport({ data, days: requestDays, baselineDays: requestBaseline }) },
    );
  };

  const currentReport = report?.days === parsedDays && report.baselineDays === parsedBaseline
    ? report.data
    : null;

  return <div className="mx-auto max-w-5xl space-y-6">
    <div>
      <p className="fp-eyebrow">Insights · {role}</p>
      <h1 className="fp-page-title mt-2">Spending <em>anomalies</em></h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Compare recent company expenses with earlier vendor or category spending. The scan runs only when you ask for it.</p>
    </div>

    <Card>
      <CardHeader className="border-b border-line">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-caution/20 text-pine"><Activity aria-hidden="true" className="size-5" /></span>
          <div><CardTitle>Choose analysis windows</CardTitle><CardDescription className="mt-1">Recent expenses are compared against a separate earlier baseline. The company data is read-only.</CardDescription></div>
        </div>
      </CardHeader>
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-semibold text-muted" htmlFor="anomaly-days">
            Recent scan window (1–90 days)
            <Input className="fp-figure" id="anomaly-days" max={DAY_MAX} min={DAY_MIN} onChange={(event) => { setDays(event.currentTarget.value); clearReport(); }} type="number" value={days} />
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-muted" htmlFor="anomaly-baseline-days">
            Earlier baseline window (30–730 days)
            <Input className="fp-figure" id="anomaly-baseline-days" max={BASELINE_MAX} min={BASELINE_MIN} onChange={(event) => { setBaselineDays(event.currentTarget.value); clearReport(); }} type="number" value={baselineDays} />
          </label>
        </div>
        <p className="text-xs leading-5 text-muted">Windows do not overlap. The baseline ends the day before the recent scan begins. Explanation wording may be AI-generated or deterministic; the amounts and comparisons are computed by FinPilot.</p>
        {!valid && <p className="text-sm font-medium text-negative" role="alert">Enter whole-day values within the ranges shown.</p>}
        <Button disabled={!valid || scan.isPending} onClick={runScan}>
          <Search aria-hidden="true" className="size-4" />{scan.isPending ? "Scanning expenses…" : "Run anomaly scan"}
        </Button>
        {scan.error && <div className="space-y-3"><ErrorMessage>{errorText(scan.error)}</ErrorMessage><Button disabled={!valid || scan.isPending} onClick={runScan} variant="secondary">Try again</Button></div>}
      </div>
    </Card>

    {scan.isPending && <Card><LoadingState label="Checking recent expenses against company history" /></Card>}
    {currentReport && <ReportView companyId={companyId} currency={currency} report={currentReport} />}
    {!currentReport && !scan.isPending && !scan.error && <Card className="px-6 py-10 text-center">
      <Search aria-hidden="true" className="mx-auto size-7 text-muted" />
      <h2 className="mt-3 text-base font-semibold text-foreground">No scan has been run yet</h2>
      <p className="mt-1 text-sm text-muted">Choose a recent window and a baseline, then run the scan to see results for those dates.</p>
    </Card>}
  </div>;
}

function ReportView({ companyId, currency, report }: {
  companyId: string;
  currency: string | null;
  report: SpendingAnomalyReport;
}) {
  return <section aria-labelledby="anomaly-report-heading" className="space-y-4">
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div><CardTitle id="anomaly-report-heading">Scan report</CardTitle><CardDescription className="mt-1"><span className="tabular-nums">{report.scanned_transactions}</span> expenses checked in the recent window.</CardDescription></div>
        <Badge variant="neutral">On-demand · read-only</Badge>
        <div className="grid w-full gap-3 border-t border-line pt-4 sm:grid-cols-2">
          <p className="text-sm text-foreground-body"><span className="font-semibold">Recent window:</span> {formatDate(report.window_start)} – {formatDate(report.window_end)}</p>
          <p className="text-sm text-foreground-body"><span className="font-semibold">Baseline:</span> {formatDate(report.baseline_start)} – {formatDate(report.baseline_end)}</p>
        </div>
      </CardHeader>
    </Card>
    <TruncationNotice report={report} />
    {report.anomalies.length === 0 ? <Card className="px-6 py-10 text-center">
      <Activity aria-hidden="true" className="mx-auto size-7 text-positive" />
      <h2 className="mt-3 text-base font-semibold text-foreground">No unusual expenses found</h2>
      <p className="mt-1 text-sm text-muted">No expenses in {formatDate(report.window_start)} – {formatDate(report.window_end)} crossed the anomaly threshold.</p>
    </Card> : <div className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">Unusual expenses (<span className="tabular-nums">{report.anomalies.length}</span>)</h2>
      {report.anomalies.map((anomaly) => <AnomalyCard anomaly={anomaly} companyId={companyId} currency={currency} key={anomaly.transaction_id} />)}
    </div>}
  </section>;
}

export function AnomaliesPage() {
  const company = useCompany();
  return <CompanyAnomalies companyId={company.company_id} currency={company.currency_code} key={company.company_id} />;
}
