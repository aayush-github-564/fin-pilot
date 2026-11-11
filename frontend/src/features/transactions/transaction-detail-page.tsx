import { format, parseISO } from "date-fns";
import { ArrowLeft, ArrowDownRight, ArrowUpRight, FileText } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { formatMoney } from "../../lib/money";
import { useCompany } from "../companies/company-context";
import { useCategories, useTransactionById } from "./hooks";

function statusVariant(status: string) {
  if (status === "done") return "success" as const;
  if (status === "needs_review" || status === "failed") return "danger" as const;
  return "info" as const;
}

export function TransactionDetailPage() {
  const company = useCompany();
  const { transactionId = "" } = useParams();
  const transaction = useTransactionById(company.company_id, transactionId);
  const categories = useCategories(company.company_id);
  const backToLedger = `/c/${company.company_id}/transactions`;

  if (transaction.isPending) return <LoadingState label="Opening transaction" />;
  if (transaction.isError) return <main className="mx-auto max-w-2xl space-y-4 py-8">
    <ErrorMessage>{transaction.error instanceof ApiError ? transaction.error.message : "This transaction could not be loaded."}</ErrorMessage>
    <Button asChild variant="secondary"><Link to={backToLedger}><ArrowLeft aria-hidden="true" className="size-4" />Back to transactions</Link></Button>
  </main>;

  const item = transaction.data;
  const category = categories.data?.find((candidate) => candidate.id === item.category_id);
  const date = parseISO(item.date);

  return <div className="mx-auto max-w-3xl space-y-5">
    <Button asChild variant="secondary"><Link to={backToLedger}><ArrowLeft aria-hidden="true" className="size-4" />Back to transactions</Link></Button>
    <Card>
      <CardHeader className="border-b border-line">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-signal-deep/10 text-accent"><FileText aria-hidden="true" className="size-5" /></span>
            <div><CardDescription>Transaction</CardDescription><CardTitle className="mt-1">{item.description || "No description"}</CardTitle></div>
          </div>
          <Badge variant={statusVariant(item.categorization_status)}>{item.categorization_status.replaceAll("_", " ")}</Badge>
        </div>
        <p className="mt-4 inline-flex items-center gap-2 text-xl font-semibold tabular-nums text-foreground">
          {item.amount.startsWith("-") ? <ArrowUpRight aria-hidden="true" className="size-5 text-negative" /> : <ArrowDownRight aria-hidden="true" className="size-5 text-positive" />}
          {formatMoney(item.amount, company.currency_code)}
        </p>
      </CardHeader>
      <dl className="grid gap-4 p-5 sm:grid-cols-2">
        <Detail label="Date" value={Number.isNaN(date.getTime()) ? item.date : format(date, "MMMM d, yyyy")} />
        <Detail label="Source" value={item.source === "upload" ? "Imported" : "Manual"} />
        <Detail label="Category" value={categories.isPending ? "Loading category…" : categories.isError ? "Category unavailable" : category?.name ?? "Uncategorized"} />
        <Detail label="Categorization source" value={item.categorization_source?.replaceAll("_", " ") ?? "Not available"} />
      </dl>
    </Card>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-foreground">{value}</dd></div>;
}
